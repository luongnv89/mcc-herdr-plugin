// Tests for the Herdr desktop app's mcc usage section: the pure helpers in
// herdr-app/mcc-usage/usage.js and system.js (ES modules, loaded through a data:
// URL) and the layout edits herdr-app/install.js makes.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { main, addBlock, removeBlock, pathTo, agentsId, isShipped } = require("../herdr-app/install.js");

const MOD = path.join(__dirname, "..", "herdr-app", "mcc-usage");
const load = (file) => import("data:text/javascript;base64," + fs.readFileSync(path.join(MOD, file)).toString("base64"));
const usage = () => load("usage.js");
const system = () => load("system.js");
const F = require("./system-fixtures.js");

const doc = (profiles) => JSON.stringify({ schema: 2, profiles });
const profile = (name, usage, extra = {}) => ({ name, is_default: name === "default", usage, login_warning: false, login_expires_at: null, ...extra });
const ok = (five, week, updated = "2026-11-05T21:45:15Z") => ({ status: "ok", reason: null, five_hour: { percent: five, resets_at: "2026-11-05T23:00:00Z" }, weekly: { percent: week, resets_at: "2026-11-09T14:00:00Z" }, source: "cache", updated_at: updated });
const NOW = Date.parse("2026-11-05T22:00:00Z");

test("parse reads mcc's schema 2 and rejects anything else", async () => {
  const { parse } = await usage();
  const rows = parse(doc([profile("default", ok(41, 24)), profile("bad name", { status: "error", reason: "token_expired" })]));
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0].five, { percent: 41, resetsAt: "2026-11-05T23:00:00Z" });
  assert.equal(rows[0].isDefault, true);
  assert.equal(rows[1].name, "bad name");
  assert.equal(rows[1].five, null);
  assert.throws(() => parse(JSON.stringify({ schema: 1, profiles: [] })), /update mcc/);
});

test("times, flags and staleness", async () => {
  const { until, ago, flag, level, isStale } = await usage();
  assert.equal(until("2026-11-05T22:42:00Z", NOW), "42m");
  assert.equal(until("2026-11-06T01:05:00Z", NOW), "3h05");
  assert.equal(until("2026-11-09T01:00:00Z", NOW), "3d3h");
  assert.equal(until("2026-11-05T21:00:00Z", NOW), "now");
  assert.equal(ago("2026-11-05T21:56:00Z", NOW), "4m ago");
  assert.deepEqual([flag(79), flag(80), flag(95)], ["", "!", "!!"]);
  assert.deepEqual([level(10), level(85), level(99)], ["ok", "warn", "high"]);
  assert.equal(isStale({ updatedAt: "2026-11-05T21:30:00Z" }, NOW), false);
  assert.equal(isStale({ updatedAt: "2026-11-05T20:30:00Z" }, NOW), true);
});

test("notices say why an account can't be read and what to run", async () => {
  const { parse, notices } = await usage();
  const rows = parse(doc([
    profile("default", ok(1, 2)),
    profile("cs", { status: "error", reason: "token_expired" }),
    profile("soon", ok(1, 2), { login_warning: true, login_expires_at: "2026-11-06T01:00:00Z" }),
    profile("live", ok(1, 2)),
  ]));
  const lines = notices(rows, { live: "rate_limited" }, NOW).map((n) => n.text);
  assert.deepEqual(lines, [
    "cs: login expired · mcc login cs",
    "soon: login ends in 3h00 · mcc login soon",
    "live: rate limited",
  ]);
});

test("hasProblem flags failed refreshes, unreadable accounts and ending logins", async () => {
  const { parse, hasProblem } = await usage();
  const [fine, bad, soon, live] = parse(doc([
    profile("default", ok(1, 2)),
    profile("cs", { status: "error", reason: "token_expired" }),
    profile("soon", ok(1, 2), { login_warning: true }),
    profile("live", ok(1, 2)),
  ]));
  assert.equal(hasProblem(fine, undefined), false);
  assert.equal(hasProblem(bad, undefined), true);
  assert.equal(hasProblem(soon, undefined), true);
  assert.equal(hasProblem(live, "rate_limited"), true);
});

