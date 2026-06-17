let selectedId = null;

const tasksEl = document.getElementById("tasks");
const eventsEl = document.getElementById("events");

function statusClass(status) {
  return `status ${status}`;
}

function renderTasks(tasks) {
  if (!tasks.length) {
    tasksEl.className = "empty";
    tasksEl.textContent = "No tasks yet — run: k2so ask \"…\"";
    return;
  }
  tasksEl.className = "";
  tasksEl.innerHTML = tasks
    .map(
      (t) => `
    <div class="task${t.id === selectedId ? " selected" : ""}" data-id="${t.id}">
      <div class="${statusClass(t.status)}">${t.status}</div>
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
    `created: ${task.createdAt}`,
    "",
    ...task.events.map((e) => `[${e.type}] ${e.at}\n${JSON.stringify(e.data ?? {}, null, 2)}`),
  ];
  eventsEl.textContent = lines.join("\n");
}

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function refresh() {
  const res = await fetch("/tasks");
  const tasks = await res.json();
  renderTasks(tasks);
  if (selectedId) {
    showEvents(tasks.find((t) => t.id === selectedId));
  }
}

const es = new EventSource("/events");
es.onmessage = (msg) => {
  try {
    const data = JSON.parse(msg.data);
    if (data.type === "ping" || data.type === "connected") {
      return;
    }
    void refresh();
  } catch {
    // ignore
  }
};

void refresh();
setInterval(() => void refresh(), 5000);
