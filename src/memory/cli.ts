import { spawn } from "node:child_process";
import { copyFile, mkdir, readdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { loadProfile } from "../config.js";
import { templatesDir } from "../paths.js";
import { getMemorySnapshot } from "./api.js";
import { resolveMemoryPaths } from "./paths.js";

type MemoryWhich = "soul" | "user" | "memory" | "skills";

const WHICH_ALIASES: Record<string, MemoryWhich> = {
  soul: "soul",
  user: "user",
  memory: "memory",
  skills: "skills",
};

function parseWhich(value: string | undefined): MemoryWhich | undefined {
  if (!value) {
    return undefined;
  }
  return WHICH_ALIASES[value.toLowerCase()];
}

function printSection(title: string, path: string, content: string): void {
  console.log(`# ${title}`);
  console.log(`# path: ${path}`);
  console.log(content.trim() || "(empty)");
  console.log("");
}

async function runShow(args: string[]): Promise<void> {
  const profile = await loadProfile();
  const snapshot = await getMemorySnapshot(profile);
  const onlySoul = args.includes("--soul");
  const onlyUser = args.includes("--user");
  const onlyMemory = args.includes("--memory");
  const onlySkills = args.includes("--skills");
  const filtered = onlySoul || onlyUser || onlyMemory || onlySkills;

  if (!filtered || onlySoul) {
    printSection("Soul", snapshot.soul.path, snapshot.soul.content);
  }
  if (!filtered || onlyUser) {
    printSection("User", snapshot.user.path, snapshot.user.content);
  }
  if (!filtered || onlyMemory) {
    printSection("Memory", snapshot.memory.path, snapshot.memory.content);
  }
  if (!filtered || onlySkills) {
    console.log("# Skills");
    console.log(`# dir: ${snapshot.paths.skillsDir}`);
    if (!snapshot.skills.length) {
      console.log("(no skills yet)");
    } else {
      for (const skill of snapshot.skills) {
        console.log(`\n## ${skill.name}`);
        console.log(`path: ${skill.path}`);
        if (skill.trigger) {
          console.log(`trigger: ${skill.trigger}`);
        }
        console.log(skill.content.trim() || "(empty)");
      }
    }
    console.log("");
  }
}

async function runEditor(filePath: string): Promise<void> {
  const editor = process.env.EDITOR ?? process.env.VISUAL ?? "vi";
  await new Promise<void>((resolve, reject) => {
    const child = spawn(editor, [filePath], { stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${editor} exited with code ${code}`));
      }
    });
  });
}

async function runEdit(whichArg: string | undefined): Promise<void> {
  const which = parseWhich(whichArg);
  if (!which) {
    console.error("usage: k2so memory edit <soul|user|memory|skills>");
    process.exit(1);
  }

  const profile = await loadProfile();
  const paths = resolveMemoryPaths(profile);

  if (which === "skills") {
    await mkdir(paths.skillsDir, { recursive: true });
    if (process.platform === "linux") {
      spawn("xdg-open", [paths.skillsDir], { stdio: "ignore", detached: true }).unref();
      console.log(`opened ${paths.skillsDir}`);
      return;
    }
    console.log(`skills directory: ${paths.skillsDir}`);
    return;
  }

  const filePath =
    which === "soul" ? paths.soul : which === "user" ? paths.user : paths.memory;
  await mkdir(dirname(filePath), { recursive: true });
  try {
    await runEditor(filePath);
  } catch (err) {
    console.error("k2so:", err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

async function resetSkills(skillsDir: string): Promise<void> {
  await mkdir(skillsDir, { recursive: true });
  const entries = await readdir(skillsDir);
  for (const entry of entries) {
    if (!entry.endsWith(".md")) {
      continue;
    }
    await rm(join(skillsDir, entry));
  }
}

async function runReset(args: string[]): Promise<void> {
  if (!args.includes("--confirm")) {
    console.error("k2so memory reset requires --confirm");
    process.exit(1);
  }

  const which = parseWhich(args.find((arg) => !arg.startsWith("-")));
  if (!which) {
    console.error("usage: k2so memory reset <soul|user|memory|skills> --confirm");
    process.exit(1);
  }

  const profile = await loadProfile();
  const paths = resolveMemoryPaths(profile);
  const templateMap: Record<Exclude<MemoryWhich, "skills">, string> = {
    soul: "SOUL.md",
    user: "USER.md",
    memory: "MEMORY.md",
  };

  if (which === "skills") {
    await resetSkills(paths.skillsDir);
    console.log(`reset skills in ${paths.skillsDir} (.archive preserved)`);
    return;
  }

  const template = join(templatesDir(), templateMap[which]);
  const dest = which === "soul" ? paths.soul : which === "user" ? paths.user : paths.memory;
  await mkdir(dirname(dest), { recursive: true });
  await copyFile(template, dest);
  console.log(`reset ${which} -> ${dest}`);
}

export async function runMemoryCli(args: string[]): Promise<void> {
  const sub = args[0];
  const rest = args.slice(1);

  switch (sub) {
    case "show":
      await runShow(rest);
      break;
    case "edit":
      await runEdit(rest[0]);
      break;
    case "reset":
      await runReset(rest);
      break;
    default:
      console.log(`k2so memory — inspect and edit K-2SO memory files

usage:
  k2so memory show [--soul|--user|--memory|--skills]
  k2so memory edit <soul|user|memory|skills>
  k2so memory reset <soul|user|memory|skills> --confirm
`);
      process.exit(sub ? 1 : 0);
  }
}