import styles from "./careers.module.css";
import type { PageContext } from "../page-context";

export function explore({
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
        "Find your next direction",
        "Explore the engineering careers where your skills can make an impact.",
      ) +
      `<div class="toolbar"><input class="search" id="career-search" aria-label="Search careers" placeholder="Search careers, skills, or interests…"></div><div class="tiles" id="career-tiles">${careers.map((c, i) => `<article class="card tile" data-career="${c.toLowerCase()}"><div class="career-emblem">${icon(i % 2 ? "settings" : "career")}</div>${badge("Engineering")}<h2 class="mt">${c}</h2><p>${["Connect mechanical, electronic, and intelligent systems to solve real-world challenges.", "Design reliable automated processes that make industry smarter and more efficient.", "Build intelligent machines and shape the future of human–robot collaboration."][i % 3]}</p><div class="tags">${badge(i % 2 ? "Industrial systems" : "Automation", "grey")}${badge("Problem solving", "grey")}</div><button class="btn subtle" data-action="career" data-value="${c}">Explore this career ${icon("arrow")}</button></article>`).join("")}</div><p id="no-careers" hidden>No careers match your search.</p>`
    );
  })();
  return `<section class="${styles.page}">${content}</section>`;
}

export function career({
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
        escape(state.career),
        "A career at the intersection of engineering and innovation.",
        button("Choose this career", "target"),
      ) +
      `<div class="grid">${card("What you’ll do", `<p>Design, integrate, and maintain intelligent engineering systems. Apply mechanical knowledge, electronics, control systems, and software to practical industrial problems.</p><h3 class="mt">Competencies you can assess</h3>${["Engineering fundamentals", "System integration", "Diagnostics & troubleshooting", "Safety & professional practice"].map((s, i) => `<div class="document-row" style="padding:16px 0"><span class="step-number">${i + 1}</span><h3>${s}</h3>${badge("Core")}</div>`).join("")}`)}${card("Shape your assessment", `<p>Choose related industries and optional companies to add context to your assessment.</p><div class="detail-list"><div><span>Career targets</span><strong>One at a time</strong></div><div><span>Industries</span><strong>Choose 1–3</strong></div><div><span>Companies</span><strong>Optional, up to 3</strong></div></div><div class="notice">Company preferences provide context. They do not represent job offers or employer partnerships.</div>${button("Build my target", "target")}`)}</div>`
    );
  })();
  return `<section class="${styles.page}">${content}</section>`;
}

export function target({
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
        "Build your career target",
        "Make your assessment relevant to where you want to go.",
      ) +
      card(
        "Your assessment context",
        `<form id="target-form"><div class="notice">${state.prepared ? "This demo target is prepared. Its choices are locked." : "Review your choices carefully. Preparing your target freezes the career, qualifications, and assessment rubric."}</div><div class="field"><label for="target-career">Selected career</label><input id="target-career" value="${escape(state.career)}" readonly></div><h3>Related industries · select 1–3</h3>${["Manufacturing & production", "Industrial automation", "Energy & power systems"].map((s, i) => `<label class="check"><input type="checkbox" name="industries" ${i === 0 ? "checked" : ""} ${state.prepared ? "disabled" : ""}>${s}</label>`).join("")}<div class="form-grid mt"><div class="field"><label for="company">Company preference (optional)</label><select id="company" ${state.prepared ? "disabled" : ""}><option>No preference</option><option>Kenya Electricity Generating Company</option><option>Kiira Motors Corporation</option></select></div><div class="field"><label for="qualification">Qualification</label><select id="qualification" ${state.prepared ? "disabled" : ""}><option>Profile discipline only</option></select><p>Only current, clean, non-rejected qualifications can be selected.</p></div></div><label class="check"><input type="checkbox" required ${state.prepared ? "checked disabled" : ""}>I understand that preparing this target locks my choices.</label>${state.prepared ? button("Continue to booking", "booking") : '<button class="btn primary">Prepare my target</button>'}</form>`,
      )
    );
  })();
  return `<section class="${styles.page}">${content}</section>`;
}
