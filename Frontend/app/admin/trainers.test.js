import test from "node:test";
import assert from "node:assert/strict";
import { createAdminStore } from "./store.js";
import { pageView, shell } from "./views.js";
import { createAdminApi } from "./api.js";
const user = {
  id: "admin",
  legalName: "Example Admin",
  email: "admin@example.test",
  emailVerifiedAt: "2026-01-01",
  roles: ["ADMIN"],
  permissions: ["trainers.manage"],
};
const envelope = { data: [], meta: { page: 1, limit: 20, total: 0 } };
const base = {
  me: async () => user,
  trainers: async () => envelope,
  trainerInvitations: async () => envelope,
  clear() {},
};
test("trainer-only admins enter after a real protected permission/MFA probe", async () => {
  let calls = 0;
  const store = createAdminStore({
    client: {
      ...base,
      trainers: async () => {
        calls++;
        return envelope;
      },
    },
  });
  await store.boot();
  assert.equal(store.snapshot().auth, "ready");
  assert.equal(calls, 1);
  const gated = createAdminStore({
    client: {
      ...base,
      trainers: async () => {
        throw Object.assign(new Error("MFA required"), {
          status: 403,
          code: "MFA_REQUIRED",
        });
      },
    },
  });
  await gated.boot();
  assert.equal(gated.snapshot().auth, "mfa");
});
test("trainer invitation and review writes carry only the supported server fields", async () => {
  let invited, reviewed, revoked;
  const store = createAdminStore({
    client: {
      ...base,
      inviteTrainer: async (email) => {
        invited = email;
      },
      revokeTrainerInvitation: async (id) => {
        revoked = id;
      },
      reviewTrainer: async (id, body) => {
        reviewed = { id, body };
      },
    },
  });
  await store.boot();
  assert.equal(
    await store.mutate("invite-trainer", "", {
      email: " TRAINER@EXAMPLE.TEST ",
      role: "ADMIN",
    }),
    true,
  );
  assert.equal(invited, "trainer@example.test");
  assert.equal(
    await store.mutate("revoke-trainer-invitation", "invite-id", {}),
    true,
  );
  assert.equal(revoked, "invite-id");
  assert.equal(
    await store.mutate("review-trainer", "trainer-user", {
      version: "3",
      outcome: "APPROVED",
      reason: " Independently reviewed qualifications ",
      evidenceReference: " Official reference 42 ",
    }),
    true,
  );
  assert.deepEqual(reviewed, {
    id: "trainer-user",
    body: {
      version: 3,
      outcome: "APPROVED",
      reason: "Independently reviewed qualifications",
      evidenceReference: "Official reference 42",
    },
  });
});
test("approval needs independent evidence and unknown writes require refresh", async () => {
  let calls = 0;
  const store = createAdminStore({
    client: {
      ...base,
      reviewTrainer: async () => {
        calls++;
      },
    },
  });
  await store.boot();
  assert.equal(
    await store.mutate("review-trainer", "trainer", {
      version: "1",
      outcome: "APPROVED",
      reason: "Reviewed qualifications",
    }),
    false,
  );
  assert.equal(calls, 0);
  const failed = createAdminStore({
    client: {
      ...base,
      inviteTrainer: async () => {
        throw Object.assign(new Error("Disconnected"), {
          code: "NETWORK_ERROR",
        });
      },
    },
  });
  await failed.boot();
  assert.equal(
    await failed.mutate("invite-trainer", "", {
      email: "trainer@example.test",
    }),
    false,
  );
  assert.equal(failed.snapshot().mutationUncertain, true);
});
test("trainer navigation, invitation list and decisions render escaped backend records", () => {
  const state = {
    user,
    data: envelope,
    error: "",
    notice: "",
    fieldErrors: {},
    loading: false,
  };
  assert.ok(shell(state, "trainers", "").includes("Trainer invitations"));
  assert.ok(
    pageView(state, "trainers", {}, () => true).includes(
      "No trainer profiles match",
    ),
  );
  const invitations = pageView(
    {
      ...state,
      data: {
        ...envelope,
        data: [
          {
            id: "id",
            email: "<script>private</script>",
            status: "PENDING",
            expiresAt: "2099-01-01",
          },
        ],
      },
    },
    "trainer-invitations",
    {},
    () => true,
  );
  assert.ok(invitations.includes("&lt;script&gt;"));
  assert.ok(!invitations.includes("<script>"));
  const detail = {
    user: { legalName: "Trainer", email: "trainer@example.test" },
    userId: "trainer",
    headline: "PLC educator",
    biography: "Practical engineering educator",
    region: "Nyeri",
    country: "KE",
    yearsExperience: 4,
    expertise: ["PLC"],
    status: "SUBMITTED",
    version: 7,
    qualifications: [],
    reviews: [],
  };
  const html = pageView({ ...state, data: detail }, "trainer", {}, () => true);
  assert.ok(html.includes('value="7"'));
  assert.ok(html.includes("Independent verification reference"));
  assert.ok(html.includes("Record trainer decision"));
  assert.ok(
    !pageView(
      { ...state, data: { ...detail, status: "DRAFT" } },
      "trainer",
      {},
      () => true,
    ).includes('data-admin-form="review-trainer"'),
  );
});
test("trainer admin API encodes IDs and preserves protected CSRF contracts", async () => {
  const calls = [];
  const client = createAdminApi({
    base: "/api/v1",
    fetcher: async (url, options) => {
      calls.push([url, options]);
      return new Response(
        JSON.stringify({
          data: url.endsWith("/csrf") ? { csrfToken: "csrf" } : {},
        }),
      );
    },
  });
  await client.reviewTrainer("trainer/user", {
    version: 2,
    outcome: "CHANGES_REQUESTED",
    reason: "Add more professional details",
  });
  assert.equal(calls[1][0], "/api/v1/admin/trainers/trainer%2Fuser/reviews");
  assert.equal(calls[1][1].headers["X-CSRF-Token"], "csrf");
});
