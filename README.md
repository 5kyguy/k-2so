# K-2SO

Background task agent for your desktop. K-2SO is the brains — it plans, researches, and reports. Pair it with an MCP integration pack (like [R2-D2](https://github.com/5kyguy/r2-d2)) for local system tools.

**OpenCode is a prerequisite, not bundled.** Install and configure [OpenCode](https://opencode.ai) yourself (provider, auth, `~/.config/opencode/opencode.json`). K-2SO registers via sidecar files and never writes your OpenCode config.

## What it does

- Accept instructions via CLI (`k2so ask "..."`) over a Unix domain socket API
- Run tasks in the background through an OpenCode engine
- Stream progress to a local web dashboard — a persistent HTTP bridge at `http://127.0.0.1:7780` (run via `k2so dashboard`, or the `k2so-dashboard.service` companion unit under R2-D2); `k2so open` opens it in your browser
- Queue work with configurable concurrency limits; prune old workspaces with `k2so prune`
- Remember context across tasks via local memory files (`SOUL.md`, `USER.md`, `MEMORY.md`, skills)

## Requirements

- Node.js 20+
- [OpenCode](https://opencode.ai) installed and configured with your LLM provider
- An MCP server for platform-specific tools (optional for testing)

## Install

```bash
# 1. Install OpenCode and configure your provider (see docs/OPENCODE.md)
curl -fsSL https://opencode.ai/install | bash

# 2. Install K-2SO
npm install -g @5kyguy/k2so

# 3. Register K-2SO (markdown agent + memory seeds — no opencode.json edits)
k2so init

# 4. Run
k2so serve
k2so ask "Summarize what is in my Downloads folder"
```

Upgrading from the old `install.sh` model? Run `k2so init --migrate-opencode` to move the agent to `~/.config/opencode/agents/k2so.md` and remove the legacy `agent.k2so` block from your config.

Full guide: [`docs/INSTALL.md`](docs/INSTALL.md). Health check: `k2so doctor`. Remove: `k2so uninstall`.

## Memory

K-2SO is a companion that grows via local files in `~/.config/k2so/`:

- **Soul** — persona (`SOUL.md`)
- **User** — model of you (`USER.md`)
- **Memory** — long-term facts (`MEMORY.md`)
- **Skills** — reusable procedures (`skills/*.md`)

```bash
k2so memory show
k2so memory edit user
k2so open    # open the dashboard (127.0.0.1:7780) in your browser
```

Details: [`docs/MEMORY.md`](docs/MEMORY.md).

## Development

```bash
npm install
npm run build
node dist/cli.js init    # or: npm link && k2so init
k2so serve
```

## Configuration

Profile path defaults to `~/.config/k2so/profile.toml`. Override with `K2SO_PROFILE`.

See [`docs/OPENCODE.md`](docs/OPENCODE.md) and `templates/` for profile and agent templates.

## Changelog

See [`CHANGELOG.md`](CHANGELOG.md) or the [GitHub Releases](https://github.com/5kyguy/k-2so/releases) page.

## R2-D2 integration

[R2-D2](https://github.com/5kyguy/r2-d2) ships `r2d2-mcp`, Hyprland hotkeys, and voice ingress that call into K-2SO. K-2SO itself stays platform-agnostic.

## License

MIT
