let selectedId = null;
let activeView = "tasks";
let expandedMemoryKey = null;
let expandedEventKeys = new Set();
let lastTasks = [];
let sseConnected = false;

const tasksEl = document.getElementById("tasks");
const detailEl = document.getElementById("detail");
const statsEl = document.getElementById("stats");
const taskCountEl = document.getElementById("task-count");
const liveEl = document.getElementById("live");
const memoryGridEl = document.getElementById("memory-grid");
const reflectionLogEl = document.getElementById("reflection-log");

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function previewText(text, max = 280) {
  const trimmed = (text || "").trim();
  if (!trimmed) {
    return "(empty)";
  }
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

function shortId(id) {
  return id ? id.slice(0, 8) : "—";
}

function parseTime(iso) {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

function formatDuration(ms) {
  if (ms < 0 || !Number.isFinite(ms)) {
    return "—";
  }
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const sec = Math.floor(ms / 1000);
  if (sec < 60) {
    return `${sec}s`;
  }
  const min = Math.floor(sec / 60);
  const remSec = sec % 60;
  if (min < 60) {
    return remSec ? `${min}m ${remSec}s` : `${min}m`;
  }
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  return remMin ? `${hr}h ${remMin}m` : `${hr}h`;
}

function relativeTime(iso) {
  const ms = parseTime(iso);
  if (ms === null) {
    return iso || "—";
  }
  const diff = Date.now() - ms;
  const abs = Math.abs(diff);
  if (abs < 60_000) {
    return "just now";
  }
  if (abs < 3_600_000) {
    const m = Math.floor(abs / 60_000);
    return diff >= 0 ? `${m}m ago` : `in ${m}m`;
  }
  if (abs < 86_400_000) {
    const h = Math.floor(abs / 3_600_000);
    return diff >= 0 ? `${h}h ago` : `in ${h}h`;
  }
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function taskDuration(task) {
  const start = parseTime(task.createdAt);
  const end = parseTime(task.updatedAt);
  if (start === null) {
    return null;
  }
  if (task.status === "running" || task.status === "queued") {
    return Date.now() - start;
  }
  if (end === null) {
    return null;
  }
  return end - start;
}

function countByStatus(tasks) {
  const counts = { running: 0, queued: 0, done: 0, failed: 0, aborted: 0 };
  for (const t of tasks) {
    if (counts[t.status] !== undefined) {
      counts[t.status]++;
    }
  }
  return counts;
}

function sortTasks(tasks) {
  const order = { running: 0, queued: 1, done: 2, failed: 3, aborted: 4 };
  return [...tasks].sort((a, b) => {
    const sa = order[a.status] ?? 9;
    const sb = order[b.status] ?? 9;
    if (sa !== sb) {
      return sa - sb;
    }
    return (parseTime(b.updatedAt) ?? 0) - (parseTime(a.updatedAt) ?? 0);
  });
}

function canAbort(status) {
  return status === "queued" || status === "running";
}

function eventCounts(events) {
  let messages = 0;
  let tools = 0;
  for (const e of events ?? []) {
    if (e.type === "message") {
      messages++;
    }
    if (e.type === "tool") {
      tools++;
    }
  }
  return { messages, tools };
}

function extractPartText(data) {
  if (!data || typeof data !== "object") {
    return "";
  }
  const part = data;
  if (typeof part.text === "string" && part.text.trim()) {
    return part.text.trim();
  }
  if (typeof part.content === "string" && part.content.trim()) {
    return part.content.trim();
  }
  if (Array.isArray(part.parts)) {
    return part.parts
      .filter((p) => p?.type === "text" && p.text?.trim())
      .map((p) => p.text.trim())
      .join("\n");
  }
  return "";
}

function extractToolName(data) {
  if (!data || typeof data !== "object") {
    return "tool";
  }
  return data.tool || data.name || data.toolName || "tool";
}

function summarizeEvent(event) {
  const data = event.data ?? {};
  switch (event.type) {
    case "status": {
      const status = data.status || "update";
      const session = data.sessionId ? ` · session ${shortId(data.sessionId)}` : "";
      return { title: "Status", body: `${status}${session}`, muted: false };
    }
    case "message": {
      const text = extractPartText(data);
      return {
        title: data.role ? `Message (${data.role})` : "Message",
        body: text || "(no text content)",
        muted: !text,
      };
    }
    case "tool": {
      const name = extractToolName(data);
      const state = data.state || data.status;
      const detail = state ? ` — ${state}` : "";
      return { title: "Tool", body: `${name}${detail}`, muted: false };
    }
    case "error": {
      const msg = data.message || data.error || JSON.stringify(data);
      return { title: "Error", body: String(msg), muted: false };
    }
    case "done": {
      return { title: "Done", body: "Task completed successfully", muted: false };
    }
    default:
      return { title: event.type, body: JSON.stringify(data, null, 2), muted: true };
  }
}

function setLiveState(connected) {
  sseConnected = connected;
  liveEl.classList.toggle("connected", connected);
  liveEl.querySelector(".live-label").textContent = connected ? "live" : "reconnecting…";
}

function renderStats(tasks) {
  const c = countByStatus(tasks);
  const parts = [];
  if (c.running) {
    parts.push(`<span class="stat running"><strong>${c.running}</strong> running</span>`);
  }
  if (c.queued) {
    parts.push(`<span class="stat queued"><strong>${c.queued}</strong> queued</span>`);
  }
  if (c.done) {
    parts.push(`<span class="stat done"><strong>${c.done}</strong> done</span>`);
  }
  if (c.failed + c.aborted) {
    parts.push(
      `<span class="stat failed"><strong>${c.failed + c.aborted}</strong> failed</span>`,
    );
  }
  statsEl.innerHTML = parts.length ? parts.join("") : `<span class="stat">idle</span>`;
  taskCountEl.textContent = tasks.length ? `${tasks.length} total` : "";
}

function setView(view) {
  activeView = view;
  for (const btn of document.querySelectorAll("nav button")) {
    btn.classList.toggle("active", btn.dataset.view === view);
  }
  for (const panel of document.querySelectorAll(".view")) {
    panel.classList.toggle("active", panel.id === `view-${view}`);
  }
  if (view === "memory") {
    void refreshMemory();
  }
  if (view === "reflection") {
    void refreshReflection();
  }
}

for (const btn of document.querySelectorAll("nav button")) {
  btn.addEventListener("click", () => setView(btn.dataset.view));
}

function selectTask(id, tasks) {
  selectedId = id;
  const params = new URLSearchParams(window.location.search);
  if (id) {
    params.set("task", id);
  } else {
    params.delete("task");
  }
  const qs = params.toString();
  const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
  window.history.replaceState(null, "", url);
  renderTasks(tasks ?? lastTasks);
  showDetail((tasks ?? lastTasks).find((t) => t.id === selectedId));
}

function pickInitialTask(tasks) {
  const fromUrl = new URLSearchParams(window.location.search).get("task");
  if (fromUrl && tasks.some((t) => t.id === fromUrl)) {
    return fromUrl;
  }
  const running = tasks.find((t) => t.status === "running");
  if (running) {
    return running.id;
  }
  const queued = tasks.find((t) => t.status === "queued");
  if (queued) {
    return queued.id;
  }
  const sorted = sortTasks(tasks);
  return sorted[0]?.id ?? null;
}

async function abortTask(taskId, event) {
  event.stopPropagation();
  const res = await fetch(`/tasks/${taskId}/abort`, { method: "POST" });
  if (!res.ok) {
    alert("Abort failed");
    return;
  }
  void refresh();
}

function renderTasks(tasks) {
  lastTasks = tasks;
  renderStats(tasks);

  if (!tasks.length) {
    tasksEl.className = "task-list empty";
    tasksEl.textContent = 'No tasks yet — run: k2so ask "…"';
    detailEl.innerHTML = `<div class="detail-empty">No tasks to show</div>`;
    return;
  }

  const sorted = sortTasks(tasks);
  tasksEl.className = "task-list";
  tasksEl.innerHTML = sorted
    .map((t) => {
      const counts = eventCounts(t.events);
      const dur = taskDuration(t);
      const stats = [];
      if (counts.tools) {
        stats.push(`${counts.tools} tool${counts.tools === 1 ? "" : "s"}`);
      }
      if (counts.messages) {
        stats.push(`${counts.messages} msg`);
      }
      if (dur !== null && t.status !== "queued") {
        stats.push(formatDuration(dur));
      }
      return `
    <div class="task${t.id === selectedId ? " selected" : ""}" data-id="${t.id}">
      <div class="task-top">
        <div class="task-meta-row">
          <span class="pill ${t.status}">${t.status}</span>
          <span class="task-id">${shortId(t.id)}</span>
        </div>
        ${
          canAbort(t.status)
            ? `<button class="abort" data-id="${t.id}" type="button">Abort</button>`
            : `<span class="task-time">${relativeTime(t.updatedAt)}</span>`
        }
      </div>
      <div class="instruction">${escapeHtml(t.instruction)}</div>
      ${stats.length ? `<div class="task-stats">${stats.map(escapeHtml).join(" · ")}</div>` : ""}
    </div>`;
    })
    .join("");

  for (const el of tasksEl.querySelectorAll(".task")) {
    el.addEventListener("click", () => selectTask(el.dataset.id, tasks));
  }

  for (const btn of tasksEl.querySelectorAll(".abort")) {
    btn.addEventListener("click", (event) => {
      void abortTask(btn.dataset.id, event);
    });
  }
}

function renderTimeline(task) {
  const events = task.events ?? [];
  if (!events.length) {
    return `<div class="detail-empty" style="padding:1.5rem 0">No activity yet</div>`;
  }

  return `
    <div class="timeline">
      ${events
        .map((e, i) => {
          const key = `${task.id}:${i}`;
          const summary = summarizeEvent(e);
          const expanded = expandedEventKeys.has(key);
          const doneClass = e.type === "done" ? (task.status === "done" ? "ok" : "failed") : "";
          const raw = JSON.stringify(e.data ?? {}, null, 2);
          return `
        <div class="tl-item ${e.type} ${doneClass}${expanded ? " expanded" : ""}" data-event-key="${key}">
          <span class="tl-dot"></span>
          <div class="tl-head">
            <span class="tl-type">${escapeHtml(summary.title)}</span>
            <span class="tl-time">${escapeHtml(relativeTime(e.at))}</span>
          </div>
          <div class="tl-body${summary.muted ? " muted" : ""}">${escapeHtml(summary.body)}</div>
          <button type="button" class="tl-toggle" data-event-key="${key}">${expanded ? "Hide raw" : "Show raw"}</button>
          <div class="tl-raw">${escapeHtml(raw)}</div>
        </div>`;
        })
        .join("")}
    </div>`;
}

function showDetail(task) {
  if (!task) {
    detailEl.innerHTML = `<div class="detail-empty">Select a task to view activity</div>`;
    return;
  }

  const dur = taskDuration(task);
  const counts = eventCounts(task.events);
  const parent = task.parentTaskId
    ? `<span class="meta-link" data-parent="${task.parentTaskId}">${shortId(task.parentTaskId)}</span>`
    : "—";

  detailEl.innerHTML = `
    <section>
      <div class="meta-grid">
        <div class="meta-item">
          <label>Task ID</label>
          <code title="${escapeHtml(task.id)}">${escapeHtml(task.id)}</code>
        </div>
        <div class="meta-item">
          <label>Status</label>
          <span class="pill ${task.status}">${task.status}</span>
        </div>
        <div class="meta-item">
          <label>Session</label>
          <span>${task.sessionId ? `<code>${escapeHtml(shortId(task.sessionId))}</code>` : "—"}</span>
        </div>
        <div class="meta-item">
          <label>Type</label>
          <span>${escapeHtml(task.taskType || "background")}</span>
        </div>
        <div class="meta-item">
          <label>Parent</label>
          <span>${parent}</span>
        </div>
        <div class="meta-item">
          <label>Created</label>
          <span title="${escapeHtml(task.createdAt)}">${escapeHtml(relativeTime(task.createdAt))}</span>
        </div>
        <div class="meta-item">
          <label>Updated</label>
          <span title="${escapeHtml(task.updatedAt)}">${escapeHtml(relativeTime(task.updatedAt))}</span>
        </div>
        <div class="meta-item">
          <label>Duration</label>
          <span>${dur !== null ? escapeHtml(formatDuration(dur)) : "—"}</span>
        </div>
        <div class="meta-item">
          <label>Activity</label>
          <span>${counts.tools} tools · ${counts.messages} messages</span>
        </div>
      </div>
      ${task.error ? `<div class="error-banner">${escapeHtml(task.error)}</div>` : ""}
      <div class="section-head" style="padding:0 0.85rem">
        <h2>Activity</h2>
        <span class="task-count">${(task.events ?? []).length} events</span>
      </div>
      <div class="timeline-wrap">
        ${renderTimeline(task)}
      </div>
    </section>`;

  const parentLink = detailEl.querySelector("[data-parent]");
  if (parentLink) {
    parentLink.addEventListener("click", () => selectTask(parentLink.dataset.parent, lastTasks));
  }

  for (const btn of detailEl.querySelectorAll(".tl-toggle")) {
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const key = btn.dataset.eventKey;
      if (expandedEventKeys.has(key)) {
        expandedEventKeys.delete(key);
      } else {
        expandedEventKeys.add(key);
      }
      showDetail(task);
    });
  }
}

function memoryCard(key, title, path, content) {
  const expanded = expandedMemoryKey === key;
  return `
    <div class="card mem-card${expanded ? " expanded" : ""}" data-mem-key="${key}">
      <h2>${escapeHtml(title)}</h2>
      <div class="mem-path">${escapeHtml(path)}</div>
      ${
        expanded
          ? `<div class="raw-panel">${escapeHtml(content.trim() || "(empty)")}</div>`
          : `<div class="mem-preview">${escapeHtml(previewText(content))}</div>`
      }
    </div>`;
}

function renderMemory(snapshot) {
  const cards = [
    memoryCard("soul", "Soul", snapshot.soul.path, snapshot.soul.content),
    memoryCard("user", "User", snapshot.user.path, snapshot.user.content),
    memoryCard("memory", "Memory", snapshot.memory.path, snapshot.memory.content),
  ];

  const skillsPreview =
    snapshot.skills.length === 0
      ? "(no skills yet)"
      : snapshot.skills
          .map(
            (skill) => `
        <div class="skill-item" data-skill-slug="${escapeHtml(skill.slug)}">
          <div class="skill-name">${escapeHtml(skill.name)}</div>
          <div class="skill-trigger">${escapeHtml(skill.trigger || "no trigger")}</div>
        </div>`,
          )
          .join("");

  const skillsExpanded = expandedMemoryKey === "skills";
  cards.push(`
    <div class="card mem-card${skillsExpanded ? " expanded" : ""}" data-mem-key="skills">
      <h2>Skills</h2>
      <div class="mem-path">${escapeHtml(snapshot.paths.skillsDir)}</div>
      ${
        skillsExpanded
          ? `<div class="raw-panel">${snapshot.skills
              .map(
                (skill) =>
                  `## ${skill.name}\npath: ${skill.path}\ntrigger: ${skill.trigger || "—"}\n\n${skill.content.trim() || "(empty)"}`,
              )
              .join("\n\n---\n\n") || "(no skills yet)"}</div>`
          : `<div>${skillsPreview}</div>`
      }
    </div>`);

  memoryGridEl.className = "grid-mem";
  memoryGridEl.innerHTML = cards.join("");

  for (const card of memoryGridEl.querySelectorAll(".mem-card")) {
    card.addEventListener("click", () => {
      const key = card.dataset.memKey;
      expandedMemoryKey = expandedMemoryKey === key ? null : key;
      renderMemory(snapshot);
    });
  }
}

function renderReflection(entries) {
  if (!entries.length) {
    reflectionLogEl.className = "empty";
    reflectionLogEl.textContent = "No reflection entries yet.";
    return;
  }

  reflectionLogEl.className = "";
  reflectionLogEl.innerHTML = [...entries]
    .reverse()
    .map((entry) => {
      const applied = entry.applied
        ? `user=${entry.applied.user} memory=${entry.applied.memory} skill=${entry.applied.skill}`
        : "";
      const body = entry.error
        ? entry.error
        : JSON.stringify(entry.result ?? {}, null, 2);
      return `
      <div class="reflection-entry${entry.error ? " error" : ""}">
        <div class="meta">${escapeHtml(entry.recordedAt)} · task ${escapeHtml(entry.taskId.slice(0, 8))} · ${escapeHtml(entry.model)}${applied ? ` · ${escapeHtml(applied)}` : ""}</div>
        <pre>${escapeHtml(body)}</pre>
      </div>`;
    })
    .join("");
}

async function refresh() {
  const res = await fetch("/tasks");
  const tasks = await res.json();

  if (!selectedId) {
    selectedId = pickInitialTask(tasks);
  } else if (!tasks.some((t) => t.id === selectedId)) {
    selectedId = pickInitialTask(tasks);
    expandedEventKeys.clear();
  }

  renderTasks(tasks);
  if (selectedId) {
    showDetail(tasks.find((t) => t.id === selectedId));
  }
}

async function refreshMemory() {
  const res = await fetch("/memory");
  if (!res.ok) {
    memoryGridEl.className = "empty";
    memoryGridEl.textContent = "Failed to load memory";
    return;
  }
  renderMemory(await res.json());
}

async function refreshReflection() {
  const res = await fetch("/memory/reflection?limit=50");
  if (!res.ok) {
    reflectionLogEl.className = "empty";
    reflectionLogEl.textContent = "Failed to load reflection log";
    return;
  }
  const data = await res.json();
  renderReflection(data.entries ?? []);
}

const es = new EventSource("/events");
es.onopen = () => setLiveState(true);
es.onerror = () => setLiveState(false);
es.onmessage = (msg) => {
  try {
    const data = JSON.parse(msg.data);
    if (data.type === "ping") {
      return;
    }
    if (data.type === "connected") {
      setLiveState(true);
      return;
    }
    void refresh();
    if (activeView === "memory") {
      void refreshMemory();
    }
    if (activeView === "reflection") {
      void refreshReflection();
    }
  } catch {
    // ignore
  }
};

void refresh();
setInterval(() => {
  if (activeView === "tasks" && lastTasks.length) {
    renderTasks(lastTasks);
    if (selectedId) {
      showDetail(lastTasks.find((t) => t.id === selectedId));
    }
  }
  void refresh();
  if (activeView === "memory") {
    void refreshMemory();
  }
  if (activeView === "reflection") {
    void refreshReflection();
  }
}, 5000);
