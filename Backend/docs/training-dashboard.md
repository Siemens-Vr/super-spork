# Trainer and hiring workflows

Apply the Prisma migrations from Backend with `npm run db:migrate` and generate the client with `npm run db:generate`. The 20261117140000 migration creates the core training models. The 20261118100000 migration adds working hours, milestone progress, verified enrollment, attendance, mock interviews, candidate access requests, and the employer role.

For local development, include ports 3000–3003 in the backend CORS allowlist. From Frontend, start the applicant, employer, admin, and trainer portals using the corresponding `dev:applicant`, `dev:employer`, `dev:admin`, and `dev:trainer` npm scripts. Keep the existing backend notification worker running to send training and interview emails.

## Training

1. In **Admin → Training assignments**, certify catalogue teaching skills for approved trainers. Assign published applicant skill gaps to trainers enabled for the corresponding skill.
2. In the **Trainer dashboard**, trainers can pause or enable their certified skills, set weekly working hours, and schedule sessions. Times use East Africa Time. Each enabled skill shows up to 25 unassigned applicants with published gaps, identified by initials and assessed role. Pausing a skill stops new sessions and assignments for that skill. Trainers can still manage existing sessions and assignments.
3. In **Training assignments**, choose a session for an assigned applicant and enter the reference from the verified external payment. An enrollment takes one place in that session. Existing skill assignments require payment verification and enrollment before they appear on a session roster.
4. Trainers can record attendance in the session roster after the session begins and record progress and feedback on the trainee’s milestone. After an enrolled session ends, a trainer can sign off on the milestone. When all assessed gaps have trainer sign-off, the applicant enters the mock interview scheduling queue.

## Hiring

1. In **Admin → Hiring operations → Mock interviews**, schedule applicants who passed the initial assessment or received trainer sign-off for all assessed gaps. After the scheduled time, record the interview outcome. Applicants can see their interview status and joining instructions on their learning plan. A passing outcome qualifies the candidate for the employer shortlist for that assessed role.
2. In **Hiring operations → Employer requests**, grant employer access to an active, verified account by email. The employer signs in with that account at port 3001 and searches the active technical role catalogue.
3. Before approval, employers see candidate initials, verified skill names, and the qualifying assessment status. An employer requests the full profile for a specific shortlist entry. An administrator confirms the external payment or procurement reference in **Hiring operations → Employer requests**.
4. The requesting employer can then view the full candidate profile and contact details in **Profile requests**. The API checks ownership and approval when serving the profile. Each confirmation is tied to the specific employer request.

## Verification

Run the backend unit suite with `npm run test:unit`. To run the training and hiring integration test, apply migrations to an isolated PostgreSQL database named `nexus_test` and point `TEST_DATABASE_URL` at it before running `npx vitest run tests/integration/training.test.ts`.
