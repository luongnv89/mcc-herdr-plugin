// Tests for the Mistral Vibe row: the view helpers in herdr-app/mcc-usage/mistral.js
// (an ES module, loaded through a data: URL) and mistral-status.cjs, run against a
// fake vibe-app-server that checks the handshake as strictly as the real one.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile, spawn } = require("node:child_process");

const MOD = path.join(__dirname, "..", "herdr-app", "mcc-usage");
const HELPER = path.join(MOD, "mistral-status.cjs");
const mistral = () => import("data:text/javascript;base64," + fs.readFileSync(path.join(MOD, "mistral.js")).toString("base64"));
const { sanitize, findVibe } = require(HELPER);

const NOW = Date.parse("2026-11-17T19:00:00Z");
// Values the server sends that must never be printed. None of them is shaped like a key.
const SECRETS = ["PREVIEW-SENTINEL", "OFFER-SENTINEL", "RATE-SENTINEL", "SESSION-SENTINEL", "CUSTOMER-SENTINEL"];
const ACCOUNT = {
  status: "ready",
  plan: { kind: "chat", name: "INDIVIDUAL", title: "Pro", customerId: "CUSTOMER-SENTINEL" },
  planOffer: { title: "OFFER-SENTINEL" },
  rateLimitAction: "RATE-SENTINEL",
  apiKey: { preview: "PREVIEW-SENTINEL", source: "env" },
  budget: { usagePercentage: 0.62, resetAt: "2026-12-01T00:00:00Z", paygEnabled: false },
};

// ── mistral.js ──────────────────────────────────────────────────────────────

test("parseStatus keeps only the whitelisted fields, each of its type", async () => {
  const { parseStatus } = await mistral();
  const s = parseStatus(JSON.stringify({ found: true, ...ACCOUNT, sessionId: "SESSION-SENTINEL" }) + "\n");
  assert.deepEqual(s, {
    found: true, status: "ready", plan: { kind: "chat", name: "INDIVIDUAL", title: "Pro" },
    budget: { usagePercentage: 0.62, resetAt: "2026-12-01T00:00:00Z", paygEnabled: false }, error: null,
  });
  for (const secret of SECRETS) assert.doesNotMatch(JSON.stringify(s), new RegExp(secret));
  assert.deepEqual(parseStatus('{"found":false}'), { found: false });
  assert.equal(parseStatus("not json").error, "no answer from mistral-status");
  assert.equal(parseStatus("").status, null);
  assert.equal(parseStatus(JSON.stringify({ found: true, status: "weird" })).status, null);
  assert.equal(parseStatus(JSON.stringify({ found: true, status: "ready", budget: { usagePercentage: "x" } })).budget, null);
  assert.equal(parseStatus(JSON.stringify({ found: true, status: null, error: "a\x1b[31mb" })).error, "a [31mb", "control characters are cleaned");
});

test("failedStatus says when the helper is missing", async () => {
  const { failedStatus } = await mistral();
  assert.equal(failedStatus("Error: Cannot find module '/x/mistral-status.cjs'").error, "helper missing: reinstall the plugin");
  assert.equal(failedStatus("").error, "mistral-status failed");
  assert.equal(failedStatus(null).status, null);
});

test("the plan label is the title, else the name, else the kind", async () => {
  const { planLabel } = await mistral();
  assert.equal(planLabel({ kind: "chat", name: "INDIVIDUAL", title: "Pro" }), "Pro");
  assert.equal(planLabel({ kind: "chat", name: "INDIVIDUAL", title: null }), "Individual");
  assert.equal(planLabel({ kind: "mistral_code", name: null, title: null }), "Mistral Code");
  assert.equal(planLabel(null), null);
});

