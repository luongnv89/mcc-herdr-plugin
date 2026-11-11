// The 5-hour and weekly Claude Code usage of every account mcc manages, as a
// sidebar section under Agents. The eye button shows or hides the values; ↻ looks
// every account up live (`mcc usage --all`). Between refreshes it rereads mcc's
// cache (`mcc usage --json-v2`, a local file read) every 30 seconds while shown.
// Above the accounts, a line with this machine's CPU, memory and network, sampled
// every 5 seconds while shown.
//
// It lives in a layout block (id "mcc-usage", or props.block) and sizes that
// block to its rows with layout.resize. Key commands: mcc-usage.toggle, .show,
// .hide, .refresh (bind them in keys.json).

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, home, theme, run, layout, props, nextCommand, readTextFile, window as appWindow } from "herdr";
import { parse, firstError, notices, details, updatedLabel, blockHeight, SIZES, level, isStale, staleAge, unreadable, hasProblem } from "./usage.js";
import { parseProcStat, cpuPercent, parseMeminfo, parseVmStat, parseIostat, netDevNames, parseNetDev, parseNetstat, rate, step, formatPair, formatRate, shortBytes, memPercent, readout, label, statsTip } from "./system.js";

const POLL = 30000;
// The machine's stats change by the second, so they're sampled more often than usage,
// and no command that reads them may run into the next sample.
const STATS = 5000, STATS_TIMEOUT = 4000;
// The sidebar's rail (collapsed to icons) is narrower than this, as the built-in
// sections (agents, workspace-chrome) have it.
const RAIL = 160;
const ICON = (name) => `mods/mcc-usage/${name}.svg`;
// Meter widths, px: bar, gap, percent.
const BAR = 22, PCT = 30, METER = BAR + 5 + PCT;
// Stale numbers keep their threshold colour, faded to this.
const FADED = 0.45;

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

