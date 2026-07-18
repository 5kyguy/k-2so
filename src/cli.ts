#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { loadProfile } from "./config.js";
import { runDoctor, runInit, runUninstall } from "./init.js";
import { runMemoryCli } from "./memory/cli.js";
import { startDaemon } from "./daemon.js";
import { daemonFetch } from "./client.js";
import { dashboardUrl, servePersistent, startDashboardBridge } from "./dashboard-bridge.js";
import { packageRoot } from "./paths.js";
import type { TaskRecord } from "./engine/interface.js";
import type { BenchEntry } from "./bench.js";

const [, , command, ...args] = process.argv;

async function readVersion(): Promise<string> {
  try {
    const pkg = await readFile(join(packageRoot(), "package.json"), "utf8");
    return (JSON.parse(pkg).version as string | undefined) ?? "unknown";
  } catch {
    return "unknown";
  }
}

function parseAskArgs(argv: string[]): {
  taskType?: string;
  parentTaskId?: string;
  instruction: string;
} {
  let taskType: string | undefined;
  let parentTaskId: string | undefined;
  const rest: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--type" && argv[i + 1]) {
      taskType = argv[++i];
      continue;
    }
    if (argv[i] === "--continue" && argv[i + 1]) {
      parentTaskId = argv[++i];
      continue;
    }
    rest.push(argv[i]!);
  }

  return { taskType, parentTaskId, instruction: rest.join(" ").trim() };
}

async function main(): Promise<void> {
  switch (command) {
    case "serve":
      await startDaemon();
      break;
    case "ask": {
      const { taskType, parentTaskId, instruction } = parseAskArgs(args);
      if (!instruction) {
        console.error("usage: k2so ask [--type <id>] [--continue <task-id>] <instruction>");
        process.exit(1);
      }
      const res = await daemonFetch("/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction, taskType, parentTaskId }),
      });
      if (!res.ok) {
        const text = await res.text();
        console.error(`k2so: failed to submit task (${res.status}): ${text}`);
        process.exit(1);
      }
      const task = (await res.json()) as TaskRecord;
      console.log(`task ${task.id} queued`);
      break;
    }
    case "status": {
      const res = await daemonFetch("/tasks");
      if (!res.ok) {
        console.error("k2so: daemon not reachable — is k2so serve running?");
        process.exit(1);
      }
      const tasks = (await res.json()) as TaskRecord[];
      if (!tasks.length) {
        console.log("no tasks");
        break;
      }
      for (const task of tasks) {
        console.log(`${task.id.slice(0, 8)}  ${task.status.padEnd(8)}  ${task.instruction.slice(0, 60)}`);
      }
      break;
    }
    case "abort": {
      const taskId = args[0]?.trim();
      if (!taskId) {
        console.error("usage: k2so abort <task-id>");
        process.exit(1);
      }
      const res = await daemonFetch(`/tasks/${taskId}/abort`, { method: "POST" });
      if (!res.ok) {
        console.error("k2so: abort failed — task not found or not abortable");
        process.exit(1);
      }
      console.log(`task ${taskId.slice(0, 8)} aborted`);
      break;
    }
    case "dashboard":
      await servePersistent();
      break;
    case "open": {
      // Prefer the persistent dashboard service; only spin up the transient
      // bridge when nothing is listening at the configured HTTP port.
      const url = await dashboardUrl(args[0]?.trim() || undefined);
      const up = await fetch(url, { method: "HEAD" }).then(
        (r) => r.ok || r.status === 405, // some servers reject HEAD on "/"
        () => false,
      );
      if (up) {
        console.log(`k2so: dashboard ${url}`);
        spawn("xdg-open", [url], { stdio: "ignore", detached: true }).unref();
      } else {
        console.log("k2so: persistent dashboard down — starting transient bridge");
        await startDashboardBridge(args[0]?.trim() || undefined);
      }
      break;
    }
    case "open-task": {
      const taskId = args[0]?.trim();
      if (!taskId) {
        console.error("usage: k2so open-task <task-id>");
        process.exit(1);
      }
      const profile = await loadProfile();
      const workspace = join(profile.daemon.workspace, taskId);
      spawn("xdg-open", [workspace], { stdio: "ignore", detached: true }).unref();
      break;
    }
    case "prune": {
      const res = await daemonFetch("/admin/prune", { method: "POST" });
      if (!res.ok) {
        console.error("k2so: prune failed — is k2so serve running?");
        process.exit(1);
      }
      const result = (await res.json()) as { removed: number };
      console.log(`pruned ${result.removed} task(s)`);
      break;
    }
    case "init": {
      const force = args.includes("--force");
      const migrateOpencode = args.includes("--migrate-opencode");
      await runInit({ force, migrateOpencode });
      break;
    }
    case "doctor":
      await runDoctor();
      break;
    case "uninstall":
      await runUninstall();
      break;
    case "memory":
      await runMemoryCli(args);
      break;
    case "bench": {
      const profile = await loadProfile();
      const logPath = join(profile.daemon.state, "bench", "log.jsonl");
      try {
        const text = await readFile(logPath, "utf8");
        const lines = text.trim().split("\n").filter(Boolean).slice(-10);
        if (!lines.length) {
          console.log("no bench entries yet");
          break;
        }
        for (const line of lines) {
          const entry = JSON.parse(line) as BenchEntry;
          console.log(
            `${entry.recordedAt}  ${entry.taskId.slice(0, 8)}  ${entry.totalMs ?? "?"}ms  tools=${entry.toolCalls}`,
          );
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          console.log("no bench log at", logPath);
        } else {
          throw err;
        }
      }
      break;
    }
    default: {
      const version = await readVersion();
      console.log(`k2so — background desktop agent (v${version})

Prerequisite: install and configure OpenCode yourself, then run k2so init.

usage:
  k2so init [--force] [--migrate-opencode]
                                register K-2SO; --migrate-opencode removes legacy agent.k2so
  k2so doctor                   health check (non-mutating)
  k2so uninstall                remove K-2SO files (opencode.json untouched)
  k2so serve                    start daemon (Unix socket)
  k2so dashboard                run persistent HTTP dashboard (127.0.0.1:7780)
  k2so ask [--type <id>] [--continue <task-id>] <text>
                                submit a background task; --continue chains on a prior task's session
  k2so status                   list tasks
  k2so abort <task-id>          abort a queued or running task
  k2so open [task-id]           open dashboard in browser (uses persistent service, falls back to transient)
  k2so open-task <task-id>      open task workspace folder
  k2so prune                    remove old task workspaces
  k2so bench                    show recent benchmark entries
  k2so memory show|edit|reset   inspect and edit memory files
`);
      process.exit(command ? 1 : 0);
    }
  }
}

main().catch((err) => {
  const nodeErr = err as NodeJS.ErrnoException;
  if (nodeErr.code === "ENOENT" && nodeErr.syscall === "connect") {
    console.error("k2so: daemon not running — start with: k2so serve");
    console.error("      or: systemctl --user start k2so");
    process.exit(1);
  }
  console.error("k2so:", err);
  process.exit(1);
});
