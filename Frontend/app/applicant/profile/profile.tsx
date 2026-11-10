import styles from "./profile.module.css";
import type { PageContext } from "../page-context";

export function profile({
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
      heading("Your profile", "A little about you. A better path forward.") +
      `<div class="grid">${card("Personal & academic information", `<form id="profile-form"><div class="form-grid">${field("Full legal name", "name", state.name)}${field("Email address", "email", "alex@example.test", "email")}${field("Phone number", "phone", "+254 712 345 678", "tel")}<div class="field"><label for="country">Country</label><select id="country"><option>Kenya</option><option>Uganda</option><option>Tanzania</option><option>Rwanda</option></select></div><div class="full">${field("Discipline / course", "discipline", state.discipline)}</div></div><button class="btn primary">Save profile</button></form>`)}${card("Your onboarding checklist", `<div class="detail-list"><div>Email verified ${badge("Complete", "green")}</div><div>Profile information ${badge("Complete", "green")}</div><div>Identity submission ${badge("Complete", "green")}</div><div>Academic documents ${badge("In review", "amber")}</div></div><div class="notice">Qualification and institution details belong to your document uploads. You can explore careers while academic review continues.</div>${button("Manage documents", "documents", "subtle")}`)}</div>`
    );
  })();
  return `<section class="${styles.page}">${content}</section>`;
}
