import styles from "./dashboard.module.css";
import type { PageContext } from "../page-context";

export function dashboard({
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
    const steps = [
      [
        "Create your account",
        "Your email is verified. You’re ready to go.",
        "done",
      ],
      [
        "Complete your profile",
        "Tell us about your engineering background.",
        "done",
      ],
      [
        "Upload your documents",
        "Identity submitted. Academic review in progress.",
        "done",
      ],
      [
        "Choose your career path",
        "Find the role that matches your ambitions.",
        "current",
      ],
      [
        "Book your assessment",
        "Choose a convenient time to show your skills.",
        "",
      ],
    ];
    return (
      heading(
        `Welcome back, ${escape((currentUser()?.legalName || state.name).split(" ")[0])} 👋`,
        "A clearer picture of your skills. A confident next step in your career.",
      ) +
      `<section class="hero"><div><div class="eyebrow">YOUR NEXT CHAPTER STARTS HERE</div><h2>Turn your potential into<br>career-ready confidence.</h2><p>Your documents are in. Explore engineering careers and choose the assessment that takes you forward.</p>${button("Explore career paths", "careers", "light")}</div><div class="hero-art">${icon("career")}<span>Built for your future ↗</span></div></section><div class="stats">${[
        ["file", "3", "Documents submitted"],
        ["shield", "1 of 3", "Documents authenticated"],
        ["career", "27", "Industries to explore"],
        ["calendar", state.booked ? "1" : "—", "Upcoming assessments"],
      ]
        .map(
          ([i, v, l]) =>
            `<div class="stat"><div class="stat-icon">${icon(i)}</div><div><strong>${v}</strong><small>${l}</small></div></div>`,
        )
        .join(
          "",
        )}</div><div class="grid">${card("Your journey", `<div class="progress-label"><span>Let’s get you assessment-ready</span><strong>3 of 5 steps</strong></div><div class="progress" style="margin-bottom:26px"><span style="width:60%"></span></div>${steps.map(([t, d, c], i) => `<div class="step ${c}"><div class="step-number">${c === "done" ? icon("check") : i + 1}</div><div class="step-content"><div><h3>${t}</h3><p>${d}</p></div>${c === "current" ? badge("Next step") : c === "done" ? badge("Complete", "green") : ""}</div></div>`).join("")}`)}${card("A path worth exploring", `<div class="career-emblem">${icon("settings")}</div><div class="eyebrow">ENGINEERING & TECHNOLOGY</div><h2 style="margin-top:10px">${escape(state.career)}</h2><p>Bring mechanical systems, electronics, and intelligent automation together.</p><div class="tags">${badge("Automation")}${badge("Robotics")}${badge("Manufacturing")}</div><div class="soft-panel"><h3>Discover where you stand</h3><p>Assess your competencies and get a personalized plan to close your skill gaps.</p></div><div class="mt">${button("View career details", "career", "subtle")}</div>`)}</div><section class="card section"><div class="card-head"><h2>Your documents</h2><a href="#/documents">View all documents →</a></div>${documents()}</section>`
    );
  })();
  return `<section class="${styles.page}">${content}</section>`;
}
