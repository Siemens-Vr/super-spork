import { createTrainingWorkspace } from '../../context/training-workspace.js';
import { dashboardLayout } from '../../components/dashboard-layout/dashboard-layout.tsx';
import "../admin/admin.css";
import "./trainer.css";
import { createTrainerApi } from "./api.js";
import { createTrainerStore } from "./store.js";
import { gateView, profileView } from "./views.js";
import { initializeNavigation, getRoute } from "../../hooks/navigation.js";
const app = document.getElementById("app"),
  client = createTrainerApi();
let invitation = new URLSearchParams(location.hash.slice(1)).get("token") || "";
if (invitation) history.replaceState(null, "", location.pathname);
const urls = new Set();
const store = createTrainerStore({
  client,
  onChange(reason) {
    if (reason === "logout") invitation = "";
    if (
      reason === "busy" ||
      (reason === "failed" && store.snapshot().auth === "ready")
    ) {
      setBusy();
      return;
    }
    render();
  },
});
const training = createTrainingWorkspace({ client, mode: 'trainer', onChange: render, onAuthError: () => { void store.boot(); } });
function setBusy() {
  const state = store.snapshot();
  for (const fieldset of app.querySelectorAll("fieldset:not(.training-workspace fieldset)"))
    fieldset.disabled =
      state.busy ||
      state.uncertain ||
      !["DRAFT", "CHANGES_REQUESTED", "REJECTED"].includes(
        state.profile?.status,
      );
  for (const b of app.querySelectorAll("button:not(.training-workspace button)"))
    b.disabled =
      (state.busy || state.uncertain) &&
      !["refresh", "logout"].includes(b.dataset.trainerAction);
  const region = document.getElementById("trainer-error");
  if (region) {
    region.textContent = state.error;
    region.hidden = !state.error;
  }
  for (const [name, message] of Object.entries(state.fieldErrors)) {
    const field = app.querySelector(`[name="${CSS.escape(name)}"]`);
    field?.setAttribute("aria-invalid", "true");
    field?.setAttribute("title", message);
  }
}
function render() {
  const state = store.snapshot();
  document.title = "VML NEXUS · Trainer workspace";
  if(state.auth !== 'ready') training.reset();
  if(state.auth === 'ready' && state.profile.status === 'APPROVED' && !['profile','qualifications'].includes(getRoute())) {
    training.ensure(state.user.id);
    app.innerHTML = dashboardLayout({role:'trainer',actionAttribute:'data-trainer-action',links:[['dashboard','Training dashboard','calendar'],['profile','Professional profile','user'],['qualifications','Qualifications','file']],route:'dashboard',title:'Training dashboard',name:state.user.legalName,body:training.view()});
    return;
  }
  app.innerHTML =
    state.auth === "ready"
      ? profileView(
          state,
          ["profile", "qualifications"].includes(getRoute())
            ? getRoute()
            : "dashboard",
          ({title,body}) => dashboardLayout({role:'trainer',actionAttribute:'data-trainer-action',links:[['dashboard','Training dashboard','calendar'],['profile','Professional profile','user'],['qualifications','Qualifications','file']],route:getRoute(),title,name:state.user.legalName,body}),
        )
      : gateView(state, !!invitation);
  setBusy();
}
async function action(kind, input) {
  const success = await store.mutate(kind, input);
  if (success && kind === "accept") {
    invitation = "";
    history.replaceState(null, "", "/dashboard");
  }
  if (success) render();
  else {
    setBusy();
    document.getElementById("trainer-error")?.focus();
  }
}
document.addEventListener("submit", async (event) => {
  const form = event.target.closest("[data-trainer-form]");
  if (!form) return;
  event.preventDefault();
  if (store.snapshot().busy || store.snapshot().uncertain) return;
  const data = new FormData(form);
  if (form.dataset.trainerForm === "qualification") {
    const file = data.get("file");
    if (file instanceof File && file.size > 10 * 1024 * 1024) {
      const error = document.getElementById("trainer-error");
      error.textContent = "Choose a file no larger than 10 MB.";
      error.hidden = false;
      error.focus();
      return;
    }
    await action("upload", data);
  } else {
    const input = Object.fromEntries(data);
    input.yearsExperience = Number(input.yearsExperience);
    input.expertise = input.expertise
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
    input.country = input.country.toUpperCase();
    await action("profile", input);
  }
});
document.addEventListener("click", async (event) => {
  const control = event.target.closest("[data-trainer-action]");
  if (!control || control.disabled) return;
  const kind = control.dataset.trainerAction;
  if (kind === "refresh") {
    await store.boot();
    return;
  }
  if (kind === "logout") {
    await store.logout();
    return;
  }
  if (kind === "accept") {
    await action("accept", invitation);
    return;
  }
  if (kind === "submit") {
    await action("submit");
    return;
  }
  if (kind === "withdraw") {
    if (
      confirm(
        "Withdraw this qualification? Its historical record will be retained.",
      )
    )
      await action("withdraw", control.dataset.id);
    return;
  }
  if (kind === "download") {
    const file = await store.download(control.dataset.id);
    if (!file) return;
    const url = URL.createObjectURL(file.blob);
    urls.add(url);
    const link = document.createElement("a");
    link.href = url;
    link.download = `trainer-qualification-${control.dataset.id}.${file.blob.type === "application/pdf" ? "pdf" : file.blob.type === "image/png" ? "png" : "jpg"}`;
    link.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      urls.delete(url);
    }, 1000);
  }
});
window.addEventListener("app:navigate", render);
window.addEventListener("pagehide", () => {
  for (const url of urls) URL.revokeObjectURL(url);
  urls.clear();
  invitation = "";
  store.reset();
});
initializeNavigation();
render();
void store.boot();

document.addEventListener('click',event=>{const b=event.target.closest('[data-action]');if(!b)return;const a=b.dataset.action;if(a==='menu'||a==='close-menu'){const sidebar=document.getElementById('workspace-sidebar');const open=a==='menu'&&!sidebar?.classList.contains('open');sidebar?.classList.toggle('open',open);document.querySelector('[data-action="menu"]')?.setAttribute('aria-expanded',String(open));const backdrop=document.querySelector('[data-action="close-menu"]');if(backdrop)backdrop.hidden=!open;}if(a==='notifications')location.assign('/dashboard');});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&document.querySelector('#workspace-sidebar.open'))document.querySelector('[data-action="close-menu"]')?.click();});
