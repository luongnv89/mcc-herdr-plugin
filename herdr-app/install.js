#!/usr/bin/env node
// Installs the mcc usage section into the Herdr desktop app: copies the mod to
// ~/.config/herdr-app/mods/mcc-usage and adds a block for it to your layout's
// sidebar, right under the Agents list. The app picks both up within a second.
//
//   node herdr-app/install.js                 the layout Herdr shows now
//   node herdr-app/install.js --layout NAME   another of your layouts
//   node herdr-app/install.js --uninstall     take the block out of every layout of yours, then the mod
//
// Herdr's own layouts (main, terminals, win98) are replaced on every start, so it
// only edits layouts that are yours: clone one first (Duplicate layout).
"use strict";
const clone = structuredClone ?? ((o) => JSON.parse(JSON.stringify(o)));
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const MOD = "mcc-usage";
const BLOCK = { id: MOD, type: "block", content: { mod: MOD }, size: { px: 120 } };
const SOURCE = path.join(__dirname, MOD);
// Files the app writes into every mod folder; never copied from here.
const APP_WRITTEN = new Set(["gpui-kit.d.ts", "jsconfig.json"]);

const appHome = (env = process.env) => env.HERDR_APP_HOME || path.join(os.homedir(), ".config", "herdr-app");

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

// The path from `node` to the node with `id`, both ends included, or null.
function pathTo(node, id, trail = []) {
  if (!node || typeof node !== "object") return null;
  const here = [...trail, node];
  if (node.id === id) return here;
  for (const child of node.children ?? []) {
    const found = pathTo(child, id, here);
    if (found) return found;
  }
  return null;
}

// The agents list: the node with id "agents", else the block that shows an agents mod.
function agentsId(root) {
  if (pathTo(root, "agents")) return "agents";
  const walk = (n) => {
    if (!n || typeof n !== "object") return null;
    if (n.type === "block" && /(^|-)agents$/.test(n.content?.mod ?? "")) return n.id;
    for (const c of n.children ?? []) { const id = walk(c); if (id) return id; }
    return null;
  };
  return walk(root);
}

// Adds `block` under the agents list. In a sidebar column, it goes right after the
// sidebar child that holds the agents list (so the lists keep how they share their
// column); elsewhere, right after the agents block in its column.
// Returns { layout, changed, where } and never edits `root` in place.
function addBlock(root, block = BLOCK) {
  const layout = clone(root);
  if (pathTo(layout, block.id)) return { layout, changed: false, where: "already there" };
  const id = agentsId(layout);
  if (!id) throw new Error("this layout has no agents list to put the section under");
  const trail = pathTo(layout, id);
  const sidebarAt = trail.findIndex((n) => n.id === "sidebar" && n.type === "column");
  let parent, after;
  if (sidebarAt >= 0 && sidebarAt < trail.length - 1) { parent = trail[sidebarAt]; after = trail[sidebarAt + 1]; }
  else { parent = trail[trail.length - 2]; after = trail[trail.length - 1]; }
  if (!parent || parent.type !== "column") throw new Error(`the agents list isn't in a column (${parent?.type ?? "it's the root"}); add the block by hand`);
  parent.children.splice(parent.children.indexOf(after) + 1, 0, clone(block));
  return { layout, changed: true, where: `under "${after.id}" in "${parent.id}"` };
}

// Takes every node with `id` out. Returns { layout, changed }.
function removeBlock(root, id = MOD) {
  const layout = clone(root);
  let changed = false;
  const walk = (n) => {
    if (!Array.isArray(n?.children)) return;
    const kept = n.children.filter((c) => c?.id !== id);
    if (kept.length !== n.children.length) { n.children = kept; changed = true; }
    kept.forEach(walk);
  };
  walk(layout);
  return { layout, changed };
}

