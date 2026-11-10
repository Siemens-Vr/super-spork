import styles from "./assessments.module.css";
import type { PageContext } from "../page-context";

export function booking({
  state,
  escape,
  heading,
  button,
  card,
  badge,
  field,
  documents,
  icon,
  currentUser,
  careers,
}: PageContext): string {
  const content = (() => {
    return (
      heading(
        "Your assessments",
        "Make time for the next step in your career.",
      ) +
      `<div class="notice">Demo scheduling only. These example slots are not published backend availability.</div><div class="grid">${card(state.booked ? "Your upcoming assessment" : "Choose a time", state.booked ? `<div class="career-emblem">${icon("calendar")}</div><h2>${escape(state.career)}</h2><div class="detail-list"><div><span>Date</span><strong>18 November 2026</strong></div><div><span>Time</span><strong>${["09:00", "11:00", "14:00"][state.slot]} EAT</strong></div><div><span>Duration</span><strong>60 minutes</strong></div><div><span>Status</span>${badge("Scheduled", "green")}</div></div><div class="inline-actions">${button("Device check & preview", "preflight")}<button class="btn" data-action="reschedule">Reschedule</button><button class="btn" data-action="cancel">Cancel booking</button></div>` : `<h3>${escape(state.career)}</h3><p>Wednesday, 18 November 2026 · Africa/Nairobi (EAT)</p><div class="slots">${["09:00", "11:00", "14:00"].map((s, i) => `<button class="slot ${state.slot === i ? "selected" : ""}" data-action="slot" data-value="${i}" aria-pressed="${state.slot === i}">${s} – ${["10:00", "12:00", "15:00"][i]}<small>Example slot · 60 minutes</small></button>`).join("")}</div><button class="btn primary" data-action="book">Confirm demo booking</button>`)}${card("Before you book", `<div class="detail-list"><div>Verified email ${badge("Ready", "green")}</div><div>Complete profile ${badge("Ready", "green")}</div><div>Clean identity ${badge("Ready", "green")}</div><div>Prepared target ${badge(state.prepared ? "Ready" : "Required", state.prepared ? "green" : "amber")}</div></div><p>Availability, cancellation notice, and rescheduling limits are set by the assessment provider.</p><div class="mt">${button("Review career target", "target", "subtle")}</div>`)}</div>`
    );
  })();
  return `<section class="${styles.page}">${content}</section>`;
}

export function preflight({
  state,
  escape,
  heading,
  button,
  card,
  badge,
  field,
  documents,
  icon,
  currentUser,
  careers,
}: PageContext): string {
  const content = (() => {
    return (
      heading(
        "Let’s get you ready",
        "A few checks before you enter your assessment.",
      ) +
      card(
        "Assessment preflight",
        `<form id="preflight-form"><div class="notice">This is a text-based demo. It does not request device permissions, record audio or video, or connect to an AI provider.</div><h3>${escape(state.career)}</h3><p>You’ll see one prompt at a time. Review your answer before submitting it.</p><label class="check"><input type="checkbox" required>I have a stable connection and a quiet space.</label><label class="check"><input type="checkbox" required>I understand confirmed answers form part of the assessment evidence.</label><label class="check"><input type="checkbox" required>I am ready to enter the practice interface.</label><button class="btn primary">Enter demo assessment ${icon("arrow")}</button></form>`,
      )
    );
  })();
  return `<section class="${styles.page}">${content}</section>`;
}

export function assessment({
  state,
  escape,
  heading,
  button,
  card,
  badge,
  field,
  documents,
  icon,
  currentUser,
  careers,
}: PageContext): string {
  const content = (() => {
    return (
      heading(
        "Assessment room",
        "Take your time. Show how you approach the problem.",
        badge("Practice preview"),
      ) +
      `<div class="grid">${card("Engineering scenario", `<div class="chat" id="chat"><div class="bubble"><strong>Scenario 1 · System diagnostics</strong><br>A conveyor motor stops intermittently under load. How would you investigate the fault while keeping the team and equipment safe?</div>${state.messages.map((m) => `<div class="bubble mine">${escape(m)}</div><div class="bubble">Practice response saved in this browser session. In the connected assessment, the interviewer would continue with an approved follow-up question.</div>`).join("")}</div><form id="answer-form" class="mt"><div class="field"><label for="answer">Your answer</label><textarea id="answer" required maxlength="8000" placeholder="Describe your reasoning and the steps you would take…"></textarea></div><button class="btn primary">Confirm & submit answer</button></form>`)}${card("Session overview", `<div class="progress-label"><span>Practice scenario</span><strong>1 of 1</strong></div><div class="progress"><span style="width:100%"></span></div><div class="detail-list"><div><span>Mode</span><strong>Text</strong></div><div><span>Connection</span>${badge("Local demo", "green")}</div></div><p>Your confirmed answer appears in the conversation. No score is generated in this preview.</p><div class="mt">${button("View example results", "results", "subtle")}</div>`)}</div>`
    );
  })();
  return `<section class="${styles.page}">${content}</section>`;
}
