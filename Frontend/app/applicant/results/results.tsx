import styles from "./results.module.css";
import type { PageContext } from "../page-context";

export function results({
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
        "Your skills, in focus",
        "Understand your strengths. See where to grow next.",
        badge("Example report"),
      ) +
      `<div class="notice">Illustrative final results only. Real AI proposals require assessor review before final scores and learning plans are published.</div><div class="grid">${card(
        "Competency breakdown",
        `<div class="table-wrap"><table><thead><tr><th>Competency</th><th>Score</th><th>Required</th><th>Gap</th></tr></thead><tbody>${(
          [
            ["Engineering fundamentals", 82, 70],
            ["System integration", 64, 75],
            ["Diagnostics", 72, 80],
            ["Safety & practice", 91, 80],
          ] as [string, number, number][]
        )
          .map(
            ([s, v, t]) =>
              `<tr><td>${s}</td><td><strong>${v}</strong></td><td>${t}</td><td>${badge(v >= t ? "Met" : `${t - v} points`, v >= t ? "green" : "amber")}</td></tr>`,
          )
          .join("")}</tbody></table></div>`,
      )}${card("Your overall picture", `<div class="score">77.3 <small>/ 100</small></div><p>Example weighted competency score</p><div class="soft-panel"><h3>A strong foundation to build on</h3><p>Focus next on system integration and diagnostic reasoning.</p></div><div class="mt">${button("Open learning plan", "learning")}</div>`)}</div>`
    );
  })();
  return `<section class="${styles.page}">${content}</section>`;
}
