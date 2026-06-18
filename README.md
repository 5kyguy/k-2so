# K-2SO

Background task agent for your desktop. K-2SO is the brains — it plans, researches, and reports. Pair it with an MCP integration pack (like [R2-D2](https://github.com/5kyguy/r2-d2)) for local system tools.

## What it does

- Accept instructions via CLI (`k2so ask "..."`) over a Unix domain socket API
- Run tasks in the background through an [OpenCode](https://opencode.ai) engine
- Stream progress to a local web dashboard (`k2so open` starts a short-lived HTTP bridge)
- Queue work with configurable concurrency limits; prune old workspaces with `k2so prune`

## Requirements

- Node.js 20+
- [OpenCode](https://opencode.ai) installed and configured with your LLM provider
- An MCP server for platform-specific tools (optional for testing)

## Quick start

```bash
npm install
npm run build

# Start the daemon (expects opencode serve on :4096, or set in profile)
k2so serve

# In another terminal
k2so ask "Summarize what is in my Downloads folder"
k2so status
k2so open   # opens the dashboard
```

## Configuration

Profile path defaults to `~/.config/k2so/profile.toml`. Override with `K2SO_PROFILE`.

See [`docs/OPENCODE.md`](docs/OPENCODE.md) and `templates/` for OpenCode and profile setup.

## R2-D2 integration

[R2-D2](https://github.com/5kyguy/r2-d2) ships `r2d2-mcp`, Hyprland hotkeys, and voice ingress that call into K-2SO. K-2SO itself stays platform-agnostic.

## License

MIT
