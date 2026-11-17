export async function allBookingPages(read) {
  const rows = [];
  for (let page = 1; ; page++) {
    const result = await read(page);
    rows.push(...result.data);
    if (result.data.length < 100) return rows;
  }
}
export function createBookingStore({ client, onChange = () => {}, onUnauthorized = () => {}, makeKey = () => crypto.randomUUID() }) {
  const empty = () => ({ ownerId: null, status: 'idle', eligibility: null, bookings: [], slots: [], blueprintId: '', reservationId: '', selectedSlot: '', busy: false, error: '', notice: '', mode: '', reason: '', uncertain: false, requiresMfa: false });
  let state = empty(), generation = 0, pending = null;
  const current = (v, owner) => v === generation && owner === state.ownerId;
  const fail = error => { state.requiresMfa = error.code === 'MFA_REQUIRED'; if (error.status === 401) onUnauthorized(); return error.message || 'Unable to load booking information.'; };
  const store = {
    snapshot: () => state,
    reset() { generation++; pending = null; state = empty(); },
    async load(owner, force = false) {
      if (!owner) return;
      if (owner !== state.ownerId) { store.reset(); state.ownerId = owner; }
      if (state.busy || (!force && state.status !== 'idle')) return;
      const v = ++generation;
      state.status = 'loading'; state.error = ''; state.requiresMfa = false; state.slots = []; state.selectedSlot = '';
      try {
        // Reading bookings first reconciles expired reservations on the server.
        const bookings = await allBookingPages(page => client.bookings(page));
        if (!current(v, owner)) return;
        const eligibility = await client.bookingEligibility();
        if (!current(v, owner)) return;
        state.bookings = bookings; state.eligibility = eligibility;
        state.blueprintId = eligibility.eligible && eligibility.attemptId ? eligibility.blueprints.find(item => !item.reasons.length)?.blueprintId || '' : '';
        if (state.blueprintId) {
          const slots = await client.bookingSlots(state.blueprintId);
          if (!current(v, owner)) return;
          state.slots = slots;
        }
        state.status = 'ready'; state.uncertain = false;
        if (!bookings.some(item => item.status === 'SCHEDULED')) state.mode = '';
      } catch (error) { if (current(v, owner)) { state.status = 'error'; state.error = fail(error); } }
      if (current(v, owner)) onChange();
    },
    select(id) { if (!state.busy && state.slots.some(item => item.id === id)) { state.selectedSlot = id; state.error = ''; onChange(); } },
    mode(value) { if (!state.busy) { state.mode = value; state.selectedSlot = ''; state.reason = ''; state.error = ''; onChange(); } },
    reason(value) { state.reason = value; },
    async mutate(action) {
      if (state.busy || state.status !== 'ready' || state.uncertain) return false;
      if (!['book', 'on-demand', 'reschedule', 'cancel'].includes(action)) return false;
      const active = state.bookings.find(item => item.status === 'SCHEDULED');
      const creating = action === 'book' || action === 'on-demand';
      if (!creating && !active || creating && active) return false;
      if (action === 'reschedule' && active.onDemand) return false;
      if (action === 'on-demand' && !state.eligibility?.blueprints.find(b => b.blueprintId === state.blueprintId)?.onDemand?.available) return false;
      if (['book', 'reschedule'].includes(action) && (!state.blueprintId || !state.slots.some(item => item.id === state.selectedSlot))) return false;
      if (!creating && state.reason.trim().length < 5) { state.error = 'Enter a reason of at least 5 characters.'; onChange(); return false; }
      const v = generation, owner = state.ownerId;
      const reason = state.reason.trim(), slot = state.selectedSlot;
      const signature = JSON.stringify([action, state.blueprintId, active?.bookingId, slot, reason]);
      if (!pending || pending.signature !== signature) pending = { signature, key: makeKey() };
      state.busy = true; state.error = ''; state.notice = ''; onChange();
      let saved = false;
      try {
        let reservation;
        if (action === 'on-demand') reservation = await client.reserveOnDemand(state.blueprintId, pending.key);
        else if (action === 'book') await client.bookAssessment(slot, pending.key);
        else if (action === 'reschedule') await client.rescheduleBooking(active.bookingId, slot, reason, pending.key);
        else await client.cancelBooking(active.bookingId, reason);
        if (!current(v, owner)) return false;
        state.reservationId = reservation?.bookingId || '';
        pending = null; state.mode = ''; state.reason = ''; saved = true;
        state.notice = action === 'on-demand' ? 'Your immediate place is reserved. Complete device checks and consent within five minutes.' : action === 'book' ? 'Your assessment booking is confirmed.' : action === 'reschedule' ? 'Your assessment has been rescheduled.' : 'Your booking has been cancelled.';
      } catch (error) {
        if (!current(v, owner)) return false;
        state.error = fail(error);
        if (error.code === 'NETWORK_ERROR' || error.status >= 500) { state.uncertain = true; state.error += ' The result is unconfirmed. Refresh bookings before trying again.'; }
        else if (error.status === 409) { state.uncertain = true; state.error += ' Refresh bookings for current availability and booking status.'; }
      } finally {
        if (current(v, owner)) { state.busy = false; onChange(); }
      }
      if (saved && current(v, owner)) await store.load(owner, true);
      return saved;
    },
  };
  return store;
}