test("details and the updated label", async () => {
  const { parse, details, updatedLabel } = await usage();
  const [p] = parse(doc([profile("default", ok(96, 24))]));
  assert.equal(details(p, null, NOW), "default (default)\n5 hours: 96%!!, resets in 1h00\nWeek: 24%, resets in 3d16h\nUpdated 14m ago");
  assert.equal(updatedLabel([p], null, NOW), "updated 14m ago");
  assert.equal(updatedLabel([p], NOW - 5000, NOW), "updated just now");
  assert.equal(updatedLabel([], null, NOW), "");
});

test("block height: the header alone when hidden, else every line", async () => {
  const { blockHeight, SIZES } = await usage();
  assert.equal(blockHeight({ hidden: true, rows: 6, notices: 2 }), SIZES.header);
  assert.equal(blockHeight({ hidden: false, rows: 6, notices: 0 }), SIZES.header + SIZES.labels + 6 * SIZES.row + SIZES.bottom);
  assert.equal(blockHeight({ hidden: false, rows: 0, notices: 1 }), SIZES.header + SIZES.labels + SIZES.row + SIZES.notice + SIZES.bottom);
});

test("block height with the stats line: one more line when the values show, none when hidden", async () => {
  const { blockHeight, SIZES } = await usage();
  assert.equal(blockHeight({ hidden: false, rows: 2, notices: 1, stats: true }), SIZES.header + SIZES.stats + SIZES.labels + 2 * SIZES.row + SIZES.notice + SIZES.bottom);
  assert.equal(blockHeight({ hidden: true, rows: 2, notices: 1, stats: true }), SIZES.header);
  const button = 2 * SIZES.railPad + SIZES.row;
  assert.equal(blockHeight({ rail: true, hidden: false, rows: 2, stats: true }), button + 2 * SIZES.row + 3 * SIZES.railStat);
  assert.equal(blockHeight({ rail: true, hidden: true, rows: 2, stats: true }), button);
});

test("block height on the rail: the eye button, then one line per account, no header or notices", async () => {
  const { blockHeight, SIZES } = await usage();
  const button = 2 * SIZES.railPad + SIZES.row;
  assert.equal(blockHeight({ rail: true, hidden: true, rows: 6, notices: 2 }), button);
  assert.equal(blockHeight({ rail: true, hidden: false, rows: 3, notices: 2 }), button + 3 * SIZES.row);
  assert.equal(blockHeight({ rail: true, hidden: false, rows: 0 }), button);
});

test("staleAge says how old stale numbers are, and nothing for fresh ones", async () => {
  const { staleAge } = await usage();
  assert.equal(staleAge({ updatedAt: "2026-11-05T21:30:00Z" }, NOW), "");
  assert.equal(staleAge({ updatedAt: null }, NOW), "");
  assert.equal(staleAge({ updatedAt: "2026-11-05T18:50:00Z" }, NOW), "3h");
  assert.equal(staleAge({ updatedAt: "2026-11-03T21:00:00Z" }, NOW), "2d");
});

// main.js runs only inside the app, so check here that every name it imports from
// its sibling modules is one they export: a typo would otherwise ship.
test("every name main.js imports from system.js and usage.js exists", async () => {
  const src = fs.readFileSync(path.join(MOD, "main.js"), "utf8");
  const modules = { "system.js": await system(), "usage.js": await usage() };
  const seen = new Set();
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*"\.\/(system|usage)\.js"/g)) {
    const file = `${m[2]}.js`;
    seen.add(file);
    for (const spec of m[1].split(",").map((x) => x.trim()).filter(Boolean)) {
      const name = spec.split(/\s+as\s+/)[0];
      assert.ok(name in modules[file], `main.js imports ${name} from ./${file}, which doesn't export it`);
    }
  }
  assert.deepEqual([...seen].sort(), ["system.js", "usage.js"]);
});

