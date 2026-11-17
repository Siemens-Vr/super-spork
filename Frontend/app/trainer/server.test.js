import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";

test("trainer portal serves owned assets, invitation and profile routes without source exposure", async () => {
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const server = spawn(process.execPath, ["server.mjs", "trainer"], {
    cwd: new URL("../../", import.meta.url),
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      NODE_ENV: "production",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  server.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Admin server startup timed out")),
        15000,
      );
      server.stdout.on("data", (chunk) => {
        if (chunk.toString().includes("VML NEXUS trainer:")) {
          clearTimeout(timer);
          resolve();
        }
      });
      server.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      server.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`Admin server exited ${code}: ${stderr}`));
      });
    });
    const base = `http://127.0.0.1:${port}`;
    const entry = await fetch(base);
    assert.equal(entry.status, 200);
    assert.ok((await entry.text()).includes("/dist/trainer/app.js"));
    for (const path of [
      "/dashboard",
      "/profile",
      "/qualifications",
      "/invitations/accept",
      "/dist/trainer/app.js",
      "/dist/trainer/app.css",
      "/styles/globals.css",
    ])
      assert.equal((await fetch(base + path)).status, 200, path);
    for (const path of [
      "/dist/admin/app.js",
      "/dist/app.js",
      "/app/trainer/store.js",
      "/package.json",
      "/api/v1/trainers/me",
      "/trainers",
    ])
      assert.equal((await fetch(base + path)).status, 404, path);
    const method = await fetch(base, { method: "POST" });
    assert.equal(method.status, 405);
  } finally {
    if (server.exitCode === null) {
      const stopped = once(server, "exit");
      server.kill("SIGTERM");
      await stopped;
    }
  }
});
