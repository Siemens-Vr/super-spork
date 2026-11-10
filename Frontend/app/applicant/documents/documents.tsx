import styles from "./documents.module.css";
import type { PageContext } from "../page-context";

export function documentPage({
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
        "My documents",
        "Your qualifications, securely in one place.",
        button("Upload a document", "upload"),
      ) +
      `<div class="notice">Demo records only. Scan status and human verification are separate. Your original files and review history are preserved when you replace a document.</div><section class="card"><div class="card-head"><h2>Submitted documents</h2>${badge("3 documents")}</div>${documents()}</section><div class="grid section">${card("Verification timeline", `<div class="step done"><span class="step-number">${icon("check")}</span><div><h3>Identity authenticated</h3><p>08 November · Independent verification completed.</p></div></div><div class="step current"><span class="step-number">2</span><div><h3>Academic review in progress</h3><p>You’ll be notified if more evidence is needed.</p></div></div>`)}${card("Need to update a file?", `<p>Submit a replacement when a file or its details have changed. Previous versions stay in your verification history.</p><div class="mt">${button("Replace / add evidence", "upload", "subtle")}</div>`)}</div>`
    );
  })();
  return `<section class="${styles.page}">${content}</section>`;
}

export function upload({
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
        "Upload a document",
        "Add your qualifications to your career journey.",
      ) +
      card(
        "Document details",
        `<form id="upload-form"><div class="form-grid"><div class="field"><label for="category">Document category</label><select id="category"><option>Bachelor’s degree</option><option>Academic transcript</option><option>National ID</option><option>Passport</option><option>Diploma</option><option>Industry certification</option></select></div>${field("Institution / issuer", "institution", "")}${field("Course / certification name", "course", "")}${field("Issue date", "issued", "", "date")}</div><div class="upload">${icon("upload")}<h3 class="mt">Choose your document</h3><p>Use a clear, complete PDF or image. This preview does not transmit files.</p><label><span class="sr-only">Select file</span><br><input type="file" id="document-file" accept=".pdf,.jpg,.jpeg,.png" required></label></div><label class="check"><input type="checkbox" required>I confirm that this document belongs to me and the details are accurate.</label><button class="btn primary">Preview submission</button></form>`,
      )
    );
  })();
  return `<section class="${styles.page}">${content}</section>`;
}
