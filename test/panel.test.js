"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const p = require("../panel.js");
const F = require("./system-fixtures.js");
const { bottomLeft } = require("../toggle.js");

const strip = (s) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
const NOW = Date.parse("2026-11-03T22:00:00Z");

const DOC = JSON.stringify({
  schema: 2,
  profiles: [
    { name: "default", is_default: true, usage: { status: "ok", five_hour: { percent: 12, resets_at: "2026-11-04T01:40:00Z" }, weekly: { percent: 81, resets_at: "2026-11-09T14:00:00Z" }, source: "cache", updated_at: "2026-11-03T21:34:36Z" }, login_warning: false },
    { name: "work", is_default: false, usage: { status: "ok", five_hour: null, weekly: { percent: 96, resets_at: null } }, login_warning: true, login_expires_at: "2026-11-04T10:00:00Z" },
    { name: "old", is_default: false, usage: { status: "unavailable", reason: "token_expired", five_hour: null, weekly: null } },
  ],
});

test("parse reads schema 2 and tolerates null windows", () => {
  const rows = p.parse(DOC);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0].five, { percent: 12, resetsAt: "2026-11-04T01:40:00Z" });
  assert.equal(rows[1].five, null);
  assert.equal(rows[1].week.resetsAt, null);
  assert.equal(rows[2].status, "unavailable");
  assert.equal(rows[2].reason, "token_expired");
});

test("parse rejects another schema", () => {
  assert.throws(() => p.parse(JSON.stringify([{ name: "x" }])), /schema/);
  assert.throws(() => p.parse(JSON.stringify({ schema: 3, profiles: [] })), /schema 3/);
});

test("until and ago format durations", () => {
  assert.equal(p.until("2026-11-03T22:42:00Z", NOW), "42m");
  assert.equal(p.until("2026-11-04T01:05:00Z", NOW), "3h05");
  assert.equal(p.until("2026-11-09T01:00:00Z", NOW), "5d3h");
  assert.equal(p.until("2026-11-03T21:00:00Z", NOW), "now");
  assert.equal(p.until(null, NOW), "");
  assert.equal(p.ago("2026-11-03T21:58:00Z", NOW), "2m ago");
});

test("flags follow mcc's 80% and 95% thresholds", () => {
  assert.equal(p.flag(79), "");
  assert.equal(p.flag(80), "!");
  assert.equal(p.flag(95), "!!");
});

test("rows never exceed the pane width", () => {
  const rows = p.parse(DOC);
  for (const cols of [16, 20, 24, 28, 32, 40, 50, 60, 80, 120, 200]) {
    const layout = p.columns(cols, 7);
    for (const r of rows) {
      const text = strip(p.row(r, layout, null, NOW));
      assert.ok(p.width(text) <= cols, `${cols} cols: "${text}" is ${p.width(text)} wide`);
    }
  }
});

test("wide rows carry bars and countdowns, narrow ones drop them", () => {
  const [r] = p.parse(DOC);
  const wide = strip(p.row(r, p.columns(100, 7), null, NOW));
  assert.match(wide, /5h █+░+ +12% +3h40/);
  assert.match(wide, /wk █+░* +81%! +5d16h/);
  const narrow = strip(p.row(r, p.columns(34, 7), null, NOW));
  assert.doesNotMatch(narrow, /█/);
  assert.match(narrow, /12%.*81%!/);
});

test("an unreadable account shows why", () => {
  const rows = p.parse(DOC);
  assert.match(strip(p.row(rows[2], p.columns(80, 7), null, NOW)), /old +login expired/);
});

test("notices name the login command", () => {
  p.ui.profiles = p.parse(DOC);
  p.ui.issues = {};
  const lines = p.noticeLines().map((n) => n.text);
  assert.ok(lines.some((l) => l === "old: login expired · mcc login old"));
  assert.ok(lines.some((l) => l.startsWith("work: login ends") && l.endsWith("mcc login work")));
});

test("peak is the highest percent of a window", () => {
  const rows = p.parse(DOC);
  assert.equal(p.peak(rows, "five"), 12);
  assert.equal(p.peak(rows, "week"), 96);
  assert.equal(p.peak([], "five"), null);
});

