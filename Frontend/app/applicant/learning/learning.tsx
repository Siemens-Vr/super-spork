import styles from "./learning.module.css";
import type { PageContext } from "../page-context";

export function learning({
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
    const items = [
      "Strengthen system integration skills",
      "Practice structured fault diagnosis",
      "Apply your learning in a practical scenario",
    ];
    let n = state.learning.filter(Boolean).length;
    return (
      heading(
        "Keep moving forward",
        "Small, focused steps toward stronger engineering skills.",
      ) +
      card(
        "Your personalized learning plan",
        `<div class="progress-label"><span>${n} of 3 activities completed</span><strong>${Math.round((n / 3) * 100)}%</strong></div><div class="progress"><span style="width:${(n / 3) * 100}%"></span></div>${items.map((t, i) => `<div class="document-row" style="padding:25px 0"><span class="step-number">${i + 1}</span><div style="flex:1"><h3>${t}</h3><p>${["Review interfaces, signals, and integration testing.", "Work through load-dependent motor fault scenarios.", "Document the evidence and explain your decisions."][i]}</p></div><label class="check"><input type="checkbox" data-learning="${i}" ${state.learning[i] ? "checked" : ""}>Done</label></div>`).join("")}<div class="notice mt">Demo progress is stored locally. Completing an activity records your progress; it does not certify competency.</div>`,
      )
    );
  })();
  return `<section class="${styles.page}">${content}</section>`;
}
