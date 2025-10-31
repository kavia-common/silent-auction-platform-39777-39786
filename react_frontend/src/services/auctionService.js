import { supabase } from '../lib/supabaseClient';
import { getOrCreateClientId } from '../lib/clientId';
import { uploadPublicImageToBucket } from './storageService';

const LS_JOIN_CONTEXT = 'auction.joinContext';

// Small, safe logger to help diagnose production preview issues without noise
const log = {
  info: (...args) => { if (process.env.NODE_ENV !== 'test') { try { console.info('[auction]', ...args); } catch {} } },
  warn: (...args) => { if (process.env.NODE_ENV !== 'test') { try { console.warn('[auction]', ...args); } catch {} } },
  error: (...args) => { if (process.env.NODE_ENV !== 'test') { try { console.error('[auction]', ...args); } catch {} } },
};

/**
 * Utility to generate a simple event code from a name.
 * Note: In a real app, prefer generating this in the database with uniqueness guarantees.
 *
 * Participant handling:
 * - This demo stores bidder identity client-side and writes it into bids.bidder_name on placeBid.
 * - The database includes an optional participants table for future enhancement (e.g., named attendees).
 */
function generateEventCode(name = '') {
  const slug = (name || 'event').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 8);
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `${slug}${rand}`;
}

/**
 * Get normalized event status:
 * - Prefer text status field (e.g., 'open'|'closed'|'active'), else fallback to boolean is_open,
 *   else default to 'open' for backwards compatibility.
 */
function getEventStatus(evt) {
  if (!evt) return 'open';
  if (typeof evt.status === 'string' && evt.status.trim()) return evt.status;
  if (typeof evt.is_open === 'boolean') return evt.is_open ? 'open' : 'closed';
  return 'open';
}

/**
 * Internal helper to detect if events.is_open exists (cached).
 * This avoids write errors in projects that haven't applied the is_open patch.
 */
let hasIsOpenCache = null;
async function ensureEventsIsOpenPresenceKnown() {
  if (typeof hasIsOpenCache === 'boolean') return hasIsOpenCache;
  const { data, error } = await supabase
    .from('events')
    .select('id, is_open')
    .limit(1)
    .maybeSingle();
  if (data && Object.prototype.hasOwnProperty.call(data, 'is_open')) {
    hasIsOpenCache = true;
    return true;
  }
  if (error && /column .*is_open.* does not exist/i.test(error.message || '')) {
    hasIsOpenCache = false;
    return false;
  }
  hasIsOpenCache = false;
  return false;
}

/**
 * Internal helper: detect optional per-item close columns on items (closed_at or is_open)
 * Used to gracefully support schemas that have these fields; otherwise we will do client-side disables.
 */
let hasItemClosedAt = null;
let hasItemIsOpen = null;
async function ensureItemCloseColumnsPresenceKnown() {
  if (hasItemClosedAt !== null && hasItemIsOpen !== null) {
    return { hasItemClosedAt, hasItemIsOpen };
  }
  // Probe with a select on a single row to see if columns exist
  const { data, error } = await supabase
    .from('items')
    .select('id, closed_at, is_open')
    .limit(1)
    .maybeSingle();
  if (error) {
    const msg = error.message || '';
    hasItemClosedAt = !/column .*closed_at.* does not exist/i.test(msg);
    hasItemIsOpen = !/column .*is_open.* does not exist/i.test(msg);
  } else {
    hasItemClosedAt = data ? Object.prototype.hasOwnProperty.call(data, 'closed_at') : false;
    hasItemIsOpen = data ? Object.prototype.hasOwnProperty.call(data, 'is_open') : false;
  }
  return { hasItemClosedAt, hasItemIsOpen };
}

/**
 * Wrapper to perform a Supabase call with short retry/backoff for transient network/replica lag issues.
 * Attempts: 3 (0ms, 300ms, 300ms); returns first successful response or the last error.
 */
async function withShortRetry(fn) {
  const delays = [0, 300, 300];
  let last;
  for (let i = 0; i < delays.length; i++) {
    if (delays[i] > 0) {
      await new Promise((r) => setTimeout(r, delays[i]));
    }
    try {
      last = await fn();
      if (!last || (last && last.error)) {
        // continue
      } else {
        return last;
      }
    } catch (e) {
      last = { data: null, error: e };
    }
  }
  return last;
}

