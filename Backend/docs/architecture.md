# Architecture

One Express 5 TypeScript application serves a versioned REST API. Route modules apply validation and access controls; services enforce ownership, transitions and transactions directly with Prisma. Thin controllers handle transport-specific details where needed. The worker is a separate process using the same codebase and database, not a separate application microservice.

`app.ts` constructs the application without listening. `server.ts` connects PostgreSQL and Redis, opens HTTP and handles shutdown. Environment validation fails early, rejects malformed encryption keys and requires HTTPS in production. Logs contain request IDs and paths without query strings; request bodies and authentication headers are never serialized. JSON responses use `{data, meta?}` and centralized `{error:{code,message,details?,requestId}}` errors.

PostgreSQL is authoritative for identities, sessions, workflows, audit records, scheduling and notification intent. Redis/BullMQ transport email and scan work. Workers poll durable pending outbox/document records; a Redis interruption does not erase committed notification intent. Retry exhaustion stays visible in the queue and must be investigated and explicitly retried by an operator. No notification is sent inside an application transaction.

Object storage holds random private document keys. The API accepts only one small PDF/JPEG/PNG, compares MIME type with the detected signature and records a SHA-256 digest. No public URLs or storage keys are exposed. Reads are authenticated attachment downloads, fail closed until scanning succeeds, check integrity and record an audit event. AWS S3 production writes request server-side AES-256 encryption. The private bucket policy must prohibit anonymous access and enforce TLS/encryption.

Applicant and admin permissions are persisted rather than inferred from client fields. Admin TOTP uses OTPAuth, AES-256-GCM-encrypted secrets, hashed single-use recovery codes and replay-resistant counters. Google OIDC uses openid-client's verified authorization-code grant, PKCE, state and nonce. Provider subject identifiers are unique. Explicit linking requires a recent existing login; matching email never merges accounts automatically.

Scheduling uses concrete finite availability windows with configurable policy and generated slots. Every booking locks its applicant and slot in a transaction. Partial unique indexes enforce one active booking per applicant and one active occupant per seat. A trigger checks the slot's blueprint and capacity. An exclusion constraint prevents active availability windows overlapping for the same blueprint. Idempotency keys bind each applicant's booking request to its original payload. Rescheduling keeps the predecessor record and all events.

Future Python AI services receive narrow versioned contracts, not database credentials. There is no AI transport or fake result generator in this milestone. A review remains possible entirely through admin actions.

Source layout follows the requested layers while combining closely related catalogue/admin modules and using one category-discriminated document model. Empty controllers or placeholder portals were deliberately omitted.
