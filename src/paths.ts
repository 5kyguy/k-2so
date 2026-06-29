import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function expandHome(path: string): string {
  if (path.startsWith("~/")) {
    return join(homedir(), path.slice(2));
  }
  return path;
}

/** Root of the installed k2so npm package (parent of dist/). */
export function packageRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..");
}

export function templatesDir(): string {
  return join(packageRoot(), "templates");
}

export function memoryMcpEntry(): string {
  return join(packageRoot(), "mcp", "memory", "dist", "index.js");
}

export const paths = {
  opencodeConfig: () => join(homedir(), ".config", "opencode", "opencode.json"),
  opencodeAgentsDir: () => join(homedir(), ".config", "opencode", "agents"),
  k2soAgentMd: () => join(homedir(), ".config", "opencode", "agents", "k2so.md"),
  k2soConfigDir: () => join(homedir(), ".config", "k2so"),
  k2soProfile: () => join(homedir(), ".config", "k2so", "profile.toml"),
  k2soSoul: () => join(homedir(), ".config", "k2so", "SOUL.md"),
  k2soUser: () => join(homedir(), ".config", "k2so", "USER.md"),
  k2soMemory: () => join(homedir(), ".config", "k2so", "MEMORY.md"),
  k2soSkillsDir: () => join(homedir(), ".config", "k2so", "skills"),
  k2soState: () => join(homedir(), ".local", "state", "k2so"),
  k2soWorkspace: () => join(homedir(), ".local", "share", "k2so", "workspace"),
  k2soShare: () => join(homedir(), ".local", "share", "k2so"),
};