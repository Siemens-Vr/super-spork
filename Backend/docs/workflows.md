# Workflows

## Parallel onboarding

1. Register name, email, phone, password confirmation and current privacy consent.
2. Verify email with the emailed code; sign in and confirm your name, phone, country and discipline/course. A phone and discipline complete the profile. Institution and qualification details belong to document uploads.
3. Upload NATIONAL_ID or PASSPORT to `/identity/documents` as multipart `file` plus metadata. Storage stays private and quarantined until the worker obtains a clean ClamAV verdict.
4. Once identity is submitted, continue academic uploads and career selection while review is pending. Both tracks remain independent.
5. Create an assessment target with one career, one to three related industries, zero to three companies and relevant qualification documents. Edit choices while the target is a draft.
6. Prepare the target to freeze its context and rubric. Read eligibility and available slots, then schedule with an idempotency key.
7. Start within the booked window. An authorised assessor records evidence and competency results; completion creates skill gaps and an upskilling plan and unlocks the next career target. See [the assessment API workflow](assessment-targets.md).

Scheduling requires verified email, active account, complete profile, a clean current identity submission, active selected role and active approved blueprint. Identity/academic **authentication** is only required when the blueprint explicitly enables that policy. A quarantined or infected identity is never sufficient for scheduling. Academic review otherwise proceeds independently.

## Document review

A clean scan transitions `UPLOADED` → `UNDER_REVIEW`. Administrators download clean files through the protected API and record method, outcome, reason, evidence reference and optional internal notes. Permitted transitions:

| From                         | To                                                    |
| ---------------------------- | ----------------------------------------------------- |
| UPLOADED                     | UNDER_REVIEW (scanner/admin)                          |
| UNDER_REVIEW                 | AUTHENTICATED, REJECTED, ADDITIONAL_EVIDENCE_REQUIRED |
| ADDITIONAL_EVIDENCE_REQUIRED | UNDER_REVIEW, REJECTED                                |
| AUTHENTICATED                | UNDER_REVIEW, DISPUTED                                |
| REJECTED                     | UNDER_REVIEW, DISPUTED                                |
| DISPUTED                     | UNDER_REVIEW, REJECTED                                |

`AUTHENTICATED` requires an independent evidence reference and a method other than AI_ASSISTED. A visible name match alone is insufficient. Applicants can view public review reasons and respond with evidence references after an evidence request, rejection or dispute; that returns the record to human review. Evidence references are stored, never fetched by the server. To supply a new file, use the replacement endpoint. The old file, reviews and history remain associated with their original document, and only the latest version can be reviewed. Reviewed metadata cannot be silently edited; supply a replacement.

## Career and catalogue

Browse active industries, companies and roles. Companies are preference catalogue records, not employer accounts, hiring claims or partnerships. Suggest a missing company with `/companies/suggestions`; admin creates/approves the catalogue entry and records moderation. Once a target is prepared, its choices remain frozen until completion; cancelling its booking does not unlock another career. Framework and blueprint versions preserve the approved configuration used by a booking.

## Scheduling

An admin creates an explicit future availability window for an active blueprint with an approved framework, including timezone, capacity, advance notice, maximum horizon, cancellation notice and reschedule limit. The backend creates complete-duration slots and drops an incomplete remainder. Active windows for one blueprint cannot overlap. API timestamps contain UTC offsets and are persisted in UTC; the display timezone defaults to Africa/Nairobi.

Applicants see slots with remaining capacity within policy bounds. The booking transaction locks the applicant and selected slot, rechecks eligibility and capacity, reserves a free seat, writes the booking/event/audit and encrypted confirmation intent. Identical concurrent idempotency-key retries return the original booking; reusing a key for another slot returns `409`. A partial unique index permits only one active booking per applicant. There is no assessment launch URL in this phase.

Applicant cancellation must precede the configured notice deadline. Admins may override that deadline with an audited reason. Rescheduling atomically marks the old booking RESCHEDULED and creates its successor while enforcing limits; failure rolls back the entire transaction. All events and predecessor records remain. Assessor completion atomically marks the booking and target COMPLETED and persists results and a learning plan. EXPIRED and MISSED remain reserved for future scheduling operations.