test("firstError skips the --all risk notice", () => {
  assert.equal(p.firstError("⚠ --all looks usage up live…\nerror: no profiles\n"), "error: no profiles");
  assert.equal(p.firstError("⚠ only the notice\n"), "");
});

test("resizeStep moves the divider by a share of the split", () => {
  assert.deepEqual(p.resizeStep(28, 6, 57), { direction: "down", amount: 22 / 57 });
  assert.deepEqual(p.resizeStep(6, 10, 57), { direction: "up", amount: 4 / 57 });
  assert.equal(p.resizeStep(8, 8, 57), null);
});

test("parentSplit finds the split the pane is the bottom of", () => {
  const layout = {
    splits: [
      { direction: "right", rect: { x: 0, y: 0, width: 200, height: 57 } },
      { direction: "down", rect: { x: 0, y: 0, width: 100, height: 57 } },
    ],
  };
  assert.equal(p.parentSplit(layout, { x: 0, y: 29, width: 100, height: 28 }), layout.splits[1]);
  assert.equal(p.parentSplit(layout, { x: 0, y: 0, width: 100, height: 29 }), null);
});

test("bottomLeft picks the lowest pane on the left edge", () => {
  const layout = {
    area: { x: 0, y: 0, width: 200, height: 57 },
    panes: [
      { pane_id: "a", rect: { x: 0, y: 0, width: 100, height: 30 } },
      { pane_id: "b", rect: { x: 0, y: 30, width: 100, height: 27 } },
      { pane_id: "c", rect: { x: 100, y: 0, width: 100, height: 57 } },
    ],
  };
  assert.equal(bottomLeft(layout).pane_id, "b");
});

test("a very narrow pane gets compact rows", () => {
  const rows = p.parse(DOC);
  const layout = p.columns(22, 7);
  assert.ok(layout.compact);
  assert.equal(strip(p.row(rows[0], layout, null, NOW)), " default 12/81%!");
  assert.equal(strip(p.row(rows[2], layout, null, NOW)), " old     ✗");
});

test("clip cuts by cells and keeps colour codes", () => {
  const line = "\x1b[32mabcdef\x1b[0m";
  assert.equal(p.clip(line, 3), "\x1b[32mabc\x1b[0m");
  assert.equal(strip(p.clip("日本語", 4)), "日本");
});

// ── Machine stats ───────────────────────────────────────────────────────────

const system = () => import("data:text/javascript;base64," +
  fs.readFileSync(path.join(__dirname, "..", "herdr-app", "mcc-usage", "system.js")).toString("base64"));

// Set some of p.ui for one test and put it back after, so test order never matters.
function withUi(t, values) {
  const saved = Object.fromEntries(Object.keys(values).map((k) => [k, p.ui[k]]));
  Object.assign(p.ui, values);
  t.after(() => Object.assign(p.ui, saved));
}

const MEM = { used: (764905 - 8234 + 203523 + 716032) * 16384, total: F.MEMSIZE };
const STATES = {
  read: { cpu: 16.7, mem: MEM, net: { rx: 1.2 * 1024 ** 2, tx: 40 * 1024 } },
  busy: { cpu: 97, mem: { used: 31 * 1024 ** 3, total: 32 * 1024 ** 3 }, net: { rx: 999 * 1024 ** 3, tx: 999 * 1024 ** 3 } },
  pending: {},
  unavailable: { cpu: null, mem: null, net: null },
  mixed: { cpu: 3, mem: null, net: undefined },
};