// PUBLIC_INTERFACE
export async function createEvent(name, customCode) {
  /** Create a new auction event with a generated code. Returns { data, error }. */
  const code = (customCode && customCode.trim()) ? customCode.trim() : generateEventCode(name);
  const payload = { name, code, status: 'open' };
  try {
    const hasIsOpen = await ensureEventsIsOpenPresenceKnown();
    if (hasIsOpen) payload.is_open = true;
  } catch { /* omit is_open if detection fails */ }
  const call = () => supabase.from('events').insert([payload]).select('*').single();
  const { data, error } = await withShortRetry(call);
  return { data, error };
}

// PUBLIC_INTERFACE
export async function sendHostMagicLink(email, eventId) {
  /** Send a Supabase Auth magic link to host with redirect to dashboard. */
  if (!email) return { data: null, error: new Error('Email is required') };
  const siteOrigin =
    process.env.REACT_APP_SITE_URL ||
    (typeof window !== 'undefined' ? window.location.origin : '');
  const redirectUrl = `${siteOrigin}/host/callback${eventId ? `?eventId=${encodeURIComponent(eventId)}` : ''}`;
  return withShortRetry(() => supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectUrl }
  }));
}

// PUBLIC_INTERFACE
export async function getEventByCode(code) {
  /** Fetch event by code (limit 1, maybeSingle for resilience). */
  const call = () =>
    supabase
      .from('events')
      .select('id, name, code, status, is_open, created_at')
      .eq('code', code)
      .limit(1)
      .maybeSingle();
  const { data, error } = await withShortRetry(call);
  return { data, error };
}

// PUBLIC_INTERFACE
export async function validateEventCode(eventCode) {
  /** Validate event code existence. */
  return getEventByCode(eventCode);
}

// PUBLIC_INTERFACE
export function storeBidderContext(partial) {
  /** Merge and store bidder context in localStorage. */
  try {
    const raw = localStorage.getItem(LS_JOIN_CONTEXT);
    const existing = raw ? JSON.parse(raw) : {};
    const updated = { ...existing, ...partial };
    localStorage.setItem(LS_JOIN_CONTEXT, JSON.stringify(updated));
  } catch { /* ignore */ }
}

// PUBLIC_INTERFACE
export async function getEventByName(name) {
  /** Fetch an event by name (not guaranteed unique). */
  const call = () =>
    supabase.from('events').select('*').eq('name', name).limit(1).maybeSingle();
  const { data, error } = await withShortRetry(call);
  return { data, error };
}

/**
 * (Removed) Legacy helper for item_image_url updates. No-op retained for compatibility.
 * Calls will be ignored as we no longer reference or persist item_image_url.
 */
async function tryUpdateItemImageUrl() {
  return { data: null, error: null };
}

/**
 * Internal: update item with image storage path if column exists, otherwise ignore.
 */
async function tryUpdateItemImagePath(itemId, imagePath) {
  if (!itemId || !imagePath) return { data: null, error: null };
  const { data, error } = await withShortRetry(() =>
    supabase.from('items').update({ image_path: imagePath }).eq('id', itemId).select('*').single()
  );
  if (error && /column .*image_path.* does not exist/i.test(error.message || '')) {
    return { data: null, error: null };
  }
  return { data, error };
}

/**
 * Attempt to persist both image_path and a public image_url if available.
 * The image_url is generated via storageService.getPublicUrl at upload time.
 */