test("CPU: /proc/stat samples and iostat", async () => {
  const { parseProcStat, cpuPercent, parseIostat } = await system();
  const a = parseProcStat(F.PROC_STAT_1), b = parseProcStat(F.PROC_STAT_2);
  assert.deepEqual(a, { total: 1000, idle: 850 });
  assert.equal(Math.round(cpuPercent(a, b) * 10) / 10, 16.7);
  assert.equal(cpuPercent(null, b), null);
  assert.equal(cpuPercent(b, b), null, "no time passed");
  assert.equal(parseIostat(F.IOSTAT), 31, "the last line, not the since-boot one");
  for (const bad of [F.EMPTY, F.GARBAGE, null]) {
    assert.equal(parseProcStat(bad), null);
    assert.equal(parseIostat(bad), null);
  }
});

test("memory: /proc/meminfo and vm_stat", async () => {
  const { parseMeminfo, parseVmStat, memPercent } = await system();
  assert.deepEqual(parseMeminfo(F.MEMINFO), { used: (16384000 - 8192000) * 1024, total: 16384000 * 1024 });
  // Anonymous - purgeable + wired + compressor, in 16 KB pages.
  const mac = parseVmStat(F.VM_STAT, F.MEMSIZE);
  assert.deepEqual(mac, { used: (764905 - 8234 + 203523 + 716032) * 16384, total: F.MEMSIZE });
  assert.equal(Math.round(memPercent(mac)), 80);
  assert.equal(parseVmStat(F.VM_STAT, NaN), null, "no total");
  assert.equal(parseVmStat(F.VM_STAT.replace(/^Anonymous pages.*$/m, ""), F.MEMSIZE), null, "a field missing");
  for (const bad of [F.EMPTY, F.GARBAGE, null]) {
    assert.equal(parseMeminfo(bad), null);
    assert.equal(parseVmStat(bad, F.MEMSIZE), null);
  }
});

test("network: physical interfaces only, from /proc/net/dev and netstat", async () => {
  const { parseNetDev, netDevNames, parseNetstat } = await system();
  assert.deepEqual(parseNetDev(F.NET_DEV), { rx: 5200, tx: 3100 }, "eth0 + wlan0");
  // What Linux says about an interface beats the name list.
  assert.deepEqual(parseNetDev(F.NET_DEV, (n) => (n === "eth0" ? true : n === "wg0" ? false : undefined)), { rx: 900, tx: 700 });
  assert.deepEqual(netDevNames(F.NET_DEV), ["lo", "eth0", "wg0", "tailscale0", "docker0", "lxdbr0", "podman0", "wlan0"]);
  assert.deepEqual(parseNetstat(F.NETSTAT), { rx: 1300, tx: 700 }, "en0 + en1");
  for (const bad of [F.EMPTY, F.GARBAGE, null]) {
    assert.equal(parseNetDev(bad), null);
    assert.equal(parseNetstat(bad), null);
  }
});

test("rate: bytes per second over the time measured, never negative", async () => {
  const { rate, step } = await system();
  assert.deepEqual(rate({ rx: 1000, tx: 500, at: 0 }, { rx: 3000, tx: 500, at: 2000 }), { rx: 1000, tx: 0 });
  assert.deepEqual(rate({ rx: 3000, tx: 500, at: 0 }, { rx: 1000, tx: 900, at: 1000 }), { rx: 0, tx: 400 }, "a counter reset");
  assert.equal(rate(null, { rx: 1, tx: 1, at: 1 }), null);
  assert.equal(rate({ rx: 1, tx: 1, at: 5 }, { rx: 2, tx: 2, at: 5 }), null);
  // The first sample only sets the base; a failed one shows null and drops it.
  const first = step(null, { rx: 0, tx: 0, at: 0 }, rate);
  assert.equal(first.value, undefined);
  assert.deepEqual(step(first.base, { rx: 2048, tx: 0, at: 2000 }, rate).value, { rx: 1024, tx: 0 });
  assert.deepEqual(step(first.base, null, rate), { value: null, base: null });
});

