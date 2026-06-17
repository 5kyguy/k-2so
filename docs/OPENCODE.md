# OpenCode setup for K-2SO

K-2SO delegates reasoning to [OpenCode](https://opencode.ai) via `opencode serve`. You configure providers, agents, and MCP tools in OpenCode — K-2SO only submits tasks.

## 1. Install OpenCode

```bash
curl -fsSL https://opencode.ai/install | bash
```

Ensure `opencode` is on your `PATH`.

## 2. Copy the template config

```bash
mkdir -p ~/.config/opencode
cp templates/opencode.json ~/.config/opencode/opencode.json
```

Edit the file to add your LLM provider. Example for Z.AI GLM Coding Plan:

```jsonc
{
  "provider": {
    "zai-coding": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Z.AI GLM Coding Plan",
      "options": {
        "baseURL": "https://api.z.ai/api/coding/paas/v4",
        "apiKey": "{env:ZAI_API_KEY}"
      },
      "models": {
        "glm-5.2": { "name": "GLM-5.2" },
        "glm-4.5-air": { "name": "GLM-4.5-Air" }
      }
    }
  },
  "model": "zai-coding/glm-5.2"
}
```

Set `ZAI_API_KEY` in your environment or shell profile.

## 3. Register MCP servers

Add an `mcp` block to `opencode.json` for each tool server:

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

OpenCode exposes tools as `my-tools_<tool_name>`. Restrict which tools an agent may call:

```jsonc
{
  "agent": {
    "k2so": {
      "mode": "primary",
      "prompt": "You are K-2SO…",
      "tools": {
        "my-tools_*": true
      }
    }
  }
}
```

## 4. K-2SO profile

Copy `templates/profile.toml` to `~/.config/k2so/profile.toml` and adjust ports or paths.

## 5. Verify

```bash
opencode serve --port 4096 &
k2so serve
k2so ask "say hello"
k2so status
```

## R2-D2 desktop

For Hyprland integration with `r2d2-mcp`, see the [R2-D2 K2SO guide](https://github.com/5kyguy/r2-d2/blob/main/docs/K2SO.md).
