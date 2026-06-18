import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { TaskRecord } from "../engine/interface.js";

export class TaskStore {
  private tasks = new Map<string, TaskRecord>();
  private indexPath: string;

  constructor(stateDir: string) {
    this.indexPath = join(stateDir, "tasks.json");
  }

  async load(): Promise<void> {
    await mkdir(join(this.indexPath, ".."), { recursive: true });
    try {
      const raw = await readFile(this.indexPath, "utf8");
      const list = JSON.parse(raw) as TaskRecord[];
      for (const task of list) {
        this.tasks.set(task.id, {
          ...task,
          taskType: task.taskType ?? "background",
          events: task.events ?? [],
        });
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw err;
      }
    }
  }

  async save(): Promise<void> {
    const list = [...this.tasks.values()].sort(
      (a, b) => b.createdAt.localeCompare(a.createdAt),
    );
    await writeFile(this.indexPath, JSON.stringify(list, null, 2));
  }

  list(): TaskRecord[] {
    return [...this.tasks.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get(id: string): TaskRecord | undefined {
    return this.tasks.get(id);
  }

  upsert(task: TaskRecord): void {
    this.tasks.set(task.id, task);
  }

  remove(id: string): void {
    this.tasks.delete(id);
  }
}
