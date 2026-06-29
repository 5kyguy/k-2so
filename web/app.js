let selectedId = null;
let activeView = "tasks";
let expandedMemoryKey = null;

const tasksEl = document.getElementById("tasks");
const eventsEl = document.getElementById("events");
const memoryGridEl = document.getElementById("memory-grid");
const reflectionLogEl = document.getElementById("reflection-log");

function statusClass(status) {
  return `status ${status}`;
}

function canAbort(status) {
  return status === "queued" || status === "running";
}

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function previewText(text, max = 280) {
  const trimmed = (text || "").trim();
  if (!trimmed) {
    return "(empty)";
  }
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
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
  if (!tasks.length) {
    tasksEl.className = "empty";
    tasksEl.textContent = 'No tasks yet — run: k2so ask "…"';
    return;
  }
  tasksEl.className = "";
  tasksEl.innerHTML = tasks
    .map(
      (t) => `
    <div class="task${t.id === selectedId ? " selected" : ""}" data-id="${t.id}">
      <div class="task-header">
        <div class="${statusClass(t.status)}">${t.status}</div>
        ${
          canAbort(t.status)
            ? `<button class="abort" data-id="${t.id}" type="button">Abort</button>`
            : ""
        }
      </div>
      <div class="instruction">${escapeHtml(t.instruction)}</div>
    </div>`,
    )
    .join("");

  for (const el of tasksEl.querySelectorAll(".task")) {
    el.addEventListener("click", () => {
      selectedId = el.dataset.id;
      renderTasks(tasks);
      showEvents(tasks.find((t) => t.id === selectedId));
    });
  }

  for (const btn of tasksEl.querySelectorAll(".abort")) {
    btn.addEventListener("click", (event) => {
      void abortTask(btn.dataset.id, event);
    });
  }
}

function showEvents(task) {
  if (!task) {
    eventsEl.className = "empty";
    eventsEl.textContent = "Select a task";
    return;
  }
  eventsEl.className = "";
  const lines = [
    `id: ${task.id}`,
    `session: ${task.sessionId || "—"}`,
    `type: ${task.taskType || "background"}`,
    `created: ${task.createdAt}`,
    "",
    ...task.events.map((e) => `[${e.type}] ${e.at}\n${JSON.stringify(e.data ?? {}, null, 2)}`),
  ];
  eventsEl.textContent = lines.join("\n");
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
  renderTasks(tasks);
  if (selectedId) {
    showEvents(tasks.find((t) => t.id === selectedId));
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
es.onmessage = (msg) => {
  try {
    const data = JSON.parse(msg.data);
    if (data.type === "ping" || data.type === "connected") {
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
  void refresh();
  if (activeView === "memory") {
    void refreshMemory();
  }
  if (activeView === "reflection") {
    void refreshReflection();
  }
}, 5000);