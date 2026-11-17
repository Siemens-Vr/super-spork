import { escapeHtml as e } from "../../components/html.js";
import { editable } from "./store.js";
import { sharedLoginUrl, workspaceUrl } from "../../lib/workspaces.js";
export const label = (value) =>
  String(value || "")
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/^./, (c) => c.toUpperCase());
const date = (v) =>
  v
    ? new Intl.DateTimeFormat("en-GB", {
        dateStyle: "medium",
        timeZone: "Africa/Nairobi",
      }).format(new Date(v))
    : "—";
const badge = (value) =>
  `<span class="badge ${value === "APPROVED" || value === "CLEAN" ? "green" : ["REJECTED", "SUSPENDED", "INFECTED", "FAILED"].includes(value) ? "red" : "amber"}">${e(label(value))}</span>`;
const button = (text, action, extra = "") =>
  `<button class="btn primary" type="button" data-trainer-action="${action}" ${extra}>${text}</button>`;
const alert = (state) =>
  `<div id="trainer-error" class="admin-error" tabindex="-1" role="alert" ${state.error ? "" : "hidden"}>${e(state.error)}</div>${state.notice ? `<p class="notice admin-success" role="status">${e(state.notice)}</p>` : ""}`;
const field = (name, title, value, attrs = "", type = "text") =>
  `<div class="field"><label for="trainer-${name}">${e(title)}</label><input id="trainer-${name}" name="${name}" type="${type}" value="${e(value ?? "")}" ${attrs}></div>`;
const card = (title, body) =>
  `<section class="card"><div class="card-head"><h2>${title}</h2></div><div class="card-body">${body}</div></section>`;
