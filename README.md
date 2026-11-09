# mcc-herdr-plugin

A [Herdr](https://herdr.dev) plugin that shows the 5-hour and weekly Claude Code usage
of every account [mcc](https://github.com/luongnv89/mcc) manages, in a small pane at the bottom-left of the
tab, right under the sidebar's agent list.

```
 ▾ mcc usage                                        updated 4m ago  ↻ refresh
──────────────────────────────────────────────────────────────────────────────
 default    5h ██░░░░░░░░░░  14%   3h55    wk █░░░░░░░░░░░   7%   5d16h
 csdaisy    5h █░░░░░░░░░░░  12%   5m      wk ░░░░░░░░░░░░   2%   2d9h
 csluong    5h ············    —           wk ██░░░░░░░░░░  16%   5d16h  ⚠ 11h ago
 csluong: login expired · mcc login csluong
 r refresh · c collapse · q close
```

It works in both Herdrs: the terminal one (`herdr`, a plugin, below) and the desktop
app (Herdr.app, a sidebar section, see [Herdr app](#herdr-app)).

Each row shows a bar, the percent used and the time until the window resets. As in
`mcc usage`, `!` marks 80% or more and `!!` marks 95% or more. A ⚠ marks an account
whose last live lookup failed or whose login ends soon, with a line under the table
naming the `mcc login` command that fixes it. When the numbers are more than an hour
old, the row says how old they are.

## Install

You need Node 20 or later, Herdr 0.9.5 or later, and [mcc](https://github.com/luongnv89/mcc) on your `PATH`. If Herdr's
server can't find `mcc`, set `MCC_BIN` to its full path.

```bash
herdr plugin install luongnv89/mcc-herdr-plugin
```

To update, run `herdr plugin update mcc-herdr-plugin`. To remove it, run
`herdr plugin uninstall mcc-herdr-plugin`.

Then bind a key to it:

```bash
herdr plugin action invoke mcc-herdr-plugin.bind-key
```

This adds `prefix+u` to `~/.config/herdr/config.toml` and reloads the config. If
`prefix+u` is taken, it uses the first free `prefix+` letter instead, and it says which
key it picked. If the panel already has a key, it changes nothing. It saves the old
config as `config.toml.bak-mcc-herdr-plugin`. To choose the key yourself, run
`node bind-key.js prefix+x` in the plugin folder (`herdr plugin list` shows
where that is), or add the binding by hand and run
`herdr server reload-config`:

```toml
[[keys.command]]
key = "prefix+u"
type = "plugin_action"
command = "mcc-herdr-plugin.toggle"
description = "mcc usage panel"
```

Herdr plugins can't declare keys in their manifest, so linking or installing the
plugin doesn't bind one. Without a key, run `herdr plugin action invoke mcc-herdr-plugin.toggle`.

## Use

| Key or click                 | Does                                           |
| ---------------------------- | ---------------------------------------------- |
| `r`, or click **↻ refresh**  | Look every account's usage up live             |
| `c`, Enter, or click the title | Collapse or expand                           |
| `↑` `↓` / wheel              | Scroll when the accounts don't fit             |
| `q`                          | Close the panel                                |

Running the toggle action again in the same tab also closes the panel.

**Collapse** shrinks the pane so the panes above get the space back. The title row
then shows the highest 5-hour and weekly percent across accounts. Herdr keeps a split
at least a tenth of its height, so a collapsed pane still shows a few rows. Expanding
fits the pane to its rows again, up to 60% of the split. The panel remembers whether
it was collapsed.

**Refresh** runs `mcc usage --all`, which looks up every account's usage live with
that account's own login and saves the result to mcc's cache. It sends each
account's OAuth token to Anthropic's undocumented, rate-limited usage endpoint, so it
only runs when you ask for it. For the details, see `mcc usage --help`. Between
refreshes, the panel rereads mcc's cache (`mcc usage --json-v2`, a local file read)
every 30 seconds. That picks up whatever `mcc statusline` caches as you work.

## Why a pane and not part of the sidebar

Herdr plugins (v1) can open terminal panes but can't draw inside Herdr's own sidebar.
So the panel is an ordinary split pane placed at the tab's bottom-left corner, next to
the bottom of the sidebar. You can move or resize it like any other pane.

## Herdr app

The desktop app (Herdr.app, `herdr-app`) can't load terminal plugins: it's extended
with mods, small JavaScript panels that draw in its own window. So the app gets its
own version: a **Usage** section in the left sidebar, right under **Agents**.

```
 Agents                                  ◷
 …
──────────────────────────────────────────
 Usage                               ↻  👁
 updated 3m ago              5h      week
 default            ▬▬── 47%    ▬─── 24%
 csdaisy            ──── 0%     ▬─── 13%
 work               ▬─── 12%    ▬▬── 38%
──────────────────────────────────────────
 ⚙ Settings
```

- **👁** (or a click on "Usage") shows or hides the values. Hidden, the section
  shrinks to its title line and the Agents list gets the room. It remembers.
- **↻** looks every account up live (`mcc usage --all`), only when you click it.
  Between clicks it rereads mcc's cache every 30 seconds while it shows.
- Hover a row for each window's percent, when it resets and how old the numbers
  are. Green under 80%, yellow from 80%, red from 95%; numbers more than an hour old
  show faded, with their age (◷ 3h) beside the name. A name in yellow with ⚠ has a
  problem, and a line under the rows says which `mcc login` fixes it. A failed ↻
  says why in a line of its own.
- With the sidebar collapsed to its rail, it shows each account's 5-hour percent
  (faded when stale, ⚠ for a problem) under a 👁 button that shows or hides them.

### Install

You need Herdr app 0.1.13 or later, Node 20 or later to run the installer, and mcc
on your `PATH` (or in `~/.local/bin`, `~/.cargo/bin`, `/opt/homebrew/bin` or
`/usr/local/bin`).

```bash
git clone https://github.com/luongnv89/mcc-herdr-plugin
node mcc-herdr-plugin/herdr-app/install.js
```

This copies the mod to `~/.config/herdr-app/mods/mcc-usage`, runs `herdr-app check`
on it and adds this block to the layout Herdr shows now, under the agents list
(it saves the old file as `<layout>.json.bak-mcc-usage`):

```json
{ "id": "mcc-usage", "type": "block", "content": { "mod": "mcc-usage" }, "size": { "px": 120 } }
```

The section then sizes the block to its rows itself. Herdr's own layouts (`main`,
`terminals`, `win98`) are replaced on every start, so the installer only edits your
own; clone one first, then run it again:

```bash
herdr-app do layout.clone '{"name":"main","as":"my-layout"}'
```

`--layout NAME` picks another of your layouts. To update, pull and run it again. To
remove it, run `node herdr-app/install.js --uninstall`.

### Keys

The section takes `mcc-usage.toggle`, `mcc-usage.show`, `mcc-usage.hide` and
`mcc-usage.refresh`. To bind one, add it to `~/.config/herdr-app/keys.json`:

```json
"global": { "cmd-shift-u": "mcc-usage.toggle" }
```

or run it from a shell: `herdr-app do mcc-usage.toggle`.

### Limits

Herdr gives a mod's programs 30 seconds. If `mcc usage --all` takes longer (many
accounts, a slow network), ↻ shows an error; the section still rereads the cache, so
it shows whatever mcc saved in that time.

## Develop

```bash
git clone https://github.com/luongnv89/mcc-herdr-plugin
cd mcc-herdr-plugin
herdr plugin link "$PWD"
node --test test/*.test.js
node panel.js            # run outside Herdr to see the panel in your terminal
```

A linked plugin runs straight from your folder, so a change shows the next time the
panel opens.

- `herdr-plugin.toml`: the manifest, with two actions (`toggle`, `bind-key`) and one pane (`panel`).
- `toggle.js`: opens the panel at the tab's bottom-left, or closes it.
- `panel.js`: the panel itself. Plain Node, no npm packages.
- `bind-key.js`: binds a key to `toggle` in Herdr's config.
- `herdr-app/mcc-usage/`: the Herdr app mod. `main.js` draws the section,
  `usage.js` holds the parts with no Herdr in them (reading mcc's JSON, times,
  notices, the block's height). After a change, run `node herdr-app/install.js`
  again: the app reloads the mod as soon as its files change.
- `herdr-app/install.js`: copies the mod and adds its block to your layout.
- `test/`: unit tests for reading mcc's JSON, the rows at every width, the pane's
  height, how `bind-key` picks a key and edits the config, the app mod's helpers and
  where the installer puts the block.

## License

MIT
