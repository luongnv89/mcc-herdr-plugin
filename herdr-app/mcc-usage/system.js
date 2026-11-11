// This machine's CPU, memory and network, read from what Linux (/proc) and macOS
// (vm_stat, netstat, iostat) print. No Herdr, GPUI or imports in it, so the tests
// can load it in plain Node. panel.js carries a copy of the parsers.
//
// A metric is a value, `undefined` before there is one (a rate needs two samples),
// or `null` when it can't be read: label() shows those as "—" and "unavailable".

// Interfaces that carry no traffic of their own (containers, VPNs, bridges), so
// counting them would count the same bytes twice. Used when Linux can't say.
const VIRTUAL = /^(lo$|docker|veth|br-|virbr|tun|tap|wg|tailscale|cni|flannel|cali|lxc|lxdbr|incusbr|podman|mpqemubr|vnet|vxlan)/;
// The same on macOS: loopback, bridges, VPN tunnels, AirDrop/peer links and the like.
const MAC_VIRTUAL = /^(lo|bridge|utun|awdl|llw|gif|stf|ap|anpi|vmenet|nan)\d*$/;

const num = (s) => (/^\d+$/.test(s) ? Number(s) : NaN);

// /proc/stat → the total and idle jiffies of all CPUs together.
export function parseProcStat(text) {
  const line = String(text ?? "").split("\n").find((l) => l.startsWith("cpu "));
  if (!line) return null;
  // user nice system idle iowait irq softirq steal; guest time is already in user.
  const f = line.trim().split(/\s+/).slice(1, 9).map(num);
  if (f.length < 4 || f.some(Number.isNaN)) return null;
  const total = f.reduce((a, b) => a + b, 0);
  return { total, idle: f[3] + (f[4] ?? 0) };
}

// The busy percent between two samples of parseProcStat (or os.cpus() sums).
export function cpuPercent(prev, cur) {
  if (!prev || !cur) return null;
  const total = cur.total - prev.total, idle = cur.idle - prev.idle;
  if (!(total > 0)) return null;
  return Math.max(0, Math.min(100, 100 * (1 - idle / total)));
}

// /proc/meminfo → bytes used and in all: what the kernel says it can't hand out.
export function parseMeminfo(text) {
  const kb = (key) => {
    const m = String(text ?? "").match(new RegExp(`^${key}:\\s+(\\d+)\\s*kB`, "m"));
    return m ? Number(m[1]) * 1024 : NaN;
  };
  const total = kb("MemTotal"), free = kb("MemAvailable");
  if (!(total > 0) || Number.isNaN(free)) return null;
  return { used: Math.max(0, total - free), total };
}

// `vm_stat` and the machine's memory (hw.memsize) → bytes used, as Activity
// Monitor's "Memory Used" counts it: app memory, wired and compressed.
export function parseVmStat(text, totalBytes) {
  const s = String(text ?? "");
  const page = Number(s.match(/page size of (\d+) bytes/)?.[1]);
  const total = Number(totalBytes);
  if (!(page > 0) || !(total > 0)) return null;
  const pages = {};
  for (const line of s.split("\n")) {
    const m = line.trim().match(/^"?(.+?)"?:\s+(\d+)\.?$/);
    if (m) pages[m[1]] = Number(m[2]);
  }
  const need = ["Anonymous pages", "Pages purgeable", "Pages wired down", "Pages occupied by compressor"];
  if (need.some((k) => pages[k] == null)) return null;
  const used = (pages["Anonymous pages"] - pages["Pages purgeable"] + pages["Pages wired down"] + pages["Pages occupied by compressor"]) * page;
  return { used: Math.max(0, Math.min(total, used)), total };
}

// `iostat -c 2 -w 1 -n 0` → the busy percent over the last second. Its first line
// of numbers is the average since boot, so the last one counts.
export function parseIostat(text) {
  const lines = String(text ?? "").split("\n").map((l) => l.trim().split(/\s+/));
  const head = lines.find((f) => f.includes("us") && f.includes("sy") && f.includes("id"));
  if (!head) return null;
  const rows = lines.filter((f) => f.length === head.length && f.every((x) => /^\d+(\.\d+)?$/.test(x)));
  if (!rows.length) return null;
  const idle = Number(rows.at(-1)[head.indexOf("id")]);
  return idle >= 0 && idle <= 100 ? 100 - idle : null;
}

// The interface names in /proc/net/dev.
export function netDevNames(text) {
  return String(text ?? "").split("\n").slice(2).map((l) => l.split(":")[0].trim()).filter(Boolean);
}

