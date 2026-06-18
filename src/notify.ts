import { spawn } from "node:child_process";
import { join } from "node:path";
import type { K2soProfile } from "./config.js";
import type { TaskRecord } from "./engine/interface.js";

export function notifyTaskDone(profile: K2soProfile, task: TaskRecord): void {
  if (!profile.notify?.enabled) {
    return;
  }

  const cmd = profile.notify.command ?? "notify-send";
  const title = "K-2SO";
  const workspace = join(profile.daemon.workspace, task.id);
  const summary = task.instruction.slice(0, task.status === "done" ? 80 : 60);
  const body =
    task.status === "done"
      ? `Task done: ${summary} — ${workspace}`
      : `Task ${task.status}: ${summary} — ${workspace}`;

  spawn(cmd, [title, body, "-t", "8000"], { stdio: "ignore", detached: true }).unref();
}
