// The 5-hour and weekly Claude Code usage of every account mcc manages, as a
// sidebar section under Agents. The eye button shows or hides the values; ↻ looks
// every account up live (`mcc usage --all`). Between refreshes it rereads mcc's
// cache (`mcc usage --json-v2`, a local file read) every 30 seconds while shown.
//
// It lives in a layout block (id "mcc-usage", or props.block) and sizes that
// block to its rows with layout.resize. Key commands: mcc-usage.toggle, .show,
// .hide, .refresh (bind them in keys.json).

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, home, theme, run, layout, props, nextCommand } from "herdr";
import { parse, firstError, notices, details, updatedLabel, blockHeight, level, isStale, unreadable } from "./usage.js";

const POLL = 30000;
// The sidebar's rail (collapsed to icons) is narrower than this.
const RAIL = 150;
const ICON = (name) => `mods/mcc-usage/${name}.svg`;
// Meter widths, px: bar, gap, percent.
const BAR = 22, PCT = 30, METER = BAR + 5 + PCT;

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
    this.error = null;
    this.loaded = false;
    this.hidden = localStorage.getItem("hidden") === "1";
    this.bin = null;

    cx.timer.every(POLL, (cx) => { if (!this.hidden) this.load(cx); });
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "toggle") this.toggle(cx);
        else if (c === "show" && this.hidden) this.toggle(cx);
        else if (c === "hide" && !this.hidden) this.toggle(cx);
        else if (c === "refresh") this.refresh(cx);
      }
    });
    if (!this.hidden) this.load(cx);
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
          this.error = null;
        } catch (e) { this.error = firstError(r.stderr) || e.message; }
      } catch (e) { this.error = e.message ?? String(e); }
      this.refreshing = false;
      cx.notify();
      this.load(cx);
    });
  }

  toggle(cx) {
    this.hidden = !this.hidden;
    try { localStorage.setItem("hidden", this.hidden ? "1" : "0"); } catch {}
    if (!this.hidden) this.load(cx);
    this.fit();
    cx.notify();
  }

  // The notice lines: an error first, then each account's.
  lines() {
    const out = notices(this.profiles, this.issues);
    if (this.error) out.unshift({ name: null, text: this.error, error: true });
    return out;
  }

  // Fit the block to what it shows. Never from render(): a resize re-renders.
  fit() {
    const want = blockHeight({ hidden: this.hidden, rows: this.profiles.length, notices: this.lines().length });
    const node = find(layout(), this.block);
    if (!node || node.size?.px === want) return;
    run("layout.resize", { id: this.block, px: want });
  }

  button(t, id, icon, tip, action) {
    return div().id(id).size(22).flex_none().flex().items_center().justify_center().rounded(5).cursor_pointer()
      .text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground))
      .tooltip(tip).on_click(action).child(svg(ICON(icon)).size(14));
  }

  header(t) {
    return h_flex().px(16).h(41).pt(14).pb(5).flex_none().gap(2).items_center()
      .child(div().id("mu-title").flex_1().min_w(0).truncate().text_size(11.5).font_medium().text_color(t.dim)
        .cursor_pointer().hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => this.toggle(cx)).child("Usage"))
      .when(!this.hidden, (el) => el.child(this.refreshing
        ? div().size(22).flex_none().flex().items_center().justify_center()
          .child(svg("mods/workspace-chrome/spinner.svg").size(12).text_color(t.working).spin(900))
        : this.button(t, "mu-refresh", "refresh", "Look every account up live (mcc usage --all)", (_e, cx) => this.refresh(cx))))
      .child(this.button(t, "mu-eye", this.hidden ? "eye-off" : "eye", this.hidden ? "Show usage" : "Hide usage", (_e, cx) => this.toggle(cx)));
  }

  tone(t, pct) {
    const l = level(pct);
    return l === "high" ? t.ansi1 : l === "warn" ? t.ansi3 : t.ansi2;
  }

  // A small bar and the percent. Stale numbers show dim.
  meter(t, w, stale) {
    if (!w) {
      return h_flex().w(METER).flex_none().gap(5).items_center()
        .child(div().w(BAR).h(4).rounded(2).bg(t.border))
        .child(div().w(PCT).text_right().text_size(11.5).text_color(t.dim).child("—"));
    }
    const pct = Math.round(w.percent), color = stale ? t.dim : this.tone(t, pct);
    const fill = Math.max(0, Math.min(BAR, Math.round((pct / 100) * BAR)));
    return h_flex().w(METER).flex_none().gap(5).items_center()
      .child(div().w(BAR).h(4).rounded(2).bg(t.border).overflow_hidden().child(div().w(fill).h(4).bg(color)))
      .child(div().w(PCT).text_right().text_size(11.5).text_color(color).child(`${pct}%`));
  }

  row(t, p, now) {
    const issue = this.issues[p.name];
    const warn = Boolean(issue) || p.status !== "ok" || p.loginWarning;
    const stale = isStale(p, now);
    return h_flex().id(`mu-${p.name}`).h(24).px(8).flex_none().gap(6).items_center().rounded(6)
      .hover((s) => s.bg(t.hover)).tooltip(details(p, issue, now))
      .child(div().flex_1().min_w(0).truncate().text_color(warn ? t.ansi3 : p.isDefault ? t.foreground : t.muted)
        .child(warn ? `${p.name} ⚠` : p.name))
      .when(unreadable(p), (el) => el.child(div().w(METER * 2 + 6).flex_none().text_right().text_size(11).text_color(t.dim).truncate().child("unavailable")))
      .when(!unreadable(p), (el) => el.child(this.meter(t, p.five, stale)).child(this.meter(t, p.week, stale)));
  }

  // The rail: one 5-hour percent per account, the rest in the tooltip.
  railRow(t, p, now) {
    const w = p.five;
    return div().id(`mu-${p.name}`).h(24).flex_none().flex().items_center().justify_center().text_size(11.5)
      .text_color(w ? this.tone(t, Math.round(w.percent)) : t.dim).tooltip(details(p, this.issues[p.name], now))
      .child(w ? `${Math.round(w.percent)}%` : "—");
  }

  render(cx) {
    const t = theme(), now = Date.now();
    const rail = (this.width ?? Infinity) < RAIL;
    const root = v_flex().id("mcc-usage").size_full().min_h(0).bg(t.chrome).border_t(1).border_color(t.border)
      .text_size(12.5).text_color(t.foreground)
      .on_size_change((size, cx) => { if (size.width !== this.width) { this.width = size.width; cx.notify(); } });

    if (rail) {
      return root.pt(8).when(!this.hidden, (el) => el.child(v_flex().id("mu-rail").flex_1().min_h(0).overflow_y_scrollbar()
        .children(this.profiles.map((p) => this.railRow(t, p, now)))));
    }

    const placeholder = !this.loaded ? "Loading…" : !this.profiles.length && !this.error ? "No mcc profiles" : null;
    return root.child(this.header(t)).when(!this.hidden, (el) => el.child(
      v_flex().id("mu-list").flex_1().min_h(0).px(8).overflow_y_scrollbar()
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
