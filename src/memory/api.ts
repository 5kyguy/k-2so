import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { K2soProfile } from "../config.js";
import { listSkillEntries, loadMemory, loadSkillsBlock, loadSoul, loadUser } from "./loaders.js";
import { resolveMemoryPaths, type MemoryPaths } from "./paths.js";

export interface MemoryFileView {
  path: string;
  content: string;
}

export interface MemorySnapshot {
  paths: MemoryPaths;
  soul: MemoryFileView;
  user: MemoryFileView;
  memory: MemoryFileView;
  skillsCatalog: string;
  skills: Awaited<ReturnType<typeof listSkillEntries>>;
}

export interface ReflectionLogEntry {
  taskId: string;
  sessionId: string;
  recordedAt: string;
  model: string;
  applied: { user: number; memory: number; skill: boolean };
  result?: {
    user_updates?: string[];
    memory_appends?: Array<{ section: string; content: string }>;
    new_skill?: { name: string; body: string; trigger: string };
  };
  error?: string;
}

export async function getMemorySnapshot(profile: K2soProfile): Promise<MemorySnapshot> {
  const paths = resolveMemoryPaths(profile);
  const [soul, user, memory, skillsCatalog, skills] = await Promise.all([
    loadSoul(paths),
    loadUser(paths),
    loadMemory(paths),
    loadSkillsBlock(paths),
    listSkillEntries(paths),
  ]);

  return {
    paths,
    soul: { path: paths.soul, content: soul },
    user: { path: paths.user, content: user },
    memory: { path: paths.memory, content: memory },
    skillsCatalog,
    skills,
  };
}

export async function readReflectionLog(stateDir: string, limit = 50): Promise<ReflectionLogEntry[]> {
  const logPath = join(stateDir, "reflection.jsonl");
  try {
    const text = await readFile(logPath, "utf8");
    const lines = text.trim().split("\n").filter(Boolean);
    return lines.slice(-limit).map((line) => JSON.parse(line) as ReflectionLogEntry);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw err;
  }
}