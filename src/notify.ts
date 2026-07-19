import { spawn } from "node:child_process";
import { join } from "node:path";
import type { K2soProfile } from "./config.js";
import type { TaskRecord } from "./engine/interface.js";

function dashboardTaskUrl(profile: K2soProfile, taskId: string): string {
  return `http://${profile.dashboard.bind}:${profile.dashboard.port}/?task=${encodeURIComponent(taskId)}`;
}

function isNotifySend(command: string): boolean {
  return command === "notify-send" || command.endsWith("/notify-send");
}

function runAction(action: string, taskId: string): void {
  if (action === "open") {
    spawn("k2so", ["open", taskId], { stdio: "ignore", detached: true }).unref();
    return;
  }
  if (action === "folder") {
    spawn("k2so", ["open-task", taskId], { stdio: "ignore", detached: true }).unref();
  }
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
      ? `Done: ${summary}\n${preview}${task.response!.trim().length > 100 ? "…" : ""}`
      : `Task done: ${summary}`;
  } else {
    body = `Task ${task.status}: ${summary}\n${workspace}`;
  }

  // notify-send -A implies --wait and prints the action id on stdout (mako shows buttons).
  if (isNotifySend(cmd) && task.status === "done") {
    const args = [
      "-a",
      "k2so",
      "-t",
      "12000",
      "-A",
      "open=Open result",
      "-A",
      "folder=Open folder",
      title,
      body,
    ];
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "ignore"] });
    let handled = false;
    child.stdout?.on("data", (buf: Buffer) => {
      if (handled) {
        return;
      }
      const action = buf.toString().trim();
      if (!action) {
        return;
      }
      handled = true;
      runAction(action, task.id);
    });
    child.on("error", () => {});
    child.unref();
    return;
  }

  // Custom notify command, or non-done status: plain fire-and-forget.
  if (task.status === "done") {
    body = `${body}\n${dashUrl}`;
  }
  spawn(cmd, [title, body, "-t", "8000"], { stdio: "ignore", detached: true }).unref();
}
