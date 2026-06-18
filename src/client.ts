import { readFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { join } from "node:path";
import { loadProfile } from "./config.js";

const VIRTUAL_HOST = "k2so.local";

export interface SocketResponse {
  ok: boolean;
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export async function resolveSocketPath(): Promise<string> {
  const profile = await loadProfile();
  const runtimePath = join(profile.daemon.state, "runtime.json");
  try {
    const raw = JSON.parse(await readFile(runtimePath, "utf8")) as { socketPath?: string };
    if (raw.socketPath) {
      return raw.socketPath;
    }
  } catch {
    // fall through to profile default
  }
  return profile.daemon.socket_path;
}

function socketRequest(
  socketPath: string,
  path: string,
  init: { method?: string; headers?: Record<string, string>; body?: string | Buffer } = {},
): Promise<SocketResponse> {
  return new Promise((resolve, reject) => {
    const body = init.body;
    const headers = { ...(init.headers ?? {}) };
    if (body && !headers["Content-Length"]) {
      headers["Content-Length"] = String(Buffer.byteLength(body));
    }

    const req = httpRequest(
      {
        socketPath,
        path,
        method: init.method ?? "GET",
        headers: {
          Host: VIRTUAL_HOST,
          ...headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const buffer = Buffer.concat(chunks);
          const status = res.statusCode ?? 500;
          resolve({
            ok: status >= 200 && status < 300,
            status,
            headers: res.headers,
            body: buffer,
            json: async () => JSON.parse(buffer.toString("utf8")),
            text: async () => buffer.toString("utf8"),
          });
        });
      },
    );

    req.on("error", reject);
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

export async function daemonFetch(
  path: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
): Promise<SocketResponse> {
  const socketPath = await resolveSocketPath();
  return socketRequest(socketPath, path.startsWith("/") ? path : `/${path}`, init);
}

export { socketRequest };