export async function addItem(eventId, item, imageFile) {
  const payload = {
    event_id: eventId,
    title: item.title,
    description: item.description || '',
    starting_bid: Number(item.starting_bid || 0),
    // Force include any provided image refs from caller (AddItemModal passes both)
    ...(item?.image_path ? { image_path: item.image_path } : {}),
    ...(item?.image_url ? { image_url: item.image_url } : {}),
  };

  // Dev-safe log of outgoing payload (no raw URL)
  if (process.env.NODE_ENV !== 'test') {
    try {
      console.info('[auction:addItem] inserting item', {
        has_image_path: !!payload.image_path,
        has_image_url: !!payload.image_url,
        image_url_len: payload.image_url ? String(payload.image_url).length : 0
      });
    } catch {}
  }

  // Create item first (so we have id for subsequent upload if needed)
  const insertCall = () => supabase.from('items').insert([payload]).select('*').single();
  const { data: created, error: createErr } = await withShortRetry(insertCall);

  if (process.env.NODE_ENV !== 'test') {
    try {
      console.info('[auction:addItem] insert result', {
        ok: !createErr,
        id: created?.id || null,
        has_image_path: !!created?.image_path,
        has_image_url: !!created?.image_url,
        image_url_len: created?.image_url ? String(created.image_url).length : 0
      });
    } catch {}
  }

  if (createErr) return { data: null, error: createErr };

  // If a file is provided, upload and persist storage key and image_url (if public)
  if (imageFile) {
    const { path, publicUrl, error: uploadErr } = await uploadPublicImageToBucket(eventId, created.id, imageFile);
    if (uploadErr) {
      // Keep the item, but surface error to caller
      if (process.env.NODE_ENV !== 'test') {
        try {
          console.warn('[auction:addItem] upload failed after insert', { id: created.id, message: uploadErr.message });
        } catch {}
      }
      return { data: created, error: uploadErr };
    }
    const updates = { image_path: path || null };
    if (publicUrl) updates.image_url = publicUrl;

    if (process.env.NODE_ENV !== 'test') {
      try {
        console.info('[auction:addItem] patching image fields', {
          id: created.id,
          has_public_url: !!publicUrl,
          url_len: publicUrl ? String(publicUrl).length : 0,
          has_path: !!path
        });
      } catch {}
    }

    const { data: updated, error: patchErr } = await withShortRetry(() =>
      supabase.from('items').update(updates).eq('id', created.id).select('*').single()
    );

    if (process.env.NODE_ENV !== 'test') {
      try {
        console.info('[auction:addItem] patch result', {
          ok: !patchErr,
          id: updated?.id || created?.id || null,
          has_image_path: !!updated?.image_path,
          has_image_url: !!updated?.image_url,
          image_url_len: updated?.image_url ? String(updated.image_url).length : 0
        });
      } catch {}
    }

    // Temporary hard update fallback: if server response still lacks image_url but we have it client-side, force update
    if (!patchErr && updated && !updated.image_url && updates.image_url) {
      try {
        const { data: forced, error: forceErr } = await withShortRetry(() =>
          supabase.from('items').update({ image_url: updates.image_url }).eq('id', created.id).select('*').single()
        );
        if (process.env.NODE_ENV !== 'test') {
          try {
            console.info('[auction:addItem] forced image_url update', {
              ok: !forceErr,
              id: forced?.id || created.id,
              has_image_url: !!forced?.image_url
            });
          } catch {}
        }
        return { data: forced || updated, error: forceErr || null };
      } catch (e) {
        // swallow; return the best we have
      }
    }

    return { data: updated || created, error: patchErr || null };
  }

  // No image file but caller may have passed image_url (pre-upload via AddItemModal). If DB dropped it, try a fallback update.
  if (payload.image_url && created && !created.image_url) {
    try {
      const { data: forced, error: forceErr } = await withShortRetry(() =>
        supabase.from('items').update({ image_url: payload.image_url }).eq('id', created.id).select('*').single()
      );
      if (process.env.NODE_ENV !== 'test') {
        try {
          console.info('[auction:addItem] forced image_url update (no file path case)', {
            ok: !forceErr,
            id: forced?.id || created.id,
            has_image_url: !!forced?.image_url
          });
        } catch {}
      }
      return { data: forced || created, error: forceErr || null };
    } catch {
      // continue to return created
    }
  }

  return { data: created, error: null };
}

/**
 * PUBLIC_INTERFACE
 * Convenience alias explicitly indicating image handling.
 */
export async function addItemWithImage(eventId, item, imageFile) {
  return addItem(eventId, item, imageFile);
}

/**
 * PUBLIC_INTERFACE
 * Update only the image for an existing item: uploads file and patches items.image_path and items.image_url (if public).
 */
