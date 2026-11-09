# Assessment targets, results and upskilling

Each assessment has one career target. Its industries, employers and educational background belong to that target, rather than being inferred later from an applicant's changeable preferences. An applicant can create the next target after completing the current assessment; previous results and learning plans remain available.

## Applicant workflow

All endpoints are under `/api/v1`. Authenticate with a verified applicant account, use the same browser/cookie jar, and provide CSRF for mutations. Swagger handles CSRF automatically.

1. Complete the profile, including `discipline`, and submit identity. Booking/start require a current clean identity. Submit qualifications through `/documents` and wait for clean scans before selecting them.
2. Browse `/industries`, `/careers` and `/companies`. Career/company lists accept `industryIds=<uuid>,<uuid>` for up to three selected industries. Career results match every selected industry; company results match at least one. Each selected industry must be linked to the chosen career; each selected company must operate in at least one selected industry.
3. `POST /assessments/targets` creates a draft. Use catalogue UUIDs, not names:

```json
{
  "jobRoleId": "<career UUID>",
  "industryIds": ["<manufacturing UUID>", "<energy UUID>"],
  "companyIds": ["<employer UUID>"],
  "qualificationIds": ["<qualification document UUID>"]
}
```

Choose 1–3 distinct industries, 0–3 distinct companies, and up to 10 qualification documents. `qualificationIds` may be empty for students or applicants without a qualification file; a profile discipline is then required. Identity files, standalone transcripts, quarantined/infected/rejected documents, replacement predecessors and another applicant's qualifications cannot be selected. Qualification selection does not certify authenticity; the snapshot records verification status.

4. `PUT /assessments/targets/{id}` replaces the choices while status is `DRAFT`. There is one active target per applicant, enforced by a partial unique index as well as transaction locking.
5. `POST /assessments/targets/{id}/prepare` with `{ "blueprintId": "<approved core blueprint UUID>" }` creates an attempt and freezes its context and rubric. The response includes `id` (attempt ID), `targetId`, `contextSnapshot` and `requirements`. Retrying with the same blueprint returns the same attempt; changing it returns `409`.
6. Read eligibility and available slots, then use the existing `POST /assessments/bookings` with `slotId` and `Idempotency-Key`. Booking binds to the prepared target/blueprint. Booking or rescheduling cannot replace the frozen inputs.
7. `POST /assessments/attempts/{id}/start` starts the assessment only within its scheduled slot. The API rechecks current identity/academic policy and selected qualification safety. Repeated starts while in progress return the same attempt. This API records the session lifecycle; an interviewer, question delivery UI and automated assessment provider are not connected.
8. An authorised assessor records the evidence and results using the admin completion endpoint below. Completion atomically creates results and a learning plan, completes the booking and target, and allows a new target for another career or a reassessment of the same career.
9. `GET /assessments/targets` provides paginated history. `GET /assessments/attempts/{id}` returns the frozen context, requirements, results and learning plan. Ownership applies to every applicant read and mutation.

Target states are `DRAFT → PREPARED → IN_PROGRESS → COMPLETED`. Cancelling a booking keeps its prepared target locked; rebook the same target to finish it. There is deliberately no career-switch bypass through cancellation. Learning may continue after the next career assessment is chosen.

## How the four inputs affect the rubric

Use the existing admin career/company APIs to maintain their industry links. Use `/admin/competencies`, `/admin/frameworks` and `/admin/blueprints` to configure requirements. Only approved frameworks are used:

| Scope      | Context field | Selection                                                                            |
| ---------- | ------------- | ------------------------------------------------------------------------------------ |
| `CORE`     | None          | The exact approved framework pinned by the selected career blueprint                 |
| `INDUSTRY` | `industryId`  | Latest approved matching version for each selected industry                          |
| `COMPANY`  | `companyId`   | Latest approved matching version for each selected employer                          |
| `COURSE`   | `courseName`  | Latest approved matching version for each profile/selected qualification course name |

Framework versions remain unique per career across all scopes. Supply only the context field for the chosen scope. Course matching ignores case and repeated whitespace. Course context can add diagnostics or raise requirements; it never lowers the career's core skill thresholds. Missing context frameworks add no invented employer/industry/course criteria.

Each framework competency accepts `competencyId`, `weight` (1–100), `requiredScore` (1–100, default 70), optional `learningObjective`, and up to 20 curated HTTP(S) `learningResources`. Weights within one framework must total 100. When the same competency occurs in multiple selected frameworks, the frozen requirement uses the maximum required score, sums the weights, retains all source framework IDs/versions, combines learning objectives and deduplicates resources. The overall score normalises by the total frozen weight. Approve real institutional rubrics and thresholds before using demonstration seed content for actual assessments.

Preparation records the selected catalogue names, profile discipline, qualification metadata, blueprint instructions/version/policies and framework versions. Snapshot qualification data omits storage keys, credential numbers and other private file capabilities. Historical rubric names, thresholds, weights, sources and recommendations remain stable even if later catalogue/profile data changes. Database triggers protect prepared selections, snapshots, rubric rows and completed results.

## Assessor completion

An ADMIN with `assessments.review`, verified email and recent MFA can inspect `/admin/assessment-attempts/{id}` and submit `POST /admin/assessment-attempts/{id}/complete` with an `Idempotency-Key` and:

```json
{
  "results": [
    {
      "requirementId": "<frozen requirement UUID>",
      "score": 50,
      "evidence": "Observed practical work and reviewed the submitted supporting evidence."
    }
  ]
}
```

Submit exactly one integer 0–100 score and meaningful evidence for every frozen requirement. Applicants cannot grade themselves. Missing, duplicate or unrelated requirements fail validation. The assessor, completion time and audit event are recorded. A completed attempt is immutable: the same key and results can be retried safely (result order does not matter); a different key or result payload returns `409`.

For each competency, `gap = max(requiredScore - score, 0)`. `overallScore` is the weighted mean rounded to two decimal places; a high overall score does not erase an individual skill gap. This is a skills diagnostic, not an automatic hiring or employer eligibility decision.

## Learning plans

Each completion creates one plan. There is one item per assessed gap, prioritised by descending gap, using the frozen learning objective and curated resources. With no gaps, the plan is completed with an empty item list. The API does not invent courses or fetch external resources.

`GET /assessments/learning-plans/{id}` returns the plan with the supporting competency results. `PATCH /assessments/learning-plans/{id}/items/{itemId}` accepts `{ "status": "PENDING|IN_PROGRESS|COMPLETED" }` and recomputes plan progress. This is self-reported learning progress; completing an item does not change the historical score or establish mastery. A new assessment records improvement.

## Database setup

Deploy migrations and regenerate Prisma before restarting API/worker. The current flow uses assessment targets exclusively: create a draft, prepare it, then book the prepared blueprint. Existing administrators receive the granular `assessments.review` permission; the seed provisions it for fresh databases.

The target-only migration removes the obsolete standalone preference tables. Previously saved choices with no assessment target history become editable draft targets; existing targets, attempts, documents, bookings, results and learning plans remain intact. There is no automatic target creation or booking conversion endpoint.