test("percents, thresholds and the reset countdown", async () => {
  const { pctText, mistralLevel, mistralView } = await mistral();
  assert.deepEqual([pctText(0.62), pctText(9.4), pctText(9.96), pctText(42.4), pctText(140)], ["0.6%", "9.4%", "10%", "42%", "140%"]);
  assert.deepEqual([mistralLevel(79), mistralLevel(80), mistralLevel(95)], ["ok", "warn", "high"]);
  const v = mistralView(sanitize(ACCOUNT), NOW);
  assert.equal(v.kind, "ok");
  assert.equal(v.name, "Mistral Pro");
  assert.equal(v.reset, "13d5h");
  assert.equal(v.text, "Mistral Pro: 0.6% · resets in 13d5h");
});

test("over the allowance says whether pay-as-you-go picks it up", async () => {
  const { mistralView } = await mistral();
  const over = (payg) => mistralView({ found: true, status: "ready", plan: null, budget: { usagePercentage: 140, resetAt: null, paygEnabled: payg } }, NOW);
  assert.equal(over(true).text, "Mistral: 140% pay-as-you-go");
  assert.equal(over(false).note, "over the limit");
  assert.equal(over(true).level, "high");
});

test("with no subscription to show, the row says why instead of failing", async () => {
  const { mistralView } = await mistral();
  const text = (s) => mistralView(s, NOW).text;
  assert.equal(text(null), "Mistral: loading…");
  assert.equal(text({ found: false }), "Mistral Vibe not found: install it or set VIBE_APP_SERVER_BIN");
  assert.equal(text({ found: true, status: "missing_key" }), "Mistral: not logged in · run vibe");
  assert.equal(text({ found: true, status: "unauthorized" }), "Mistral: login rejected · run vibe");
  assert.equal(text({ found: true, status: "unavailable" }), "Mistral: account unavailable");
  assert.equal(text({ found: true, status: null, error: "vibe-app-server timed out" }), "Mistral: vibe-app-server timed out");
  assert.equal(text({ ...sanitize(ACCOUNT), budget: null }), "Mistral Pro: usage unavailable");
  assert.equal(mistralView({ found: false }, NOW).kind, "none");
  assert.equal(mistralView({ found: true, status: null }, NOW).kind, "error");
});

test("the tooltip has the plan, the month's usage, the reset and pay-as-you-go", async () => {
  const { mistralTip } = await mistral();
  assert.equal(mistralTip(sanitize(ACCOUNT), NOW), "Mistral Pro (Mistral Vibe)\nThis month: 0.6% of the allowance\nResets in 13d5h\nPay-as-you-go: off");
  assert.equal(mistralTip({ found: false }, NOW), "Mistral Vibe not found: install it or set VIBE_APP_SERVER_BIN");
});

// ── mistral-status.cjs ──────────────────────────────────────────────────────

test("sanitize builds the whitelist and drops everything else", () => {
  const s = sanitize({ ...ACCOUNT, sessionId: "SESSION-SENTINEL" });
  assert.deepEqual(Object.keys(s).sort(), ["budget", "found", "plan", "status"]);
  assert.deepEqual(s.plan, { kind: "chat", name: "INDIVIDUAL", title: "Pro" });
  for (const secret of SECRETS) assert.doesNotMatch(JSON.stringify(s), new RegExp(secret));
  assert.equal(sanitize({ status: "nonsense" }).status, "unavailable");
  assert.equal(sanitize(null).plan, null);
  assert.equal(sanitize({ status: "ready", budget: { usagePercentage: null } }).budget, null);
});

test("findVibe: $VIBE_APP_SERVER_BIN, else PATH, else ~/.local/bin", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mistral-find-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(findVibe({ VIBE_APP_SERVER_BIN: "/x/vibe" }, dir), "/x/vibe");
  assert.equal(findVibe({ PATH: dir }, dir), null);
  fs.mkdirSync(path.join(dir, ".local", "bin"), { recursive: true });
  const bin = path.join(dir, ".local", "bin", "vibe-app-server");
  fs.writeFileSync(bin, "#!/bin/sh\n", { mode: 0o755 });
  assert.equal(findVibe({ PATH: "" }, dir), bin);
});

