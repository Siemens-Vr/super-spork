import { escapeHtml as e } from "../../components/html.js";
const label = (v) =>
  String(v)
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/^./, (c) => c.toUpperCase());
const statuses = [
  "DRAFT",
  "SUBMITTED",
  "CHANGES_REQUESTED",
  "APPROVED",
  "REJECTED",
  "SUSPENDED",
];
const transitions = {
  SUBMITTED: ["APPROVED", "CHANGES_REQUESTED", "REJECTED"],
  APPROVED: ["SUSPENDED", "CHANGES_REQUESTED"],
  SUSPENDED: ["APPROVED", "CHANGES_REQUESTED"],
  REJECTED: ["CHANGES_REQUESTED"],
};
const date = (v) =>
  v
    ? new Intl.DateTimeFormat("en-GB", {
        dateStyle: "medium",
        timeZone: "Africa/Nairobi",
      }).format(new Date(v))
    : "—";
const card = (title, body) =>
  `<section class="card"><div class="card-head"><h2>${e(title)}</h2></div><div class="card-body">${body}</div></section>`;
const field = (name, title, attrs = "", type = "text") =>
  `<div class="field"><label for="admin-trainer-${name}">${e(title)}</label><input id="admin-trainer-${name}" name="${name}" type="${type}" ${attrs}></div>`;
const heading = (title, subtitle) =>
  `<div class="page-heading"><div><div class="eyebrow">NEXUS TRAINERS</div><h1 id="page-title" tabindex="-1">${e(title)}</h1><p>${e(subtitle)}</p></div><a class="btn subtle" href="/trainer-invitations">Manage invitations</a></div>`;
const pages = (meta, path) =>
  `<div class="inline-actions">${meta.page > 1 ? `<a class="btn subtle" href="/${path}?page=${meta.page - 1}">Previous</a>` : ""}<span>Page ${meta.page} · ${meta.total} records</span>${meta.page * meta.limit < meta.total ? `<a class="btn subtle" href="/${path}?page=${meta.page + 1}">Next</a>` : ""}</div>`;
