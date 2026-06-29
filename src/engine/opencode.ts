import { createOpencodeClient } from "@opencode-ai/sdk";
import type { K2soProfile } from "../config.js";
import { assemblePromptForTask } from "../memory/assemble.js";
import type { AgentEngine, AgentEvent, TaskHandle, TaskOpts, Unsubscribe } from "./interface.js";

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

export class OpenCodeEngine implements AgentEngine {
  readonly name = "opencode";
  private client;
  private listeners = new Set<(event: AgentEvent) => void>();
  private eventAbort?: AbortController;
  private sessionToTask = new Map<string, string>();

  constructor(private profile: K2soProfile) {
    this.client = createOpencodeClient({
      baseUrl: profile.engine.opencode_url,
    });
  }

  async isReady(): Promise<boolean> {
    try {
      const res = await fetch(`${this.profile.engine.opencode_url}/global/health`);
      return res.ok;
    } catch {
      return false;
    }
  }

  async startTask(instruction: string, opts: TaskOpts): Promise<TaskHandle> {
    const taskId = opts.taskId;
    const title = instruction.trim().slice(0, 80) || "K-2SO task";
    const session = await this.client.session.create({
      body: { title, parentID: opts.parentSessionId },
    });
    const sessionId = session.data?.id;
    if (!sessionId) {
      throw new Error("OpenCode session.create did not return a session id");
    }

    this.sessionToTask.set(sessionId, taskId);
    this.emit({
      type: "status",
      taskId,
      at: new Date().toISOString(),
      data: { status: "running", sessionId },
    });

    const model = opts.model ?? this.profile.agent.default_model;
    const { providerID, modelID } = parseModel(model);
    const agent = opts.agent ?? this.profile.agent.name;
    const promptText = await assemblePromptForTask(this.profile, instruction);

    void this.client.session
      .prompt({
        path: { id: sessionId },
        body: {
          agent,
          model: { providerID, modelID },
          parts: [{ type: "text", text: promptText }],
        },
      })
      .then(() => {
        this.emit({
          type: "done",
          taskId,
          at: new Date().toISOString(),
          data: { sessionId },
        });
      })
      .catch((err: unknown) => {
        this.emit({
          type: "error",
          taskId,
          at: new Date().toISOString(),
          data: { message: err instanceof Error ? err.message : String(err) },
        });
      });

    return { id: taskId, sessionId };
  }

  async abort(_taskId: string, sessionId: string): Promise<void> {
    await this.client.session.abort({ path: { id: sessionId } });
  }

  subscribe(onEvent: (event: AgentEvent) => void): Unsubscribe {
    this.listeners.add(onEvent);
    if (!this.eventAbort) {
      void this.startEventStream();
    }
    return () => {
      this.listeners.delete(onEvent);
      if (this.listeners.size === 0) {
        this.eventAbort?.abort();
        this.eventAbort = undefined;
      }
    };
  }

  private emit(event: AgentEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private async startEventStream(): Promise<void> {
    this.eventAbort = new AbortController();
    const url = `${this.profile.engine.opencode_url}/event`;

    try {
      const res = await fetch(url, {
        headers: { Accept: "text/event-stream" },
        signal: this.eventAbort.signal,
      });
      if (!res.ok || !res.body) {
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";

        for (const chunk of chunks) {
          this.handleSseChunk(chunk);
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        console.error("k2so: event stream ended:", err);
      }
    }
  }

  private handleSseChunk(chunk: string): void {
    const dataLine = chunk.split("\n").find((line) => line.startsWith("data: "));
    if (!dataLine) {
      return;
    }

    try {
      const payload = JSON.parse(dataLine.slice(6)) as {
        type?: string;
        properties?: { sessionID?: string; part?: { type?: string; tool?: string } };
      };
      const sessionId = payload.properties?.sessionID;
      if (!sessionId) {
        return;
      }
      const taskId = this.sessionToTask.get(sessionId);
      if (!taskId) {
        return;
      }

      if (payload.type === "message.part.updated") {
        const part = payload.properties?.part;
        if (part?.type === "tool") {
          this.emit({
            type: "tool",
            taskId,
            at: new Date().toISOString(),
            data: part,
          });
        } else {
          this.emit({
            type: "message",
            taskId,
            at: new Date().toISOString(),
            data: part,
          });
        }
      }
    } catch {
      // ignore malformed SSE payloads
    }
  }
}
