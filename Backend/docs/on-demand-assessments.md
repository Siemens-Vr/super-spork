# On-demand assessments

Existing blueprints remain scheduled-only after migration. In the administrator's **Assessment availability → Assessment delivery → Manage delivery**, explicitly enable immediate access and choose 1–100 concurrent places for an approved assessment. Assessments requiring supervision or equipment cannot enable on-demand access. Scheduled availability continues to work for all assessments.

Deploy migration `20261117120000_on_demand_assessments`, regenerate Prisma, and restart API and workers before enabling this feature. No assessment is automatically enabled and no existing booking is converted.

## Applicant workflow

1. Prepare a career target as usual. `/api/v1/assessments/eligibility` includes each blueprint's `onDemand` readiness, remaining capacity, duration and blocking reason codes.
2. **Continue now** calls `POST /api/v1/assessments/on-demand` with `{ "blueprintId": "<prepared blueprint UUID>" }` and an explicit `Idempotency-Key`. The server rechecks eligibility, the frozen identity/academic requirements, selected qualification safety, approved scenario coverage and AI provider configuration. The configured provider's readiness is not an external uptime probe.
3. The response is a normal owned booking with `onDemand: true` and `setupExpiresAt`. Complete the existing device checks and consent within five minutes. No interview starts automatically. The full blueprint duration begins at explicit start; setup time does not consume that duration.
4. Existing preflight, start, text/voice interaction, response recovery, assessor review, results and learning-plan APIs continue unchanged apart from additive delivery metadata. AI proposals still require assessor approval.

A scheduled booking blocks immediate reservation; an applicant must explicitly cancel it under its existing change policy first. Immediate reservations cannot be rescheduled. An unstarted immediate reservation can be cancelled or its target abandoned without a past scheduled-change deadline blocking recovery. Started assessments retain existing completion/recovery rules. Refresh bookings after an unknown request outcome; the UI never automatically replays admission. A same-key/payload API retry returns the original booking, including an expired booking, and cannot extend its deadline.

## Capacity and administration

Capacity is per blueprint. An applicant row lock prevents duplicate active bookings; a blueprint row lock serializes admissions, on-demand starts and delivery configuration changes across applicants. Reservations in setup and active interviews occupy places. Submitted evidence awaiting human review does not. Expired setup reservations and ended interviews no longer occupy capacity even before the expiry worker runs; an accepted response still processing holds its place for the existing bounded processing grace period.

Immediate admissions create private inactive availability and a dedicated slot. These windows are excluded from the public scheduled slot list and administrator availability calendar. Bookings remain visible in normal applicant history and administrator booking records. Private windows cannot be activated through availability editing, and scheduled endpoints cannot reserve their slots. Database constraints enforce delivery/policy consistency.

`PATCH /api/v1/admin/blueprints/{id}/delivery` requires ADMIN, verified email, recent MFA and `assessments.manage`, with all four fields:

```json
{
  "onDemandEnabled": true,
  "onDemandCapacity": 2,
  "requiresSupervision": false,
  "requiresEquipment": false
}
```

Capacity cannot be reduced below occupied places. Disabling new admissions preserves existing reservations and interviews. Delivery changes and reservations are audited. Capacity limits are admission controls, not measured claims about AI infrastructure throughput; set them according to provider capacity.

## Verification

PostgreSQL integration tests cover concurrent admission, ownership, idempotency, capacity reuse, setup expiry, full duration at start, mandatory preflight, review-stage capacity release, pending-response grace, delivery permissions/MFA, supervision/equipment policy, existing scheduled bookings, identity rejection, missing scenarios and provider readiness. Frontend tests cover controls, scheduled fallback, CSRF/idempotency, uncertain outcomes, account changes and administrator configuration. AI/speech adapters use test fixtures; these checks do not establish production provider availability or microphone quality.
