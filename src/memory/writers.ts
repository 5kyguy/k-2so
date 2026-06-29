import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { loadProfile } from "../config.js";
import { type MemoryPaths, resolveMemoryPaths } from "./paths.js";

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

function assertWithinRoot(root: string, target: string): void {
  const resolvedRoot = resolve(root);
  const resolvedTarget = resolve(target);
  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(resolvedRoot + sep)) {
    throw new Error("path escape denied");
  }
}

function normalizeHeading(heading: string): string {
  const trimmed = heading.trim();
  return trimmed.startsWith("## ") ? trimmed : `## ${trimmed}`;
}

interface ParsedSection {
  heading: string;
  /** Non-empty lines belonging to this section (headings excluded), in order. */
  lines: string[];
}

interface ParsedDoc {
  title: string | null;
  intro: string[];
  sections: ParsedSection[];
}

const HEADING_RE = /^(#{1,6})\s+(.*)$/;

function parseDoc(text: string): ParsedDoc {
  const lines = text.split("\n");
  let title: string | null = null;
  const intro: string[] = [];
  const sections: ParsedSection[] = [];
  let current: ParsedSection | null = null;

  for (const raw of lines) {
    const line = raw.trimEnd();
    const match = HEADING_RE.exec(line);
    if (!match) {
      if (current) {
        current.lines.push(line);
      } else if (line.trim()) {
        intro.push(line);
      }
      continue;
    }

    const level = match[1]!.length;
    const headingText = match[2]!.trim();
    if (level === 1 && !title && !current) {
      title = headingText;
      continue;
    }

    if (level === 2) {
      current = { heading: headingText, lines: [] };
      sections.push(current);
    } else if (current) {
      // Nested heading inside a section — treat as a line.
      current.lines.push(line);
    } else {
      intro.push(line);
    }
  }

  // Drop trailing empty lines from each section's body.
  for (const section of sections) {
    while (section.lines.length && section.lines[section.lines.length - 1]!.trim() === "") {
      section.lines.pop();
    }
  }

  return { title, intro, sections };
}

function serializeDoc(doc: ParsedDoc, options: { createFileTitle?: string } = {}): string {
  const out: string[] = [];

  if (doc.title) {
    out.push(`# ${doc.title}`);
    out.push("");
  } else if (options.createFileTitle) {
    out.push(`# ${options.createFileTitle}`);
    out.push("");
  }

  if (doc.intro.length) {
    out.push(...doc.intro);
    out.push("");
  }

  for (const section of doc.sections) {
    out.push(`## ${section.heading}`);
    out.push("");
    for (const line of section.lines) {
      out.push(line);
    }
    if (section.lines.length) {
      out.push("");
    }
  }

  // Collapse extra blank lines and ensure single trailing newline.
  return `${out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}

function findSection(doc: ParsedDoc, heading: string): ParsedSection | undefined {
  const target = heading.replace(/^##\s+/, "").trim();
  return doc.sections.find((s) => s.heading === target);
}

function sectionHasLine(section: ParsedSection, line: string): boolean {
  return section.lines.some((row) => row.trim() === line.trim());
}

export async function appendUnderHeading(
  filePath: string,
  heading: string,
  line: string,
  options: { idempotent?: boolean; createFileTitle?: string } = {},
): Promise<"appended" | "skipped"> {
  const normalizedHeading = normalizeHeading(heading);
  const trimmedLine = line.trim();
  if (!trimmedLine) {
    return "skipped";
  }

  const text = await readTextOrEmpty(filePath);
  const doc = parseDoc(text);
  const section = findSection(doc, normalizedHeading);

  if (section) {
    if (options.idempotent && sectionHasLine(section, trimmedLine)) {
      return "skipped";
    }
    section.lines.push(trimmedLine);
  } else {
    doc.sections.push({ heading: normalizedHeading.replace(/^##\s+/, ""), lines: [trimmedLine] });
  }

  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, serializeDoc(doc, options), "utf8");
  return "appended";
}

async function memoryPaths(): Promise<MemoryPaths> {
  const profile = await loadProfile();
  return resolveMemoryPaths(profile);
}

export async function memoryAppend(section: string, content: string): Promise<string> {
  const paths = await memoryPaths();
  assertWithinRoot(paths.dir, paths.memory);
  const result = await appendUnderHeading(paths.memory, section, content, {
    idempotent: true,
    createFileTitle: "Memory",
  });
  return result === "appended" ? `Appended to MEMORY.md under ${normalizeHeading(section)}` : "Already present — skipped";
}

export async function userProfileUpdate(learning: string): Promise<string> {
  const paths = await memoryPaths();
  assertWithinRoot(paths.dir, paths.user);
  const result = await appendUnderHeading(paths.user, "Learned", learning, {
    idempotent: false,
    createFileTitle: "User",
  });
  return result === "appended" ? "Appended learning to USER.md" : "Skipped empty learning";
}

export async function readLearnedBullets(): Promise<string[]> {
  const paths = await memoryPaths();
  const text = await readTextOrEmpty(paths.user);
  const doc = parseDoc(text);
  const section = findSection(doc, "Learned");
  if (!section) {
    return [];
  }
  return section.lines
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim())
    .filter(Boolean);
}

export async function replaceLearnedBullets(bullets: string[]): Promise<void> {
  const paths = await memoryPaths();
  assertWithinRoot(paths.dir, paths.user);
  const text = await readTextOrEmpty(paths.user);
  const doc = parseDoc(text);
  const lines = bullets.map((bullet) => `- ${bullet}`);
  const existing = findSection(doc, "Learned");
  if (existing) {
    existing.lines = lines;
  } else {
    doc.sections.push({ heading: "Learned", lines });
  }
  await mkdir(dirname(paths.user), { recursive: true });
  await writeFile(paths.user, serializeDoc(doc, { createFileTitle: "User" }), "utf8");
}

export async function soulRefine(delta: string): Promise<string> {
  const paths = await memoryPaths();
  assertWithinRoot(paths.dir, paths.soul);
  const result = await appendUnderHeading(paths.soul, "Proposed", delta, {
    idempotent: false,
    createFileTitle: "Soul",
  });
  return result === "appended" ? "Appended refinement to SOUL.md under ## Proposed" : "Skipped empty delta";
}

function slugify(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug || slug === "." || slug === "..") {
    throw new Error("invalid skill name");
  }
  return slug;
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

function stripFrontmatter(text: string): string {
  return text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
}

function bumpVersion(version: string): string {
  const parts = version.replace(/^v/i, "").split(".");
  const major = parts[0] || "1";
  const minor = parts[1] || "0";
  const patch = Number.parseInt(parts[2] ?? "0", 10) + 1;
  return `${major}.${minor}.${patch}`;
}

function skillDocument(
  name: string,
  trigger: string,
  body: string,
  version = "1.0.0",
): string {
  const slug = slugify(name);
  const trimmedBody = body.trim();
  return `---
name: ${slug}
trigger: ${trigger}
version: "${version}"
description: ${trigger}
---

${trimmedBody}
`;
}

export async function skillCreate(
  name: string,
  body: string,
  trigger: string,
  force = false,
): Promise<string> {
  const paths = await memoryPaths();
  const slug = slugify(name);
  const dest = join(paths.skillsDir, `${slug}.md`);
  assertWithinRoot(paths.dir, dest);

  await mkdir(paths.skillsDir, { recursive: true });

  const exists = await readTextOrEmpty(dest);
  if (exists && !force) {
    return `Skill ${slug} already exists — pass force: true to overwrite`;
  }

  let version = "1.0.0";
  if (exists && force) {
    version = bumpVersion(parseFrontmatter(exists).version ?? "1.0.0");
    const archiveDir = join(paths.skillsDir, ".archive");
    await mkdir(archiveDir, { recursive: true });
    const archived = join(archiveDir, `${slug}-${Date.now()}.md`);
    assertWithinRoot(paths.dir, archived);
    await rename(dest, archived);
  }

  await writeFile(dest, skillDocument(name, trigger, body, version), "utf8");
  return force && exists
    ? `Overwrote skill ${slug} v${version} (previous archived)`
    : `Created skill ${slug}`;
}

export async function skillRead(name: string): Promise<string> {
  const paths = await memoryPaths();
  const slug = slugify(name);
  const dest = join(paths.skillsDir, `${slug}.md`);
  assertWithinRoot(paths.dir, dest);

  const text = await readTextOrEmpty(dest);
  if (!text) {
    return `Skill not found: ${slug}. Use skill_list to see available skills.`;
  }

  const meta = parseFrontmatter(text);
  const body = stripFrontmatter(text);
  const label = meta.name ?? slug;
  const version = meta.version ?? "1.0.0";
  const trigger = meta.trigger ?? meta.description ?? "";

  return [
    `# Skill: ${label} (v${version})`,
    trigger ? `Trigger: ${trigger}` : undefined,
    "",
    body || "(empty procedure body)",
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}

export async function skillList(): Promise<string> {
  const paths = await memoryPaths();
  assertWithinRoot(paths.dir, paths.skillsDir);

  let entries: string[];
  try {
    entries = await readdir(paths.skillsDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return "No skills yet.";
    }
    throw err;
  }

  const lines: string[] = [];
  for (const filename of entries.filter((name) => name.endsWith(".md")).sort()) {
    const text = await readTextOrEmpty(join(paths.skillsDir, filename));
    const meta = parseFrontmatter(text);
    const label = meta.name ?? basename(filename, ".md");
    const trigger = meta.trigger ?? meta.description ?? "";
    lines.push(trigger ? `- ${label}: ${trigger}` : `- ${label}`);
  }

  return lines.length ? lines.join("\n") : "No skills yet.";
}