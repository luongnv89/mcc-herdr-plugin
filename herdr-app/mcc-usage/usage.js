// What the sidebar section knows about mcc, with no Herdr or GPUI in it, so the
// tests can load it in plain Node. Ported from the Herdr TUI plugin's panel.js.

// Numbers older than this are stale: their row shows them faded, with their age
// (staleAge) beside the name.
export const STALE = 3600000;

const clean = (text) => String(text ?? "").replace(/[\x00-\x1f\x7f-\x9f\u200b-\u200f\u2028\u2029\ufeff]+/g, " ").trim();
const usageWindow = (w) => (w && typeof w.percent === "number" ? { percent: w.percent, resetsAt: w.resets_at ?? null } : null);

// `mcc usage --json-v2` → one row per profile.
export function parse(stdout) {
  const doc = JSON.parse(stdout);
  if (doc?.schema !== 2 || !Array.isArray(doc.profiles)) throw new Error(`unexpected mcc output (schema ${doc?.schema ?? "?"}); update mcc`);
  return doc.profiles.map((p) => ({
    name: clean(p.name),
    isDefault: Boolean(p.is_default),
    status: p.usage?.status ?? "unavailable",
    reason: p.usage?.reason ?? null,
    five: usageWindow(p.usage?.five_hour),
    week: usageWindow(p.usage?.weekly),
    updatedAt: p.usage?.updated_at ?? null,
    loginWarning: Boolean(p.login_warning),
    loginExpiresAt: p.login_expires_at ?? null,
  }));
}

// The first line of mcc's stderr that isn't its --all risk notice.
export const firstError = (stderr) => (stderr || "").split("\n").map((l) => l.trim()).find((l) => l && !l.startsWith("⚠")) ?? "";

const REASONS = {
  not_logged_in: "not logged in", token_expired: "login expired", unauthorized: "login rejected", rate_limited: "rate limited",
  network: "network error", http_error: "server error", parse_error: "bad response", disabled: "usage off (MCC_NO_USAGE)", no_data: "no usage cached",
};
const NEEDS_LOGIN = new Set(["not_logged_in", "token_expired", "unauthorized"]);
export const reasonText = (r) => REASONS[r] ?? (r ? String(r).replace(/_/g, " ") : "unavailable");
export const loginCommand = (p) => `mcc login ${p.isDefault ? "default" : p.name}`;

// Time until `iso`: 42m, 3h05, 5d3h.
export function until(iso, now = Date.now()) {
  if (!iso) return "";
  const s = (Date.parse(iso) - now) / 1000;
  if (!Number.isFinite(s)) return "";
  if (s <= 0) return "now";
  const m = Math.ceil(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h${String(m % 60).padStart(2, "0")}`;
  return `${Math.floor(h / 24)}d${h % 24}h`;
}

export function ago(iso, now = Date.now()) {
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (!Number.isFinite(s)) return "";
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// mcc's thresholds: `!` at 80% or more, `!!` at 95% or more.
export const flag = (pct) => (pct >= 95 ? "!!" : pct >= 80 ? "!" : "");
export const level = (pct) => (pct >= 95 ? "high" : pct >= 80 ? "warn" : "ok");

export const isStale = (p, now = Date.now()) => Boolean(p.updatedAt) && now - Date.parse(p.updatedAt) > STALE;

// How old stale numbers are, short: 3h, 2d. Empty when they aren't stale.
export function staleAge(p, now = Date.now()) {
  if (!isStale(p, now)) return "";
  const h = Math.floor((now - Date.parse(p.updatedAt)) / 3600000);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

// The account can't be read at all: no numbers to show, only why.
export const unreadable = (p) => p.status !== "ok" && !p.five && !p.week;

// The account gets a ⚠: the last live refresh failed for it, it can't be read, or its login ends soon.
export const hasProblem = (p, issue) => Boolean(issue) || p.status !== "ok" || Boolean(p.loginWarning);

// Lines under the rows: why an account couldn't be read, and what to run.
// `issues` holds the reasons the last live refresh gave, by account name.
export function notices(profiles, issues = {}, now = Date.now()) {
  const out = [];
  for (const p of profiles) {
    const reason = issues[p.name] ?? (p.status !== "ok" ? p.reason : null);
    if (reason) out.push({ name: p.name, text: `${p.name}: ${reasonText(reason)}${NEEDS_LOGIN.has(reason) ? ` · ${loginCommand(p)}` : ""}` });
    else if (p.loginWarning) {
      const left = until(p.loginExpiresAt, now);
      out.push({ name: p.name, text: `${p.name}: login ends ${left ? `in ${left}` : "soon"} · ${loginCommand(p)}` });
    }
  }
  return out;
}

// What a row's tooltip says: each window's percent and reset, and how old the numbers are.
export function details(p, issue, now = Date.now()) {
  const part = (label, w) => {
    if (!w) return `${label}: —`;
    const pct = Math.round(w.percent), left = until(w.resetsAt, now);
    return `${label}: ${pct}%${flag(pct)}${left ? `, resets in ${left}` : ""}`;
  };
  const lines = [`${p.name}${p.isDefault ? " (default)" : ""}`];
  if (unreadable(p)) lines.push(reasonText(issue ?? p.reason));
  else lines.push(part("5 hours", p.five), part("Week", p.week));
  if (p.updatedAt) lines.push(`Updated ${ago(p.updatedAt, now)}`);
  if (issue && !unreadable(p)) lines.push(`Last refresh: ${reasonText(issue)}`);
  return lines.join("\n");
}

// The newest time any account's numbers were updated, as "updated 4m ago".
export function updatedLabel(profiles, lastLive, now = Date.now()) {
  if (lastLive && now - lastLive < 60000) return "updated just now";
  const times = profiles.map((p) => Date.parse(p.updatedAt ?? "")).filter(Number.isFinite);
  return times.length ? `updated ${ago(new Date(Math.max(...times)).toISOString(), now)}` : "";
}

// The block's height in px (at zoom 1). The section draws a header, then, when its
// values show, a column-label line, one line per account (or one for loading / empty),
// the notice lines and some room at the bottom. On the rail it draws only the eye
// button and, when its values show, one line per account, with railPad above and below.
export const SIZES = { header: 41, labels: 20, row: 24, notice: 18, bottom: 10, railPad: 8 };
export function blockHeight({ hidden, rows, notices: lines = 0, rail = false }) {
  if (rail) return 2 * SIZES.railPad + SIZES.row + (hidden ? 0 : rows * SIZES.row);
  if (hidden) return SIZES.header;
  return SIZES.header + SIZES.labels + Math.max(1, rows) * SIZES.row + lines * SIZES.notice + SIZES.bottom;
}