export async function updateItemImage(eventId, itemId, file) {
  /** Uploads an image for an existing item and persists items.image_path and image_url (if public). */
  if (!eventId || !itemId || !file) {
    return { data: null, error: new Error('Missing parameters') };
  }
  const { path, publicUrl, error: uploadErr } = await uploadPublicImageToBucket(eventId, itemId, file);
  if (uploadErr) return { data: null, error: uploadErr };

  const updates = { image_path: path || null };
  if (publicUrl) updates.image_url = publicUrl;

  if (process.env.NODE_ENV !== 'test') {
    try {
      console.info('[auction:updateItemImage] patching item image', {
        itemId,
        has_public_url: !!publicUrl,
        url_len: publicUrl ? String(publicUrl).length : 0,
        has_path: !!path
      });
    } catch {}
  }

  // Immediately persist both image_path and image_url
  const { data, error: patchErr } = await withShortRetry(() =>
    supabase.from('items').update(updates).eq('id', itemId).select('*').single()
  );

  if (process.env.NODE_ENV !== 'test') {
    try {
      console.info('[auction:updateItemImage] patch result', {
        ok: !patchErr,
        id: data?.id || null,
        has_image_path: !!data?.image_path,
        has_image_url: !!data?.image_url,
        image_url_len: data?.image_url ? String(data.image_url).length : 0
      });
    } catch {}
  }

  // Fallback hard update if image_url not reflected but we have it
  if (!patchErr && data && !data.image_url && updates.image_url) {
    const { data: forced, error: forceErr } = await withShortRetry(() =>
      supabase.from('items').update({ image_url: updates.image_url }).eq('id', itemId).select('*').single()
    );
    if (process.env.NODE_ENV !== 'test') {
      try {
        console.info('[auction:updateItemImage] forced image_url update', {
          ok: !forceErr,
          id: forced?.id || itemId,
          has_image_url: !!forced?.image_url
        });
      } catch {}
    }
    return { data: forced || data, error: forceErr || null };
  }

  return { data, error: patchErr || null };
}

/** Items are listed selecting image_url and image_path.
 * Rendering components will use image_url first, then compute from image_path via storageService.
 */
// PUBLIC_INTERFACE
export async function listItems(eventId) {
  /** List items for an event; includes image_url and image_path. */
  const call = () =>
    supabase
      .from('items')
      // Select image_url alongside image_path; UI prefers image_url.
      .select('id, event_id, title, description, starting_bid, created_at, image_path, image_url')
      .eq('event_id', eventId)
      .order('created_at', { ascending: true });
  const { data, error } = await withShortRetry(call);

  // Console-safe diagnostics for potential image_path mismatches (do not print raw URLs to UI)
  if (!error && Array.isArray(data)) {
    const bad = data.filter((it) => it.image_path && typeof it.image_path === 'string' && it.image_path.startsWith('http'));
    if (bad.length > 0 && process.env.NODE_ENV !== 'test') {
      try {
        console.warn('[auction] Detected items with full URLs in image_path; expected storage object path (e.g., folder/key.jpg)', {
          count: bad.length,
          examples: bad.slice(0, 2).map((b) => ({ id: b.id }))
        });
      } catch {}
    }
    if (process.env.NODE_ENV !== 'test') {
      try {
        const summary = data.slice(0, 10).map((r) => ({
          id: r.id,
          has_image_url: !!r.image_url,
          image_url_len: r.image_url ? String(r.image_url).length : 0,
          has_image_path: !!r.image_path
        }));
        console.info('[auction:listItems] sample image fields', { count: data.length, sample: summary });
      } catch {}
    }
  }

  return { data, error };
}

// PUBLIC_INTERFACE
export async function deleteItem(itemId) {
  /** Delete an item. */
  const call = () => supabase.from('items').delete().eq('id', itemId);
  const { data, error } = await withShortRetry(call);
  return { data, error };
}

// PUBLIC_INTERFACE
export async function listBidsForItem(itemId) {
  /** List bids for an item. */
  const call = () =>
    supabase
      .from('bids')
      .select('*')
      .eq('item_id', itemId)
      .order('amount', { ascending: false })
      .order('created_at', { ascending: true });
  const { data, error } = await withShortRetry(call);
  return { data, error };
}

