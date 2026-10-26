import { OpenCode } from "@opencode/client";
import type { K2soProfile } from "../config.js";
import { opencodeHeaders, readServerPasswordSync } from "../engine/auth.js";

export type TranscriptMessage = {
  /** "user" | "assistant" | "system" | … */
  type?: string;
  /** Plain text of user messages. */
  text?: string;
  /** Assistant message content parts. */
  content?: Array<{ type?: string; text?: string }>;
};

export const MAX_TRANSCRIPT_CHARS = 12_000;

export function truncate(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}\n…[truncated]`;
}

export function extractAssistantText(parts: Array<{ type?: string; text?: string }>): string {
  return parts
    .filter((part) => part.type === "text" && part.text)
    .map((part) => part.text!)
    .join("\n");
}

/** Last assistant message that has non-empty text parts. */
export function extractLastAssistantResponse(messages: TranscriptMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!;
    if (message.type !== "assistant") {
      continue;
    }
    const text = extractAssistantText(message.content ?? []).trim();
    if (text) {
      return text;
    }
  }
  return "";
}

function messageText(message: TranscriptMessage): string {
  if (typeof message.text === "string" && message.text.trim()) {
    return message.text.trim();
  }
  return extractAssistantText(message.content ?? []).trim();
}

export function formatTranscript(messages: TranscriptMessage[]): string {
  const lines: string[] = [];

  for (const message of messages) {
    const role = message.type ?? "unknown";
    const text = messageText(message);
    if (!text) {
      continue;
    }
    lines.push(`${role}: ${text}`);
  }

  return truncate(lines.join("\n\n"), MAX_TRANSCRIPT_CHARS);
}

function makeClient(profile: K2soProfile) {
  return OpenCode.make({
    baseUrl: profile.engine.opencode_url,
    headers: opencodeHeaders(readServerPasswordSync(profile.daemon.state)),
  });
}

export async function fetchSessionMessages(
  profile: K2soProfile,
  sessionId: string,
): Promise<TranscriptMessage[]> {
  const client = makeClient(profile);
  const res = await client.message.list({ sessionID: sessionId });
  return res.data as TranscriptMessage[];
}

export async function fetchTaskResponse(profile: K2soProfile, sessionId: string): Promise<string> {
  const messages = await fetchSessionMessages(profile, sessionId);
  return extractLastAssistantResponse(messages);
}

/**
 * Run one prompt through a fresh session and return the final assistant text.
 * Used by the memory reflection flows.
 */
export async function runOneShotPrompt(
  profile: K2soProfile,
  opts: {
    title: string;
    system?: string;
    text: string;
    model?: { providerID: string; id: string };
  },
): Promise<string> {
  const client = makeClient(profile);
  const session = await client.session.create({
    title: opts.title,
    ...(opts.model ? { model: opts.model } : {}),
  });
  const text = opts.system ? `${opts.system}\n\n\n${opts.text}` : opts.text;
  await client.session.prompt({ sessionID: session.id, text });
  await client.session.wait({ sessionID: session.id });
  return fetchTaskResponse(profile, session.id);
}
