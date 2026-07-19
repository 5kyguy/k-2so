import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { K2soProfile } from "../config.js";
import type { AgentEngine, AgentEvent, TaskRecord } from "../engine/interface.js";
import type { BenchLogger } from "../bench.js";
import { reflectOnTask } from "../memory/reflect.js";
import { fetchTaskResponse } from "../memory/transcript.js";
import { notifyTaskDone } from "../notify.js";
import { TaskStore } from "./store.js";

export class TaskManager {
  private running = 0;
  private queue: Array<{
    taskId: string;
    instruction: string;
    model?: string;
    agent?: string;
    taskType?: string;
    parentTaskId?: string;
  }> = [];
  private store: TaskStore;
  private unsubscribe?: () => void;
  private lastReflectAtMs = 0;
  private broadcast?: (payload: unknown) => void;

  constructor(
    private profile: K2soProfile,
    private engine: AgentEngine,
    private bench?: BenchLogger,
  ) {
    this.store = new TaskStore(profile.daemon.state);
  }

  setBroadcaster(fn: (payload: unknown) => void): void {
    this.broadcast = fn;
  }

  private emitChange(type: string, task: TaskRecord): void {
    this.broadcast?.({ type, task });
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

  async enqueue(
    instruction: string,
    opts: { model?: string; agent?: string; taskType?: string; parentTaskId?: string } = {},
  ): Promise<TaskRecord> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const parentTask = opts.parentTaskId ? this.store.get(opts.parentTaskId) : undefined;
    if (opts.parentTaskId && !parentTask) {
      throw new Error(`Parent task ${opts.parentTaskId} not found`);
    }
    const task: TaskRecord = {
      id,
      sessionId: "",
      instruction,
      taskType: opts.taskType ?? "background",
      status: "queued",
      createdAt: now,
      updatedAt: now,
      events: [],
      parentTaskId: parentTask?.id,
    };
    this.store.upsert(task);
    await this.store.save();

    this.bench?.markStart(id);
    this.queue.push({
      taskId: id,
      instruction,
      model: opts.model,
      agent: opts.agent,
      taskType: task.taskType,
      parentTaskId: parentTask?.id,
    });
    void this.pump();

    return task;
  }

  async abort(taskId: string): Promise<boolean> {
    const task = this.store.get(taskId);
    if (!task || (task.status !== "queued" && task.status !== "running")) {
      return false;
    }

    this.queue = this.queue.filter((job) => job.taskId !== taskId);

    if (task.sessionId) {
      await this.engine.abort(taskId, task.sessionId);
    }

    task.status = "aborted";
    task.updatedAt = new Date().toISOString();
    this.store.upsert(task);
    await this.store.save();
    return true;
  }

  resumePump(): void {
    void this.pump();
  }

  async markInFlightFailed(reason: string): Promise<void> {
    for (const task of this.store.list()) {
      if (task.status !== "running") {
        continue;
      }
      task.status = "failed";
      task.error = reason;
      task.updatedAt = new Date().toISOString();
      this.store.upsert(task);
      await this.finalizeTask(task);
    }
    await this.store.save();
  }

  async prune(): Promise<{ removed: number }> {
    const maxAgeDays = this.profile.retention?.max_age_days ?? 14;
    const maxTasks = this.profile.retention?.max_tasks ?? 200;
    const cutoffMs = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    const eventCutoffMs = cutoffMs * 2;

    const tasks = this.store.list();
    const toRemove = new Set<string>();

    for (const task of tasks) {
      const createdMs = Date.parse(task.createdAt);
      if (createdMs < cutoffMs) {
        toRemove.add(task.id);
      }
    }

    const sorted = [...tasks].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    for (const task of sorted.slice(maxTasks)) {
      toRemove.add(task.id);
    }

    let removed = 0;
    for (const taskId of toRemove) {
      const task = this.store.get(taskId);
      if (!task) {
        continue;
      }

      await rm(join(this.profile.daemon.workspace, taskId), { recursive: true, force: true });

      const createdMs = Date.parse(task.createdAt);
      if (createdMs < eventCutoffMs) {
        this.store.remove(taskId);
      } else {
        task.events = [];
        this.store.upsert(task);
      }
      removed++;
    }

    await this.store.save();
    return { removed };
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

  private async runNext(job: {
    taskId: string;
    instruction: string;
    model?: string;
    agent?: string;
    taskType?: string;
    parentTaskId?: string;
  }): Promise<void> {
    const queued = this.store.get(job.taskId);
    if (!queued || queued.status !== "queued") {
      return;
    }

    const workspace = join(this.profile.daemon.workspace, queued.id);
    await mkdir(workspace, { recursive: true });
    await writeFile(join(workspace, "instruction.txt"), job.instruction);

    const parent = job.parentTaskId ? this.store.get(job.parentTaskId) : undefined;

    try {
      const handle = await this.engine.startTask(job.instruction, {
        taskId: queued.id,
        model: job.model,
        agent: job.agent,
        taskType: job.taskType,
        parentTaskId: parent?.id,
        parentSessionId: parent?.sessionId || undefined,
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
      await this.finalizeTask(task);
    }

    this.store.upsert(task);
    await this.store.save();

    this.emitChange("task.updated", task);
    if (event.type === "done") {
      this.emitChange("task.done", task);
    }
  }

  private shouldReflect(task: TaskRecord): boolean {
    if (task.status !== "done") {
      return false;
    }
    const types = this.profile.memory?.reflect_on_task_types;
    if (types && !types.includes(task.taskType)) {
      return false;
    }
    if (!task.response && !task.events.some((e) => e.type === "message")) {
      return false;
    }
    const minInterval = this.profile.memory?.reflect_min_interval_ms ?? 0;
    if (minInterval > 0 && Date.now() - this.lastReflectAtMs < minInterval) {
      return false;
    }
    return true;
  }

  private async captureResponse(task: TaskRecord): Promise<void> {
    if (task.status !== "done" || !task.sessionId) {
      return;
    }

    try {
      const response = await fetchTaskResponse(this.profile.engine.opencode_url, task.sessionId);
      if (!response.trim()) {
        return;
      }
      task.response = response;
      const workspace = join(this.profile.daemon.workspace, task.id);
      await mkdir(workspace, { recursive: true });
      await writeFile(join(workspace, "response.md"), response, "utf8");
    } catch (err) {
      console.error("k2so: failed to capture task response:", err);
    }
  }

  private async finalizeTask(task: TaskRecord): Promise<void> {
    const toolCalls = task.events.filter((e) => e.type === "tool").length;
    void this.bench?.record({
      taskId: task.id,
      taskType: task.taskType,
      totalMs: this.bench.elapsed(task.id),
      toolCalls,
      turns: task.events.filter((e) => e.type === "message").length,
    });

    await this.captureResponse(task);
    notifyTaskDone(this.profile, task);

    if (this.profile.memory?.reflect && this.shouldReflect(task)) {
      this.lastReflectAtMs = Date.now();
      reflectOnTask(task, this.profile);
    }
  }
}
