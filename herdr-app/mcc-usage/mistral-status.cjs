#!/usr/bin/env node
// The Mistral Vibe subscription's status, as one line of JSON on stdout. It asks
// Mistral Vibe's own app server (`vibe-app-server`, JSON-RPC over stdio) the way
// Vibe does: initialize, initialized, an ephemeral session, account/read, then
// deletes the session. Both the terminal panel and the app mod run it.
//
// It prints only { found, status, plan: { kind, name, title }, budget:
// { usagePercentage, resetAt, paygEnabled }, error }: never the API key, offers,
// ids or anything else the server sends. It always exits 0.
"use strict";
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const VERSION = "0.2.0";
// The whole exchange takes about 2 s; the app gives its programs 25 s.
const TIMEOUT = 20000;
const STATUSES = new Set(["ready", "missing_key", "unauthorized", "unavailable"]);
const KINDS = new Set(["api", "chat", "mistral_code"]);

const clean = (text) => String(text ?? "").replace(/[\x00-\x1f\x7f-\x9f\u200b-\u200f\u2028\u2029\ufeff]+/g, " ").trim();
// A short server-given string, or null.
const short = (v) => (typeof v === "string" && clean(v) ? clean(v).slice(0, 40) : null);

// vibe-app-server: $VIBE_APP_SERVER_BIN, else PATH, else where Vibe's uv install puts it.
function findVibe(env = process.env, home = os.homedir()) {
  if (env.VIBE_APP_SERVER_BIN) return env.VIBE_APP_SERVER_BIN;
  const dirs = [...(env.PATH || "").split(path.delimiter), path.join(home, ".local", "bin")];
  for (const dir of dirs) {
    if (!dir) continue;
    const file = path.join(dir, "vibe-app-server");
    try { fs.accessSync(file, fs.constants.X_OK); if (fs.statSync(file).isFile()) return file; } catch {}
  }
  return null;
}

// account/read's `account` → only the fields we show, each built and type-checked.
function sanitize(account) {
  const a = account && typeof account === "object" ? account : {};
  const p = a.plan && typeof a.plan === "object" ? a.plan : null;
  const b = a.budget && typeof a.budget === "object" ? a.budget : null;
  const pct = typeof b?.usagePercentage === "number" ? b.usagePercentage : NaN;
  return {
    found: true,
    status: STATUSES.has(a.status) ? a.status : "unavailable",
    plan: p ? { kind: KINDS.has(p.kind) ? p.kind : null, name: short(p.name), title: short(p.title) } : null,
    budget: b && Number.isFinite(pct) ? { usagePercentage: pct, resetAt: short(b.resetAt), paygEnabled: b.paygEnabled === true } : null,
  };
}

// Run the handshake against `bin`. Resolves with sanitize()'s object, or
// { found: true, status: null, error } — never rejects.
function status(bin, { timeout = TIMEOUT, cwd = os.tmpdir() } = {}) {
  return new Promise((resolve) => {
    let child, done = false, buf = "", id = 0;
    const waiters = new Map();
    const finish = (out) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      for (const w of waiters.values()) w.reject(new Error("aborted"));
      try { child?.stdin.end(); } catch {}
      // Give it a moment to exit on its own (it deletes nothing late), then make sure.
      setTimeout(() => { try { child?.kill("SIGKILL"); } catch {} }, 1000).unref();
      resolve(out);
    };
    const fail = (error) => finish({ found: true, status: null, error: clean(error).slice(0, 80) });
    const timer = setTimeout(() => { try { child?.kill("SIGKILL"); } catch {} fail("vibe-app-server timed out"); }, timeout);

    try { child = spawn(bin, [], { cwd, stdio: ["pipe", "pipe", "ignore"] }); } catch (e) { return fail(`can't run vibe-app-server (${e.code ?? "error"})`); }
    child.on("error", (e) => fail(`can't run vibe-app-server (${e.code ?? "error"})`));
    child.on("exit", (code, sig) => fail(`vibe-app-server exited (${sig ?? code})`));
    child.stdin.on("error", () => {});
    child.stdout.on("data", (d) => {
      buf += d;
      let n;
      while ((n = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, n);
        buf = buf.slice(n + 1);
        let m;
        try { m = JSON.parse(line); } catch { continue; }
        const w = m && waiters.get(m.id);
        if (!w) continue;
        waiters.delete(m.id);
        // Only the step and the code: a server message may name a session or a key.
        if (m.error) w.reject(new Error(`${w.method} failed (${Number.isInteger(m.error.code) ? m.error.code : "error"})`));
        else w.resolve(m.result);
      }
    });
    const send = (msg) => { try { child.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...msg }) + "\n"); } catch {} };
    const request = (method, params) => new Promise((res, rej) => {
      const i = ++id;
      waiters.set(i, { method, resolve: res, reject: rej });
      send({ id: i, method, params });
    });

    (async () => {
      await request("initialize", { clientInfo: { name: "mcc-herdr-plugin", version: VERSION } });
      // `params` must be exactly {}: without it the server exits.
      send({ method: "initialized", params: {} });
      const started = await request("session/start", { kind: "ephemeral", agentConfig: { cwd } });
      const sessionId = started?.state?.session?.id;
      if (typeof sessionId !== "string") throw new Error("session/start gave no session");
      try {
        const r = await request("account/read", { sessionId });
        return sanitize(r?.account);
      } finally {
        await request("session/delete", { sessionId }).catch(() => {});
      }
    })().then(finish, (e) => fail(e.message));
  });
}

// Print one line and exit 0 once it's written, whatever happened.
async function main(env = process.env) {
  let out;
  try {
    const bin = findVibe(env);
    const timeout = Number(env.MISTRAL_STATUS_TIMEOUT_MS) > 0 ? Number(env.MISTRAL_STATUS_TIMEOUT_MS) : TIMEOUT;
    out = bin ? await status(bin, { timeout }) : { found: false };
  } catch { out = { found: true, status: null, error: "mistral-status failed" }; }
  process.stdout.write(JSON.stringify(out) + "\n", () => process.exit(0));
}

if (require.main === module) main();
else module.exports = { findVibe, sanitize, status, TIMEOUT };
