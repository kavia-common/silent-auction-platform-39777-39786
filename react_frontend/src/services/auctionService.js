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
  // Prefer string status if present
  if (typeof evt.status === 'string' && evt.status.trim()) return evt.status;
  // Fallback to boolean is_open (older/newer schema variant)
  if (typeof evt.is_open === 'boolean') return evt.is_open ? 'open' : 'closed';
  // Default to open to avoid blocking the UI if both are absent
  return 'open';
}

/**
 * NOTE: The database must generate the primary key for events.id (UUID default).
 * Ensure your Supabase schema has: id uuid primary key default gen_random_uuid()
 * This function intentionally omits 'id' from the insert payload.
 */
let hasIsOpenCache = null;
async function ensureEventsIsOpenPresenceKnown() {
  // Fast path
  if (typeof hasIsOpenCache === 'boolean') return hasIsOpenCache;
  // Probe one row for shape; if no rows, use a select with limited columns and check error details
  const { data, error } = await supabase
    .from('events')
    .select('id, is_open')
    .limit(1)
    .maybeSingle();

  // If we got data and 'is_open' in it (could be undefined if column missing)
  if (data && Object.prototype.hasOwnProperty.call(data, 'is_open')) {
    hasIsOpenCache = true;
    return true;
  }

  // If error mentions 'column' or 'is_open' missing, infer false; otherwise conservatively assume false
  if (error && /column .*is_open.* does not exist/i.test(error.message || '')) {
    hasIsOpenCache = false;
    return false;
  }

  // If no rows returned, we cannot observe shape; try a safer detection by querying information_schema via RPC is not available on anon.
  // Fall back to false (omit is_open in writes) to avoid runtime errors; the UI still works by using status text.
  hasIsOpenCache = false;
  return false;
}

// PUBLIC_INTERFACE
export async function createEvent(name, customCode) {
  /** Create a new auction event with a generated code. Returns { data, error }. */
  const code = (customCode && customCode.trim()) ? customCode.trim() : generateEventCode(name);

  // Build payload without 'id' to allow DB default to generate it
  const payload = { name, code, status: 'open' };
  // Conditionally include is_open if the column exists
  try {
    const hasIsOpen = await ensureEventsIsOpenPresenceKnown();
    if (hasIsOpen) payload.is_open = true;
  } catch {
    // ignore detection errors; omit is_open to be safe
  }

  // Insert and return created event
  const { data, error } = await supabase
    .from('events')
    .insert([payload])
    .select('*')
    .single();

  return { data, error };
}

// PUBLIC_INTERFACE
export async function sendHostMagicLink(email, eventId) {
  /**
   * Sends a passwordless magic link to the host's email.
   * The email redirect includes eventId so we can route the host to their dashboard.
   * Returns { data, error } from Supabase Auth.
   *
   * NOTE: Make sure you set the Site URL in Supabase Auth settings to allow redirect.
   */
  if (!email) {
    return { data: null, error: new Error('Email is required') };
  }

  const siteOrigin =
    process.env.REACT_APP_SITE_URL ||
    (typeof window !== 'undefined' ? window.location.origin : '');
  const redirectUrl = `${siteOrigin}/host/callback${
    eventId ? `?eventId=${encodeURIComponent(eventId)}` : ''
  }`;

  // TODO: Configure Supabase email templates/policies as needed.
  const { data, error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: redirectUrl
    }
  });

  return { data, error };
}

/** Convenience alias used by the join step to validate code existence. */
// PUBLIC_INTERFACE
export async function getEventByCode(code) {
  /** Fetch an event by its public code. Returns { data, error }.
   * Uses .maybeSingle() to avoid "Cannot coerce the result to a single JSON object"
   * if the database contains unexpected duplicates. We also .limit(1) for safety.
   */
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
  /** Validate event code existence. Returns { data, error } where data is the event row if found. */
  return getEventByCode(eventCode);
}

// PUBLIC_INTERFACE
export function storeBidderContext(partial) {
  /** 
   * Persist bidder context to localStorage: merges keys with existing.
   * Recognized keys: eventCode, eventId, bidderName
   */
  try {
    const raw = localStorage.getItem(LS_JOIN_CONTEXT);
    const existing = raw ? JSON.parse(raw) : {};
    const updated = { ...existing, ...partial };
    localStorage.setItem(LS_JOIN_CONTEXT, JSON.stringify(updated));
  } catch {
    // ignore storage errors
  }
}

// PUBLIC_INTERFACE
export async function getEventByName(name) {
  /** Fetch an event by name (exact match). Returns { data, error }.
   * Uses .maybeSingle() because names may not be unique in the database.
   * If multiple rows match, Supabase returns an error; callers should surface a friendly message.
   */
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('name', name)
    .limit(1)
    .maybeSingle();

  return { data, error };
}

/**
 * NOTE: items.id must be generated by the database (UUID default). Do not send `id` from the client.
 * If you encounter "null value in column \"id\" of relation \"items\"" errors, apply:
 * assets/sql_patches/items_id_uuid_patch.sql in your Supabase SQL editor.
 */