// /proc/net/dev → bytes received and sent so far by the physical interfaces.
// `isVirtual(name)` (true/false, or undefined when it doesn't know) beats the name list.
export function parseNetDev(text, isVirtual) {
  let rx = 0, tx = 0, seen = 0;
  for (const line of String(text ?? "").split("\n").slice(2)) {
    const at = line.indexOf(":");
    if (at < 0) continue;
    const name = line.slice(0, at).trim();
    const f = line.slice(at + 1).trim().split(/\s+/).map(num);
    if (!name || f.length < 9 || Number.isNaN(f[0]) || Number.isNaN(f[8])) continue;
    seen++;
    if (name === "lo" || (isVirtual?.(name) ?? VIRTUAL.test(name))) continue;
    rx += f[0]; tx += f[8];
  }
  return seen ? { rx, tx } : null;
}

// `netstat -ibn` (macOS) → the same. Only the <Link#N> row of each interface has
// its own counters; rows without an address have one field fewer, so read from the end.
export function parseNetstat(text) {
  let rx = 0, tx = 0, seen = 0;
  for (const line of String(text ?? "").split("\n")) {
    const f = line.trim().split(/\s+/);
    if (f.length < 10 || !/^<Link#\d+>$/.test(f[2])) continue;
    const ib = num(f.at(-5)), ob = num(f.at(-2));
    if (Number.isNaN(ib) || Number.isNaN(ob)) continue;
    seen++;
    // A trailing * marks an interface that is down.
    if (MAC_VIRTUAL.test(f[0].replace(/\*$/, ""))) continue;
    rx += ib; tx += ob;
  }
  return seen ? { rx, tx } : null;
}

// Bytes per second between two counter samples ({ rx, tx, at } with `at` in ms).
// Counters that went backwards (an interface gone) count as no traffic.
export function rate(prev, cur) {
  if (!prev || !cur) return null;
  const s = (cur.at - prev.at) / 1000;
  if (!(s > 0)) return null;
  return { rx: Math.max(0, cur.rx - prev.rx) / s, tx: Math.max(0, cur.tx - prev.tx) / s };
}

// A metric worked out from two samples (CPU on Linux, network) after a new one:
// null when it failed, undefined until there are two. `base` is kept for the next.
export function step(base, cur, delta) {
  if (!cur) return { value: null, base: null };
  return { value: base ? delta(base, cur) ?? undefined : undefined, base: cur };
}

const UNITS = ["B", "KB", "MB", "GB", "TB"];
const scale = (n) => {
  let i = 0;
  while (n >= 1024 && i < UNITS.length - 1) { n /= 1024; i++; }
  return [n, i];
};
// 512 B, 40 KB, 1.2 MB, 28.0 GB.
export function formatBytes(n) {
  if (!Number.isFinite(n) || n < 0) return "—";
  const [v, i] = scale(n);
  return `${v.toFixed(i >= 3 || (i > 0 && v < 10) ? 1 : 0)} ${UNITS[i]}`;
}
export const formatRate = (n) => (Number.isFinite(n) && n >= 0 ? `${formatBytes(n)}/s` : "—");
// For tight spots: 40K, 1.2M.
export function shortBytes(n) {
  if (!Number.isFinite(n) || n < 0) return "—";
  const [v, i] = scale(n);
  return `${v.toFixed(i > 0 && v < 10 ? 1 : 0)}${UNITS[i][0]}`;
}
// Used of total in the total's unit: 28.0/32.0 GB.
export function formatPair(used, total) {
  if (!(total > 0) || !(used >= 0)) return "—";
  const [t, i] = scale(total);
  const u = used / 1024 ** i;
  const d = i >= 3 || (i > 0 && t < 10) ? 1 : 0;
  return `${u.toFixed(d)}/${t.toFixed(d)} ${UNITS[i]}`;
}

export const memPercent = (m) => (m && m.total > 0 ? (100 * m.used) / m.total : null);

// An exec or run() result → what `parse` makes of its output, or null when the
// program failed: it couldn't start or timed out (error), exited non-zero (or was
// killed: a null code), or printed nothing.
export function readout(r, parse) {
  if (!r || r.error || r.code !== 0 || !r.stdout) return null;
  try { return parse(r.stdout) ?? null; } catch { return null; }
}

// One metric's text: "—" before the first reading, "unavailable" when it can't be read.
export const label = (v, show) => (v === undefined ? "—" : v === null ? "unavailable" : show(v));

// The tooltip for the stats line.
export function statsTip(s) {
  return [
    `CPU: ${label(s.cpu, (v) => `${Math.round(v)}% busy`)}`,
    `Memory: ${label(s.mem, (m) => `${formatBytes(m.used)} of ${formatBytes(m.total)} used (${Math.round(memPercent(m))}%)`)}`,
    `Network: ${label(s.net, (n) => `↓ ${formatRate(n.rx)} in, ↑ ${formatRate(n.tx)} out`)}`,
    "This machine, every 5 seconds",
  ].join("\n");
}
