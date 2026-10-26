import { OpenCode } from "@opencode/client";
import type { K2soProfile } from "../config.js";
import { assemblePromptForTask } from "../memory/assemble.js";
import { extractLastAssistantResponse, fetchSessionMessages } from "../memory/transcript.js";
import { ensureServerPassword, opencodeHeaders } from "./auth.js";
import type { AgentEngine, AgentEvent, TaskHandle, TaskOpts, Unsubscribe } from "./interface.js";

const EVENT_RETRY_MS = 500;
const EVENT_RETRY_MAX_MS = 10_000;

type EngineEvent = {
  type?: string;
  data?: { sessionID?: string } & Record<string, unknown>;
};

function parseModel(model: string): { providerID: string; id: string } {
  const slash = model.indexOf("/");
  if (slash === -1) {
    return { providerID: "openai", id: model };
  }
  return {
    providerID: model.slice(0, slash),
    id: model.slice(slash + 1),
  };
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class OpenCodeEngine implements AgentEngine {
  readonly name = "opencode";
  private client;
  private listeners = new Set<(event: AgentEvent) => void>();
  private eventAbort?: AbortController;
  private eventLoopRunning = false;
  private sessionToTask = new Map<string, string>();

  constructor(private profile: K2soProfile) {
    // Ensure the password exists before any request or spawn so daemon,
    // supervisor, and dashboard all share the same credential.
    const password = ensureServerPassword(profile.daemon.state);
    this.client = OpenCode.make({
      baseUrl: profile.engine.opencode_url,
      headers: opencodeHeaders(password),
    });
  }

  async isReady(): Promise<boolean> {
    try {
      const info = await this.client.server.info();
      return typeof info.version === "string";
    } catch {
      return false;
    }
  }

  async startTask(instruction: string, opts: TaskOpts): Promise<TaskHandle> {
    const taskId = opts.taskId;
    const title = instruction.trim().slice(0, 80) || "K-2SO task";
    const agent = opts.agent ?? this.profile.agent.name;
    const session = await this.client.session.create({
      title,
      ...(opts.parentSessionId ? { parentID: opts.parentSessionId } : {}),
      agent,
      model: parseModel(opts.model ?? this.profile.agent.default_model),
      location: { directory: this.taskWorkspace(taskId) },
    });
    const sessionId = session.id;

    this.sessionToTask.set(sessionId, taskId);
    this.emit({
      type: "status",
      taskId,
      at: new Date().toISOString(),
      data: { status: "running", sessionId },
    });

    const promptText = await assemblePromptForTask(this.profile, instruction);

    void this.runPrompt(taskId, sessionId, agent, promptText);

    return { id: taskId, sessionId };
  }

  async abort(_taskId: string, sessionId: string): Promise<void> {
    try {
      await this.client.session.interrupt({ sessionID: sessionId });
    } catch (err) {
      console.warn("k2so: session interrupt failed:", errorMessage(err));
    }
  }

  subscribe(onEvent: (event: AgentEvent) => void): Unsubscribe {
    this.listeners.add(onEvent);
    if (!this.eventLoopRunning) {
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

  private taskWorkspace(taskId: string): string {
    return `${this.profile.daemon.workspace}/${taskId}`;
  }

  private emit(event: AgentEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  /**
   * Prompt, wait for the agent loop to go idle, then verify a response exists.
   * The v2 prompt endpoint admits input asynchronously; completion is the
   * session.wait call, and the response is read from the message log.
   */
  private async runPrompt(
    taskId: string,
    sessionId: string,
    agent: string,
    promptText: string,
  ): Promise<void> {
    try {
      await this.client.session.prompt({ sessionID: sessionId, text: promptText });
      await this.client.session.wait({ sessionID: sessionId });

      const messages = await fetchSessionMessages(this.profile, sessionId);
      const response = extractLastAssistantResponse(messages).trim();
      if (!response) {
        // v2 accepts unknown agent names at session create but never delivers
        // their input — surface that case explicitly instead of a generic error.
        let message = "OpenCode finished the task without any assistant text";
        try {
          const inbox = await this.client.session.inbox.list({ sessionID: sessionId });
          if (inbox.some((item) => item.type === "user")) {
            message = `prompt was queued but never delivered — agent '${agent}' is not registered with OpenCode (run: k2so init)`;
          }
        } catch {
          // keep the generic message
        }
        this.emit({
          type: "error",
          taskId,
          at: new Date().toISOString(),
          data: { message },
        });
        return;
      }

      this.emit({
        type: "done",
        taskId,
        at: new Date().toISOString(),
        data: { sessionId },
      });
    } catch (err) {
      this.emit({
        type: "error",
        taskId,
        at: new Date().toISOString(),
        data: { message: errorMessage(err) },
      });
    }
  }

  private async startEventStream(): Promise<void> {
    if (this.eventLoopRunning) {
      return;
    }
    this.eventLoopRunning = true;

    let backoffMs = EVENT_RETRY_MS;
    let waitingLogged = false;

    while (this.listeners.size > 0) {
      this.eventAbort = new AbortController();
      const signal = this.eventAbort.signal;
      let established = false;

      try {
        for await (const event of this.client.event.subscribe({ signal })) {
          if (!established) {
            established = true;
            backoffMs = EVENT_RETRY_MS;
            if (waitingLogged) {
              console.log("k2so: event stream connected");
              waitingLogged = false;
            }
          }
          this.handleEngineEvent(event as EngineEvent);
        }
      } catch (err) {
        if (isAbortError(err) || signal.aborted) {
          break;
        }
        if (!established && !waitingLogged) {
          console.warn("k2so: waiting for OpenCode event stream…");
          waitingLogged = true;
        }
      }

      if (this.listeners.size === 0 || signal.aborted) {
        break;
      }

      await new Promise((r) => setTimeout(r, backoffMs));
      backoffMs = Math.min(backoffMs * 2, EVENT_RETRY_MAX_MS);
    }

    this.eventLoopRunning = false;
    this.eventAbort = undefined;
    // A listener may have re-subscribed while we were exiting.
    if (this.listeners.size > 0) {
      void this.startEventStream();
    }
  }

  private handleEngineEvent(event: EngineEvent): void {
    const data = event.data;
    const sessionId = data?.sessionID;
    if (!sessionId) {
      return;
    }
    const taskId = this.sessionToTask.get(sessionId);
    if (!taskId) {
      return;
    }
    const at = new Date().toISOString();

    switch (event.type) {
      case "session.text.delta":
        if (typeof data.delta === "string" && data.delta) {
          this.emit({ type: "message", taskId, at, data: { type: "text", text: data.delta } });
        }
        return;
      case "session.text.ended":
        if (typeof data.text === "string" && data.text) {
          this.emit({ type: "message", taskId, at, data: { type: "text", text: data.text } });
        }
        return;
      case "session.reasoning.delta":
      case "session.reasoning.ended": {
        const text = (data.delta ?? data.text) as string | undefined;
        if (text) {
          this.emit({ type: "message", taskId, at, data: { type: "reasoning", text } });
        }
        return;
      }
      case "session.tool.called":
      case "session.tool.success":
      case "session.tool.failed":
        this.emit({ type: "tool", taskId, at, data: { type: "tool", tool: data.id ?? data.tool } });
        return;
      default:
        return;
    }
  }
}