// PUBLIC_INTERFACE
export async function addItem(eventId, item) {
  /**
   * Add a new auction item to an event.
   * item: { title, description, starting_bid }
   */
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
  /** List items for an event. Returns { data, error }. */
  const { data, error } = await supabase
    .from('items')
    .select('*')
    .eq('event_id', eventId)
    .order('created_at', { ascending: true });

  return { data, error };
}

// PUBLIC_INTERFACE
export async function deleteItem(itemId) {
  /** Delete an item by id. Returns { data, error }. */
  const { data, error } = await supabase.from('items').delete().eq('id', itemId);
  return { data, error };
}

// PUBLIC_INTERFACE
export async function listBidsForItem(itemId) {
  /** List bids for an item ordered by amount desc. Returns { data, error }. */
  const { data, error } = await supabase
    .from('bids')
    .select('*')
    .eq('item_id', itemId)
    .order('amount', { ascending: false });

  return { data, error };
}

// PUBLIC_INTERFACE
export async function getHighBid(itemId) {
  /** Fetch the highest bid for an item. Returns { data, error }. */
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
  /**
   * Place a bid with client-side validation:
   * - amount must be a positive number
   * - amount must exceed current price (max of starting_bid and highest bid)
   *
   * NOTE: Server/database-side checks must be implemented for true integrity.
   * Adds bidder_session_id for anonymous session tracking.
   */
  const numeric = Number(amount);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return { data: null, error: new Error('Bid amount must be a positive number') };
  }

  // Fetch the item to know its starting_bid
  const { data: itemRow, error: itemErr } = await supabase
    .from('items')
    .select('id, starting_bid')
    .eq('id', itemId)
    .limit(1)
    .maybeSingle();

  if (itemErr) {
    return { data: null, error: new Error(itemErr.message || 'Unable to validate bid') };
  }

  const starting = Number(itemRow?.starting_bid || 0);
  const { data: high, error: highErr } = await getHighBid(itemId);
  if (highErr) {
    // Non-fatal; proceed but warn via console
    // eslint-disable-next-line no-console
    console.warn('Could not fetch high bid for validation:', highErr.message);
  }
  const current = Math.max(starting, Number(high?.amount || 0));
  if (numeric <= current) {
    return { data: null, error: new Error(`Bid must be greater than current price (${current})`) };
  }

  // Ensure we have a clientId in localStorage (anonymous session identifier)
  const clientId = getOrCreateClientId();

  const payload = {
    event_id: eventId,
    item_id: itemId,
    amount: numeric,
    bidder_name: (bidderName || 'Anonymous').trim() || 'Anonymous',
    // This column may not yet exist in older schemas; DB will ignore unknown fields only if column exists.
    // We include it and document adding the column; if absent, Supabase will return an error.
    // To handle gracefully, we attempt insert with and without the column (fallback below).
    bidder_session_id: clientId
  };

  // Try insert with bidder_session_id; if the column doesn't exist, retry without it.
  let insert = await supabase.from('bids').insert([payload]).select('*').single();

  if (insert.error && /column .*bidder_session_id.* does not exist/i.test(insert.error.message || '')) {
    const { bidder_session_id, ...fallbackPayload } = payload;
    insert = await supabase.from('bids').insert([fallbackPayload]).select('*').single();
  }

  return insert;
}

// PUBLIC_INTERFACE
export function subscribeToItems(eventId, onChange) {
  /**
   * Subscribe to realtime changes for items in an event.
   * Returns an unsubscribe function.
   *
   * Requires Realtime enabled and Row Level Security policies configured in Supabase.
   */
  const channel = supabase
    .channel(`items-changes-${eventId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'items', filter: `event_id=eq.${eventId}` },
      (payload) => {
        if (typeof onChange === 'function') onChange(payload);
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

// PUBLIC_INTERFACE
export function subscribeToBids(itemId, onChange) {
  /**
   * Subscribe to realtime changes for bids on a specific item.
   * Returns an unsubscribe function.
   */
  const channel = supabase
    .channel(`bids-changes-item-${itemId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'bids', filter: `item_id=eq.${itemId}` },
      (payload) => {
        if (typeof onChange === 'function') onChange(payload);
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

// PUBLIC_INTERFACE
export function subscribeToEvent(eventId, onChange) {
  /**
   * Subscribe to realtime updates for a single event (e.g., status changes).
   * Returns an unsubscribe function.
   */
  const channel = supabase
    .channel(`event-${eventId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'events', filter: `id=eq.${eventId}` },
      (payload) => {
        if (typeof onChange === 'function') onChange(payload);
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

 // PUBLIC_INTERFACE
export async function updateAuctionStatus(eventId, desired) {
  /**
   * Update auction open/closed status.
   * desired: 'open' | 'closed'
   * Attempts to update string status and, if supported by schema, boolean is_open.
   */
  const isOpen = desired === 'open';
  const updates = { status: desired };
  try {
    const hasIsOpen = await ensureEventsIsOpenPresenceKnown();
    if (hasIsOpen) updates.is_open = isOpen;
  } catch {
    // ignore detection errors; skip is_open
  }
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
  /** Fetch a single event by id for host view. */
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
  getNormalizedEventStatus
};