const statusText = {
  DRAFT:
    "Build your professional profile and add your qualifications. You can save your progress before submitting.",
  SUBMITTED:
    "Your profile is with an administrator. We will email you when the review is complete. Your submitted details are locked during review.",
  CHANGES_REQUESTED:
    "An administrator has requested changes. Read the latest feedback, update your details and resubmit.",
  APPROVED:
    "Your trainer profile has been approved. Training delivery and learner assignments will be connected in a later milestone.",
  REJECTED:
    "Your submission was not approved. Read the feedback below. You may update your profile and qualifications before submitting again.",
  SUSPENDED:
    "Your trainer approval has been suspended. Contact your institution administrator and refer to the review reason below.",
};
export function gateView(state, hasInvitation) {
  if (state.auth === "mfa")
    return `<main class="auth trainer-gate"><section class="card card-body"><div class="eyebrow">VML NEXUS · SECURITY CHECK</div><h1>Confirm administrator access</h1><p>Accounts with administrator access need a recent MFA check before opening their trainer profile.</p><p>${e(state.error || "")}</p><a class="btn primary" target="_blank" rel="noopener" href="${e(workspaceUrl("ADMIN"))}">Complete security check</a><button class="btn subtle" data-trainer-action="refresh">Check sign-in</button><button class="btn subtle" data-trainer-action="logout">Sign out</button></section></main>`;

  const loading = state.auth === "loading";
  const heading = loading
    ? "Checking your session…"
    : state.auth === "unverified"
      ? "Verify your email first"
      : state.auth === "error"
        ? "Unable to open trainer workspace"
        : hasInvitation
          ? "Your trainer invitation"
          : "Trainer access is by invitation";
  return `<main class="auth trainer-gate"><section class="card card-body"><div class="eyebrow">VML NEXUS · TRAINERS</div><h1>${heading}</h1>${alert(state)}<p>${loading ? "Please wait while we check your existing NEXUS session." : state.auth === "unverified" ? "Use the shared verification page, then return here." : hasInvitation ? "Sign in or register with the exact email that received this invitation. Keep this tab open while signing in." : "Ask your institution administrator to invite your verified account email."}</p>${!loading ? `<div class="inline-actions"><a class="btn subtle" target="_blank" rel="noopener" href="${e(state.auth === "unverified" ? workspaceUrl("APPLICANT", "/verify-email") : sharedLoginUrl())}">${state.auth === "unverified" ? "Verify email" : "Open shared sign in"}</a>${button("Check sign-in", "refresh")}</div>${state.user && hasInvitation && state.auth !== "unverified" ? `<p>Accepting as <strong>${e(state.user.email)}</strong>.</p>${button("Accept trainer invitation", "accept", state.busy ? "disabled" : "")}` : ""}${state.user ? `<p><button class="btn subtle" data-trainer-action="logout">Sign out</button></p>` : ""}<p class="admin-small">Invitation links expire after seven days. This tab holds the invitation privately in memory; reopen the email link if you refresh it.</p>` : ""}</section></main>`;
}
export function profileView(state, route = "dashboard") {
  const p = state.profile,
    canEdit = editable(p.status),
    current = p.qualifications.filter((q) => !q.withdrawnAt),
    first = p.reviews[0];
  const navigation = [
    ["dashboard", "Overview"],
    ["profile", "Professional profile"],
    ["qualifications", "Qualifications"],
  ];
  let content = "";
  if (route === "profile")
    content = card(
      "Professional profile",
      `<p>Your account name and email come from your existing NEXUS identity. Only your professional trainer details are edited here.</p><form data-trainer-form="profile"><fieldset ${!canEdit ? "disabled" : ""}><div class="form-grid">${field("headline", "Professional headline", p.headline, 'required minlength="3" maxlength="120"')}${field("region", "County or region", p.region, 'required minlength="2" maxlength="100"')}${field("country", "Country (ISO code)", p.country, 'required pattern="[A-Z]{2}" maxlength="2"')}${field("yearsExperience", "Years of relevant experience", p.yearsExperience, 'required min="0" max="60" step="1"', "number")}</div><div class="field"><label for="trainer-biography">Professional biography</label><textarea id="trainer-biography" name="biography" rows="6" required minlength="40" maxlength="3000">${e(p.biography)}</textarea></div>${field("expertise", "Expertise areas (comma separated)", p.expertise.join(", "), 'required maxlength="820"')}<p class="admin-small">Add between one and ten distinct areas, such as PLC programming, industrial automation or instrumentation.</p><button class="btn primary" type="submit">Save profile</button></fieldset></form>`,
    );
  else if (route === "qualifications")
    content = card(
      "Your qualifications",
      `<p>Attach PDF, JPEG or PNG evidence, up to 10 MB per file. Files are private and unavailable for download until scanning passes. Withdrawal preserves previous review evidence.</p>${current.length ? `<ul class="trainer-qualification-list">${current.map((q) => `<li><div><strong>${e(q.title)}</strong><p>${e(q.issuer)} · ${e(label(q.category))}</p><small>Issued ${date(q.issuedAt)}${q.expiresAt ? " · Expires " + date(q.expiresAt) : ""}</small></div>${badge(q.scanStatus)}<div class="inline-actions">${q.scanStatus === "CLEAN" ? button("Download", "download", `data-id="${e(q.id)}"`) : ""}${canEdit ? `<button class="btn subtle" type="button" data-trainer-action="withdraw" data-id="${e(q.id)}">Withdraw</button>` : ""}</div></li>`).join("")}</ul>` : '<div class="empty"><h3>No qualifications yet</h3><p>Add at least one qualification to support your trainer application.</p></div>'}${canEdit ? `<h3>Add a qualification</h3><form data-trainer-form="qualification"><fieldset><div class="form-grid"><div class="field"><label for="trainer-category">Qualification type</label><select id="trainer-category" name="category">${["DEGREE", "DIPLOMA", "CERTIFICATION", "REGISTRATION", "OTHER"].map((v) => `<option value="${v}">${label(v)}</option>`).join("")}</select></div>${field("title", "Qualification title", "", 'required minlength="3" maxlength="200"')}${field("issuer", "Issuing institution or organisation", "", 'required minlength="2" maxlength="200"')}${field("issuedAt", "Issue date", "", "required", "date")}${field("expiresAt", "Expiry date (optional)", "", "", "date")}${field("file", "Evidence file", "", 'required accept="application/pdf,image/jpeg,image/png"', "file")}</div><button class="btn primary" type="submit">Upload qualification</button></fieldset></form>` : ""}`,
    );
  else
    content = `<section class="hero trainer-hero"><div class="eyebrow">YOUR KNOWLEDGE. THEIR NEXT STEP.</div><h2>Bring practical experience<br>to the next generation.</h2><p>Build a verified professional profile so the institution can review your expertise and qualifications.</p><a class="btn light" href="/profile">${canEdit ? "Complete your profile" : "View your profile"} →</a></section><div class="grid trainer-overview">${card("Professional details", `<h3>${e(p.headline || "Add your professional headline")}</h3><p>${p.expertise.length ? e(p.expertise.join(" · ")) : "Tell us about the areas you can teach."}</p><a href="/profile">Open professional profile →</a>`)}${card("Qualification evidence", `<strong class="trainer-stat">${current.length}</strong><p>${current.filter((q) => q.scanStatus === "CLEAN").length} passed malware scanning</p><a href="/qualifications">Manage qualifications →</a>`)}</div>${card("Submit for review", `<p>Complete your professional profile and add at least one current qualification. All current evidence files must pass malware scanning before you submit.</p>${canEdit ? button("Submit profile for review", "submit") : badge(p.status)}`)}`;
  const history = p.reviews.length
    ? card(
        "Review history",
        `<ol class="admin-timeline">${p.reviews.map((r) => `<li><strong>${e(label(r.outcome))}</strong><small>${date(r.createdAt)}</small><p>${e(r.reason)}</p></li>`).join("")}</ol>`,
      )
    : "";
  return `<a class="admin-skip" href="#trainer-main">Skip to content</a><aside class="sidebar trainer-sidebar"><a class="brand" href="/dashboard"><span class="mark">N</span><span>VML NEXUS<small>VIRTUAL MECHATRONICS LABS</small></span></a><div class="nav-label">TRAINER WORKSPACE</div><nav aria-label="Trainer navigation">${navigation.map(([path, title]) => `<a class="nav-link ${path === route ? "active" : ""}" href="/${path}" ${path === route ? 'aria-current="page"' : ""}>${title}</a>`).join("")}</nav><div class="sidebar-bottom"><a class="nav-link" href="${e(workspaceUrl("APPLICANT", "/workspaces"))}">Switch workspace</a><button class="nav-link" data-trainer-action="logout">Sign out</button></div></aside><div class="main trainer-main"><header class="topbar"><strong>Trainer onboarding</strong><span>${e(state.user.legalName)}</span></header><main class="content" id="trainer-main" tabindex="-1"><div class="page-heading"><div><div class="eyebrow">BUILD YOUR TRAINER PROFILE</div><h1>${e(navigation.find((n) => n[0] === route)?.[1] || "Overview")}</h1><p>${e(state.user.email)}</p></div><button class="btn subtle" data-trainer-action="refresh">Refresh saved profile</button></div>${alert(state)}<section class="notice trainer-status" aria-label="Trainer approval status">${badge(p.status)}<p>${e(statusText[p.status])}</p>${first ? `<p><strong>Latest review:</strong> ${e(first.reason)}</p>` : ""}</section>${content}${history}</main></div>`;
}