export function trainerPage(state, route, filters = {}) {
  if (route === "trainer-invitations")
    return (
      heading(
        "Trainer invitations",
        "Invite verified account holders to complete a professional profile.",
      ) +
      `<a class="btn subtle" href="/trainers">View trainer profiles</a>` +
      card(
        "Send an invitation",
        `<p>Invitations expire in seven days. A new invitation revokes previous pending links for that email. The worker delivers the link; it is never displayed here.</p><form data-admin-form="invite-trainer"><fieldset>${field("email", "Trainer email", 'required maxlength="254" autocomplete="email"', "email")}<button class="btn primary" type="submit">Send trainer invitation</button></fieldset></form>`,
      ) +
      card(
        "Invitation history",
        state.data.data.length
          ? `<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Email</th><th>Status</th><th>Expires</th><th>Action</th></tr></thead><tbody>${state.data.data.map((i) => `<tr><td>${e(i.email)}</td><td>${e(label(i.status))}${i.status === "PENDING" && Date.parse(i.expiresAt) <= Date.now() ? " · Expired" : ""}</td><td>${date(i.expiresAt)}</td><td>${i.status === "PENDING" ? `<form data-admin-form="revoke-trainer-invitation" data-id="${e(i.id)}"><fieldset><button class="btn subtle" type="submit">Revoke invitation</button></fieldset></form>` : "—"}</td></tr>`).join("")}</tbody></table></div>`
          : "<p>No trainer invitations have been sent.</p>",
      ) +
      pages(state.data.meta, "trainer-invitations")
    );
  if (route === "trainers")
    return (
      heading(
        "Trainer profiles",
        "Review professional experience and private qualification evidence.",
      ) +
      card(
        "Find trainers",
        `<form data-admin-form="trainer-filters" class="admin-filter-bar">${field("search", "Name or email", `value="${e(filters.search || "")}"`)}<div class="field"><label for="trainer-status">Status</label><select name="status" id="trainer-status"><option value="">All statuses</option>${statuses.map((s) => `<option value="${s}" ${s === filters.status ? "selected" : ""}>${label(s)}</option>`).join("")}</select></div><button class="btn primary" type="submit">Search trainers</button></form>`,
      ) +
      card(
        "Trainers",
        state.data.data.length
          ? `<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Trainer</th><th>Professional headline</th><th>Status</th><th>Qualifications</th><th>Review</th></tr></thead><tbody>${state.data.data.map((p) => `<tr><td><strong>${e(p.user.legalName)}</strong><small>${e(p.user.email)}</small></td><td>${e(p.headline || "Profile in progress")}</td><td>${e(label(p.status))}</td><td>${p._count.qualifications}</td><td><a class="btn subtle" href="/trainer?id=${encodeURIComponent(p.userId)}">Open profile</a></td></tr>`).join("")}</tbody></table></div>`
          : "<p>No trainer profiles match these filters.</p>",
      ) +
      pages(state.data.meta, "trainers")
    );
  const p = state.data,
    choices = transitions[p.status] || [];
  return (
    heading(
      p.user.legalName,
      "Trainer professional profile and review history",
    ) +
    `<p><a href="/trainers">← All trainer profiles</a></p>` +
    card(
      "Professional experience",
      `<p><strong>${e(label(p.status))}</strong> · ${e(p.user.email)}</p><h3>${e(p.headline || "Headline not supplied")}</h3><p class="trainer-biography">${e(p.biography || "Biography not supplied")}</p><p>${e(p.region)}, ${e(p.country)} · ${p.yearsExperience} years of experience</p><p><strong>Expertise:</strong> ${e(p.expertise.join(", ") || "Not supplied")}</p>`,
    ) +
    card(
      "Qualification evidence",
      p.qualifications.length
        ? `<ul>${p.qualifications.map((q) => `<li><h3>${e(q.title)}${q.withdrawnAt ? " · Withdrawn" : ""}</h3><p>${e(q.issuer)} · ${e(label(q.category))} · ${e(label(q.scanStatus))}</p><p>Issued ${date(q.issuedAt)}${q.expiresAt ? " · Expires " + date(q.expiresAt) : ""}</p>${q.scanStatus === "CLEAN" ? `<button class="btn subtle" data-admin-action="trainer-download" data-id="${e(q.id)}">Download evidence</button>` : ""}</li>`).join("")}</ul>`
        : "<p>No qualifications submitted.</p>",
    ) +
    card(
      "Administrator decision",
      choices.length
        ? `<p>Approval confirms the institution’s trainer onboarding decision. Review qualification evidence independently; a clean malware scan does not prove authenticity. This milestone does not grant access to applicant identities or assessment scoring.</p><form data-admin-form="review-trainer" data-id="${e(p.userId)}"><fieldset><input type="hidden" name="version" value="${p.version}"><div class="field"><label for="trainer-decision">Decision</label><select id="trainer-decision" name="outcome">${choices.map((v) => `<option value="${v}">${label(v)}</option>`).join("")}</select></div><div class="field"><label for="trainer-review-reason">Reason shown to trainer</label><textarea id="trainer-review-reason" name="reason" required minlength="10" maxlength="2000" rows="4"></textarea></div>${field("evidenceReference", "Independent verification reference (required for approval)", 'maxlength="1000"')}<label class="check"><input type="checkbox" required><span>I have reviewed this profile and the supporting evidence.</span></label><button class="btn primary" type="submit">Record trainer decision</button></fieldset></form>`
        : "<p>The trainer must submit a completed profile before it can be reviewed.</p>",
    ) +
    card(
      "Review history",
      p.reviews.length
        ? `<ol class="admin-timeline">${p.reviews.map((r) => `<li><strong>${e(label(r.outcome))}</strong><p>${e(r.reason)}</p><small>${date(r.createdAt)}${r.evidenceReference ? " · " + e(r.evidenceReference) : ""}</small></li>`).join("")}</ol>`
        : "<p>No administrator decisions yet.</p>",
    )
  );
}
