import { spawn } from "node:child_process";
import { join } from "node:path";
import type { K2soProfile } from "./config.js";
import type { TaskRecord } from "./engine/interface.js";

function dashboardTaskUrl(profile: K2soProfile, taskId: string): string {
  return `http://${profile.dashboard.bind}:${profile.dashboard.port}/?task=${encodeURIComponent(taskId)}`;
}

export function notifyTaskDone(profile: K2soProfile, task: TaskRecord): void {
  if (!profile.notify?.enabled) {
    return;
  }

  const cmd = profile.notify.command ?? "notify-send";
  const title = "K-2SO";
  const workspace = join(profile.daemon.workspace, task.id);
  const summary = task.instruction.slice(0, task.status === "done" ? 80 : 60);
  const dashUrl = dashboardTaskUrl(profile, task.id);

  let body: string;
  if (task.status === "done") {
    const preview = task.response?.trim().replace(/\s+/g, " ").slice(0, 100);
    body = preview
      ? `Done: ${summary}\n${preview}${task.response!.trim().length > 100 ? "…" : ""}\n${dashUrl}`
      : `Task done: ${summary}\n${dashUrl}\n${workspace}`;
  } else {
    body = `Task ${task.status}: ${summary}\n${workspace}`;
  }

  spawn(cmd, [title, body, "-t", "8000"], { stdio: "ignore", detached: true }).unref();
}