// A fake vibe-app-server, as strict as the real one: initialize first, then the
// `initialized` notification with params exactly {} (anything else: exit 1), and
// no request before it. FAKE_MODE picks what account/read gives; FAKE_LOG gets
// each method it was sent.
const FAKE = `#!/usr/bin/env node
"use strict";
const fs = require("fs");
const mode = process.env.FAKE_MODE || "ready";
const log = (m) => process.env.FAKE_LOG && fs.appendFileSync(process.env.FAKE_LOG, m + "\\n");
const ACCOUNT = ${JSON.stringify(ACCOUNT)};
let state = "new", buf = "";
const send = (o) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...o }) + "\\n");
const fail = (id, code, message) => send({ id, error: { code, message, data: { sessionId: "SESSION-SENTINEL" } } });
process.stdin.on("data", (d) => {
  buf += d;
  let n;
  while ((n = buf.indexOf("\\n")) >= 0) {
    const m = JSON.parse(buf.slice(0, n));
    buf = buf.slice(n + 1);
    log(m.method);
    if (m.method === "initialize") { state = "init"; send({ id: m.id, result: { serverInfo: { name: "vibe", version: "9" }, processId: 1 } }); continue; }
    if (m.method === "initialized") {
      if (state !== "init" || JSON.stringify(m.params) !== "{}") process.exit(1);
      state = "ready";
      continue;
    }
    if (state !== "ready") { fail(m.id, -32002, "not_initialized"); continue; }
    if (mode === "hang") continue;
    if (m.method === "session/start") {
      if (m.params?.kind !== "ephemeral" || typeof m.params?.agentConfig?.cwd !== "string") { fail(m.id, -32602, "bad params"); continue; }
      send({ id: m.id, result: { state: { session: { id: "SESSION-SENTINEL" } } } });
    } else if (m.method === "account/read") {
      if (m.params?.sessionId !== "SESSION-SENTINEL") { fail(m.id, -32602, "no session"); continue; }
      if (mode === "error") { fail(m.id, -32000, "boom for SESSION-SENTINEL"); continue; }
      const account = mode === "nobudget" ? { ...ACCOUNT, budget: null } : mode === "ready" ? ACCOUNT : { ...ACCOUNT, status: mode, plan: null, budget: null, apiKey: null };
      send({ id: m.id, result: { account } });
    } else if (m.method === "session/delete") send({ id: m.id, result: {} });
    else fail(m.id, -32601, "no such method");
  }
});
process.stdin.on("end", () => process.exit(0));
`;

// A tmp dir with the fake in it; HOME and PATH point there too, so the real
// vibe-app-server on this machine is never found.
function fakeServer(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mistral-fake-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bin = path.join(dir, "fake-vibe-app-server");
  fs.writeFileSync(bin, FAKE, { mode: 0o755 });
  fs.chmodSync(bin, 0o755);
  const log = path.join(dir, "methods.log");
  const empty = path.join(dir, "empty");
  fs.mkdirSync(empty);
  // The fake's shebang needs `node` on PATH: only Node's own folder, never ~/.local/bin's vibe.
  const nodeDir = path.join(dir, "node-bin");
  fs.mkdirSync(nodeDir);
  fs.symlinkSync(process.execPath, path.join(nodeDir, "node"));
  const env = { HOME: dir, PATH: nodeDir, VIBE_APP_SERVER_BIN: bin, FAKE_LOG: log };
  return { dir, bin, env, empty, methods: () => (fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n") : []) };
}

// Run the helper as the panel and the app do; resolves with its exit code and stdout.
function helper(env) {
  return new Promise((resolve) => {
    execFile(process.execPath, [HELPER], { env, encoding: "utf8", timeout: 30000 }, (error, stdout, stderr) =>
      resolve({ code: error ? error.code : 0, stdout, stderr, out: JSON.parse(stdout.trim()) }));
  });
}

const assertNoSecrets = (stdout) => { for (const secret of SECRETS) assert.doesNotMatch(stdout, new RegExp(secret), `${secret} leaked`); };

test("the fake server exits 1 when `initialized` doesn't carry params {}", async (t) => {
  const { bin, env } = fakeServer(t);
  for (const params of [null, undefined, { x: 1 }]) {
    const code = await new Promise((resolve) => {
      const p = spawn(bin, [], { env, stdio: ["pipe", "ignore", "ignore"] });
      p.on("exit", resolve);
      p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) + "\n");
      p.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "initialized", params }) + "\n");
    });
    assert.equal(code, 1, `params ${JSON.stringify(params)}`);
  }
});

