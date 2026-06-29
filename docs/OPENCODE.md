# OpenCode setup for K-2SO

K-2SO delegates reasoning to [OpenCode](https://opencode.ai) via `opencode serve`. You configure providers and MCP tools in OpenCode — K-2SO only submits tasks.

**K-2SO never writes `~/.config/opencode/opencode.json`.** After you configure OpenCode yourself, run `k2so init` to register the `k2so` markdown agent at `~/.config/opencode/agents/k2so.md`.

## 1. Install OpenCode

```bash
curl -fsSL https://opencode.ai/install | bash
```

Ensure `opencode` is on your `PATH`.

## 2. Configure your provider

Create `~/.config/opencode/opencode.json` with your LLM provider. Example for Z.AI GLM Coding Plan:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "model": "zai-coding/glm-5.2",
  "provider": {
    "zai-coding": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Z.AI GLM Coding Plan",
      "options": {
        "baseURL": "https://api.z.ai/api/coding/paas/v4",
        "apiKey": "{file:~/.config/k2so/zai-api-key}"
      },
      "models": {
        "glm-5.2": { "name": "GLM-5.2" },
        "glm-4.5-air": { "name": "GLM-4.5-Air" }
      }
    }
  }
}
```

Set your Z.AI API key in `~/.config/k2so/zai-api-key` (raw value, one line, `chmod 600`). OpenCode reads it via `{file:...}` — no shell export needed.

## 3. Register K-2SO

```bash
k2so init
```

This writes the `k2so` markdown agent. Tool allowlists for `k2so-memory_*` live in that file's YAML frontmatter.

## 4. Register additional MCP servers

Add an `mcp` block to your `opencode.json` for tool servers you own (e.g. R2-D2's `r2d2` pack):

```jsonc
{
  "mcp": {
    "my-tools": {
      "type": "local",
      "command": ["node", "/path/to/your-mcp/dist/index.js"],
      "enabled": true
    }
  }
}
```

K-2SO's memory MCP (`k2so-memory`) is injected at spawn time via `OPENCODE_CONFIG_CONTENT` when you run `k2so serve` — it is not written into your config file.

## 5. K-2SO profile

`k2so init` seeds `~/.config/k2so/profile.toml` from the package template. Adjust ports or paths as needed.

## 6. Verify

```bash
k2so init
k2so doctor
k2so serve
k2so ask "say hello"
k2so status
```

## R2-D2 desktop

For Hyprland integration with `r2d2-mcp`, see the [R2-D2 K2SO guide](https://github.com/5kyguy/r2-d2/blob/main/docs/K2SO.md).