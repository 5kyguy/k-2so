# K-2SO memory model

K-2SO grows as a companion via local markdown files under `~/.config/k2so/` (or `memory.dir` in `profile.toml`). Nothing is synced to the cloud.

## Files

| File | Purpose |
| ---- | ------- |
| `SOUL.md` | Persona and voice. Seeded once, evolves rarely. `soul_refine` appends to `## Proposed` for manual review. |
| `USER.md` | Model of you — stack, preferences, patterns. Grows via `user_profile_update` and the reflection loop. |
| `MEMORY.md` | Long-term facts in sections (`## Projects`, `## Preferences`, `## Corrections`, …). Appended via `memory_append` and reflection. |
| `skills/*.md` | Procedural memory (`agentskills.io` frontmatter). Created/improved via `skill_create`. |

## Seeding

`k2so init` copies templates from the npm package when files are absent. Existing files are never overwritten.

```bash
k2so init
k2so init --force              # overwrite agents/k2so.md only
k2so init --migrate-opencode   # also remove legacy agent.k2so from opencode.json
```

### Legacy installs

If you installed K-2SO before the markdown-agent model, `opencode.json` may still contain an `agent.k2so` block. `k2so init` detects this and prompts to remove it (or pass `--migrate-opencode`). Only that block is removed — your providers and other MCP servers are untouched.

## Runtime injection

Each task prompt is assembled server-side (`src/memory/assemble.ts`) with live contents of Soul, User, Memory, and the skills catalog. The static body in `~/.config/opencode/agents/k2so.md` remains the OpenCode agent baseline.

## MCP write tools

Registered at spawn time as `k2so-memory_*` (see `src/engine/supervisor.ts`):

- `memory_append(section, content)`
- `user_profile_update(learning)`
- `soul_refine(delta)`
- `skill_create(name, body, trigger, force?)`
- `skill_list()`
- `skill_read(name)`

All writes are sandboxed to the memory directory.

## Reflection loop

After qualifying tasks (`memory.reflect = true`, default task type `background`, at least one assistant message), K-2SO runs a sidecar LLM call (`memory.reflect_model`, default `glm-4.5-air`) to propose conservative updates to `USER.md` and `MEMORY.md`, and optionally new skills.

When a reflection pass adds to `USER.md` and the `## Learned` bullet count exceeds `memory.compact_user_threshold` (default `20`), a compaction pass runs the same model to consolidate duplicates and contradictions, then replaces the section. Disable by setting `compact_user_threshold = 0`. The before/after counts are recorded in the audit log.

Reflection is rate-limited by `memory.reflect_min_interval_ms` (default `300000`, i.e. 5 minutes). A qualifying task that fires within the cooldown is skipped — set to `0` to reflect after every qualifying task.

Audit log: `~/.local/state/k2so/reflection.jsonl`

Reflection errors are logged and dropped — they never affect task results.

Configure in `profile.toml`:

```toml
[memory]
enabled = true
dir = "~/.config/k2so"
reflect = true
reflect_model = "zai-coding/glm-4.5-air"
reflect_on_task_types = ["background"]
compact_user_threshold = 20
reflect_min_interval_ms = 300000
```

## CLI

```bash
k2so memory show [--soul|--user|--memory|--skills]
k2so memory edit <soul|user|memory|skills>
k2so memory reset <soul|user|memory|skills> --confirm
```

## Dashboard

`k2so open` → **Memory** tab (read-only, click to expand raw files) and **Reflection** tab (audit log).

## Editing policy

- `MEMORY.md` / `USER.md`: append-only during tasks; `USER.md`'s `## Learned` section is auto-compacted by reflection when it crosses `compact_user_threshold`.
- `SOUL.md` canonical body: edit directly or approve `## Proposed` entries.
- Skills: versioned; `skill_create(..., force: true)` archives the previous file to `skills/.archive/`.