// PUBLIC_INTERFACE
export async function getHighBid(itemId) {
  /** Highest bid for item. */
  const call = () =>
    supabase
      .from('bids')
      .select('id, amount, bidder_name, bidder_session_id, created_at')
      .eq('item_id', itemId)
      .order('amount', { ascending: false })
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
  const { data, error } = await withShortRetry(call);
  return { data, error };
}

// PUBLIC_INTERFACE
export async function placeBid({ eventId, itemId, amount, bidderName }) {
  /** Place a bid with client-side validation and bidder_session_id shim. */
  const numeric = Number(amount);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return { data: null, error: new Error('Bid amount must be a positive number') };
  }

  const { data: itemRow, error: itemErr } = await withShortRetry(() =>
    supabase
      .from('items')
      .select('id, starting_bid')
      .eq('id', itemId)
      .limit(1)
      .maybeSingle()
  );
  if (itemErr) return { data: null, error: new Error(itemErr.message || 'Unable to validate bid') };

  const starting = Number(itemRow?.starting_bid || 0);
  const { data: high, error: highErr } = await getHighBid(itemId);
  if (highErr) {
    log.warn('Could not fetch high bid for validation:', highErr.message);
  }
  const current = Math.max(starting, Number(high?.amount || 0));
  if (numeric <= current) {
    return { data: null, error: new Error(`Bid must be greater than current price (${current})`) };
  }

  const clientId = getOrCreateClientId();
  const payload = {
    event_id: eventId,
    item_id: itemId,
    amount: numeric,
    bidder_name: (bidderName || 'Anonymous').trim() || 'Anonymous',
    bidder_session_id: clientId
  };

  let insert = await withShortRetry(() =>
    supabase.from('bids').insert([payload]).select('*').single()
  );
  if (insert.error && /column .*bidder_session_id.* does not exist/i.test(insert.error.message || '')) {
    const { bidder_session_id, ...fallbackPayload } = payload;
    insert = await withShortRetry(() =>
      supabase.from('bids').insert([fallbackPayload]).select('*').single()
    );
  }
  return insert;
}

// PUBLIC_INTERFACE
export function subscribeToItems(eventId, onChange) {
  /** Subscribe to realtime item changes for an event. */
  const channel = supabase
    .channel(`items-changes-${eventId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'items', filter: `event_id=eq.${eventId}` },
      (payload) => { if (typeof onChange === 'function') onChange(payload); }
    )
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}

// PUBLIC_INTERFACE
export function subscribeToBids(itemId, onChange) {
  /** Subscribe to realtime bid changes for a given item. */
  const channel = supabase
    .channel(`bids-changes-item-${itemId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'bids', filter: `item_id=eq.${itemId}` },
      (payload) => { if (typeof onChange === 'function') onChange(payload); }
    )
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}

