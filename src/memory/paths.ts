import { join } from "node:path";
import type { K2soProfile } from "../config.js";
import { expandHome } from "../paths.js";

export interface MemoryPaths {
  dir: string;
  soul: string;
  user: string;
  memory: string;
  skillsDir: string;
}

const DEFAULT_MEMORY_DIR = "~/.config/k2so";

export function resolveMemoryPaths(profile: K2soProfile): MemoryPaths {
  const dir = expandHome(profile.memory?.dir ?? DEFAULT_MEMORY_DIR);
  return {
    dir,
    soul: join(dir, "SOUL.md"),
    user: join(dir, "USER.md"),
    memory: join(dir, "MEMORY.md"),
    skillsDir: join(dir, "skills"),
  };
}