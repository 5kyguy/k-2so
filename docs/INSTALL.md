# Installing K-2SO

K-2SO is a background desktop agent that runs tasks through [OpenCode](https://opencode.ai). **OpenCode is a prerequisite** — K-2SO does not install or configure it for you.

## 1. Install and configure OpenCode

Install OpenCode yourself:

```bash
curl -fsSL https://opencode.ai/install | bash
```

Create `~/.config/opencode/opencode.json` with your LLM provider and run OpenCode's auth/setup flow. That file is **yours** — K-2SO never writes to it.

See [`OPENCODE.md`](OPENCODE.md) for provider examples.

## 2. Install K-2SO

```bash
npm install -g @5kyguy/k2so
```

From a local checkout:

```bash
cd k-2so
npm ci && npm run build
npm install -g .
```

## 3. Register K-2SO

```bash
k2so init
```

This is idempotent. It:

- Writes `~/.config/opencode/agents/k2so.md` (markdown agent — no `opencode.json` edits)
- Seeds `~/.config/k2so/profile.toml`, `SOUL.md`, `USER.md`, `MEMORY.md`, and `skills/` if absent
- Requires `opencode` on `PATH` and an existing `opencode.json`

Pass `--force` to overwrite an existing `k2so.md` agent file.

### Upgrading from `install.sh`

If `~/.config/opencode/opencode.json` still has an `agent.k2so` block from the old installer:

```bash
k2so init --migrate-opencode
```

This removes only `agent.k2so` — providers and other MCP servers are untouched. In an interactive terminal, `k2so init` prompts instead.

## 4. Run

```bash
k2so serve          # start daemon (spawns opencode serve with memory MCP overlay)
k2so ask "hello"    # submit a task
k2so status         # list tasks
k2so show <id>      # print the task response (fetches OpenCode if not stored yet)
k2so open           # dashboard — Result panel shows the answer; ?task=<id> deep-links
```

When a task completes, K-2SO stores the final assistant text on the task (`response`), writes `response.md` in the task workspace, and shows it in the dashboard Result panel (rendered as markdown). Notifications (when enabled) include a short preview and a dashboard deep link. Older done tasks without a stored response are fetched from the OpenCode session when you open them in the dashboard or run `k2so show`.

## Health check

```bash
k2so doctor
```

Non-mutating status table: OpenCode on PATH, `opencode.json` present, agent file, profile, memory files, memory MCP bundle.

## Uninstall

```bash
k2so uninstall
```

Removes:

- `~/.config/opencode/agents/k2so.md`
- `~/.config/k2so/`
- `~/.local/state/k2so/`
- `~/.local/share/k2so/`

Does **not** remove `opencode.json`, OpenCode, or your other agents/providers/MCP servers.

## Memory

```bash
k2so memory show
k2so memory edit soul
k2so memory reset memory --confirm
```

See [`MEMORY.md`](MEMORY.md) for the full memory model, reflection loop, and MCP tools.

## R2-D2 desktop

For Hyprland hotkeys and `r2d2-mcp`, see [R2-D2 K2SO guide](https://github.com/5kyguy/r2-d2/blob/main/docs/K2SO.md).
