import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { spawn } from "node:child_process";
import { loadProfile } from "./config.js";
import { resolveSocketPath, socketRequest } from "./client.js";

const IDLE_MS = 5 * 60 * 1000;

async function forward(req: IncomingMessage, res: ServerResponse, socketPath: string): Promise<void> {
  const url = req.url ?? "/";
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined || key === "host") {
      continue;
    }
    headers[key] = Array.isArray(value) ? value.join(", ") : value;
  }

  const body =
    req.method === "GET" || req.method === "HEAD"
      ? undefined
      : await new Promise<Buffer>((resolve, reject) => {
          const chunks: Buffer[] = [];
          req.on("data", (chunk: Buffer) => chunks.push(chunk));
          req.on("end", () => resolve(Buffer.concat(chunks)));
          req.on("error", reject);
        });

  const upstream = await socketRequest(socketPath, url, {
    method: req.method,
    headers,
    body,
  });

  res.statusCode = upstream.status;
  for (const [key, value] of Object.entries(upstream.headers)) {
    if (value === undefined || key.toLowerCase() === "transfer-encoding") {
      continue;
    }
    res.setHeader(key, value);
  }
  res.end(upstream.body);
}

/** Stable URL of the persistent dashboard (from [dashboard] profile config). */
export async function dashboardUrl(taskId?: string): Promise<string> {
  const profile = await loadProfile();
  const base = `http://${profile.dashboard.bind}:${profile.dashboard.port}`;
  return taskId?.trim() ? `${base}/?task=${encodeURIComponent(taskId.trim())}` : base;
}

function makeProxy(socketPath: string, onRequest: (req: IncomingMessage, res: ServerResponse) => void) {
  return createServer((req, res) => {
    onRequest(req, res);
    void forward(req, res, socketPath).catch((err) => {
      console.error("k2so: bridge forward error:", err);
      if (!res.headersSent) {
        res.statusCode = 502;
      }
      res.end();
    });
  });
}

/** On-demand transient bridge: random port, opens a browser, exits after IDLE_MS idle. */
export async function startDashboardBridge(taskId?: string): Promise<void> {
  const socketPath = await resolveSocketPath();
  let idleTimer: NodeJS.Timeout | undefined;

  const resetIdle = () => {
    if (idleTimer) {
      clearTimeout(idleTimer);
    }
    idleTimer = setTimeout(() => {
      console.log("k2so: dashboard bridge idle timeout — exiting");
      server.close();
      process.exit(0);
    }, IDLE_MS);
  };

  const server = makeProxy(socketPath, () => resetIdle());

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("dashboard bridge failed to bind");
  }

  const base = `http://127.0.0.1:${address.port}`;
  const url = taskId?.trim() ? `${base}/?task=${encodeURIComponent(taskId.trim())}` : base;
  console.log(`k2so: dashboard bridge ${url} (closes after ${IDLE_MS / 1000}s idle)`);
  spawn("xdg-open", [url], { stdio: "ignore", detached: true }).unref();
  resetIdle();
}

/**
 * Persistent dashboard: binds the fixed [dashboard] bind:port forever, no idle
 * timeout, no browser launch. Intended to run under k2so-dashboard.service.
 */
export async function servePersistent(): Promise<void> {
  const profile = await loadProfile();
  if (!profile.dashboard.enabled) {
    console.error("k2so: dashboard disabled in profile ([dashboard].enabled = false)");
    process.exit(0);
  }

  const socketPath = await resolveSocketPath();
  const server = makeProxy(socketPath, () => {});

  await new Promise<void>((resolve, reject) => {
    server.listen(profile.dashboard.port, profile.dashboard.bind, () => resolve());
    server.on("error", reject);
  });

  const url = await dashboardUrl();
  console.log(`k2so: dashboard listening on ${url} (persistent)`);

  const shutdown = () => {
    console.log("k2so: dashboard shutting down…");
    server.close(() => process.exit(0));
    // Don't hang forever if a connection won't drain.
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
