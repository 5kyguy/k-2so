import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { K2soProfile } from "../config.js";
import type { AgentEngine, AgentEvent, TaskRecord } from "../engine/interface.js";
import type { BenchLogger } from "../bench.js";
import { notifyTaskDone } from "../notify.js";
import { TaskStore } from "./store.js";

export class TaskManager {
  private running = 0;
  private queue: Array<{ taskId: string; instruction: string; model?: string; agent?: string }> = [];
  private store: TaskStore;
  private unsubscribe?: () => void;

  constructor(
    private profile: K2soProfile,
    private engine: AgentEngine,
    private bench?: BenchLogger,
  ) {
    this.store = new TaskStore(profile.daemon.state);
  }

  async init(): Promise<void> {
    await this.store.load();
    this.unsubscribe = this.engine.subscribe((event) => {
      void this.handleEvent(event);
    });
  }

  async shutdown(): Promise<void> {
    this.unsubscribe?.();
    await this.store.save();
  }

  list(): TaskRecord[] {
    return this.store.list();
  }

  get(id: string): TaskRecord | undefined {
    return this.store.get(id);
  }

  async enqueue(instruction: string, opts: { model?: string; agent?: string } = {}): Promise<TaskRecord> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const task: TaskRecord = {
      id,
      sessionId: "",
      instruction,
      status: "queued",
      createdAt: now,
      updatedAt: now,
      events: [],
    };
    this.store.upsert(task);
    await this.store.save();

    this.bench?.markStart(id);
    this.queue.push({ taskId: id, instruction, model: opts.model, agent: opts.agent });
    void this.pump();

    return task;
  }

  async abort(taskId: string): Promise<boolean> {
    const task = this.store.get(taskId);
    if (!task || !task.sessionId) {
      return false;
    }
    await this.engine.abort(taskId, task.sessionId);
    task.status = "aborted";
    task.updatedAt = new Date().toISOString();
    this.store.upsert(task);
    await this.store.save();
    return true;
  }

  private async pump(): Promise<void> {
    while (this.running < this.profile.daemon.max_concurrent_tasks && this.queue.length > 0) {
      const next = this.queue.shift();
      if (!next) {
        break;
      }
      this.running++;
      void this.runNext(next).finally(() => {
        this.running--;
        void this.pump();
      });
    }
  }

  private async runNext(job: { taskId: string; instruction: string; model?: string; agent?: string }): Promise<void> {
    const queued = this.store.get(job.taskId);
    if (!queued || queued.status !== "queued") {
      return;
    }

    const workspace = join(this.profile.daemon.workspace, queued.id);
    await mkdir(workspace, { recursive: true });
    await writeFile(join(workspace, "instruction.txt"), job.instruction);

    try {
      const handle = await this.engine.startTask(job.instruction, {
        model: job.model,
        agent: job.agent,
      });
      queued.sessionId = handle.sessionId;
      queued.status = "running";
      queued.updatedAt = new Date().toISOString();
      this.store.upsert(queued);
      await this.store.save();
    } catch (err) {
      queued.status = "failed";
      queued.error = err instanceof Error ? err.message : String(err);
      queued.updatedAt = new Date().toISOString();
      this.store.upsert(queued);
      await this.store.save();
    }
  }

  private async handleEvent(event: AgentEvent): Promise<void> {
    const task = this.store.get(event.taskId);
    if (!task) {
      return;
    }

    task.events.push(event);
    task.updatedAt = event.at;

    if (event.type === "done") {
      task.status = "done";
    } else if (event.type === "error") {
      task.status = "failed";
      task.error = String((event.data as { message?: string })?.message ?? "unknown error");
    }

    const terminal = event.type === "done" || event.type === "error";
    if (terminal) {
      const toolCalls = task.events.filter((e) => e.type === "tool").length;
      void this.bench?.record({
        taskId: task.id,
        taskType: "background",
        totalMs: this.bench.elapsed(task.id),
        toolCalls,
        turns: task.events.filter((e) => e.type === "message").length,
      });
      notifyTaskDone(this.profile, task);
    }

    this.store.upsert(task);
    await this.store.save();
  }
}
