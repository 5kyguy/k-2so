# Changelog

All notable changes to **@5kyguy/k2so** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

GitHub Releases for each version are published from the matching section below;
see the [Releases page](https://github.com/5kyguy/k-2so/releases).

## [0.1.7] - 2026-10-26

### Fixed

- **Actionable error for unregistered agents.** OpenCode v2 accepts an unknown
  agent name when creating a session but then silently never delivers the
  prompt (it stays queued in the session inbox). Tasks that end with no
  assistant response now check the inbox and report:
  `prompt was queued but never delivered — agent 'k2so' is not registered with
  OpenCode (run: k2so init)` instead of a generic "no assistant text" error.

## [0.1.6] - 2026-10-26

### Fixed

- **OpenCode v2 engine support.** OpenCode v2 replaced the v1 server API, which
  silently broke task submission (the engine talked to v1 endpoints that no
  longer exist; tasks failed with `session.create` errors). The engine now uses
  `@opencode/client` against the v2 HTTP API: sessions are created per task
  workspace, prompts complete via `session.wait`, responses are read from the
  v2 message log, aborts use `session.interrupt`, and live timeline events map
  from the v2 event stream. The supervisor pins the spawned server's password
  via `OPENCODE_SERVER_PASSWORD` (persisted at `~/.local/state/k2so/server-password`,
  mode 600) and authenticates with HTTP Basic auth, so the daemon and dashboard
  share one credential. `k2so doctor` now requires OpenCode v2+.

## [0.1.5] - 2026-10-26

### Added

- **Notification actions.** Done-task `notify-send` notifications include **Open
  result** (`k2so open <id>`) and **Open folder** (`k2so open-task <id>`)
  buttons when using the default notify-send command (mako shows them as
  actions). App-name is `k2so`.

### Fixed

- **Failed prompts no longer show as done.** The OpenCode SDK resolves instead of
  throwing on HTTP errors, so a rejected `session.prompt` (e.g. the `k2so` agent
  missing from `~/.config/opencode/agents/`, or an unknown model) was reported as
  a **done** task with no response. K-2SO now checks the SDK result of
  `session.create`, `session.prompt`, and `session.messages`: a rejected prompt
  marks the task **failed** with the server's error message, and a run that
  finishes without assistant text fails loudly instead of showing an empty
  result. `k2so doctor` already flags a missing `agents/k2so.md`.

- **OpenCode event stream reconnect.** The live Activity SSE now retries with
  backoff when OpenCode is down or the stream drops, instead of dying once on
  cold-start `ECONNREFUSED`. Daemon startup also brings OpenCode up before
  subscribing to `/event`, so the first connect usually succeeds quietly.

## [0.1.3] - 2026-07-19

### Added

- **Task response presentation.** When a task completes, K-2SO captures the final
  assistant text onto the task record, writes `workspace/<id>/response.md`, and
  surfaces it in the CLI and dashboard.
  - New `k2so show <task-id>` prints status and response; if nothing is stored
    yet, it fetches the OpenCode session transcript on the fly (covers older
    done tasks).
  - Dashboard **Result** panel renders the response as markdown (headings, lists,
    tables, code, links). Deep-link with `/?task=<id>` or `k2so open <id>`.
  - `GET /tasks/:id/response` returns the stored answer or falls back to OpenCode.
  - Completion notifications (when enabled) include a short preview and a
    dashboard deep link.

### Fixed

- Live activity SSE now resolves `sessionID` from the message part when OpenCode
  omits it on the event properties — tool/message timeline events record again.

## [0.1.2] - 2026-07-18

### Added

- **Persistent HTTP dashboard service.** The dashboard now runs as a long-lived
  companion at `http://127.0.0.1:7780` instead of a transient bridge that exits
  after 5 minutes idle — bookmark it, leave the tab open, no terminal required.
  - New `[dashboard]` profile section (`enabled`, `bind`, `port`) in
    `profile.toml`; defaults to loopback `127.0.0.1:7780`, opt-out via
    `enabled = false`.
  - New `k2so dashboard` subcommand runs the persistent bridge (foreground; used
    by the `k2so-dashboard.service` companion unit under R2-D2).
  - `k2so open` now opens the persistent URL in a browser, falling back to the
    transient bridge only when the persistent service is down.
  - Version now shown in the `k2so` help banner (`k2so — background desktop agent (v0.1.2)`).

### Changed

- The core `k2so serve` daemon stays Unix-socket-only; the dashboard companion
  is the sole TCP listener, bound to loopback.

## [0.1.1] - 2026-07-18

### Added

- Improved task-event visibility in the web dashboard (richer streaming progress
  and dashboard surface).

## [0.1.0] - 2026-07-01

### Added

- Initial public release on npm.
- **Background task agent.** Accept instructions via `k2so ask "..."` over a
  Unix domain socket API; run tasks in the background through an OpenCode engine.
- **Web dashboard.** Stream task progress to a local HTTP bridge
  (`k2so open`).
- **Daemon.** Unix-socket daemon (`k2so serve`) with an OpenCode supervisor that
  keeps the engine alive; no long-lived TCP listener for task submission.
- **CLI surface:** `init`, `doctor`, `uninstall`, `serve`, `ask`, `status`,
  `abort`, `open`, `open-task`, `prune`, `bench`.
- **Memory layer.** Persona (`SOUL.md`), user model (`USER.md`), long-term facts
  (`MEMORY.md`), and skills (`skills/*.md`), injected into prompts; post-task
  reflection writes back to memory. Includes a `k2so-memory` MCP server for
  runtime memory writes and `k2so memory show|edit|reset` for inspection.
- **Task lifecycle.** Queue with configurable concurrency limits, retention
  pruning (`k2so prune`), and completion notifications via profile config.
- **Session chaining.** `k2so ask --continue <task-id>` chains on a prior task's
  session.

[0.1.7]: https://github.com/5kyguy/k-2so/releases/tag/v0.1.7
[0.1.6]: https://github.com/5kyguy/k-2so/releases/tag/v0.1.6
[0.1.5]: https://github.com/5kyguy/k-2so/releases/tag/v0.1.5
[0.1.3]: https://github.com/5kyguy/k-2so/releases/tag/v0.1.3
[0.1.2]: https://github.com/5kyguy/k-2so/releases/tag/v0.1.2
[0.1.1]: https://github.com/5kyguy/k-2so/releases/tag/v0.1.1
[0.1.0]: https://github.com/5kyguy/k-2so/releases/tag/v0.1.0
