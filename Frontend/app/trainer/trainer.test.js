import test from "node:test";
import assert from "node:assert/strict";
import { createTrainerStore } from "./store.js";
import { profileView, gateView } from "./views.js";
import { workspaceUrl, availableWorkspaces } from "../../lib/workspaces.js";
import { createTrainerApi } from "./api.js";
const user = {
  id: "trainer-1",
  legalName: "Example Trainer",
  email: "trainer@example.test",
  emailVerifiedAt: "2026-01-01",
  roles: ["APPLICANT", "TRAINER"],
  permissions: [],
};
const profile = {
  userId: user.id,
  headline: "PLC educator",
  biography: "Practical technical education and safe engineering delivery.",
  country: "KE",
  region: "Nyeri",
  yearsExperience: 5,
  expertise: ["PLC programming"],
  status: "DRAFT",
  version: 1,
  qualifications: [],
  reviews: [],
};
const clientBase = {
  me: async () => user,
  profile: async () => structuredClone(profile),
  clear() {},
  logout: async () => {},
};
function pending() {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
test("shared sign-in supports trainer-only and multiple workspaces", () => {
  assert.equal(workspaceUrl("TRAINER"), "http://localhost:3003/dashboard");
  assert.deepEqual(availableWorkspaces({ roles: ["TRAINER"] }), ["TRAINER"]);
  assert.deepEqual(availableWorkspaces(user), ["APPLICANT", "TRAINER"]);
  assert.equal(workspaceUrl("not-a-role"), "http://localhost:3000/dashboard");
});
test("loads only the authenticated trainer profile and clears private state on logout", async () => {
  const store = createTrainerStore({ client: { ...clientBase } });
  await store.boot();
  assert.equal(store.snapshot().auth, "ready");
  assert.equal(store.snapshot().profile.userId, user.id);
  await store.logout();
  assert.equal(store.snapshot().auth, "login");
  assert.equal(store.snapshot().profile, null);
});
test("requires invitation and verified email before loading a profile", async () => {
  let calls = 0;
  const store = createTrainerStore({
    client: {
      ...clientBase,
      me: async () => ({ ...user, roles: ["APPLICANT"] }),
      profile: async () => {
        calls++;
      },
    },
  });
  await store.boot();
  assert.equal(store.snapshot().auth, "invitation");
  assert.equal(calls, 0);
  const other = createTrainerStore({
    client: {
      ...clientBase,
      me: async () => ({ ...user, emailVerifiedAt: null }),
    },
  });
  await other.boot();
  assert.equal(other.snapshot().auth, "unverified");
});
test("profile save carries current version and confirmed response becomes authoritative", async () => {
  let body;
  const store = createTrainerStore({
    client: {
      ...clientBase,
      saveProfile: async (input) => {
        body = input;
        return { ...profile, ...input, version: 2 };
      },
    },
  });
  await store.boot();
  assert.equal(
    await store.mutate("profile", { headline: "Updated headline" }),
    true,
  );
  assert.equal(body.version, 1);
  assert.equal(store.snapshot().profile.version, 2);
});
test("uploaded evidence uses multipart versioning and preserves failures for correction", async () => {
  let body;
  const store = createTrainerStore({
    client: {
      ...clientBase,
      uploadQualification: async (input) => {
        body = input;
        throw Object.assign(new Error("Invalid issue date"), {
          status: 422,
          details: [{ path: "issuedAt", message: "Invalid date" }],
        });
      },
    },
  });
  await store.boot();
  const data = new FormData();
  data.set("title", "PLC certificate");
  assert.equal(await store.mutate("upload", data), false);
  assert.equal(body.get("version"), "1");
  assert.equal(body.get("title"), "PLC certificate");
  assert.equal(store.snapshot().fieldErrors.issuedAt, "Invalid date");
  assert.equal(store.snapshot().uncertain, false);
});
test("unknown mutation outcomes block repetition until a fresh server read", async () => {
  let calls = 0;
  const store = createTrainerStore({
    client: {
      ...clientBase,
      saveProfile: async () => {
        calls++;
        throw Object.assign(new Error("Connection lost"), {
          code: "NETWORK_ERROR",
        });
      },
    },
  });
  await store.boot();
  await store.mutate("profile", {});
  assert.equal(store.snapshot().uncertain, true);
  await store.mutate("profile", {});
  assert.equal(calls, 1);
  await store.boot();
  assert.equal(store.snapshot().uncertain, false);
});
test("late private responses cannot survive logout or another account", async () => {
  const job = pending();
  const store = createTrainerStore({
    client: { ...clientBase, saveProfile: () => job.promise },
  });
  await store.boot();
  const mutation = store.mutate("profile", {});
  await store.logout();
  job.resolve({ ...profile, headline: "Stale response" });
  await mutation;
  assert.equal(store.snapshot().profile, null);
  assert.equal(store.snapshot().auth, "login");
});
test("submitted and approved profiles cannot be edited from the store", async () => {
  let calls = 0;
  const store = createTrainerStore({
    client: {
      ...clientBase,
      profile: async () => ({ ...profile, status: "APPROVED" }),
      saveProfile: async () => {
        calls++;
      },
    },
  });
  await store.boot();
  assert.equal(await store.mutate("profile", {}), false);
  assert.equal(calls, 0);
});
test("accepts an invitation and reloads the newly assigned role", async () => {
  let accepted = false;
  const store = createTrainerStore({
    client: {
      ...clientBase,
      me: async () => ({
        ...user,
        roles: accepted ? ["TRAINER"] : ["APPLICANT"],
      }),
      acceptInvitation: async (token) => {
        assert.equal(token, "private-token");
        accepted = true;
      },
    },
  });
  await store.boot();
  assert.equal(await store.mutate("accept", "private-token"), true);
  assert.equal(store.snapshot().auth, "ready");
  assert.deepEqual(store.snapshot().user.roles, ["TRAINER"]);
});
test("renders actual status, feedback and escaped private values", () => {
  const html = profileView(
    {
      user,
      profile: {
        ...profile,
        status: "CHANGES_REQUESTED",
        headline: "<img src=x onerror=alert(1)>",
        reviews: [
          {
            outcome: "CHANGES_REQUESTED",
            reason: "<script>unsafe</script>",
            createdAt: "2026-11-16",
          },
        ],
      },
      error: "",
      notice: "",
    },
    "profile",
  );
  assert.ok(html.includes("&lt;img"));
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("Professional profile"));
  const gate = gateView({ auth: "login" }, true);
  assert.ok(gate.includes("Keep this tab open"));
  assert.ok(!gate.includes("private-token"));
});
test("API routes encode qualification IDs and use existing CSRF cookies", async () => {
  const calls = [];
  const client = createTrainerApi({
    base: "/api/v1",
    fetcher: async (url, options) => {
      calls.push([url, options]);
      return new Response(
        JSON.stringify({
          data: url.endsWith("/csrf") ? { csrfToken: "csrf" } : profile,
        }),
        { status: 200 },
      );
    },
  });
  await client.withdrawQualification("a/b", 4);
  assert.equal(calls[1][0], "/api/v1/trainers/me/qualifications/a%2Fb");
  assert.equal(calls[1][1].headers["X-CSRF-Token"], "csrf");
  assert.deepEqual(JSON.parse(calls[1][1].body), { version: 4 });
});

