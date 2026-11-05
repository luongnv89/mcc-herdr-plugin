// Tests for the Herdr desktop app's mcc usage section: the pure helpers in
// herdr-app/mcc-usage/usage.js (an ES module, loaded through a data: URL) and the
// layout edits herdr-app/install.js makes.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { addBlock, removeBlock, pathTo, agentsId } = require("../herdr-app/install.js");

const usage = () => import("data:text/javascript;base64," +
  fs.readFileSync(path.join(__dirname, "..", "herdr-app", "mcc-usage", "usage.js")).toString("base64"));

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
