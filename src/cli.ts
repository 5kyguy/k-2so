#!/usr/bin/env node

import { spawn } from "node:child_process";
import { loadProfile } from "./config.js";
import { startDaemon } from "./daemon.js";
import type { TaskRecord } from "./engine/interface.js";

const [, , command, ...args] = process.argv;

async function main(): Promise<void> {
  switch (command) {
    case "serve":
      await startDaemon();
      break;
    case "ask": {
      const instruction = args.join(" ").trim();
      if (!instruction) {
        console.error("usage: k2so ask <instruction>");
        process.exit(1);
      }
      const profile = await loadProfile();
      const host = profile.daemon.host ?? "127.0.0.1";
      const port = profile.daemon.port;
      const res = await fetch(`http://${host}:${port}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction }),
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
      const profile = await loadProfile();
      const host = profile.daemon.host ?? "127.0.0.1";
      const port = profile.daemon.port;
      const res = await fetch(`http://${host}:${port}/tasks`);
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
    case "open": {
      const profile = await loadProfile();
      const host = profile.daemon.host ?? "127.0.0.1";
      const port = profile.daemon.port;
      const url = `http://${host}:${port}`;
      spawn("xdg-open", [url], { stdio: "ignore", detached: true }).unref();
      break;
    }
    default:
      console.log(`k2so — background desktop agent

usage:
  k2so serve          start daemon and dashboard
  k2so ask <text>     submit a background task
  k2so status         list tasks
  k2so open           open dashboard in browser
`);
      process.exit(command ? 1 : 0);
  }
}

main().catch((err) => {
  console.error("k2so:", err);
  process.exit(1);
});
