import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export interface BenchEntry {
  taskId: string;
  taskType: string;
  ttftMs?: number;
  totalMs?: number;
  toolCalls: number;
  turns: number;
  ramMb?: number;
  recordedAt: string;
}

export class BenchLogger {
  private path: string;
  private starts = new Map<string, number>();

  constructor(stateDir: string) {
    this.path = join(stateDir, "bench", "log.jsonl");
  }

  async init(): Promise<void> {
    await mkdir(join(this.path, ".."), { recursive: true });
  }

  markStart(taskId: string): void {
    this.starts.set(taskId, Date.now());
  }

  async record(entry: Omit<BenchEntry, "recordedAt">): Promise<void> {
    const line = JSON.stringify({
      ...entry,
      recordedAt: new Date().toISOString(),
    });
    await appendFile(this.path, `${line}\n`);
  }

  elapsed(taskId: string): number | undefined {
    const start = this.starts.get(taskId);
    if (!start) {
      return undefined;
    }
    return Date.now() - start;
  }
}