export default class Usage extends View {
  init(_props, cx) {
    this.block = props()?.block ?? "mcc-usage";
    this.profiles = [];
    this.issues = {};      // name → reason the last live refresh gave
    this.error = null;     // why the last cache reread failed
    this.refreshError = null; // why the last live refresh failed; kept until one succeeds
    this.loaded = false;
    this.hidden = localStorage.getItem("hidden") === "1";
    this.bin = null;
    this.stats = {};       // cpu, mem, net: a value, undefined until there is one, null when it can't be read
    this.cpuBase = null;   // the last /proc/stat sample (Linux), for the next CPU percent
    this.netBase = null;   // the last byte counters, for the next network rate
    this.virtual = new Map(); // interface name → whether Linux lists it as virtual
    this.epoch = 0;        // bumped on hide and show, so a sample that was running then is dropped

    cx.timer.every(POLL, (cx) => { if (!this.hidden) this.load(cx); });
    cx.timer.every(STATS, (cx) => { if (!this.hidden) this.sample(cx); });
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "toggle") this.toggle(cx);
        else if (c === "show" && this.hidden) this.toggle(cx);
        else if (c === "hide" && !this.hidden) this.toggle(cx);
        else if (c === "refresh") this.refresh(cx);
      }
    });
    if (!this.hidden) { this.load(cx); this.sample(cx); }
    else this.fit();
  }

  // Runs mcc: from PATH, else where its installers put it. Remembers which one worked.
  async mcc(args) {
    const h = home();
    const tries = this.bin ? [this.bin] : ["mcc", `${h}/.local/bin/mcc`, `${h}/.cargo/bin/mcc`, "/opt/homebrew/bin/mcc", "/usr/local/bin/mcc"];
    let last = null;
    for (const bin of tries) {
      try {
        const r = await exec(bin, args);
        this.bin = bin;
        return r;
      } catch (e) { last = e; }
    }
    throw new Error(this.bin ? `can't run ${this.bin}: ${last}` : "mcc not found: install it or put it on your PATH");
  }

  load(cx) {
    if (this.loading) return;
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const r = await this.mcc(["usage", "--json-v2"]);
        try {
          this.profiles = parse(r.stdout);
          this.error = null;
          this.refreshError = null;
        } catch (e) { this.error = firstError(r.stderr) || e.message; }
      } catch (e) { this.error = e.message ?? String(e); }
      this.loading = false;
      this.loaded = true;
      this.fit();
      cx.notify();
    });
  }

  // Look every account up live with its own login. mcc saves what it finds to its
  // cache, so rereading the cache shows fresh numbers and keeps the last good ones
  // for accounts it couldn't reach; those get a line saying why.
  refresh(cx) {
    if (this.refreshing) return;
    this.refreshing = true;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const r = await this.mcc(["usage", "--all", "--json-v2"]);
        try {
          const live = parse(r.stdout);
          this.issues = {};
          for (const p of live) if (p.status !== "ok") this.issues[p.name] = p.reason;
          this.lastLive = Date.now();
          this.refreshError = null;
        } catch (e) { this.refreshError = firstError(r.stderr) || e.message; }
      } catch (e) { this.refreshError = e.message ?? String(e); }
      this.refreshing = false;
      this.fit();
      cx.notify();
      this.load(cx);
    });
  }

  toggle(cx) {
    this.hidden = !this.hidden;
    try { localStorage.setItem("hidden", this.hidden ? "1" : "0"); } catch {}
    // Rates over the time it was hidden would be averages, not what is happening now.
    this.stats = {};
    this.cpuBase = this.netBase = null;
    this.epoch++;
    if (!this.hidden) { this.load(cx); this.sample(cx); }
    this.fit();
    cx.notify();
  }

  // Linux or macOS. Herdr's window says; if it can't, /proc is only on Linux.
  async platform() {
    if (this.os) return this.os;
    try { this.os = appWindow().platform; } catch {}
    if (!this.os) this.os = (await readTextFile("/proc/stat").catch(() => null)) != null ? "linux" : "macos";
    return this.os;
  }

  // A /proc file. They report a size of 0, so if reading one gives nothing, cat it.
  async proc(path) {
    let text = null;
    if (!this.catProc) text = await readTextFile(path).catch(() => null);
    if (text) return text;
    text = readout(await exec("/bin/cat", [path], { timeout: STATS_TIMEOUT }).catch(() => null), (t) => t);
    if (text) this.catProc = true;
    return text;
  }

  // Counters of the physical interfaces. Linux lists the virtual ones (bridges,
  // VPNs, containers) under /sys/devices/virtual/net; the name list covers the rest.
  async physical(text) {
    for (const name of netDevNames(text)) {
      if (this.virtual.has(name)) continue;
      const found = await readTextFile(`/sys/devices/virtual/net/${name}/ifindex`).catch(() => null);
      this.virtual.set(name, found != null ? true : undefined);
    }
    return parseNetDev(text, (n) => this.virtual.get(n));
  }

  // One reading of each source; null for one that failed. Programs by absolute path:
  // the app's PATH may be thinner than your shell's. Stats are of this machine (no `on`).
  async readStats() {
    const at = Date.now();
    if ((await this.platform()) === "macos") {
      const opts = { timeout: STATS_TIMEOUT };
      const [vm, size, net, io] = await Promise.allSettled([
        exec("/usr/bin/vm_stat", [], opts),
        // The machine's memory doesn't change: asked once.
        this.memTotal ? { code: 0, stdout: String(this.memTotal) } : exec("/usr/sbin/sysctl", ["-n", "hw.memsize"], opts),
        exec("/usr/sbin/netstat", ["-ibn"], opts),
        exec("/usr/sbin/iostat", ["-c", "2", "-w", "1", "-n", "0"], opts),
      ]);
      const value = (s) => (s.status === "fulfilled" ? s.value : null);
      const total = readout(value(size), (t) => Number(t.trim()) || null);
      if (total) this.memTotal = total;
      return { cpu: readout(value(io), parseIostat), mem: total ? readout(value(vm), (t) => parseVmStat(t, total)) : null, net: readout(value(net), parseNetstat), at };
    }
    const [stat, mem, dev] = await Promise.all(["/proc/stat", "/proc/meminfo", "/proc/net/dev"].map((f) => this.proc(f)));
    return { stat: stat ? parseProcStat(stat) : null, mem: mem ? parseMeminfo(mem) : null, net: dev ? await this.physical(dev) : null, at };
  }

  // Sample CPU, memory and network. Each one that can't be read shows "unavailable"
  // on its own; none of it touches the usage rows or their errors.
  sample(cx) {
    if (this.statsBusy) return;
    this.statsBusy = true;
    const epoch = this.epoch;
    cx.spawn(async (cx) => {
      let r = null;
      try { r = await this.readStats(); } catch {}
      this.statsBusy = false;
      if (epoch !== this.epoch || this.hidden) return;
      const at = r?.at ?? Date.now();
      let cpu = r?.cpu ?? null;
      if (r && "stat" in r) ({ value: cpu, base: this.cpuBase } = step(this.cpuBase, r.stat ?? null, cpuPercent));
      const net = step(this.netBase, r?.net ? { ...r.net, at } : null, rate);
      this.netBase = net.base;
      this.stats = { cpu, mem: r?.mem ?? null, net: net.value };
      cx.notify();
    });
  }

  // The notice lines: the errors first, then each account's.
  lines() {
    const out = notices(this.profiles, this.issues);
    if (this.refreshError && this.refreshError !== this.error) out.unshift({ name: null, text: `Refresh failed: ${this.refreshError}`, error: true });
    if (this.error) out.unshift({ name: null, text: this.error, error: true });
    return out;
  }

  // On the rail? Goes by the sidebar's width like the built-in sections, so they all
  // switch together; in a layout with no sidebar, by this block's own width.
  narrow() {
    return (find(layout(), "sidebar")?.size?.px ?? this.width ?? Infinity) < RAIL;
  }

  // Fit the block to what it shows. Never from render(): a resize re-renders.
  fit() {
    // The stats lines show whenever the values do, read or not, so sampling never resizes.
    const want = blockHeight({ hidden: this.hidden, rows: this.profiles.length, notices: this.lines().length, rail: this.narrow(), stats: !this.hidden });
    const node = find(layout(), this.block);
    if (!node || node.size?.px === want) return;
    run("layout.resize", { id: this.block, px: want });
  }

  button(t, id, icon, tip, action) {
    return div().id(id).size(22).flex_none().flex().items_center().justify_center().rounded(5).cursor_pointer()
      .text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground))
      .role("button").accessibility_label(tip).tooltip(tip).on_click(action).child(svg(ICON(icon)).size(14));
  }

  eye(t) {
    return this.button(t, "mu-eye", this.hidden ? "eye-off" : "eye", this.hidden ? "Show usage" : "Hide usage", (_e, cx) => this.toggle(cx));
  }

  header(t) {
    return h_flex().px(16).h(41).pt(14).pb(5).flex_none().gap(2).items_center()
      .child(div().id("mu-title").flex_1().min_w(0).truncate().text_size(11.5).font_medium().text_color(t.dim)
        .cursor_pointer().hover((s) => s.text_color(t.foreground))
        .role("button").accessibility_label(this.hidden ? "Show usage" : "Hide usage")
        .on_click((_e, cx) => this.toggle(cx)).child("Usage"))
      .when(!this.hidden, (el) => el.child(this.refreshing
        ? div().size(22).flex_none().flex().items_center().justify_center().role("progress_indicator").accessibility_label("Refreshing usage")
          .child(svg("mods/workspace-chrome/spinner.svg").size(12).text_color(t.working).spin(900))
        : this.button(t, "mu-refresh", "refresh", "Look every account up live (mcc usage --all)", (_e, cx) => this.refresh(cx))))
      .child(this.eye(t));
  }

  tone(t, pct) {
    const l = level(pct);
    return l === "high" ? t.ansi1 : l === "warn" ? t.ansi3 : t.ansi2;
  }

  // A small bar and the percent. Stale numbers show faded.
  meter(t, w, stale) {
    if (!w) {
      return h_flex().w(METER).flex_none().gap(5).items_center()
        .child(div().w(BAR).h(4).rounded(2).bg(t.border))
        .child(div().w(PCT).text_right().text_size(11.5).text_color(t.dim).child("—"));
    }
    const pct = Math.round(w.percent), color = this.tone(t, pct);
    const fill = Math.max(0, Math.min(BAR, Math.round((pct / 100) * BAR)));
    return h_flex().w(METER).flex_none().gap(5).items_center().when(stale, (el) => el.opacity(FADED))
      .child(div().w(BAR).h(4).rounded(2).bg(t.border).overflow_hidden().child(div().w(fill).h(4).bg(color)))
      .child(div().w(PCT).text_right().text_size(11.5).text_color(color).child(`${pct}%`));
  }

  row(t, p, now) {
    const issue = this.issues[p.name];
    const warn = hasProblem(p, issue);
    const stale = isStale(p, now), age = staleAge(p, now);
    return h_flex().id(`mu-${p.name}`).h(24).px(8).flex_none().gap(6).items_center().rounded(6)
      .hover((s) => s.bg(t.hover)).tooltip(details(p, issue, now))
      .child(div().flex_1().min_w(0).truncate().text_color(warn ? t.ansi3 : p.isDefault ? t.foreground : t.muted).child(p.name))
      .when(warn, (el) => el.child(div().flex_none().text_color(t.ansi3).child("⚠")))
      // Stale numbers say how old they are, not only by fading.
      .when(Boolean(age), (el) => el.child(h_flex().flex_none().gap(2).items_center().text_size(10.5).text_color(t.dim)
        .child(svg("mods/workspace-chrome/clock.svg").size(10)).child(age)))
      .when(unreadable(p), (el) => el.child(div().w(METER * 2 + 6).flex_none().text_right().text_size(11).text_color(t.dim).truncate().child("unavailable")))
      .when(!unreadable(p), (el) => el.child(this.meter(t, p.five, stale)).child(this.meter(t, p.week, stale)));
  }

  // CPU and memory take the usage thresholds' colours; unread ones show dim.
  statColor(t, pct) {
    return pct == null ? t.dim : this.tone(t, Math.round(pct));
  }

  // This machine's CPU, memory and network on one line; the tooltip has the detail.
  statsLine(t) {
    const s = this.stats;
    // CPU stays whole; memory and network give way when the sidebar is narrow.
    const part = (name, text, color) => h_flex().flex_none().gap(3).items_center()
      .child(div().text_color(t.dim).child(name)).child(div().text_color(color).child(text));
    const shrink = (name, text, color) => h_flex().flex_shrink(1).min_w(0).gap(3).items_center()
      .child(div().flex_none().text_color(t.dim).child(name)).child(div().min_w(0).truncate().text_color(color).child(text));
    return h_flex().id("mu-stats").h(SIZES.stats).px(8).flex_none().gap(8).items_center().overflow_hidden().text_size(11)
      .tooltip(statsTip(s))
      .child(part("CPU", label(s.cpu, (v) => `${Math.round(v)}%`), this.statColor(t, s.cpu)))
      .child(shrink("Mem", label(s.mem, (m) => formatPair(m.used, m.total)), this.statColor(t, memPercent(s.mem))))
      .child(h_flex().flex_1().min_w(0).gap(3).items_center()
        .child(div().flex_none().text_color(t.dim).child("Net"))
        .child(div().min_w(0).truncate().text_color(s.net ? t.foreground : t.dim)
          .child(label(s.net, (n) => `↓${formatRate(n.rx)} ↑${formatRate(n.tx)}`))));
  }

  // The same on the rail: C, M and N lines, "n/a" for one that can't be read.
  railStats(t) {
    const s = this.stats, tip = statsTip(s);
    const short = (v, show) => (v === null ? "n/a" : label(v, show));
    const line = (id, name, text, color) => h_flex().id(id).h(SIZES.railStat).flex_none().gap(2).items_center().justify_center()
      .text_size(10.5).tooltip(tip)
      .child(div().flex_none().text_color(t.dim).child(name)).child(div().min_w(0).truncate().text_color(color).child(text));
    return [
      line("mu-rail-cpu", "C", short(s.cpu, (v) => `${Math.round(v)}%`), this.statColor(t, s.cpu)),
      line("mu-rail-mem", "M", short(s.mem, (m) => `${Math.round(memPercent(m))}%`), this.statColor(t, memPercent(s.mem))),
      line("mu-rail-net", "N", short(s.net, (n) => `↓${shortBytes(n.rx)}`), s.net ? t.foreground : t.dim),
    ];
  }

  // The rail: one 5-hour percent per account, the rest in the tooltip. Like the
  // full rows, stale numbers show dim and an account with a problem gets a ⚠.
  railRow(t, p, now) {
    const w = p.five, issue = this.issues[p.name];
    return h_flex().id(`mu-${p.name}`).h(24).flex_none().gap(2).items_center().justify_center().text_size(11.5)
      .tooltip(details(p, issue, now))
      .when(hasProblem(p, issue), (el) => el.child(div().text_color(t.ansi3).child("⚠")))
      .child(div().text_color(w ? this.tone(t, Math.round(w.percent)) : t.dim).when(Boolean(w) && isStale(p, now), (el) => el.opacity(FADED))
        .child(w ? `${Math.round(w.percent)}%` : "—"));
  }

  render(cx) {
    const t = theme(), now = Date.now();
    const rail = this.narrow();
    // Crossing the rail width changes what the section draws, so refit then (here,
    // not in render()).
    const root = v_flex().id("mcc-usage").size_full().min_h(0).bg(t.chrome).border_t(1).border_color(t.border)
      .text_size(12.5).text_color(t.foreground)
      .on_size_change((size, cx) => {
        if (size.width === this.width) return;
        this.width = size.width;
        const r = this.narrow();
        if (r !== this.rail) { this.rail = r; this.fit(); }
        cx.notify();
      });

    if (rail) {
      return root.pt(8).child(h_flex().h(24).flex_none().items_center().justify_center().child(this.eye(t)))
        .when(!this.hidden, (el) => el.child(v_flex().id("mu-rail").flex_1().min_h(0).overflow_y_scrollbar()
          .children(this.railStats(t))
          .children(this.profiles.map((p) => this.railRow(t, p, now)))));
    }

    const placeholder = !this.loaded ? "Loading…" : !this.profiles.length && !this.error ? "No mcc profiles" : null;
    return root.child(this.header(t)).when(!this.hidden, (el) => el.child(
      v_flex().id("mu-list").flex_1().min_h(0).px(8).overflow_y_scrollbar()
        .child(this.statsLine(t))
        .child(h_flex().h(20).px(8).flex_none().gap(6).items_center().text_size(10.5).text_color(t.dim)
          .child(div().flex_1().min_w(0).truncate().child(updatedLabel(this.profiles, this.lastLive, now)))
          .child(div().w(METER).flex_none().text_right().child("5h"))
          .child(div().w(METER).flex_none().text_right().child("week")))
        .when(Boolean(placeholder), (el) => el.child(div().h(24).px(8).flex_none().flex().items_center().text_color(t.dim).child(placeholder)))
        .children(this.profiles.map((p) => this.row(t, p, now)))
        .children(this.lines().map((n, i) => div().id(`mu-note-${i}`).h(18).px(8).flex_none().flex().items_center()
          .text_size(11).text_color(n.error ? t.ansi1 : t.ansi3).tooltip(n.text).child(div().min_w(0).truncate().child(n.text))))));
  }
}
