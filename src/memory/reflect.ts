import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createOpencodeClient } from "@opencode-ai/sdk";
import type { K2soProfile } from "../config.js";
import type { TaskRecord } from "../engine/interface.js";
import { memoryAppend, readLearnedBullets, replaceLearnedBullets, skillCreate, userProfileUpdate } from "./writers.js";
import { loadMemory, loadUser } from "./loaders.js";
import { resolveMemoryPaths } from "./paths.js";

const REFLECTION_SYSTEM = `You are K-2SO's reflection subroutine. Given a completed task transcript
and the current USER.md / MEMORY.md, decide what (if anything) is worth remembering.
Return JSON only: { "user_updates": string[], "memory_appends": [{ "section": string, "content": string }],
"new_skill"?: { "name": string, "body": string, "trigger": string } }.
Omit fields that should not change. Be conservative.`;

const COMPACTION_SYSTEM = `You are K-2SO's memory compactor. Given a list of learned facts about the user,
consolidate duplicates, drop contradictions (keep the most recent), and merge related facts.
Return JSON only: { "bullets": string[] }. Each bullet must be a single line, no leading dash,
no heading. Aim for at most 12 bullets. Preserve specific, durable facts over transient observations.`;

const MAX_TRANSCRIPT_CHARS = 12_000;

interface ReflectionResult {
  user_updates?: string[];
  memory_appends?: Array<{ section: string; content: string }>;
  new_skill?: { name: string; body: string; trigger: string };
}

interface CompactionResult {
  bullets: string[];
}

interface ReflectionLogEntry {
  taskId: string;
  sessionId: string;
  recordedAt: string;
  model: string;
  applied: { user: number; memory: number; skill: boolean };
  compaction?: { before: number; after: number };
  result?: ReflectionResult;
  error?: string;
}

function parseModel(model: string): { providerID: string; modelID: string } {
  const slash = model.indexOf("/");
  if (slash === -1) {
    return { providerID: "openai", modelID: model };
  }
  return {
    providerID: model.slice(0, slash),
    modelID: model.slice(slash + 1),
  };
}

