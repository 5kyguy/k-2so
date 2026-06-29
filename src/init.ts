import { spawn } from "node:child_process";
import { access, copyFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { loadProfile } from "./config.js";
import { resolveMemoryPaths } from "./memory/paths.js";
import { memoryMcpEntry, paths, templatesDir } from "./paths.js";

import {
  hasLegacyK2soAgent,
  promptLegacyMigration,
  removeLegacyK2soAgent,
} from "./init-migrate.js";

export interface InitOptions {
  force?: boolean;
  migrateOpencode?: boolean;
}

type CheckStatus = "ok" | "warn" | "fail";

interface DoctorCheck {
  label: string;
  status: CheckStatus;
  detail: string;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function parseNodeMajor(version: string): number {
  const match = /^v(\d+)/.exec(version);
  return match ? Number(match[1]) : 0;
}

async function commandOnPath(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("sh", ["-c", `command -v ${command}`], { stdio: "ignore" });
    child.on("close", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));
  });
}

async function seedFile(dest: string, templateRel: string, force: boolean): Promise<"created" | "skipped" | "overwritten"> {
  const template = join(templatesDir(), templateRel);
  if (await exists(dest)) {
    if (!force) {
      return "skipped";
    }
    await copyFile(template, dest);
    return "overwritten";
  }
  await mkdir(dirnameFor(dest), { recursive: true });
  await copyFile(template, dest);
  return "created";
}

function dirnameFor(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx >= 0 ? path.slice(0, idx) : ".";
}

async function writeAgentMd(force: boolean): Promise<"created" | "skipped" | "overwritten"> {
  const dest = paths.k2soAgentMd();
  const template = join(templatesDir(), "agents", "k2so.md");
  await mkdir(paths.opencodeAgentsDir(), { recursive: true });
  return seedFile(dest, "agents/k2so.md", force);
}

async function seedSkillsDir(dir: string): Promise<"created" | "skipped"> {
  if (await exists(dir)) {
    return "skipped";
  }
  await mkdir(dir, { recursive: true });
  return "created";
}

export async function runInit(options: InitOptions = {}): Promise<void> {
  const force = options.force ?? false;

  if (parseNodeMajor(process.version) < 20) {
    console.error(`k2so init: Node.js 20+ required (found ${process.version})`);
    process.exit(1);
  }

  if (!(await commandOnPath("npm"))) {
    console.error("k2so init: npm is required on PATH");
    process.exit(1);
  }

  if (!(await commandOnPath("opencode"))) {
    console.error("k2so init: opencode is not on PATH");
    console.error("Install OpenCode yourself: https://opencode.ai/install");
    console.error("Then configure your LLM provider (e.g. opencode auth) and re-run: k2so init");
    process.exit(1);
  }

  const opencodeConfig = paths.opencodeConfig();
  if (!(await exists(opencodeConfig))) {
    console.error(`k2so init: ${opencodeConfig} not found`);
    console.error("Configure OpenCode first (provider + auth), then re-run: k2so init");
    console.error("K-2SO never writes to opencode.json — that file is yours.");
    process.exit(1);
  }

  const results: Array<{ path: string; action: string }> = [];

  const agent = await writeAgentMd(force);
  results.push({ path: paths.k2soAgentMd(), action: agent });

  const profileSeed = await seedFile(paths.k2soProfile(), "profile.toml", false);
  results.push({ path: paths.k2soProfile(), action: profileSeed });

  const profile = await loadProfile();
  const memoryPaths = resolveMemoryPaths(profile);

  for (const [rel, dest] of [
    ["SOUL.md", memoryPaths.soul],
    ["USER.md", memoryPaths.user],
    ["MEMORY.md", memoryPaths.memory],
  ] as const) {
    const action = await seedFile(dest, rel, false);
    results.push({ path: dest, action });
  }

  const skills = await seedSkillsDir(memoryPaths.skillsDir);
  results.push({ path: memoryPaths.skillsDir, action: skills });

  let migrated = false;
  if (options.migrateOpencode) {
    if (await hasLegacyK2soAgent(opencodeConfig)) {
      await removeLegacyK2soAgent(opencodeConfig);
      migrated = true;
      results.push({ path: opencodeConfig, action: "migrated (removed agent.k2so)" });
    }
  } else if (await promptLegacyMigration(opencodeConfig)) {
    await removeLegacyK2soAgent(opencodeConfig);
    migrated = true;
    results.push({ path: opencodeConfig, action: "migrated (removed agent.k2so)" });
  }

  console.log("k2so init complete\n");
  for (const { path, action } of results) {
    console.log(`  ${action.padEnd(11)}  ${path}`);
  }

  console.log(`
Next steps:
  1. Ensure your LLM provider is configured in ~/.config/opencode/opencode.json
  2. Start the daemon: k2so serve
  3. Submit a task: k2so ask "say hello"

Run k2so doctor to verify the installation.
${migrated ? "\nLegacy agent.k2so removed from opencode.json — OpenCode providers and MCP blocks unchanged.\n" : ""}`);
}