// PUBLIC_INTERFACE
export function subscribeToEvent(eventId, onChange) {
  /** Subscribe to realtime event row updates (status/is_open). */
  const channel = supabase
    .channel(`event-${eventId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'events', filter: `id=eq.${eventId}` },
      (payload) => { if (typeof onChange === 'function') onChange(payload); }
    )
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}

// PUBLIC_INTERFACE
export async function updateAuctionStatus(eventId, desired) {
  /** Update event status and is_open (if available). */
  const isOpen = desired === 'open';
  const updates = { status: desired };
  try {
    const hasIsOpen = await ensureEventsIsOpenPresenceKnown();
    if (hasIsOpen) updates.is_open = isOpen;
  } catch { /* skip is_open */ }
  const call = () =>
    supabase
      .from('events')
      .update(updates)
      .eq('id', eventId)
      .select('*')
      .single();
  const { data, error } = await withShortRetry(call);
  return { data, error };
}

// PUBLIC_INTERFACE
export async function getEventById(eventId) {
  /** Get event by id for host. */
  const call = () =>
    supabase
      .from('events')
      .select('id, name, code, status, is_open, created_at')
      .eq('id', eventId)
      .limit(1)
      .maybeSingle();
  const { data, error } = await withShortRetry(call);
  return { data, error };
}

// PUBLIC_INTERFACE
export function getNormalizedEventStatus(evt) {
  /** Return normalized status string for UI logic. */
  return getEventStatus(evt);
}

/**
 * Winners and analytics helpers
 */

// PUBLIC_INTERFACE
export async function getWinnersForEvent(eventId) {
  /** Winners list per item for a given eventId using highest bid per item; ties -> earliest created_at. */
  if (!eventId) return { data: [], error: null };
  log.info('Fetching winners for event', eventId);

  // Load items scoped to event first to avoid cross-event joins
  const { data: itemsData, error: itemsErr } = await withShortRetry(() =>
    supabase
      .from('items')
      .select('id, title, starting_bid, event_id, created_at')
      .eq('event_id', eventId)
      .order('created_at', { ascending: true })
  );
  if (itemsErr) {
    log.warn('Items query failed for winners:', itemsErr.message);
    return { data: null, error: itemsErr };
  }
  const items = itemsData || [];
  if (items.length === 0) return { data: [], error: null };

  // Fetch bids only for those items; order ensures first occurrence is winner (amount desc, created_at asc)
  const itemIds = items.map(i => i.id);
  const { data: bidsData, error: bidsErr } = await withShortRetry(() =>
    supabase
      .from('bids')
      .select('item_id, id, amount, bidder_name, bidder_session_id, created_at')
      .in('item_id', itemIds)
      .order('amount', { ascending: false })
      .order('created_at', { ascending: true })
  );
  if (bidsErr) {
    log.warn('Bids query failed for winners:', bidsErr.message);
    return { data: null, error: bidsErr };
  }

  const winnerByItem = {};
  for (const b of bidsData || []) {
    if (!winnerByItem[b.item_id]) winnerByItem[b.item_id] = b;
  }

  const winners = items.map((it) => {
    const win = winnerByItem[it.id] || null;
    const title = (it.title && String(it.title).trim()) ? it.title : (it.name || '');
    return {
      item_id: it.id,
      title,
      starting_bid: it.starting_bid ?? 0,
      winning_bid_id: win?.id || null,
      winning_amount: win ? Number(win.amount) : null,
      bidder_name: win?.bidder_name || null,
      bidder_session_id: win?.bidder_session_id || null,
      bid_time: win?.created_at || null
    };
  });

  return { data: winners, error: null };
}

// PUBLIC_INTERFACE
export async function getWinnerForItem(itemId) {
  /** Highest bid for a single item; ties resolved by earliest time. */
  const call = () =>
    supabase
      .from('bids')
      .select('id, amount, bidder_name, bidder_session_id, created_at')
      .eq('item_id', itemId)
      .order('amount', { ascending: false })
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
  const { data, error } = await withShortRetry(call);
  return { data, error };
}

// PUBLIC_INTERFACE
export async function getHighestBidPerItem(eventId) {
  /** Map: itemId -> highest bid amount (fallback to starting_bid if no bids). */
  if (!eventId) return { data: {}, error: null };

  const { data: items, error: itemsErr } = await withShortRetry(() =>
    supabase.from('items').select('id, starting_bid').eq('event_id', eventId)
  );
  if (itemsErr) {
    log.warn('Items query failed for highest per item:', itemsErr.message);
    return { data: null, error: itemsErr };
  }

  const itemIds = (items || []).map(i => i.id);
  if (itemIds.length === 0) return { data: {}, error: null };

  const { data: bids, error: bidsErr } = await withShortRetry(() =>
    supabase
      .from('bids')
      .select('item_id, amount, created_at')
      .in('item_id', itemIds)
      .order('amount', { ascending: false })
      .order('created_at', { ascending: true })
  );
  if (bidsErr) {
    log.warn('Bids query failed for highest per item:', bidsErr.message);
    return { data: null, error: bidsErr };
  }

  const map = {};
  for (const b of bids || []) {
    if (map[b.item_id] == null) map[b.item_id] = Number(b.amount);
  }
  for (const it of items) {
    if (map[it.id] == null) map[it.id] = Number(it.starting_bid || 0);
  }
  return { data: map, error: null };
}

// PUBLIC_INTERFACE
export async function getBidCountsPerItem(eventId) {
  /** Map: itemId -> count of bids. */
  if (!eventId) return { data: {}, error: null };

  // Only count bids for items under this event to avoid cross-event contamination
  const { data: items, error: itemsErr } = await withShortRetry(() =>
    supabase.from('items').select('id').eq('event_id', eventId)
  );
  if (itemsErr) {
    log.warn('Items query failed for counts per item:', itemsErr.message);
    return { data: null, error: itemsErr };
  }
  const ids = (items || []).map(i => i.id);
  if (ids.length === 0) return { data: {}, error: null };

  const { data: bids, error: bidsErr } = await withShortRetry(() =>
    supabase.from('bids').select('item_id').in('item_id', ids)
  );
  if (bidsErr) {
    log.warn('Bids query failed for counts per item:', bidsErr.message);
    return { data: null, error: bidsErr };
  }

  const counts = {};
  for (const id of ids) counts[id] = 0;
  for (const b of bids || []) counts[b.item_id] = (counts[b.item_id] || 0) + 1;
  return { data: counts, error: null };
}

// PUBLIC_INTERFACE
export async function getBidsTimeSeries(eventId, options = {}) {
  /**
   * Time series for bids in last window; returns [{x: unixMs, y: count}]
   */
  const bucketSizeMs = Math.max(1000, Number(options.bucketSizeMs || 60000));
  const durationMs = Math.max(bucketSizeMs, Number(options.durationMs || 60 * 60 * 1000));
  const end = Date.now();
  const start = end - durationMs;

  if (!eventId) return { data: [], error: null };

  const sinceIso = new Date(start).toISOString();
  const { data, error } = await withShortRetry(() =>
    supabase
      .from('bids')
      .select('created_at')
      .eq('event_id', eventId)
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: true })
  );
  if (error) {
    log.warn('Time series query failed:', error.message);
    return { data: null, error };
  }

  // init buckets
  const buckets = new Map();
  for (let ts = start; ts <= end; ts += bucketSizeMs) {
    buckets.set(ts - (ts % bucketSizeMs), 0);
  }
  for (const row of data || []) {
    const t = new Date(row.created_at).getTime();
    const key = t - (t % bucketSizeMs);
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) || 0) + 1);
  }
  const series = Array.from(buckets.entries()).sort((a, b) => a[0] - b[0]).map(([x, y]) => ({ x, y }));
  return { data: series, error: null };
}

// PUBLIC_INTERFACE
export function subscribeToBidsForEvent(eventId, onChange) {
  /** Subscribe to event-level bid changes for realtime analytics refresh. */
  const channel = supabase
    .channel(`bids-changes-event-${eventId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'bids', filter: `event_id=eq.${eventId}` },
      (payload) => { if (typeof onChange === 'function') onChange(payload); }
    )
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}