test("a different cookie account cannot receive a mutation intended for the previous trainer", async () => {
  let current = user,
    writes = 0;
  const store = createTrainerStore({
    client: {
      ...clientBase,
      me: async () => current,
      profile: async () => ({ ...profile, userId: current.id }),
      saveProfile: async () => {
        writes++;
      },
    },
  });
  await store.boot();
  current = { ...user, id: "another-account" };
  assert.equal(await store.mutate("profile", {}), false);
  assert.equal(writes, 0);
  assert.equal(store.snapshot().user.id, "another-account");
  assert.ok(store.snapshot().notice.includes("account changed"));
});
test("late private downloads are discarded and expired sessions clear the view", async () => {
  const job = pending();
  const store = createTrainerStore({
    client: { ...clientBase, downloadQualification: () => job.promise },
  });
  await store.boot();
  const download = store.download("qualification");
  await store.logout();
  job.resolve({ blob: new Blob(["private"]) });
  assert.equal(await download, null);
  const expired = createTrainerStore({
    client: {
      ...clientBase,
      downloadQualification: async () => {
        throw Object.assign(new Error("Expired"), { status: 401 });
      },
    },
  });
  await expired.boot();
  assert.equal(await expired.download("qualification"), null);
  assert.equal(expired.snapshot().auth, "login");
  assert.equal(expired.snapshot().profile, null);
});

test("dual-role administrators receive an MFA handoff and expired MFA clears private profile data", async () => {
  const store = createTrainerStore({
    client: {
      ...clientBase,
      profile: async () => {
        throw Object.assign(new Error("MFA required"), {
          code: "MFA_REQUIRED",
          status: 403,
        });
      },
    },
  });
  await store.boot();
  assert.equal(store.snapshot().auth, "mfa");
  assert.equal(store.snapshot().profile, null);
  assert.ok(
    gateView(store.snapshot(), false).includes(
      "http://localhost:3002/dashboard",
    ),
  );
  const expired = createTrainerStore({
    client: {
      ...clientBase,
      saveProfile: async () => {
        throw Object.assign(new Error("MFA expired"), {
          code: "MFA_REQUIRED",
          status: 403,
        });
      },
    },
  });
  await expired.boot();
  await expired.mutate("profile", {});
  assert.equal(expired.snapshot().auth, "mfa");
  assert.equal(expired.snapshot().profile, null);
});
