import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { spawn } from "node:child_process";
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

export async function startDashboardBridge(): Promise<void> {
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

  const server = createServer((req, res) => {
    resetIdle();
    void forward(req, res, socketPath).catch((err) => {
      console.error("k2so: bridge forward error:", err);
      if (!res.headersSent) {
        res.statusCode = 502;
      }
      res.end();
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("dashboard bridge failed to bind");
  }

  const url = `http://127.0.0.1:${address.port}`;
  console.log(`k2so: dashboard bridge ${url} (closes after ${IDLE_MS / 1000}s idle)`);
  spawn("xdg-open", [url], { stdio: "ignore", detached: true }).unref();
  resetIdle();
}