test("panel.js's parsers give what system.js's give, on every fixture", async () => {
  const sys = await system();
  const texts = [F.PROC_STAT_1, F.PROC_STAT_2, F.MEMINFO, F.VM_STAT, F.IOSTAT, F.NET_DEV, F.NETSTAT, F.EMPTY, F.GARBAGE, null];
  for (const text of texts) {
    for (const fn of ["parseProcStat", "parseMeminfo", "parseNetstat"]) assert.deepEqual(p[fn](text), sys[fn](text), `${fn} on ${JSON.stringify(text)?.slice(0, 30)}`);
    assert.deepEqual(p.parseVmStat(text, F.MEMSIZE), sys.parseVmStat(text, F.MEMSIZE));
    assert.deepEqual(p.parseNetDev(text), sys.parseNetDev(text));
  }
  const virtual = (n) => (n === "eth0" ? true : n === "wg0" ? false : undefined);
  assert.deepEqual(p.parseNetDev(F.NET_DEV, virtual), sys.parseNetDev(F.NET_DEV, virtual));
  const a = p.parseProcStat(F.PROC_STAT_1), b = p.parseProcStat(F.PROC_STAT_2);
  assert.equal(p.cpuPercent(a, b), sys.cpuPercent(a, b));
  const pairs = [[{ rx: 1000, tx: 500, at: 0 }, { rx: 3000, tx: 500, at: 2000 }], [{ rx: 3000, tx: 500, at: 0 }, { rx: 1000, tx: 900, at: 1000 }], [null, { rx: 1, tx: 1, at: 1 }]];
  for (const [x, y] of pairs) {
    assert.deepEqual(p.rate(x, y), sys.rate(x, y));
    assert.deepEqual(p.step(x, y, p.rate), sys.step(x, y, sys.rate));
  }
  for (const n of [0, 512, 40 * 1024, 1.2 * 1024 ** 2, 28 * 1024 ** 3, 3 * 1024 ** 5, NaN, -1]) {
    for (const fn of ["formatBytes", "formatRate", "shortBytes"]) assert.equal(p[fn](n), sys[fn](n), `${fn}(${n})`);
  }
  assert.equal(p.formatPair(MEM.used, MEM.total), sys.formatPair(MEM.used, MEM.total));
  for (const v of [undefined, null, 5]) assert.equal(p.label(v, String), sys.label(v, String));
});

test("os.cpus() times sum like /proc/stat's", () => {
  const core = (user, idle) => ({ times: { user, nice: 0, sys: 10, idle, irq: 0 } });
  assert.deepEqual(p.cpuTimes([core(30, 60), core(10, 80)]), { total: 200, idle: 140 });
  assert.equal(p.cpuTimes([]), null);
});

test("the stats row never exceeds the pane width, read or not", () => {
  for (const [name, s] of Object.entries(STATES)) {
    for (const cols of [16, 20, 24, 28, 32, 40, 50, 60, 80, 120, 200]) {
      const text = strip(p.statsRow(cols, s));
      assert.ok(p.width(text) <= cols, `${name} at ${cols} cols: "${text}" is ${p.width(text)} wide`);
    }
  }
});

test("the stats row shows CPU, memory and network, dropping the network, then the totals, when narrow", () => {
  const s = STATES.read;
  assert.equal(strip(p.statsRow(80, s)), " cpu 17% · mem 25.6/32.0 GB · net ↓1.2 MB/s ↑40 KB/s");
  assert.equal(strip(p.statsRow(40, s)), " cpu 17% · mem 25.6/32.0 GB");
  assert.equal(strip(p.statsRow(24, s)), " cpu 17% · mem 80%");
  assert.equal(strip(p.statsRow(80, STATES.pending)), " cpu — · mem — · net —");
});

test("a metric that can't be read says so, and the rest still show", () => {
  assert.equal(strip(p.statsRow(80, STATES.mixed)), " cpu 3% · mem unavailable · net —");
  assert.equal(strip(p.statsRow(80, STATES.unavailable)), " cpu unavailable · mem unavailable · net unavailable");
});

test("a stats command that timed out reads as unavailable, even with some output", (t) => {
  withUi(t, { stats: {}, cpuBase: null, netBase: null });
  // run() reports a killed program as code 0 with `error` set and what it printed so far.
  const killed = { code: 0, error: Object.assign(new Error("killed"), { killed: true }), stdout: F.NETSTAT.split("\n").slice(0, 9).join("\n"), stderr: "" };
  assert.equal(p.readout(killed, p.parseNetstat), null);
  assert.equal(p.readout({ code: 1, error: null, stdout: F.NETSTAT }, p.parseNetstat), null);
  assert.equal(p.readout({ code: 0, error: null, stdout: "" }, p.parseNetstat), null);
  p.applyStats({ cpu: { total: 1000, idle: 850 }, mem: MEM, net: p.readout(killed, p.parseNetstat), at: 0 });
  p.applyStats({ cpu: { total: 1900, idle: 1600 }, mem: MEM, net: null, at: 5000 });
  assert.equal(strip(p.statsRow(80)), " cpu 17% · mem 25.6/32.0 GB · net unavailable");
});

