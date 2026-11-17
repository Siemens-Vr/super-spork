# Document review notifications

Each committed document review already queues an email in the encrypted outbox. Keep the worker running to deliver it (local emails appear in Mailpit).

Applicants also see their latest 50 review updates in the notification bell. The badge counts all unread reviews. The frontend refreshes every 30 seconds while visible and when opened. Opening a document marks that update read; the menu can also mark displayed updates read. Existing reviews appear as unread after this feature is installed.

`GET /api/v1/documents/notifications` returns `{ data: { items, unreadCount } }`. `POST /api/v1/documents/notifications/read` takes `{ ids: [...] }` (1–50 review UUIDs) and returns 204. Both require a verified applicant and `documents.read.self`; writes require CSRF protection. Queries and updates are restricted to documents owned by the caller. Internal reviewer notes and evidence references are excluded.

Apply migration `20261117120000_review_notifications` and regenerate Prisma before deploying. Read state is stored on the review, so no separate notification queue or duplicate notification record is required.