test("helper: a ready account gives the plan and the month's usage, and nothing else", async (t) => {
  const f = fakeServer(t);
  const r = await helper({ ...f.env, FAKE_MODE: "ready" });
  assert.equal(r.code, 0);
  assert.deepEqual(r.out, { found: true, status: "ready", plan: { kind: "chat", name: "INDIVIDUAL", title: "Pro" }, budget: { usagePercentage: 0.62, resetAt: "2026-12-01T00:00:00Z", paygEnabled: false } });
  assertNoSecrets(r.stdout);
  assert.deepEqual(f.methods(), ["initialize", "initialized", "session/start", "account/read", "session/delete"]);
});

test("helper: no budget gives the plan with no usage", async (t) => {
  const f = fakeServer(t);
  const r = await helper({ ...f.env, FAKE_MODE: "nobudget" });
  assert.equal(r.out.status, "ready");
  assert.equal(r.out.plan.title, "Pro");
  assert.equal(r.out.budget, null);
  assertNoSecrets(r.stdout);
});

test("helper: not logged in, or the login rejected", async (t) => {
  const f = fakeServer(t);
  for (const mode of ["missing_key", "unauthorized"]) {
    const r = await helper({ ...f.env, FAKE_MODE: mode });
    assert.equal(r.code, 0);
    assert.deepEqual(r.out, { found: true, status: mode, plan: null, budget: null });
    assertNoSecrets(r.stdout);
  }
});

test("helper: no vibe-app-server anywhere prints found: false", async (t) => {
  const f = fakeServer(t);
  const { VIBE_APP_SERVER_BIN, ...env } = f.env;
  const r = await helper({ ...env, PATH: f.empty });
  assert.equal(r.code, 0);
  assert.deepEqual(r.out, { found: false });
});

test("helper: a server that hangs is killed at the timeout", async (t) => {
  const f = fakeServer(t);
  const started = Date.now();
  const r = await helper({ ...f.env, FAKE_MODE: "hang", MISTRAL_STATUS_TIMEOUT_MS: "500" });
  assert.equal(r.code, 0);
  assert.deepEqual(r.out, { found: true, status: null, error: "vibe-app-server timed out" });
  assert.ok(Date.now() - started < 10000, "it doesn't wait for the default timeout");
});

test("helper: an error answer names the step only, and the session is still deleted", async (t) => {
  const f = fakeServer(t);
  const r = await helper({ ...f.env, FAKE_MODE: "error" });
  assert.equal(r.code, 0);
  assert.deepEqual(r.out, { found: true, status: null, error: "account/read failed (-32000)" });
  assertNoSecrets(r.stdout);
  assert.equal(f.methods().at(-1), "session/delete");
});

test("helper: a server that can't start or exits early is an error, not a crash", async (t) => {
  const f = fakeServer(t);
  let r = await helper({ ...f.env, VIBE_APP_SERVER_BIN: path.join(f.dir, "no-such-server") });
  assert.equal(r.code, 0);
  assert.equal(r.out.status, null);
  assert.match(r.out.error, /can't run vibe-app-server/);
  const quitter = path.join(f.dir, "quitter");
  fs.writeFileSync(quitter, "#!/bin/sh\nexit 3\n", { mode: 0o755 });
  r = await helper({ ...f.env, VIBE_APP_SERVER_BIN: quitter });
  assert.equal(r.code, 0);
  assert.match(r.out.error, /vibe-app-server exited \(3\)/);
});
