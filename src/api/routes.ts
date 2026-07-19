import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { K2soProfile } from "../config.js";
import { getMemorySnapshot, readReflectionLog } from "../memory/api.js";
import { fetchTaskResponse } from "../memory/transcript.js";
import type { TaskManager } from "../tasks/manager.js";

export function createApi(manager: TaskManager, webRoot: string, profile: K2soProfile): Hono {
  const app = new Hono();
  const clients = new Set<(data: string) => void>();

  const broadcast = (payload: unknown) => {
    const data = JSON.stringify(payload);
    for (const send of clients) {
      send(data);
    }
  };

  manager.setBroadcaster(broadcast);

  app.get("/health", (c) => c.json({ ok: true }));

  app.get("/tasks", (c) => c.json(manager.list()));

  app.get("/tasks/:id", (c) => {
    const task = manager.get(c.req.param("id"));
    if (!task) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(task);
  });

  app.get("/tasks/:id/response", async (c) => {
    const id = c.req.param("id");
    const task = manager.get(id) ?? manager.list().find((t) => t.id.startsWith(id));
    if (!task) {
      return c.json({ error: "not found" }, 404);
    }
    if (task.response?.trim()) {
      return c.json({ response: task.response, source: "stored" as const });
    }
    if (!task.sessionId) {
      return c.json({ response: "", source: "none" as const });
    }
    try {
      const response = await fetchTaskResponse(profile.engine.opencode_url, task.sessionId);
      return c.json({
        response,
        source: response.trim() ? ("opencode" as const) : ("none" as const),
      });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
    }
  });

  app.post("/tasks", async (c) => {
    const body = await c.req.json<{
      instruction?: string;
      model?: string;
      agent?: string;
      taskType?: string;
      parentTaskId?: string;
    }>();
    if (!body.instruction?.trim()) {
      return c.json({ error: "instruction required" }, 400);
    }
    try {
      const task = await manager.enqueue(body.instruction, {
        model: body.model,
        agent: body.agent,
        taskType: body.taskType,
        parentTaskId: body.parentTaskId,
      });
      broadcast({ type: "task.created", task });
      return c.json(task, 202);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  app.post("/tasks/:id/abort", async (c) => {
    const ok = await manager.abort(c.req.param("id"));
    if (!ok) {
      return c.json({ error: "not found or not abortable" }, 404);
    }
    broadcast({ type: "task.aborted", id: c.req.param("id") });
    return c.json({ ok: true });
  });

  app.post("/admin/prune", async (c) => {
    const result = await manager.prune();
    broadcast({ type: "tasks.pruned", ...result });
    return c.json(result);
  });

  app.get("/memory", async (c) => c.json(await getMemorySnapshot(profile)));

  app.get("/memory/reflection", async (c) => {
    const limit = Number.parseInt(c.req.query("limit") ?? "50", 10);
    const entries = await readReflectionLog(profile.daemon.state, Number.isFinite(limit) ? limit : 50);
    return c.json({ entries });
  });

  app.get("/events", (c) =>
    streamSSE(c, async (stream) => {
      const send = (data: string) => {
        void stream.writeSSE({ data });
      };
      clients.add(send);
      await stream.writeSSE({ data: JSON.stringify({ type: "connected" }) });

      const keepAlive = setInterval(() => {
        void stream.writeSSE({ data: JSON.stringify({ type: "ping" }) });
      }, 15000);

      stream.onAbort(() => {
        clearInterval(keepAlive);
        clients.delete(send);
      });

      await new Promise(() => {});
    }),
  );

  app.get("/", async (c) => {
    const html = await readFile(join(webRoot, "index.html"), "utf8");
    return c.html(html);
  });

  app.get("/app.js", async (c) => {
    const js = await readFile(join(webRoot, "app.js"), "utf8");
    return c.body(js, 200, { "Content-Type": "application/javascript" });
  });

  return app;
}

export function webRoot(): string {
  return join(fileURLToPath(new URL("..", import.meta.url)), "web");
}