export async function runDoctor(): Promise<void> {
  const checks: DoctorCheck[] = [];

  const nodeOk = parseNodeMajor(process.version) >= 20;
  checks.push({
    label: "Node.js 20+",
    status: nodeOk ? "ok" : "fail",
    detail: process.version,
  });

  const npmOk = await commandOnPath("npm");
  checks.push({
    label: "npm on PATH",
    status: npmOk ? "ok" : "fail",
    detail: npmOk ? "found" : "missing",
  });

  const opencodeOk = await commandOnPath("opencode");
  checks.push({
    label: "opencode on PATH",
    status: opencodeOk ? "ok" : "fail",
    detail: opencodeOk ? "found" : "missing — https://opencode.ai/install",
  });

  const configPath = paths.opencodeConfig();
  const configOk = await exists(configPath);
  checks.push({
    label: "opencode.json",
    status: configOk ? "ok" : "fail",
    detail: configPath,
  });

  const agentPath = paths.k2soAgentMd();
  const agentOk = await exists(agentPath);
  checks.push({
    label: "agents/k2so.md",
    status: agentOk ? "ok" : "fail",
    detail: agentOk ? agentPath : `missing — run: k2so init`,
  });

  const profile = await loadProfile();
  const memoryPaths = resolveMemoryPaths(profile);

  checks.push({
    label: "memory.enabled",
    status: profile.memory?.enabled ? "ok" : "warn",
    detail: profile.memory?.enabled ? "true" : "disabled in profile.toml",
  });

  for (const [label, path] of [
    ["profile.toml", paths.k2soProfile()],
    ["SOUL.md", memoryPaths.soul],
    ["USER.md", memoryPaths.user],
    ["MEMORY.md", memoryPaths.memory],
  ] as const) {
    const ok = await exists(path);
    checks.push({
      label,
      status: ok ? "ok" : "warn",
      detail: ok ? path : `missing — run: k2so init`,
    });
  }

  const skillsOk = await exists(memoryPaths.skillsDir);
  checks.push({
    label: "skills/",
    status: skillsOk ? "ok" : "warn",
    detail: skillsOk ? memoryPaths.skillsDir : "missing — run: k2so init",
  });

  const mcpPath = memoryMcpEntry();
  const mcpOk = await exists(mcpPath);
  checks.push({
    label: "memory MCP bundle",
    status: mcpOk ? "ok" : "warn",
    detail: mcpOk ? mcpPath : `not built yet — ${mcpPath}`,
  });

  const statusIcon: Record<CheckStatus, string> = { ok: "✓", warn: "!", fail: "✗" };
  const statusPad = 4;

  console.log("k2so doctor\n");
  for (const check of checks) {
    const icon = statusIcon[check.status];
    console.log(`  ${icon.padEnd(statusPad)}  ${check.label.padEnd(22)}  ${check.detail}`);
  }

  const failures = checks.filter((c) => c.status === "fail").length;
  const warnings = checks.filter((c) => c.status === "warn").length;
  console.log(`\n${failures} failure(s), ${warnings} warning(s)`);

  if (failures > 0) {
    process.exit(1);
  }
}

export async function runUninstall(): Promise<void> {
  const removed: string[] = [];

  const targets = [
    paths.k2soAgentMd(),
    paths.k2soConfigDir(),
    paths.k2soState(),
    paths.k2soShare(),
  ];

  for (const target of targets) {
    if (await exists(target)) {
      await rm(target, { recursive: true, force: true });
      removed.push(target);
    }
  }

  console.log("k2so uninstall complete\n");
  if (!removed.length) {
    console.log("  nothing to remove");
  } else {
    for (const path of removed) {
      console.log(`  removed  ${path}`);
    }
  }

  console.log(`
Untouched:
  ~/.config/opencode/opencode.json  (your OpenCode config)
  other OpenCode agents, providers, and MCP servers

OpenCode remains fully functional without K-2SO.
`);
}

/** JSON merged into OpenCode at spawn time via OPENCODE_CONFIG_CONTENT. */
export function opencodeConfigOverlay(): string {
  const mcpEntry = memoryMcpEntry();
  return JSON.stringify({
    $schema: "https://opencode.ai/config.json",
    mcp: {
      "k2so-memory": {
        type: "local",
        command: ["node", mcpEntry],
        enabled: true,
      },
    },
  });
}