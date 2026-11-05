# Changelog

## Unreleased

- **Herdr app.** A Usage section for the Herdr desktop app's left sidebar, under Agents (`herdr-app/mcc-usage`): every mcc account's 5-hour and weekly usage as small bars, with an eye button that shows or hides the values (the section shrinks to its title line), a ↻ button for a live lookup, and tooltips with reset times. `node herdr-app/install.js` copies it and adds it to your layout; `--uninstall` takes it out. Key commands: `mcc-usage.toggle`, `.show`, `.hide`, `.refresh`.

## 0.1.0 (2026-11-03)

First release.

- A pane at the bottom-left of a Herdr tab, under the sidebar's agent list, with the 5-hour and weekly usage of every account mcc manages (`mcc usage --json-v2`): a bar, the percent used and the time until reset, with mcc's `!` (80%+) and `!!` (95%+) marks.
- **↻ refresh** (or `r`) looks every account up live with `mcc usage --all`, only when you ask. Between refreshes the panel rereads mcc's cache every 30 seconds.
- A ⚠ and a line naming the `mcc login` command for an account whose login has expired or ends soon. Numbers older than an hour say how old they are.
- Collapse and expand with a click on the title (or `c`): collapsing gives the pane's rows back to the panes above it; expanding fits the pane to its rows.
- A `bind-key` action that binds `prefix+u`, or the first free key, in Herdr's config.
