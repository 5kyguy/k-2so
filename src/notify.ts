import { spawn } from "node:child_process";
import type { K2soProfile } from "./config.js";
import type { TaskRecord } from "./engine/interface.js";

export function notifyTaskDone(profile: K2soProfile, task: TaskRecord): void {
  if (!profile.notify?.enabled) {
    return;
  }

  const cmd = profile.notify.command ?? "notify-send";
  const title = "K-2SO";
  const body =
    task.status === "done"
      ? `Task done: ${task.instruction.slice(0, 80)}`
      : `Task ${task.status}: ${task.instruction.slice(0, 60)}`;

  spawn(cmd, [title, body, "-t", "8000"], { stdio: "ignore", detached: true }).unref();
}
