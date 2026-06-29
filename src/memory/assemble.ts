import type { K2soProfile } from "../config.js";
import { loadMemory, loadSkillsBlock, loadSoul, loadUser } from "./loaders.js";
import { resolveMemoryPaths } from "./paths.js";

export interface AssembleInput {
  baseInstruction: string;
  soul: string;
  user: string;
  memory: string;
  skills: string;
}

function stripLeadingTitle(body: string, title: string): string {
  const lines = body.split("\n");
  const first = lines[0]?.trim().toLowerCase();
  if (first === `# ${title.toLowerCase()}`) {
    return lines.slice(1).join("\n").trim();
  }
  return body.trim();
}

const SKILLS_GUIDANCE =
  "If a task matches an existing skill's trigger, call skill_read and follow that procedure instead of replanning from scratch. Improve skills with skill_create(..., force: true) when you find a better path.";

function section(title: string, body: string): string | undefined {
  const trimmed = stripLeadingTitle(body, title);
  if (!trimmed) {
    return undefined;
  }
  return `# ${title}\n${trimmed}`;
}

function skillsSection(catalog: string): string | undefined {
  const trimmed = catalog.trim();
  if (!trimmed) {
    return undefined;
  }
  return `# Skills available\n${SKILLS_GUIDANCE}\n\n${trimmed}`;
}

export function assemblePrompt(input: AssembleInput): string {
  const sections = [
    section("Soul", input.soul),
    section("User", input.user),
    section("Memory", input.memory),
    skillsSection(input.skills),
    section("Task", input.baseInstruction),
  ].filter((block): block is string => block !== undefined);

  return sections.join("\n\n");
}

export async function assemblePromptForTask(
  profile: K2soProfile,
  baseInstruction: string,
): Promise<string> {
  if (!profile.memory?.enabled) {
    return baseInstruction;
  }

  const paths = resolveMemoryPaths(profile);
  return assemblePrompt({
    baseInstruction,
    soul: await loadSoul(paths),
    user: await loadUser(paths),
    memory: await loadMemory(paths),
    skills: await loadSkillsBlock(paths),
  });
}