function truncate(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}\n…[truncated]`;
}

function formatTranscript(
  messages: Array<{ info: { role?: string }; parts: Array<{ type?: string; text?: string }> }>,
): string {
  const lines: string[] = [];

  for (const message of messages) {
    const role = message.info.role ?? "unknown";
    const text = message.parts
      .filter((part) => part.type === "text" && part.text?.trim())
      .map((part) => part.text!.trim())
      .join("\n");
    if (!text) {
      continue;
    }
    lines.push(`${role}: ${text}`);
  }

  return truncate(lines.join("\n\n"), MAX_TRANSCRIPT_CHARS);
}

function parseReflectionJson(text: string): ReflectionResult {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const raw = (fenced?.[1] ?? text).trim();
  const parsed = JSON.parse(raw) as ReflectionResult;
  return parsed;
}

function parseCompactionJson(text: string): CompactionResult {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const raw = (fenced?.[1] ?? text).trim();
  const parsed = JSON.parse(raw) as CompactionResult;
  if (!Array.isArray(parsed.bullets)) {
    throw new Error("compaction response missing bullets[]");
  }
  return parsed;
}

function extractAssistantText(parts: Array<{ type?: string; text?: string }>): string {
  return parts
    .filter((part) => part.type === "text" && part.text)
    .map((part) => part.text!)
    .join("\n");
}

async function appendReflectionLog(profile: K2soProfile, entry: ReflectionLogEntry): Promise<void> {
  const logPath = join(profile.daemon.state, "reflection.jsonl");
  await mkdir(profile.daemon.state, { recursive: true });
  await appendFile(logPath, `${JSON.stringify(entry)}\n`, "utf8");
}

async function applyReflection(result: ReflectionResult): Promise<ReflectionLogEntry["applied"]> {
  const applied = { user: 0, memory: 0, skill: false };

  for (const learning of result.user_updates ?? []) {
    if (!learning.trim()) {
      continue;
    }
    await userProfileUpdate(learning);
    applied.user++;
  }

  for (const append of result.memory_appends ?? []) {
    if (!append.section?.trim() || !append.content?.trim()) {
      continue;
    }
    await memoryAppend(append.section, append.content);
    applied.memory++;
  }

  if (result.new_skill?.name && result.new_skill.body && result.new_skill.trigger) {
    await skillCreate(result.new_skill.name, result.new_skill.body, result.new_skill.trigger);
    applied.skill = true;
  }

  return applied;
}

async function maybeCompactUser(
  profile: K2soProfile,
  client: ReturnType<typeof createOpencodeClient>,
  model: string,
): Promise<{ before: number; after: number } | undefined> {
  const threshold = profile.memory?.compact_user_threshold;
  if (!threshold || threshold <= 0) {
    return undefined;
  }

  const before = await readLearnedBullets();
  if (before.length < threshold) {
    return undefined;
  }

  const { providerID, modelID } = parseModel(model);
  const session = await client.session.create({
    body: { title: `k2so-compact-user-${Date.now()}` },
  });
  const sessionId = session.data?.id;
  if (!sessionId) {
    throw new Error("compaction session.create did not return a session id");
  }

  const prompt = ["## Current USER.md Learned bullets", ...before.map((b) => `- ${b}`)].join("\n");
  const res = await client.session.prompt({
    path: { id: sessionId },
    body: {
      model: { providerID, modelID },
      system: COMPACTION_SYSTEM,
      parts: [{ type: "text", text: prompt }],
    },
  });

  const text = extractAssistantText(res.data?.parts ?? []);
  if (!text.trim()) {
    return undefined;
  }

  const consolidated = parseCompactionJson(text).bullets
    .map((b) => b.trim())
    .map((b) => b.replace(/^[-*]\s+/, "").trim())
    .filter(Boolean);

  if (!consolidated.length) {
    return undefined;
  }

  await replaceLearnedBullets(consolidated);
  return { before: before.length, after: consolidated.length };
}

async function runReflection(task: TaskRecord, profile: K2soProfile): Promise<void> {
  const model = profile.memory?.reflect_model ?? "zai-coding/glm-4.5-air";
  const baseEntry: ReflectionLogEntry = {
    taskId: task.id,
    sessionId: task.sessionId,
    recordedAt: new Date().toISOString(),
    model,
    applied: { user: 0, memory: 0, skill: false },
  };

  if (!task.sessionId) {
    await appendReflectionLog(profile, { ...baseEntry, error: "missing sessionId" });
    return;
  }

  try {
    const client = createOpencodeClient({ baseUrl: profile.engine.opencode_url });
    const messagesRes = await client.session.messages({ path: { id: task.sessionId } });
    const messages = messagesRes.data ?? [];
    const transcript = formatTranscript(messages);

    const memoryPaths = resolveMemoryPaths(profile);
    const userDoc = await loadUser(memoryPaths);
    const memoryDoc = await loadMemory(memoryPaths);

    const userPrompt = [
      "## Transcript",
      transcript || "(empty)",
      "## Current USER.md",
      userDoc.trim() || "(empty)",
      "## Current MEMORY.md",
      memoryDoc.trim() || "(empty)",
    ].join("\n\n");

    const reflectSession = await client.session.create({
      body: { title: `k2so-reflect-${task.id.slice(0, 8)}` },
    });
    const reflectSessionId = reflectSession.data?.id;
    if (!reflectSessionId) {
      throw new Error("reflection session.create did not return a session id");
    }

    const { providerID, modelID } = parseModel(model);
    const promptRes = await client.session.prompt({
      path: { id: reflectSessionId },
      body: {
        model: { providerID, modelID },
        system: REFLECTION_SYSTEM,
        parts: [{ type: "text", text: userPrompt }],
      },
    });

    const assistantText = extractAssistantText(promptRes.data?.parts ?? []);
    if (!assistantText.trim()) {
      await appendReflectionLog(profile, { ...baseEntry, error: "empty reflection response" });
      return;
    }

    const result = parseReflectionJson(assistantText);
    const applied = await applyReflection(result);

    let compaction: { before: number; after: number } | undefined;
    if (applied.user > 0) {
      compaction = await maybeCompactUser(profile, client, model).catch((err) => {
        console.error("k2so: user compaction failed:", err);
        return undefined;
      });
    }

    await appendReflectionLog(profile, { ...baseEntry, result, applied, compaction });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("k2so: reflection failed:", message);
    await appendReflectionLog(profile, { ...baseEntry, error: message }).catch(() => {});
  }
}

export function reflectOnTask(task: TaskRecord, profile: K2soProfile): void {
  void runReflection(task, profile);
}