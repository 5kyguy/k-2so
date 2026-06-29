import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { type MemoryPaths } from "./paths.js";

async function readTextOrEmpty(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return "";
    }
    throw err;
  }
}

function parseFrontmatter(text: string): Record<string, string> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) {
    return {};
  }

  const fields: Record<string, string> = {};
  for (const line of match[1]!.split("\n")) {
    const idx = line.indexOf(":");
    if (idx <= 0) {
      continue;
    }
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key) {
      fields[key] = value;
    }
  }
  return fields;
}

export async function loadSoul(paths: MemoryPaths): Promise<string> {
  return readTextOrEmpty(paths.soul);
}

export async function loadUser(paths: MemoryPaths): Promise<string> {
  return readTextOrEmpty(paths.user);
}

export async function loadMemory(paths: MemoryPaths): Promise<string> {
  return readTextOrEmpty(paths.memory);
}

export interface SkillEntry {
  name: string;
  slug: string;
  trigger: string;
  path: string;
  content: string;
}

export async function listSkillEntries(paths: MemoryPaths): Promise<SkillEntry[]> {
  let entries: string[];
  try {
    entries = await readdir(paths.skillsDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw err;
  }

  const skills: SkillEntry[] = [];
  for (const filename of entries.filter((name) => name.endsWith(".md")).sort()) {
    const path = join(paths.skillsDir, filename);
    const content = await readTextOrEmpty(path);
    if (!content) {
      continue;
    }
    const meta = parseFrontmatter(content);
    skills.push({
      name: meta.name ?? basename(filename, ".md"),
      slug: basename(filename, ".md"),
      trigger: meta.trigger ?? meta.description ?? "",
      path,
      content,
    });
  }
  return skills;
}

export async function loadSkillsBlock(paths: MemoryPaths): Promise<string> {
  let entries: string[];
  try {
    entries = await readdir(paths.skillsDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return "";
    }
    throw err;
  }

  const lines: string[] = [];
  const mdFiles = entries.filter((name) => name.endsWith(".md")).sort();

  for (const filename of mdFiles) {
    const text = await readTextOrEmpty(join(paths.skillsDir, filename));
    if (!text) {
      continue;
    }
    const meta = parseFrontmatter(text);
    const label = meta.name ?? filename.replace(/\.md$/, "");
    const trigger = meta.trigger ?? meta.description ?? "";
    lines.push(trigger ? `- ${label} — ${trigger}` : `- ${label}`);
  }

  return lines.join("\n");
}