test("formats: sizes, rates and used of total", async () => {
  const { formatBytes, formatRate, shortBytes, formatPair } = await system();
  assert.deepEqual([0, 512, 40 * 1024, 1.2 * 1024 ** 2, 28 * 1024 ** 3].map(formatBytes), ["0 B", "512 B", "40 KB", "1.2 MB", "28.0 GB"]);
  assert.equal(formatRate(1.2 * 1024 ** 2), "1.2 MB/s");
  assert.equal(formatRate(NaN), "—");
  assert.deepEqual([40 * 1024, 1.2 * 1024 ** 2].map(shortBytes), ["40K", "1.2M"]);
  assert.equal(formatPair(28 * 1024 ** 3, 32 * 1024 ** 3), "28.0/32.0 GB");
  assert.equal(formatPair(1, 0), "—");
});

test("a source that fails reads as unavailable; the others still show", async () => {
  const { readout, label, statsTip, parseNetstat } = await system();
  const ok = { code: 0, stdout: F.NETSTAT };
  assert.deepEqual(readout(ok, parseNetstat), { rx: 1300, tx: 700 });
  assert.equal(readout(null, parseNetstat), null, "it couldn't start");
  assert.equal(readout({ ...ok, code: 1 }, parseNetstat), null, "non-zero exit");
  assert.equal(readout({ ...ok, code: null }, parseNetstat), null, "killed");
  assert.equal(readout({ ...ok, error: new Error("timed out") }, parseNetstat), null, "timed out");
  assert.equal(readout({ code: 0, stdout: "" }, parseNetstat), null, "no output");
  assert.equal(readout({ code: 0, stdout: F.GARBAGE }, parseNetstat), null, "nothing it can read");
  assert.equal(readout(ok, () => { throw new Error("bad"); }), null);
  assert.deepEqual([label(undefined, String), label(null, String), label(5, (v) => `${v}%`)], ["—", "unavailable", "5%"]);
  const tip = statsTip({ cpu: 12.4, mem: null, net: undefined });
  assert.match(tip, /^CPU: 12% busy$/m);
  assert.match(tip, /^Memory: unavailable$/m);
  assert.match(tip, /^Network: —$/m);
});

// The shape of Herdr's main layout (and clones of it): spaces and agents share
// sidebar-lists, between the brand bar and the footer.
const mainLike = () => ({
  id: "root", type: "row", children: [
    { id: "sidebar", type: "column", children: [
      { id: "brand", type: "block", content: { mod: "workspace-chrome" } },
      { id: "sidebar-lists", type: "column", children: [
        { id: "spaces", type: "block", content: { mod: "my-spaces" }, size: { weight: 1 } },
        { id: "agents", type: "block", content: { mod: "my-agents" }, size: { weight: 1 } } ] },
      { id: "sidebar-footer", type: "block", content: { mod: "workspace-chrome", props: { footer: true } } } ] },
    { id: "work", type: "column", children: [] } ] });

test("addBlock puts the section under the agents list, before the sidebar footer", () => {
  const root = mainLike();
  const { layout, changed, where } = addBlock(root);
  assert.equal(changed, true);
  assert.match(where, /sidebar-lists/);
  assert.deepEqual(pathTo(layout, "sidebar").at(-1).children.map((c) => c.id), ["brand", "sidebar-lists", "mcc-usage", "sidebar-footer"]);
  assert.equal(pathTo(root, "mcc-usage"), null, "the input is left alone");
  assert.equal(addBlock(layout).changed, false, "a second run changes nothing");
});