test("each sample updates the stats: CPU and network from the second one on", (t) => {
  withUi(t, { stats: {}, cpuBase: null, netBase: null });
  p.applyStats({ cpu: { total: 1000, idle: 850 }, mem: MEM, net: { rx: 0, tx: 0 }, at: 0 });
  assert.deepEqual(p.ui.stats, { cpu: undefined, mem: MEM, net: undefined });
  p.applyStats({ cpu: { total: 1900, idle: 1600 }, mem: MEM, net: { rx: 10240, tx: 5120 }, at: 5000 });
  assert.equal(Math.round(p.ui.stats.cpu), 17);
  assert.deepEqual(p.ui.stats.net, { rx: 2048, tx: 1024 });
  p.applyStats({ cpu: null, mem: MEM, net: { rx: 20480, tx: 5120 }, at: 10000 });
  assert.equal(p.ui.stats.cpu, null, "CPU failed this time");
  assert.deepEqual(p.ui.stats.net, { rx: 2048, tx: 0 }, "the network still updates");
});

test("collapse and expand start the CPU and network over from a new base", (t) => {
  withUi(t, { stats: {}, cpuBase: null, netBase: null });
  p.applyStats({ cpu: { total: 1000, idle: 850 }, mem: MEM, net: { rx: 0, tx: 0 }, at: 0 });
  p.applyStats({ cpu: { total: 1900, idle: 1600 }, mem: MEM, net: { rx: 10240, tx: 0 }, at: 5000 });
  assert.equal(Math.round(p.ui.stats.cpu), 17);
  p.resetStats();
  assert.deepEqual(p.ui.stats, {}, "— until the next sample");
  // The first sample after the reset only sets the bases again.
  p.applyStats({ cpu: { total: 2900, idle: 1700 }, mem: MEM, net: { rx: 20480, tx: 0 }, at: 60000 });
  assert.deepEqual(p.ui.stats, { cpu: undefined, mem: MEM, net: undefined });
});

test("collapsed, the title line adds CPU and memory, and the network when there's room", (t) => {
  withUi(t, { collapsed: true, profiles: p.parse(DOC), stats: STATES.read });
  assert.match(strip(p.header(120)), /5h 12% · wk 96% · cpu 17% · mem 80% · net ↓1\.2M ↑40K/);
  const mid = strip(p.header(60));
  assert.match(mid, /5h 12% · wk 96% · cpu 17% · mem 80%/);
  assert.doesNotMatch(mid, /net/);
  for (const [name, s] of Object.entries(STATES)) {
    p.ui.stats = s;
    for (const cols of [24, 28, 32, 40, 50, 60, 80, 120, 200]) {
      const text = strip(p.header(cols));
      assert.ok(p.width(text) <= cols, `${name} at ${cols} cols: "${text}" is ${p.width(text)} wide`);
    }
    // Under 24 columns the title and ↻ alone overflow (draw() cuts them); the stats add nothing.
    for (const cols of [16, 20]) {
      p.ui.stats = s;
      const withStats = strip(p.header(cols));
      p.ui.stats = {};
      assert.equal(p.width(withStats), p.width(strip(p.header(cols))));
    }
  }
});

test("wantedRows counts the stats line when expanded, still one row collapsed", (t) => {
  withUi(t, { collapsed: false, profiles: p.parse(DOC), issues: {}, error: null });
  // header, stats line, rule, 3 accounts, 2 notices, footer.
  assert.equal(p.wantedRows(), 3 + 3 + 2 + 1);
  p.ui.collapsed = true;
  assert.equal(p.wantedRows(), 1);
});
