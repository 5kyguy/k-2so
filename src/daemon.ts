import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { getRequestListener } from "@hono/node-server";
import { loadProfile } from "./config.js";
import { OpenCodeEngine } from "./engine/opencode.js";
import { OpenCodeSupervisor } from "./engine/supervisor.js";
import { TaskManager } from "./tasks/manager.js";
import { BenchLogger } from "./bench.js";
import { createApi, webRoot } from "./api/routes.js";

export async function startDaemon(): Promise<void> {
  const profile = await loadProfile();
  await mkdir(profile.daemon.state, { recursive: true });

  const engine = new OpenCodeEngine(profile);
  const bench = new BenchLogger(profile.daemon.state);
  await bench.init();

  const manager = new TaskManager(profile, engine, bench);
  await manager.init();

  const supervisor = new OpenCodeSupervisor(profile, engine, manager);
  await supervisor.ensureReady();
  supervisor.start();

  const app = createApi(manager, webRoot(), profile);
  const listener = getRequestListener(app.fetch);
  const server = createServer(listener);
  const socketPath = profile.daemon.socket_path;

  await rm(socketPath, { force: true });
  await new Promise<void>((resolve, reject) => {
    server.listen(socketPath, () => resolve());
    server.on("error", reject);
  });
  await chmod(socketPath, 0o600);

  await writeFile(
    join(profile.daemon.state, "runtime.json"),
    JSON.stringify({ socketPath }, null, 2),
  );

  console.log(`k2so: listening on ${socketPath}`);

  const shutdown = async () => {
    console.log("k2so: shutting down…");
    supervisor.stop();
    await manager.shutdown();
    server.close();
    await rm(socketPath, { force: true }).catch(() => {});
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}
