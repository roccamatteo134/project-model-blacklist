# Paseo Project Model Blacklist

Per-project provider/model blacklist for [Paseo](https://paseo.sh) agents, with
cross-project folder protection.

Define one rule per project: which providers/models are forbidden there
(e.g. `opencode`, `codex`, `codex/gpt-5.5`, with optional regex), plus the
project's protected folders. Agents created with a blacklisted model fail in
that project, and resuming an existing agent with that model fails on open.
For other projects using the same provider, the plugin injects the provider's
native folder denies so a blacklisted model's folders stay unreadable
elsewhere.

> **Note:** Paseo plugins are trusted code and run *without sandbox* on the
> daemon machine (file, process and network access). Install only plugins you
> trust and review the source.

## Requirements

- Paseo `>=0.17.5` with plugins enabled (`~/.paseo/config.json` →
  `"pluginsEnabled": true`, or **Settings → Plugins → Enable plugins**).

## Install

```bash
npm install
npm run typecheck
paseo plugin install <repo-path>
paseo plugin ls   # → STATUS running
```

## Usage

1. Find the project id in the workspace list (or just list the project folder
   in `paths` to match by path).
2. Open **Settings → Plugins → Project blacklist** and add one rule per
   project: `blocked` entries like `opencode`, `codex/gpt-5.5`, optional
   `providerRegex` / `modelRegex`, and the project's protected `paths`.
3. Create an agent with a blacklisted model in that project → creation (and
   later re-open) is rejected with `modello blacklistato per questo project`.

## How it works

| Hook | Effect |
| ---- | ------ |
| `agent.create.before` | Blocks blacklisted `provider[/model]`; injects provider-native folder denies for other projects' paths |
| `agent.open.before` | Blocks resume of blacklisted agents (model is read from the saved agent); appends a system prompt forbidding protected folders |

Provider denies: **OpenCode** gets `read/edit/glob/grep/list` (plus
best-effort `bash`) denies; **Claude** gets `denyRead` entries;
**Codex** is forced to `workspace-write` rooted at the agent directory.

## Limits

- Folder denies are provider-native sandboxes, not OS-level isolation.
- `bash` escapes and already-running turns are best effort.
- Terminals carry no model and are not blocked.
- All data stays on the daemon host.

## Development

```bash
npm run typecheck
```

## Structure

| File | Content |
| ---- | ------- |
| `index.server.ts` | `agent.create.before` / `agent.open.before` hooks |
| `index.client.tsx` | Sidebar + settings screen registration |
| `shared/blacklist.ts` | Settings schema + matching logic |
| `server/blacklist.ts` | Project resolution, rule matching, folder-deny merge |
| `client/blacklist-settings.tsx` | Settings UI |
