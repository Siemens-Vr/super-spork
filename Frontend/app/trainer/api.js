import { createApi } from "../../lib/api.js";
export function createTrainerApi(options) {
  const api = createApi(options);
  return {
    ...api,
    profile: () => api.request("/trainers/me"),
    acceptInvitation: (token) =>
      api.request("/trainers/invitations/accept", {
        method: "POST",
        body: { token },
      }),
    saveProfile: (body) =>
      api.request("/trainers/me", { method: "PATCH", body }),
    submitProfile: (version) =>
      api.request("/trainers/me/submit", { method: "POST", body: { version } }),
    uploadQualification: (body) =>
      api.request("/trainers/me/qualifications", { method: "POST", body }),
    withdrawQualification: (id, version) =>
      api.request(`/trainers/me/qualifications/${encodeURIComponent(id)}`, {
        method: "DELETE",
        body: { version },
      }),
    downloadQualification: (id) =>
      api.request(
        `/trainers/me/qualifications/${encodeURIComponent(id)}/download`,
        { responseType: "blob" },
      ),
  };
}
