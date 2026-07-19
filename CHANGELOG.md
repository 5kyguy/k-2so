# Changelog

All notable changes to **@5kyguy/k2so** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

GitHub Releases for each version are published from the matching section below;
see the [Releases page](https://github.com/5kyguy/k-2so/releases).

## [Unreleased]

### Added

- **Notification actions.** Done-task `notify-send` notifications include **Open
  result** (`k2so open <id>`) and **Open folder** (`k2so open-task <id>`)
  buttons when using the default notify-send command (mako shows them as
  actions). App-name is `k2so`.

### Fixed

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

[0.1.3]: https://github.com/5kyguy/k-2so/releases/tag/v0.1.3
[0.1.2]: https://github.com/5kyguy/k-2so/releases/tag/v0.1.2
[0.1.1]: https://github.com/5kyguy/k-2so/releases/tag/v0.1.1
[0.1.0]: https://github.com/5kyguy/k-2so/releases/tag/v0.1.0
