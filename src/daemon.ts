import { spawn } from "node:child_process";
import { serve } from "@hono/node-server";
import { loadProfile } from "./config.js";
import { OpenCodeEngine } from "./engine/opencode.js";
import { TaskManager } from "./tasks/manager.js";
import { BenchLogger } from "./bench.js";
import { createApi, webRoot } from "./api/routes.js";

let opencodeChild: ReturnType<typeof spawn> | undefined;

async function ensureOpencode(profile: Awaited<ReturnType<typeof loadProfile>>): Promise<void> {
  const engine = new OpenCodeEngine(profile);
  if (await engine.isReady()) {
    return;
  }

  console.log("k2so: starting opencode serve…");
  opencodeChild = spawn("opencode", ["serve", "--port", "4096", "--hostname", "127.0.0.1"], {
    stdio: "inherit",
    env: process.env,
  });

  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await engine.isReady()) {
      console.log("k2so: opencode ready");
      return;
    }
  }

  throw new Error("opencode serve did not become ready within 15s");
}

export async function startDaemon(): Promise<void> {
  const profile = await loadProfile();
  await ensureOpencode(profile);

  const engine = new OpenCodeEngine(profile);
  const manager = new TaskManager(profile, engine);
  await manager.init();

  const bench = new BenchLogger(profile.daemon.state);
  await bench.init();

  const app = createApi(manager, webRoot());
  const host = profile.daemon.host ?? "127.0.0.1";
  const port = profile.daemon.port;

  const server = serve({ fetch: app.fetch, hostname: host, port }, () => {
    console.log(`k2so: dashboard http://${host}:${port}`);
  });

  const shutdown = async () => {
    console.log("k2so: shutting down…");
    await manager.shutdown();
    server.close();
    opencodeChild?.kill("SIGTERM");
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}
