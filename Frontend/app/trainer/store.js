export const editable = (status) =>
  ["DRAFT", "CHANGES_REQUESTED", "REJECTED"].includes(status);
export function createTrainerStore({ client, onChange = () => {} }) {
  const initial = () => ({
    auth: "loading",
    user: null,
    profile: null,
    busy: false,
    loading: false,
    error: "",
    notice: "",
    fieldErrors: {},
    uncertain: false,
  });
  let state = initial(),
    generation = 0;
  const current = (version, owner) =>
    version === generation && state.user?.id === owner;
  function failure(error) {
    if (error.code === "MFA_REQUIRED") {
      generation++;
      const user = state.user;
      state = {
        ...initial(),
        user,
        auth: "mfa",
        error:
          "Complete the administrator security check, then return here and check sign-in. No trainer change was submitted.",
      };
      onChange("auth");
      return;
    }

    if (error.status === 401) {
      generation++;
      client.clear();
      state = {
        ...initial(),
        auth: "login",
        error: "Your session ended. Sign in and try again.",
      };
      onChange("auth");
      return;
    }
    state.error = error.message || "Unable to complete the request.";
    state.fieldErrors = Object.fromEntries(
      (error.details || []).map((detail) => [detail.path, detail.message]),
    );
    if (
      [
        "NETWORK_ERROR",
        "TRAINER_VERSION_CONFLICT",
        "TRAINER_PROFILE_LOCKED",
      ].includes(error.code)
    ) {
      state.uncertain = true;
      state.error += " Refresh the saved profile before trying another change.";
    }
  }
  const store = {
    snapshot: () => state,
    reset() {
      generation++;
      client.clear();
      state = initial();
      onChange();
    },
    async boot() {
      const version = ++generation;
      state = { ...initial(), loading: true };
      onChange("load");
      try {
        const user = await client.me();
        if (version !== generation) return;
        state.user = user;
        if (!user.emailVerifiedAt) {
          state.auth = "unverified";
          return;
        }
        if (!user.roles?.includes("TRAINER")) {
          state.auth = "invitation";
          return;
        }
        const profile = await client.profile();
        if (!current(version, user.id)) return;
        state.profile = profile;
        state.auth = "ready";
      } catch (error) {
        if (version !== generation) return;
        if (error.status === 401) {
          client.clear();
          state.auth = "login";
        } else {
          state.auth = "error";
          failure(error);
        }
      } finally {
        if (version === generation) {
          state.loading = false;
          onChange("load");
        }
      }
    },
    async mutate(kind, input) {
      if (state.busy || state.loading || state.uncertain || !state.user)
        return false;
      const version = generation,
        owner = state.user.id;
      state.busy = true;
      state.error = "";
      state.notice = "";
      state.fieldErrors = {};
      onChange("busy");
      try {
        const principal = await client.me();
        if (!current(version, owner)) return false;
        if (principal.id !== owner) {
          store.reset();
          await store.boot();
          state.notice =
            "The signed-in account changed. No changes were submitted. Review this account before continuing.";
          onChange("auth");
          return false;
        }
        let profile;
        if (kind === "accept") {
          await client.acceptInvitation(input);
          if (!current(version, owner)) return false;
          const user = await client.me();
          if (!current(version, owner)) return false;
          state.user = user;
          profile = await client.profile();
        } else {
          if (state.auth !== "ready" || !editable(state.profile.status))
            throw new Error("This profile is locked for review.");
          if (kind === "profile")
            profile = await client.saveProfile({
              ...input,
              version: state.profile.version,
            });
          else if (kind === "upload") {
            input.set("version", String(state.profile.version));
            profile = await client.uploadQualification(input);
          } else if (kind === "submit")
            profile = await client.submitProfile(state.profile.version);
          else if (kind === "withdraw")
            profile = await client.withdrawQualification(
              input,
              state.profile.version,
            );
          else throw new Error("Unknown trainer action");
        }
        if (!current(version, owner)) return false;
        state.profile = profile;
        state.auth = "ready";
        state.notice = {
          accept:
            "Invitation accepted. Complete your trainer profile to begin.",
          profile: "Professional profile saved.",
          upload:
            "Qualification uploaded. It will remain private while malware scanning runs.",
          submit: "Profile submitted for administrator review.",
          withdraw:
            "Qualification withdrawn. Its historical record is retained.",
        }[kind];
        return true;
      } catch (error) {
        if (current(version, owner)) failure(error);
        return false;
      } finally {
        if (current(version, owner)) {
          state.busy = false;
          onChange(state.error ? "failed" : "mutation");
        }
      }
    },
    async download(id) {
      const version = generation,
        owner = state.user?.id;
      try {
        const result = await client.downloadQualification(id);
        return current(version, owner) && state.auth === "ready"
          ? result
          : null;
      } catch (error) {
        if (current(version, owner)) {
          failure(error);
          onChange("failed");
        }
        return null;
      }
    },
    async logout() {
      const version = ++generation;
      state.busy = true;
      onChange("busy");
      try {
        await client.logout();
      } catch (error) {
        if (version !== generation) return;
        if (error.status !== 401) {
          state.error = error.message;
          state.busy = false;
          onChange();
          return;
        }
      }
      if (version !== generation) return;
      client.clear();
      state = { ...initial(), auth: "login" };
      onChange("logout");
    },
  };
  return store;
}
