import styles from "./settings.module.css";
import type { PageContext } from "../page-context";

export function settings({
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
        "Account & security",
        "Keep your details and access up to date.",
      ) +
      `<div class="grid">${card("Account details", `<h3>${escape(state.name)}</h3><p>${escape(currentUser()?.email || "")}</p><div class="mt">${button("Edit profile", "onboarding", "subtle")}</div><h3 class="mt">Google account</h3><p>Google sign-in will be available after API integration.</p>`)}${card("Sessions & preferences", `<div class="document-row" style="padding:15px 0"><div><h3>Current browser</h3><p>Local preview session</p></div>${badge("Current", "green")}</div><button class="btn mt" data-action="reset">Reset demo workspace</button><p class="mt">Reset removes demo choices and learning progress from this browser.</p>`)}</div>`
    );
  })();
  return `<section class="${styles.page}">${content}</section>`;
}
