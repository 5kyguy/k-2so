export type TaskStatus = "queued" | "running" | "done" | "failed" | "aborted";

export interface AgentEvent {
  type: "status" | "message" | "tool" | "error" | "done";
  taskId: string;
  at: string;
  data?: unknown;
}

export interface TaskOpts {
  taskId: string;
  model?: string;
  agent?: string;
  taskType?: string;
  parentTaskId?: string;
  parentSessionId?: string;
}

export interface TaskHandle {
  id: string;
  sessionId: string;
}

export interface TaskRecord {
  id: string;
  sessionId: string;
  instruction: string;
  taskType: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  error?: string;
  /** Final assistant text captured when the task completes. */
  response?: string;
  events: AgentEvent[];
  parentTaskId?: string;
}

export type Unsubscribe = () => void;

export interface AgentEngine {
  readonly name: string;
  isReady(): Promise<boolean>;
  startTask(instruction: string, opts: TaskOpts): Promise<TaskHandle>;
  abort(taskId: string, sessionId: string): Promise<void>;
  subscribe(onEvent: (event: AgentEvent) => void): Unsubscribe;
}