// Herdr's own layouts: installed.json lists them as "layout:<name>".
function isShipped(home, name) {
  const installed = readJson(path.join(home, "installed.json"), {});
  return Object.prototype.hasOwnProperty.call(installed, `layout:${name}`) || ["main", "terminals", "win98"].includes(name);
}

function argValue(args, flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
}

function herdrApp(args, env = process.env) {
  return execFileSync(env.HERDR_APP_BIN || "herdr-app", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

const backupOf = (file) => `${file}.bak-${MOD}`;

// Takes the block out of every layout of yours (any of them may have it: installed
// with --layout, or cloned after the install), then the mod, so no layout is left
// naming a mod that isn't there. Herdr's own layouts are skipped: the installer
// never adds the block to them.
function uninstall(home, dest) {
  const dir = path.join(home, "layouts");
  const names = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).sort() : [];
  let took = 0;
  for (const name of names) {
    if (isShipped(home, name)) continue;
    const file = path.join(dir, `${name}.json`);
    let root;
    try { root = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { console.log(`Skipped ${file}: ${e.message}`); continue; }
    const { layout, changed } = removeBlock(root);
    if (!changed) continue;
    fs.copyFileSync(file, backupOf(file));
    fs.writeFileSync(file, JSON.stringify(layout, null, 2) + "\n");
    console.log(`Took the ${MOD} block out of ${name} (backup: ${path.basename(backupOf(file))})`);
    took++;
  }
  if (!took) console.log(`No layout of yours has the ${MOD} block`);
  if (fs.existsSync(dest)) { fs.rmSync(dest, { recursive: true, force: true }); console.log(`Removed ${dest}`); }
}

function main(args = process.argv.slice(2), env = process.env) {
  const home = appHome(env);
  if (!fs.existsSync(home)) throw new Error(`${home} doesn't exist: open the Herdr app once first`);
  const dest = path.join(home, "mods", MOD);
  if (args.includes("--uninstall")) return uninstall(home, dest);

  const name = argValue(args, "--layout") || readJson(path.join(home, "shared.json"), {}).layout || "main";
  const file = path.join(home, "layouts", `${name}.json`);
  if (!fs.existsSync(file)) throw new Error(`no layout ${file}`);
  const root = JSON.parse(fs.readFileSync(file, "utf8"));

  const { layout, changed, where } = addBlock(root);
  if (changed && isShipped(home, name)) {
    throw new Error(`"${name}" is one of Herdr's own layouts, which it replaces on every start.\n` +
      `Clone it first, then run this again:\n  herdr-app do layout.clone '{"name":"${name}","as":"my-layout"}'`);
  }

  // The mod first, so the layout never names a mod that isn't there yet. Files the
  // app writes into the folder (jsconfig.json, gpui-kit.d.ts) stay.
  fs.mkdirSync(dest, { recursive: true });
  for (const f of fs.readdirSync(SOURCE)) {
    if (APP_WRITTEN.has(f) || f.startsWith(".")) continue;
    fs.copyFileSync(path.join(SOURCE, f), path.join(dest, f));
  }
  console.log(`Copied the mod to ${dest}`);

  try {
    const out = herdrApp(["check", dest], env).trim();
    if (out) console.log(out);
  } catch (e) {
    if (e.code === "ENOENT") console.log("herdr-app isn't on your PATH: skipped `herdr-app check`");
    else throw new Error(`herdr-app check failed:\n${`${e.stdout || ""}${e.stderr || ""}`.trim()}`);
  }

  if (changed) {
    const backup = backupOf(file);
    fs.copyFileSync(file, backup);
    fs.writeFileSync(file, JSON.stringify(layout, null, 2) + "\n");
    console.log(`Added the section to ${name} ${where} (backup: ${path.basename(backup)})`);
  } else console.log(`${name} already has the section`);
}

if (require.main === module) {
  try { main(); } catch (e) { console.error(e.message); process.exit(1); }
} else module.exports = { main, addBlock, removeBlock, pathTo, agentsId, isShipped, appHome, BLOCK };
