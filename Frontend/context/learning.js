import { allBookingPages } from './bookings.js';

export function createLearningStore({ client, onChange = () => {}, onUnauthorized = () => {} }) {
  const empty = () => ({ owner: '', requestedId: '', bookingId: '', booking: null, plan: null, status: 'idle', busy: false, error: '', requiresMfa: false });
  let state = empty(), version = 0;
  const current = v => v === version;
  const fail = error => {
    state.error = error.message || 'Unable to load your learning plan.';
    state.requiresMfa = error.code === 'MFA_REQUIRED';
    if (error.status === 401) onUnauthorized();
  };
  const store = {
    snapshot: () => state,
    reset() { version++; state = empty(); },
    async load(owner, requestedId = '', force = false) {
      if (!owner) return;
      if (owner !== state.owner || requestedId !== state.requestedId) {
        store.reset(); state.owner = owner; state.requestedId = requestedId;
      }
      if (state.busy || (!force && state.status !== 'idle')) return;
      const v = ++version;
      state.status = 'loading'; state.error = ''; state.requiresMfa = false;
      state.plan = null; state.booking = null; state.bookingId = ''; onChange();
      try {
        const bookings = await allBookingPages(page => client.bookings(page));
        if (!current(v)) return;
        const requested = requestedId ? bookings.find(b => b.bookingId === requestedId) : null;
        if (requestedId && !requested) throw new Error('This assessment booking is unavailable.');
        // Load each completed attempt once, including plans published without an interview session.
        const candidates = requested ? [requested] : bookings.filter(b => b.status === 'COMPLETED');
        const unique = [...new Map(candidates.filter(b => b.attemptId).map(b => [b.attemptId, b])).values()];
        const plans = [];
        for (const booking of unique) {
          const attempt = await client.assessmentAttempt(booking.attemptId);
          if (!current(v)) return;
          if (attempt.completedAt && attempt.learningPlan) plans.push({ booking, attempt });
        }
        // Publication/completion time, rather than booking creation order, determines the default.
        plans.sort((a, b) => Date.parse(b.attempt.completedAt) - Date.parse(a.attempt.completedAt) || b.attempt.id.localeCompare(a.attempt.id));
        const selected = plans[0];
        state.booking = selected?.booking || requested;
        state.bookingId = state.booking?.bookingId || '';
        state.plan = selected?.attempt.learningPlan || null;
        state.status = 'ready';
      } catch (error) { if (current(v)) { state.status = 'error'; fail(error); } }
      if (current(v)) onChange();
    },
    async progress(itemId, status) {
      const plan = state.plan;
      if (state.status !== 'ready' || state.busy || !plan?.items.some(item => item.id === itemId) || !['PENDING', 'IN_PROGRESS', 'COMPLETED'].includes(status)) return;
      const v = version; state.busy = true; state.error = ''; onChange();
      try {
        const updated = await client.learningProgress(plan.id, itemId, status);
        if (current(v)) state.plan = updated;
      } catch (error) { if (current(v)) fail(error); }
      finally { if (current(v)) { state.busy = false; onChange(); } }
    },
  };
  return store;
}
