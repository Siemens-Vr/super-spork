# Future Python/FastAPI integration

This milestone intentionally stops at successful assessment scheduling. Interfaces are in `src/integrations/document-analysis/contracts.ts` and `src/integrations/ai-assessment/contracts.ts`. No live LLM calls, interview agent, automated authenticity decision or final competency score is implemented.

| Agent                 | Future input                                                                              | Future output / constraint                                                                                 |
| --------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Document Review       | Purpose-scoped document capability, category, identity name when justified, consent       | Extracted names, consistency signals, confidence, version and findings; authenticity always NOT_DETERMINED |
| Assessment Planner    | Pseudonymous applicant, pinned booking/blueprint/framework version and competency weights | Approved task identifiers and durations from the approved assessment catalogue                             |
| Technical Interviewer | Approved plan and time-limited interview session                                          | Structured responses and evidence, no unrestricted admin access                                            |
| Practical Assessment  | Approved practical tasks and controlled workspace                                         | Artifacts and structured observations                                                                      |
| Competency Evaluator  | Approved rubric, versioned assessment evidence                                            | Proposed rubric assessments subject to institutional evaluation policy                                     |
| Assessment Integrity  | Defined, consented integrity signals                                                      | Referrals for human review; no automatic punitive action                                                   |
| Skills Gap Analyst    | Authorized assessed evidence and approved training catalogue                              | Explainable recommendations after an evaluation service exists                                             |

Document analysis distinguishes reordered names, initials, possible legitimate name changes, discrepancies and insufficient evidence. Confidence or a matching name does not prove authenticity. `DocumentAnalysisJob` provides a versioned findings container but no artificial job or AI result is seeded. Human admin review remains fully operational if no analysis service exists.

Future calls must use authenticated service-to-service transport (mTLS or scoped short-lived credentials), schema validation, request IDs, strict audience binding, timeouts, bounded retries and idempotent callbacks. An analysis service receives only a short-lived capability for an explicitly authorized document; the capability transport/issuer is intentionally not activated yet. It must never receive a database connection, S3 master key, raw identity number by default, unrelated applicant records or administrative powers. Payloads, logs and storage must follow institution-approved purpose/retention policies. No URL received from an applicant should be fetched unrestrictedly.

Version contracts and rubric approvals before enabling the Python integration. Record service versions, human decisions and supporting evidence separately. Scheduling must not imply that an operational AI interview is already available.
