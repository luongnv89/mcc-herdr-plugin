// What the Mistral row shows, from what mistral-status.cjs prints: the plan, the
// month's Vibe usage and when it resets, or why there's nothing to show. No Herdr,
// GPUI or imports in it, so the tests load it in plain Node; panel.js has a copy
// of everything below the two helpers (keep the copies the same: the tests check
// they agree).

// The same as usage.js's and panel.js's, which panel.js uses for its copy.
const clean = (text) => String(text ?? "").replace(/[\x00-\x1f\x7f-\x9f\u200b-\u200f\u2028\u2029\ufeff]+/g, " ").trim();
function until(iso, now = Date.now()) {
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

// ── Copied to panel.js ──────────────────────────────────────────────────────

const MISTRAL_STATUSES = ["ready", "missing_key", "unauthorized", "unavailable"];
const PLAN_KINDS = { api: "API", chat: "Le Chat", mistral_code: "Mistral Code" };

// A short string the helper passed on, cleaned, or null.
const mistralText = (v) => (typeof v === "string" && clean(v) ? clean(v).slice(0, 40) : null);

// The helper's stdout → { found, status, plan, budget, error }, whitelisted again:
// only these fields, each of the type it should be.
function parseStatus(stdout) {
  let o;
  try { o = JSON.parse(String(stdout ?? "").trim().split("\n").at(-1)); } catch { o = null; }
  if (!o || typeof o !== "object") return { found: true, status: null, error: "no answer from mistral-status" };
  if (o.found === false) return { found: false };
  const p = o.plan && typeof o.plan === "object" ? o.plan : null;
  const b = o.budget && typeof o.budget === "object" ? o.budget : null;
  const pct = typeof b?.usagePercentage === "number" ? b.usagePercentage : NaN;
  return {
    found: true,
    status: MISTRAL_STATUSES.includes(o.status) ? o.status : null,
    plan: p ? { kind: mistralText(p.kind), name: mistralText(p.name), title: mistralText(p.title) } : null,
    budget: b && Number.isFinite(pct) ? { usagePercentage: pct, resetAt: mistralText(b.resetAt), paygEnabled: b.paygEnabled === true } : null,
    error: mistralText(o.error) ?? (MISTRAL_STATUSES.includes(o.status) ? null : "no answer from mistral-status"),
  };
}

// The status when the helper itself failed (exited non-zero): Node couldn't find it, or it broke.
const failedStatus = (stderr) => ({ found: true, status: null, error: /Cannot find module/.test(String(stderr ?? "")) ? "helper missing: reinstall the plugin" : "mistral-status failed" });

// The plan's name: its title (Pro), else its name, else what kind it is.
function planLabel(plan) {
  if (!plan) return null;
  const name = mistralText(plan.name);
  return mistralText(plan.title) ?? (name ? name[0] + name.slice(1).toLowerCase() : null) ?? PLAN_KINDS[plan.kind] ?? null;
}

// Vibe's usage is a percent of the month's allowance: 0.6%, 12%, 140%.
const pctText = (pct) => (pct < 9.95 ? `${(Math.round(pct * 10) / 10).toFixed(1)}%` : `${Math.round(pct)}%`);
// mcc's thresholds: 80% and 95%.
const mistralLevel = (pct) => (pct >= 95 ? "high" : pct >= 80 ? "warn" : "ok");

// What the row shows. `kind` is "loading", "ok" (the plan and a percent), "none"
// (no subscription to show: not found, not logged in, no usage), or "error".
// `text` is the whole line, `short` what fits beside the name.
function mistralView(s, now = Date.now()) {
  if (!s) return { kind: "loading", name: "Mistral", short: "…", text: "Mistral: loading…" };
  if (!s.found) return { kind: "none", name: "Mistral", short: "not found", text: "Mistral Vibe not found: install it or set VIBE_APP_SERVER_BIN" };
  if (!s.status) return { kind: "error", name: "Mistral", short: "error", text: `Mistral: ${s.error || "no answer"}` };
  if (s.status === "missing_key") return { kind: "none", name: "Mistral", short: "not logged in", text: "Mistral: not logged in · run vibe" };
  if (s.status === "unauthorized") return { kind: "none", name: "Mistral", short: "login rejected", text: "Mistral: login rejected · run vibe" };
  if (s.status === "unavailable") return { kind: "none", name: "Mistral", short: "unavailable", text: "Mistral: account unavailable" };
  const plan = planLabel(s.plan);
  const name = plan ? `Mistral ${plan}` : "Mistral";
  if (!s.budget) return { kind: "none", name, short: "usage unavailable", text: `${name}: usage unavailable` };
  const pct = s.budget.usagePercentage;
  const note = pct > 100 ? (s.budget.paygEnabled ? "pay-as-you-go" : "over the limit") : "";
  const reset = until(s.budget.resetAt, now);
  const text = `${name}: ${pctText(pct)}${note ? ` ${note}` : ""}${reset ? ` · resets in ${reset}` : ""}`;
  return { kind: "ok", name, pct, label: pctText(pct), level: mistralLevel(pct), note, reset, short: pctText(pct), text };
}

// The row's tooltip: the plan, the month's usage and when it resets.
function mistralTip(s, now = Date.now()) {
  const v = mistralView(s, now);
  if (v.kind !== "ok") return v.text;
  const lines = [`${v.name} (Mistral Vibe)`, `This month: ${v.label} of the allowance${v.note ? `, ${v.note}` : ""}`];
  if (v.reset) lines.push(`Resets in ${v.reset}`);
  lines.push(`Pay-as-you-go: ${s.budget.paygEnabled ? "on" : "off"}`);
  return lines.join("\n");
}

export { parseStatus, failedStatus, planLabel, pctText, mistralLevel, mistralView, mistralTip };
