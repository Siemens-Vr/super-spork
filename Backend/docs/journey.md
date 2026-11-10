# Local registration-to-booking journey

These commands assume local Compose infrastructure, seeded catalogue, an API process and a worker. Use test records and nonsensitive sample files. They require `jq`. Privacy version must match `PRIVACY_NOTICE_VERSION`.

```bash
export NEXUS_API=http://localhost:4000/api/v1
export NEXUS_COOKIE=/tmp/nexus-applicant.cookies
csrf() {
  curl -sS -b "$NEXUS_COOKIE" -c "$NEXUS_COOKIE" "$NEXUS_API/auth/csrf" | jq -r '.data.csrfToken'
}
export NEXUS_CSRF="$(csrf)"
curl -sS -b "$NEXUS_COOKIE" -c "$NEXUS_COOKIE" \
  -H "X-CSRF-Token: $NEXUS_CSRF" -H 'Content-Type: application/json' \
  -d '{"legalName":"Example Applicant","email":"applicant@example.test","phone":"0712345678","password":"a long example passphrase","passwordConfirmation":"a long example passphrase","consentVersion":"2026-11-01"}' \
  "$NEXUS_API/auth/register"
```

Open Mailpit at `http://localhost:8025` and read the delivered code. Codes are never in API responses.

```bash
read -r -p 'Verification code from local inbox: ' NEXUS_OTP
export NEXUS_CSRF="$(csrf)"
curl -sS -b "$NEXUS_COOKIE" -c "$NEXUS_COOKIE" \
  -H "X-CSRF-Token: $NEXUS_CSRF" -H 'Content-Type: application/json' \
  -d "{\"email\":\"applicant@example.test\",\"code\":\"$NEXUS_OTP\"}" "$NEXUS_API/auth/verify-email"
export NEXUS_CSRF="$(csrf)"
curl -sS -b "$NEXUS_COOKIE" -c "$NEXUS_COOKIE" \
  -H "X-CSRF-Token: $NEXUS_CSRF" -H 'Content-Type: application/json' \
  -d '{"email":"applicant@example.test","password":"a long example passphrase"}' "$NEXUS_API/auth/login"
export NEXUS_CSRF="$(csrf)"
curl -sS -X PATCH -b "$NEXUS_COOKIE" -H "X-CSRF-Token: $NEXUS_CSRF" -H 'Content-Type: application/json' \
  -d '{"discipline":"Mechatronics Engineering","country":"KE"}' \
  "$NEXUS_API/applicants/me"
# Set this to an actual nonsensitive PDF/JPEG/PNG file for local testing:
export NEXUS_SAMPLE_FILE=/absolute/path/to/sample.pdf
curl -sS -b "$NEXUS_COOKIE" -H "X-CSRF-Token: $NEXUS_CSRF" \
  -F category=NATIONAL_ID -F "file=@$NEXUS_SAMPLE_FILE;type=application/pdf" \
  "$NEXUS_API/identity/documents"
# Optional academic document (identity need only be submitted, not authenticated):
curl -sS -b "$NEXUS_COOKIE" -H "X-CSRF-Token: $NEXUS_CSRF" \
  -F category=BACHELOR -F 'courseName=Mechatronics Engineering' -F 'institutionName=Example Technical Institution' \
  -F "transcripts=@$NEXUS_SAMPLE_FILE;type=application/pdf" \
  -F "file=@$NEXUS_SAMPLE_FILE;type=application/pdf" "$NEXUS_API/documents"
# Select a role that has a seeded blueprint, such as PLC Programmer:
export NEXUS_ROLE="$(curl -sS -b "$NEXUS_COOKIE" "$NEXUS_API/careers?search=PLC%20Programmer" | jq -r '.data[0].id')"
export NEXUS_INDUSTRY="$(curl -sS -b "$NEXUS_COOKIE" "$NEXUS_API/careers/$NEXUS_ROLE" | jq -r '.data.industries[0].industryId')"
export NEXUS_TARGET="$(curl -sS -b "$NEXUS_COOKIE" -H "X-CSRF-Token: $NEXUS_CSRF" -H 'Content-Type: application/json' \
  -d "{\"industryIds\":[\"$NEXUS_INDUSTRY\"],\"companyIds\":[],\"jobRoleId\":\"$NEXUS_ROLE\",\"qualificationIds\":[]}" \
  "$NEXUS_API/assessments/targets" | jq -r '.data.id')"
curl -sS -b "$NEXUS_COOKIE" "$NEXUS_API/careers/$NEXUS_ROLE/competencies"
curl -sS -b "$NEXUS_COOKIE" "$NEXUS_API/identity/status"
```

Wait for `scanStatus: CLEAN`. Identity authenticity can remain UNDER_REVIEW unless the blueprint explicitly requires authentication. An admin must create availability before a real slot can be booked. In Swagger, sign in as the bootstrapped administrator, enroll/verify MFA, list `/admin/blueprints`, and POST `/admin/availability` with an active blueprint ID and an actual future window:

```json
{
  "blueprintId": "copy-an-active-blueprint-uuid",
  "startsAt": "2026-12-01T09:00:00+03:00",
  "endsAt": "2026-12-01T13:00:00+03:00",
  "capacity": 2,
  "minNoticeMinutes": 60,
  "maxHorizonDays": 90,
  "cancellationNoticeMinutes": 60,
  "rescheduleLimit": 2,
  "timezone": "Africa/Nairobi"
}
```

Choose future dates within the booking horizon; the literal dates above are examples, not perpetual seed availability. Continue in the applicant shell:

```bash
export NEXUS_BLUEPRINT="$(curl -sS -b "$NEXUS_COOKIE" "$NEXUS_API/careers/$NEXUS_ROLE" | jq -r '.data.blueprints[0].id')"
export NEXUS_CSRF="$(csrf)"
curl -sS -b "$NEXUS_COOKIE" -H "X-CSRF-Token: $NEXUS_CSRF" -H 'Content-Type: application/json' \
  -d "{\"blueprintId\":\"$NEXUS_BLUEPRINT\"}" "$NEXUS_API/assessments/targets/$NEXUS_TARGET/prepare"
curl -sS -b "$NEXUS_COOKIE" "$NEXUS_API/assessments/eligibility"
export NEXUS_SLOT="$(curl -sS -b "$NEXUS_COOKIE" "$NEXUS_API/assessments/available-slots?blueprintId=$NEXUS_BLUEPRINT" | jq -r '.data[0].id')"
export NEXUS_CSRF="$(csrf)"
# Save the chosen key and use exactly the same key/body for retries.
export NEXUS_BOOKING_KEY="$(openssl rand -hex 16)"
curl -sS -b "$NEXUS_COOKIE" -H "X-CSRF-Token: $NEXUS_CSRF" -H "Idempotency-Key: $NEXUS_BOOKING_KEY" \
  -H 'Content-Type: application/json' -d "{\"slotId\":\"$NEXUS_SLOT\"}" "$NEXUS_API/assessments/bookings"
curl -sS -b "$NEXUS_COOKIE" "$NEXUS_API/assessments/bookings"
```

A successful response contains a persisted SCHEDULED booking. Mailpit receives a queued confirmation containing date/time, role, blueprint version and instructions. No AI interview link or fabricated score is returned. Use the documented cancel/reschedule endpoints to change the booking under its configured policy; rescheduling needs a new idempotency key.
