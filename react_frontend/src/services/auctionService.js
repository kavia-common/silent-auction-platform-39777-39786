import { supabase } from '../lib/supabaseClient';
import { getOrCreateClientId } from '../lib/clientId';

const LS_JOIN_CONTEXT = 'auction.joinContext';

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

// PUBLIC_INTERFACE
export async function createEvent(name, customCode) {
  /** Create a new auction event with a generated code. Returns { data, error }. */
  const code = (customCode && customCode.trim()) ? customCode.trim() : generateEventCode(name);
  const payload = { name, code, status: 'open' };
  try {
    const hasIsOpen = await ensureEventsIsOpenPresenceKnown();
    if (hasIsOpen) payload.is_open = true;
  } catch { /* omit is_open if detection fails */ }
  const { data, error } = await supabase.from('events').insert([payload]).select('*').single();
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
  const { data, error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectUrl }
  });
  return { data, error };
}

// PUBLIC_INTERFACE
export async function getEventByCode(code) {
  /** Fetch event by code (limit 1, maybeSingle for resilience). */
  const { data, error } = await supabase
    .from('events')
    .select('id, name, code, status, is_open, created_at')
    .eq('code', code)
    .limit(1)
    .maybeSingle();
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
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('name', name)
    .limit(1)
    .maybeSingle();
  return { data, error };
}

// PUBLIC_INTERFACE
export async function addItem(eventId, item) {
  /** Add new item to an event. */
  const payload = {
    event_id: eventId,
    title: item.title,
    description: item.description || '',
    starting_bid: Number(item.starting_bid || 0)
  };
  const { data, error } = await supabase.from('items').insert([payload]).select('*').single();
  return { data, error };
}

// PUBLIC_INTERFACE
export async function listItems(eventId) {
  /** List items for an event. */
  const { data, error } = await supabase
    .from('items')
    .select('*')
    .eq('event_id', eventId)
    .order('created_at', { ascending: true });
  return { data, error };
}

// PUBLIC_INTERFACE
export async function deleteItem(itemId) {
  /** Delete an item. */
  const { data, error } = await supabase.from('items').delete().eq('id', itemId);
  return { data, error };
}

// PUBLIC_INTERFACE
export async function listBidsForItem(itemId) {
  /** List bids for an item. */
  const { data, error } = await supabase
    .from('bids')
    .select('*')
    .eq('item_id', itemId)
    .order('amount', { ascending: false });
  return { data, error };
}

// PUBLIC_INTERFACE
export async function getHighBid(itemId) {
  /** Highest bid for item. */
  const { data, error } = await supabase
    .from('bids')
    .select('id, amount, bidder_name, created_at')
    .eq('item_id', itemId)
    .order('amount', { ascending: false })
    .limit(1)
    .maybeSingle();
  return { data, error };
}

// PUBLIC_INTERFACE
export async function placeBid({ eventId, itemId, amount, bidderName }) {
  /** Place a bid with client-side validation and bidder_session_id shim. */
  const numeric = Number(amount);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return { data: null, error: new Error('Bid amount must be a positive number') };
  }

  const { data: itemRow, error: itemErr } = await supabase
    .from('items')
    .select('id, starting_bid')
    .eq('id', itemId)
    .limit(1)
    .maybeSingle();
  if (itemErr) return { data: null, error: new Error(itemErr.message || 'Unable to validate bid') };

  const starting = Number(itemRow?.starting_bid || 0);
  const { data: high, error: highErr } = await getHighBid(itemId);
  if (highErr) {
    // eslint-disable-next-line no-console
    console.warn('Could not fetch high bid for validation:', highErr.message);
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

  let insert = await supabase.from('bids').insert([payload]).select('*').single();
  if (insert.error && /column .*bidder_session_id.* does not exist/i.test(insert.error.message || '')) {
    const { bidder_session_id, ...fallbackPayload } = payload;
    insert = await supabase.from('bids').insert([fallbackPayload]).select('*').single();
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
  const { data, error } = await supabase
    .from('events')
    .update(updates)
    .eq('id', eventId)
    .select('*')
    .single();
  return { data, error };
}

// PUBLIC_INTERFACE
export async function getEventById(eventId) {
  /** Get event by id for host. */
  const { data, error } = await supabase
    .from('events')
    .select('id, name, code, status, is_open, created_at')
    .eq('id', eventId)
    .limit(1)
    .maybeSingle();
  return { data, error };
}

// PUBLIC_INTERFACE
export function getNormalizedEventStatus(evt) {
  /** Return normalized status string for UI logic. */
  return getEventStatus(evt);
}

// PUBLIC_INTERFACE
export async function getWinnersForEvent(eventId) {
  /** Compute winners by reducing highest bid per item in one query set. */
  const { data: items, error: itemsErr } = await listItems(eventId);
  if (itemsErr) return { data: null, error: itemsErr };
  const itemIds = (items || []).map((it) => it.id);
  if (itemIds.length === 0) return { data: [], error: null };

  const { data: bids, error: bidsErr } = await supabase
    .from('bids')
    .select('item_id, id, amount, bidder_name, created_at')
    .in('item_id', itemIds);
  if (bidsErr) return { data: null, error: bidsErr };

  const byItem = {};
  for (const b of bids || []) {
    const prev = byItem[b.item_id];
    if (!prev) {
      byItem[b.item_id] = b;
    } else if (Number(b.amount) > Number(prev.amount)) {
      byItem[b.item_id] = b;
    } else if (Number(b.amount) === Number(prev.amount)) {
      if (new Date(b.created_at).getTime() < new Date(prev.created_at).getTime()) {
        byItem[b.item_id] = b;
      }
    }
  }

  const enriched = items.map((it) => {
    const win = byItem[it.id] || null;
    return {
      item_id: it.id,
      title: it.title || it.name || '',
      starting_bid: it.starting_bid ?? 0,
      winning_bid_id: win?.id || null,
      winning_amount: win ? Number(win.amount) : null,
      bidder_name: win?.bidder_name || null,
      bid_time: win?.created_at || null
    };
  });
  return { data: enriched, error: null };
}

// PUBLIC_INTERFACE
export async function getWinnerForItem(itemId) {
  /** Highest bid for a single item; ties resolved by earliest time. */
  const { data, error } = await supabase
    .from('bids')
    .select('id, amount, bidder_name, created_at')
    .eq('item_id', itemId)
    .order('amount', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  return { data, error };
}

export default {
  createEvent,
  sendHostMagicLink,
  getEventByCode,
  getEventByName,
  validateEventCode,
  storeBidderContext,
  addItem,
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
  getWinnerForItem
};
