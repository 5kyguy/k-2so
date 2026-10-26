import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Username OpenCode's v2 server expects for HTTP Basic auth. */
const AUTH_USER = "opencode";

export function serverPasswordPath(stateDir: string): string {
  return join(stateDir, "server-password");
}

/**
 * Read the persisted engine password, creating one on first use (mode 600).
 * The same password is passed to `opencode serve` via OPENCODE_SERVER_PASSWORD
 * by the supervisor, so daemon and dashboard always share it.
 */
export function ensureServerPassword(stateDir: string): string {
  const path = serverPasswordPath(stateDir);
  if (existsSync(path)) {
    const existing = readFileSync(path, "utf8").trim();
    if (existing) {
      return existing;
    }
  }
  const password = randomBytes(32).toString("base64url");
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(path, `${password}\n`, "utf8");
  chmodSync(path, 0o600);
  return password;
}

export function readServerPasswordSync(stateDir: string): string | undefined {
  try {
    return readFileSync(serverPasswordPath(stateDir), "utf8").trim() || undefined;
  } catch {
    return undefined;
  }
}

/** Authorization headers for the spawned OpenCode v2 server. */
export function opencodeHeaders(password?: string): Record<string, string> {
  if (!password) {
    return {};
  }
  const token = Buffer.from(`${AUTH_USER}:${password}`).toString("base64");
  return { authorization: `Basic ${token}` };
}
