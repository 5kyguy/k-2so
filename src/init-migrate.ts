import { readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";

export async function hasLegacyK2soAgent(opencodeConfigPath: string): Promise<boolean> {
  try {
    const text = await readFile(opencodeConfigPath, "utf8");
    const config = JSON.parse(text) as { agent?: Record<string, unknown> };
    return Boolean(config.agent?.k2so);
  } catch {
    return false;
  }
}

export async function removeLegacyK2soAgent(opencodeConfigPath: string): Promise<void> {
  const text = await readFile(opencodeConfigPath, "utf8");
  const config = JSON.parse(text) as { agent?: Record<string, unknown> };
  if (!config.agent?.k2so) {
    return;
  }
  delete config.agent.k2so;
  if (config.agent && Object.keys(config.agent).length === 0) {
    delete config.agent;
  }
  await writeFile(opencodeConfigPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export async function promptLegacyMigration(opencodeConfigPath: string): Promise<boolean> {
  if (!(await hasLegacyK2soAgent(opencodeConfigPath))) {
    return false;
  }

  console.log(`
Legacy install detected: agent.k2so in ${opencodeConfigPath}
The markdown agent at ~/.config/opencode/agents/k2so.md replaces it.
K-2SO will remove only the agent.k2so block — providers and other agents stay untouched.
`);

  if (!process.stdin.isTTY) {
    console.log("Re-run with: k2so init --migrate-opencode");
    return false;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question("Remove agent.k2so from opencode.json? [y/N] ")).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}