import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  memoryAppend,
  skillCreate,
  skillList,
  skillRead,
  soulRefine,
  userProfileUpdate,
} from "./store.js";

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

interface ToolDef {
  description: string;
  schema: Record<string, z.ZodTypeAny>;
  handler: (args: Record<string, unknown>) => Promise<string>;
}

const TOOL_REGISTRY: Record<string, ToolDef> = {
  memory_append: {
    description: "Append a fact under a section in MEMORY.md (creates the section if missing)",
    schema: {
      section: z.string().describe("Section heading without ## prefix, e.g. Projects"),
      content: z.string().describe("Fact to remember"),
    },
    handler: async ({ section, content }) => memoryAppend(String(section), String(content)),
  },
  user_profile_update: {
    description: "Append a one-line learning about the user to USER.md under ## Learned",
    schema: {
      learning: z.string().describe("One-line observation about the user"),
    },
    handler: async ({ learning }) => userProfileUpdate(String(learning)),
  },
  soul_refine: {
    description: "Append a proposed persona refinement to SOUL.md under ## Proposed",
    schema: {
      delta: z.string().describe("Proposed refinement (requires manual approval to compact)"),
    },
    handler: async ({ delta }) => soulRefine(String(delta)),
  },
  skill_create: {
    description: "Create or overwrite a procedural skill in ~/.config/k2so/skills/",
    schema: {
      name: z.string().describe("Skill name (slugified for filename)"),
      body: z.string().describe("Skill procedure markdown body"),
      trigger: z.string().describe("When to use this skill"),
      force: z.boolean().optional().describe("Overwrite existing skill (archives previous)"),
    },
    handler: async ({ name, body, trigger, force }) =>
      skillCreate(String(name), String(body), String(trigger), Boolean(force)),
  },
  skill_list: {
    description: "List available skills with triggers",
    schema: {},
    handler: async () => skillList(),
  },
  skill_read: {
    description: "Read the full procedure body for a skill by name",
    schema: {
      name: z.string().describe("Skill name or slug from skill_list"),
    },
    handler: async ({ name }) => skillRead(String(name)),
  },
};

export async function createMemoryServer(): Promise<McpServer> {
  const server = new McpServer({
    name: "k2so-memory",
    version: "0.1.0",
  });

  for (const [name, tool] of Object.entries(TOOL_REGISTRY)) {
    server.tool(name, tool.description, tool.schema, async (args) => textResult(await tool.handler(args)));
  }

  return server;
}