test("addBlock without a sidebar column goes right after the agents block", () => {
  const root = { id: "root", type: "row", children: [
    { id: "left", type: "column", children: [{ id: "a", type: "block", content: { mod: "agents" } }, { id: "x", type: "block", content: { mod: "x" } }] }] };
  assert.equal(agentsId(root), "a");
  const { layout } = addBlock(root);
  assert.deepEqual(layout.children[0].children.map((c) => c.id), ["a", "mcc-usage", "x"]);
  assert.throws(() => addBlock({ id: "root", type: "row", children: [{ id: "agents", type: "block" }] }), /isn't in a column/);
  assert.throws(() => addBlock({ id: "root", type: "row", children: [] }), /no agents list/);
});

test("removeBlock takes the section out again", () => {
  const { layout } = addBlock(mainLike());
  const back = removeBlock(layout);
  assert.equal(back.changed, true);
  assert.deepEqual(back.layout, mainLike());
  assert.equal(removeBlock(mainLike()).changed, false);
});

// A throwaway HERDR_APP_HOME: never the real ~/.config/herdr-app. "mine" is the
// layout shown, "other" another of yours, "main" one of Herdr's own.
function appHomeFixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "mcc-herdr-app-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  fs.mkdirSync(path.join(home, "layouts"));
  for (const name of ["mine", "other", "main"]) fs.writeFileSync(path.join(home, "layouts", `${name}.json`), JSON.stringify(mainLike()));
  fs.writeFileSync(path.join(home, "shared.json"), JSON.stringify({ layout: "mine" }));
  fs.writeFileSync(path.join(home, "installed.json"), JSON.stringify({ "layout:main": "1", "layout:fancy": "1" }));
  t.mock.method(console, "log", () => {});
  const env = { HERDR_APP_HOME: home, HERDR_APP_BIN: path.join(home, "no-such-herdr-app") };
  const layout = (name) => JSON.parse(fs.readFileSync(path.join(home, "layouts", `${name}.json`), "utf8"));
  return { home, env, layout, mod: path.join(home, "mods", "mcc-usage") };
}

test("isShipped: Herdr's own layouts, by installed.json or by name", (t) => {
  const { home } = appHomeFixture(t);
  assert.equal(isShipped(home, "fancy"), true);
  assert.equal(isShipped(home, "main"), true);
  assert.equal(isShipped(home, "win98"), true, "known even without installed.json listing it");
  assert.equal(isShipped(home, "mine"), false);
});

test("main installs into the shown layout: copies the mod, backs the layout up, adds the block", (t) => {
  const { home, env, layout, mod } = appHomeFixture(t);
  main([], env);
  for (const f of ["main.js", "usage.js", "system.js", "mod.json"]) assert.ok(fs.existsSync(path.join(mod, f)), f);
  assert.ok(!fs.existsSync(path.join(mod, "jsconfig.json")), "files the app writes aren't copied");
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home, "layouts", "mine.json.bak-mcc-usage"), "utf8")), mainLike());
  assert.ok(pathTo(layout("mine"), "mcc-usage"));
  assert.equal(pathTo(layout("other"), "mcc-usage"), null, "only the shown layout");
});

test("main refuses one of Herdr's own layouts before writing anything", (t) => {
  const { home, env, layout, mod } = appHomeFixture(t);
  assert.throws(() => main(["--layout", "main"], env), /one of Herdr's own layouts/);
  assert.ok(!fs.existsSync(mod));
  assert.ok(!fs.existsSync(path.join(home, "layouts", "main.json.bak-mcc-usage")));
  assert.deepEqual(layout("main"), mainLike());
});

test("main --uninstall takes the block out of every layout of yours, then the mod", (t) => {
  const { home, env, layout, mod } = appHomeFixture(t);
  main([], env);
  main(["--layout", "other"], env);
  assert.ok(pathTo(layout("other"), "mcc-usage"));
  main(["--uninstall"], env);
  assert.deepEqual(layout("mine"), mainLike());
  assert.deepEqual(layout("other"), mainLike());
  assert.deepEqual(layout("main"), mainLike());
  assert.ok(pathTo(JSON.parse(fs.readFileSync(path.join(home, "layouts", "other.json.bak-mcc-usage"), "utf8")), "mcc-usage"), "backed up before the edit");
  assert.ok(!fs.existsSync(mod));
});
