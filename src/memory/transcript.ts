import { createOpencodeClient } from "@opencode-ai/sdk";

export type TranscriptMessage = {
  info: { role?: string };
  parts: Array<{ type?: string; text?: string }>;
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
    if (message.info.role !== "assistant") {
      continue;
    }
    const text = extractAssistantText(message.parts).trim();
    if (text) {
      return text;
    }
  }
  return "";
}

export function formatTranscript(messages: TranscriptMessage[]): string {
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

export async function fetchSessionMessages(
  opencodeUrl: string,
  sessionId: string,
): Promise<TranscriptMessage[]> {
  const client = createOpencodeClient({ baseUrl: opencodeUrl });
  const messagesRes = await client.session.messages({ path: { id: sessionId } });
  return (messagesRes.data ?? []) as TranscriptMessage[];
}

export async function fetchTaskResponse(opencodeUrl: string, sessionId: string): Promise<string> {
  const messages = await fetchSessionMessages(opencodeUrl, sessionId);
  return extractLastAssistantResponse(messages);
}