export function getItemDisplayFields(item) {
  /**
   * Returns normalized fields for displaying an item.
   * Prefer server-stored image_url (public) when present; otherwise use image_path fallback.
   */
  const title = (item?.title && String(item.title).trim()) ? item.title : (item?.name || '');
  const imageUrl = (typeof item?.image_url === 'string' && item.image_url.trim()) ? item.image_url.trim() : '';
  const imagePath = item?.image_path || '';

  // Avoid logging raw URLs; only minimal diagnostics for obvious path mistakes.
  if (!imageUrl && imagePath && process.env.NODE_ENV !== 'test') {
    try {
      if (/^https?:\/\//i.test(imagePath)) {
        console.warn('[auction] image_path appears to be a full URL; expected storage key path', { id: item?.id });
      } else if (imagePath.startsWith('the-auction-images/')) {
        console.warn('[auction] image_path contains bucket prefix; expected object path without bucket name', { id: item?.id });
      }
    } catch {}
  }

  return { title, imageUrl, imagePath };
}

export default {
  createEvent,
  sendHostMagicLink,
  getEventByCode,
  getEventByName,
  validateEventCode,
  storeBidderContext,
  addItem,
  addItemWithImage,
  listItems,
  deleteItem,
  placeBid,
  listBidsForItem,
  getHighBid,
  subscribeToItems,
  subscribeToBids,
  subscribeToEvent,
  updateAuctionStatus,
  getEventById,
  getNormalizedEventStatus,
  getWinnersForEvent,
  getWinnerForItem,
  getHighestBidPerItem,
  getBidCountsPerItem,
  getBidsTimeSeries,
  subscribeToBidsForEvent,
  getItemDisplayFields,
  updateItemImage
};
