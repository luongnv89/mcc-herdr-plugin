# Changelog

## Unreleased

- **Mistral Vibe.** Both the terminal panel and the app's Usage section show a Mistral row under the accounts: your Mistral Vibe plan (Pro, say), how much of the month's Vibe allowance you've used (same colours, with a pay-as-you-go note past 100%) and when it resets. With no subscription to show it says why: Vibe isn't installed, you aren't logged in, the account is unavailable or the usage can't be read. `herdr-app/mcc-usage/mistral-status.cjs` asks Vibe's `vibe-app-server` (found at `$VIBE_APP_SERVER_BIN`, on `PATH` or in `~/.local/bin`) at start, on refresh and every 5 minutes, and prints only the plan, status and usage: never the API key, offers or ids. Each read leaves a ~1 KB session folder under `~/.vibe/logs/session/unified/`.

## 0.2.0 (2026-11-11)

- **Herdr app.** A Usage section for the Herdr desktop app's left sidebar, under Agents (`herdr-app/mcc-usage`): every mcc account's 5-hour and weekly usage as small bars, with an eye button that shows or hides the values (the section shrinks to its title line), a ↻ button for a live lookup, and tooltips with reset times. `node herdr-app/install.js` copies it and adds it to your layout; `--uninstall` takes it out. Key commands: `mcc-usage.toggle`, `.show`, `.hide`, `.refresh`.
- **Machine stats.** Both the terminal panel and the app's Usage section show this machine's CPU and memory use and its network download/upload rate, updated every 5 seconds without any action (the usage numbers still reread every 30 seconds). Linux reads `/proc`; macOS reads `vm_stat`, `netstat` and `iostat` (memory as Activity Monitor's "Memory Used"). Only physical network interfaces count. A value that can't be read shows `unavailable` and the rest of the section still shows. Collapsed, the panel's title adds the CPU and memory percent; on the app's rail, C, M and N lines show them.

## 0.1.0 (2026-11-03)

First release.

- A pane at the bottom-left of a Herdr tab, under the sidebar's agent list, with the 5-hour and weekly usage of every account mcc manages (`mcc usage --json-v2`): a bar, the percent used and the time until reset, with mcc's `!` (80%+) and `!!` (95%+) marks.
- **↻ refresh** (or `r`) looks every account up live with `mcc usage --all`, only when you ask. Between refreshes the panel rereads mcc's cache every 30 seconds.
- A ⚠ and a line naming the `mcc login` command for an account whose login has expired or ends soon. Numbers older than an hour say how old they are.
- Collapse and expand with a click on the title (or `c`): collapsing gives the pane's rows back to the panes above it; expanding fits the pane to its rows.
- A `bind-key` action that binds `prefix+u`, or the first free key, in Herdr's config.
