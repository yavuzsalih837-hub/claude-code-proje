'use strict';

// Fix: re-define window.fetch as configurable/writable so environments that
// try to replace it (polyfills, interceptors, JSDOM, Electron) don't throw
// "Cannot set property fetch of window".
if (typeof window !== 'undefined' && typeof window.fetch === 'function') {
  const desc = Object.getOwnPropertyDescriptor(window, 'fetch')
    || Object.getOwnPropertyDescriptor(Object.getPrototypeOf(window), 'fetch');
  if (desc && (!desc.configurable || desc.writable === false)) {
    try {
      Object.defineProperty(window, 'fetch', {
        configurable: true,
        writable: true,
        value: window.fetch.bind(window),
      });
    } catch (_) { /* already accessible — ignore */ }
  }
}

// ── DATA ──────────────────────────────────────────────────────────────────────
const AGENT_TYPES = [
  { emoji: '🤖', label: 'LLM Agent' },
  { emoji: '🕷️', label: 'Crawler' },
  { emoji: '📊', label: 'Analyst' },
  { emoji: '🔍', label: 'Search' },
  { emoji: '⚙️', label: 'Worker' },
  { emoji: '🧠', label: 'Reasoner' },
  { emoji: '📡', label: 'Monitor' },
  { emoji: '💾', label: 'Storage' },
];

const TASK_TEMPLATES = [
  'Scraping data from external API',
  'Processing NLP pipeline',
  'Running vector embeddings',
  'Indexing document corpus',
  'Querying knowledge base',
  'Summarizing research report',
  'Validating data schema',
  'Generating structured output',
  'Monitoring endpoint health',
  'Classifying user intents',
  'Extracting named entities',
  'Compiling task results',
  'Waiting for upstream agent',
  'Retrying failed request',
  'Syncing state with registry',
];

const STATUSES = ['active', 'active', 'active', 'waiting', 'error', 'idle'];
const STATUS_COLORS = { active: '#22c55e', waiting: '#eab308', error: '#ef4444', idle: '#3b82f6' };

let agents = [];
let feed = [];
let tasksDone = 0;
let throughputHistory = new Array(10).fill(0);
let currentFilter = 'all';
let notifCount = 0;
let tickTasksDone = 0;
let backendActive = false;

// ── LOCALSTORAGE ──────────────────────────────────────────────────────────────
const LS_KEY = 'agentDashboard_imported';

function saveImportedToStorage() {
  const imported = agents.filter(a => a.fromImport).map(a => ({
    agentId: a.agentId,
    agentName: a.name,
    projectName: a.projectName,
    taskName: a.task,
    stage: a.stage,
    status: a.status,
    progress: a.progress,
    notes: a.notes,
    updatedAt: a.updatedAt,
  }));
  localStorage.setItem(LS_KEY, JSON.stringify(imported));
}

function loadImportedFromStorage() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function buildAgentFromImport(item, newId) {
  const status = normalizeStatus(item.status);
  return {
    id: newId,
    agentId: String(item.agentId),
    name: item.agentName || String(item.agentId),
    type: 'Imported',
    emoji: '📥',
    status,
    task: item.taskName || '—',
    progress: Math.min(100, Math.max(0, parseInt(item.progress) || 0)),
    uptime: 0,
    tasksCompleted: 0,
    errorCount: 0,
    taskLog: [],
    created: item.updatedAt ? new Date(item.updatedAt).getTime() : Date.now(),
    fromImport: true,
    projectName: item.projectName || '',
    stage: item.stage || '',
    notes: item.notes || '',
    updatedAt: item.updatedAt || new Date().toISOString(),
  };
}

// ── INIT ──────────────────────────────────────────────────────────────────────
function randomInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randomItem(arr) { return arr[randomInt(0, arr.length - 1)]; }
function randomName() {
  const prefixes = ['Alpha','Beta','Gamma','Delta','Sigma','Omega','Nova','Zeta','Apex','Core'];
  const suffixes = ['-01','-02','-03','-07','-12','-X','-Prime','-Neo'];
  return randomItem(prefixes) + randomItem(suffixes);
}

function createAgent(id) {
  const type = randomItem(AGENT_TYPES);
  const status = randomItem(STATUSES);
  return {
    id,
    name: randomName(),
    type: type.label,
    emoji: type.emoji,
    status,
    task: randomItem(TASK_TEMPLATES),
    progress: status === 'error' ? randomInt(10, 60) : status === 'waiting' ? randomInt(0, 30) : randomInt(20, 95),
    uptime: randomInt(1, 480),
    tasksCompleted: randomInt(0, 200),
    errorCount: status === 'error' ? randomInt(1, 10) : randomInt(0, 3),
    taskLog: generateTaskLog(),
    created: Date.now() - randomInt(0, 3600000),
  };
}

function generateTaskLog() {
  const count = randomInt(3, 6);
  const log = [];
  const statuses = ['done', 'done', 'done', 'error', 'active'];
  for (let i = 0; i < count; i++) {
    log.push({
      name: randomItem(TASK_TEMPLATES),
      status: i === count - 1 ? 'active' : randomItem(statuses),
      duration: randomInt(1, 120) + 's',
    });
  }
  return log;
}

function initAgents(n = 8) {
  agents = [];
  for (let i = 1; i <= n; i++) agents.push(createAgent(i));
}
function normalizeStatus(status) {
  if (!status) return 'idle';
  const s = String(status).toLowerCase();

  if (s === 'running' || s === 'active' || s === 'in-progress') return 'active';
  if (s === 'waiting' || s === 'blocked') return 'waiting';
  if (s === 'error' || s === 'failed') return 'error';

  return 'idle';
}
// ── RENDER ────────────────────────────────────────────────────────────────────
function renderStats() {
  const total = agents.length;
  const active = agents.filter(a => normalizeStatus(a.status) === 'active').length;
const waiting = agents.filter(a => normalizeStatus(a.status) === 'waiting').length;
const error = agents.filter(a => normalizeStatus(a.status) === 'error').length;

  document.getElementById('stat-total').textContent = total;
  document.getElementById('stat-active').textContent = active;
  document.getElementById('stat-waiting').textContent = waiting;
  document.getElementById('stat-error').textContent = error;
  document.getElementById('stat-done').textContent = tasksDone;
  document.getElementById('stat-done-d').textContent = `+${tickTasksDone} this tick`;

  const pct = v => total ? Math.round(v / total * 100) + '%' : '0%';
  document.getElementById('bar-active').style.width = pct(active);
  document.getElementById('bar-waiting').style.width = pct(waiting);
  document.getElementById('bar-error').style.width = pct(error);

  document.getElementById('notif-count').textContent = notifCount;
}

function renderAgents() {
  const list = document.getElementById('agent-list');
  const filtered = currentFilter === 'all'
  ? agents
  : agents.filter(a => normalizeStatus(a.status) === currentFilter);

  if (filtered.length === 0) {
    list.innerHTML = `<div style="text-align:center;padding:40px;color:var(--muted);font-size:0.85rem;">No agents match this filter.</div>`;
    return;
  }

  list.innerHTML = filtered.map(a => `
    <div class="agent-card" data-id="${a.id}">
      <div class="agent-avatar" style="background:${STATUS_COLORS[normalizeStatus(a.status)]}22">
  ${a.emoji}
</div>
      <div class="agent-info">
        <div class="agent-row1">
          <span class="agent-name">${a.name}</span>
          <span class="status-badge ${normalizeStatus(a.status)}">
  ${normalizeStatus(a.status)}
</span>
        </div>
        <div class="agent-task">${a.task}</div>
        <div class="progress-row">
          <div class="progress-bar">
            <div class="progress-fill ${normalizeStatus(a.status)}" style="width:${a.progress}%">
          </div>
          <span class="progress-pct">${a.progress}%</span>
        </div>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.agent-card').forEach(card => {
    card.addEventListener('click', () => openModal(card.dataset.id));
  });
}

// ── FEED ──────────────────────────────────────────────────────────────────────
function pushFeed(type, message, agentName) {
  const now = new Date();
  const time = now.toTimeString().slice(0, 8);
  feed.unshift({ type, message, agentName, time });
  if (feed.length > 60) feed.pop();
  renderFeed();
}

function renderFeed() {
  const el = document.getElementById('feed');
  el.innerHTML = feed.slice(0, 25).map(f => `
    <div class="feed-item">
      <span class="feed-dot ${f.type}"></span>
      <span class="feed-text"><strong>${f.agentName}</strong> ${f.message}</span>
      <span class="feed-time">${f.time}</span>
    </div>
  `).join('');
}

// ── CHART ─────────────────────────────────────────────────────────────────────
function renderChart() {
  const canvas = document.getElementById('chart');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const pad = 8;
  const max = Math.max(...throughputHistory, 1);

  ctx.clearRect(0, 0, W, H);

  const step = (W - pad * 2) / (throughputHistory.length - 1);
  const points = throughputHistory.map((v, i) => ({
    x: pad + i * step,
    y: H - pad - (v / max) * (H - pad * 2),
  }));

  // Area fill
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, 'rgba(99,102,241,0.35)');
  grad.addColorStop(1, 'rgba(99,102,241,0)');
  ctx.beginPath();
  ctx.moveTo(points[0].x, H - pad);
  points.forEach(p => ctx.lineTo(p.x, p.y));
  ctx.lineTo(points[points.length - 1].x, H - pad);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Line
  ctx.beginPath();
  points.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
  ctx.strokeStyle = '#6366f1';
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.stroke();

  // Dots
  points.forEach(p => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#6366f1';
    ctx.fill();
  });
}

// ── MODAL ─────────────────────────────────────────────────────────────────────
function openModal(id) {
  const a = agents.find(x => String(x.id) === String(id));
  if (!a) return;
  const uptimeStr = a.uptime >= 60 ? `${Math.floor(a.uptime / 60)}h ${a.uptime % 60}m` : `${a.uptime}m`;
  const createdStr = new Date(a.created).toLocaleTimeString();

  const importSection = a.fromImport ? `
    <div class="modal-section">
      <div class="modal-section-title">Import Details</div>
      <div class="modal-kv">
        ${a.projectName ? `<div class="kv-item"><div class="kv-label">Project</div><div class="kv-value">${a.projectName}</div></div>` : ''}
        ${a.stage ? `<div class="kv-item"><div class="kv-label">Stage</div><div class="kv-value">${a.stage}</div></div>` : ''}
        ${a.updatedAt ? `<div class="kv-item"><div class="kv-label">Updated At</div><div class="kv-value" style="font-size:0.78rem">${new Date(a.updatedAt).toLocaleString()}</div></div>` : ''}
        ${a.agentId ? `<div class="kv-item"><div class="kv-label">Agent ID</div><div class="kv-value" style="font-size:0.78rem">${a.agentId}</div></div>` : ''}
      </div>
      ${a.notes ? `<div style="background:var(--bg3);border-radius:8px;padding:10px 14px;font-size:0.82rem;color:var(--muted);margin-top:8px;">${a.notes}</div>` : ''}
    </div>
  ` : '';

  const taskLogSection = a.taskLog.length ? `
    <div class="modal-section">
      <div class="modal-section-title">Task Log</div>
      <div class="task-list-modal">
        ${a.taskLog.map(t => `
          <div class="task-item-modal">
            <span class="ti-status" style="color:${t.status === 'done' ? 'var(--green)' : t.status === 'error' ? 'var(--red)' : 'var(--yellow)'}">
              ${t.status === 'done' ? '✓' : t.status === 'error' ? '✗' : '◌'}
            </span>
            <span class="ti-name">${t.name}</span>
            <span class="ti-time">${t.duration}</span>
          </div>
        `).join('')}
      </div>
    </div>
  ` : '';

  document.getElementById('modal-body').innerHTML = `
    <div class="modal-agent-header">
      <div class="modal-agent-avatar" style="background:${STATUS_COLORS[a.status]}22">${a.emoji}</div>
      <div>
        <div class="modal-agent-name">${a.name}</div>
        <div class="modal-agent-type">${a.type} · <span class="status-badge ${a.status}">${a.status}</span></div>
      </div>
    </div>

    <div class="modal-section">
      <div class="modal-section-title">Metrics</div>
      <div class="modal-kv">
        <div class="kv-item"><div class="kv-label">Progress</div><div class="kv-value">${a.progress}%</div></div>
        <div class="kv-item"><div class="kv-label">Uptime</div><div class="kv-value">${uptimeStr}</div></div>
        <div class="kv-item"><div class="kv-label">Tasks Done</div><div class="kv-value">${a.tasksCompleted}</div></div>
        <div class="kv-item"><div class="kv-label">Errors</div><div class="kv-value" style="color:${a.errorCount > 0 ? 'var(--red)' : 'inherit'}">${a.errorCount}</div></div>
      </div>
    </div>

    <div class="modal-section">
      <div class="modal-section-title">Current Task</div>
      <div style="background:var(--bg3);border-radius:8px;padding:12px 14px;font-size:0.88rem;">${a.task}</div>
    </div>

    ${importSection}
    ${taskLogSection}
  `;

  document.getElementById('modal-overlay').classList.add('open');
}

document.getElementById('modal-close').addEventListener('click', () => {
  document.getElementById('modal-overlay').classList.remove('open');
});
document.getElementById('modal-overlay').addEventListener('click', e => {
  if (e.target === e.currentTarget) e.currentTarget.classList.remove('open');
});

// ── SIMULATION ────────────────────────────────────────────────────────────────
function simulateTick() {
  tickTasksDone = 0;

  agents.forEach(a => {
    if (a.fromImport) return;
    const roll = Math.random();

    if (a.status === 'active') {
      // Progress
      a.progress = Math.min(100, a.progress + randomInt(1, 8));

      if (a.progress >= 100) {
        // Task complete
        a.progress = 0;
        a.task = randomItem(TASK_TEMPLATES);
        a.tasksCompleted++;
        tasksDone++;
        tickTasksDone++;
        pushFeed('done', `completed task: "${a.task}"`, a.name);

        // Possibly change status
        if (roll < 0.1) {
          a.status = 'error';
          a.errorCount++;
          pushFeed('error', 'encountered an error', a.name);
          notifCount++;
        } else if (roll < 0.2) {
          a.status = 'waiting';
          pushFeed('waiting', 'is now waiting for upstream', a.name);
        }
      }
    } else if (a.status === 'waiting') {
      if (roll < 0.3) {
        a.status = 'active';
        a.progress = randomInt(5, 20);
        pushFeed('active', 'resumed task processing', a.name);
      }
    } else if (a.status === 'error') {
      if (roll < 0.2) {
        a.status = 'active';
        a.progress = randomInt(0, 20);
        a.task = randomItem(TASK_TEMPLATES);
        pushFeed('active', 'recovered and restarted task', a.name);
        notifCount = Math.max(0, notifCount - 1);
      }
    } else if (a.status === 'idle') {
      if (roll < 0.25) {
        a.status = 'active';
        a.task = randomItem(TASK_TEMPLATES);
        a.progress = 0;
        pushFeed('active', `started task: "${a.task}"`, a.name);
      }
    }
  });

  throughputHistory.push(tickTasksDone);
  if (throughputHistory.length > 10) throughputHistory.shift();

  renderStats();
  renderAgents();
  renderChart();
}

// ── FILTER TABS ───────────────────────────────────────────────────────────────
document.querySelectorAll('.ftab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.ftab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    renderAgents();
  });
});

// ── ADD AGENT ─────────────────────────────────────────────────────────────────
document.getElementById('btn-add-agent').addEventListener('click', () => {
  const newId = agents.length ? Math.max(...agents.map(a => a.id)) + 1 : 1;
  const a = createAgent(newId);
  a.status = 'active';
  a.progress = 0;
  agents.push(a);
  pushFeed('active', `was deployed`, a.name);
  renderStats();
  renderAgents();
});

// ── JSON IMPORT ───────────────────────────────────────────────────────────────
document.getElementById('btn-apply-json').addEventListener('click', () => {
  const raw = document.getElementById('import-json').value.trim();
  const statusEl = document.getElementById('import-status');

  let data;
  try {
    data = JSON.parse(raw);
    if (!Array.isArray(data)) data = [data];
  } catch (e) {
    statusEl.className = 'import-status error';
    statusEl.textContent = 'Invalid JSON: ' + e.message;
    return;
  }

  let created = 0, updated = 0, skipped = 0;

  data.forEach(item => {
    if (!item.agentId) { skipped++; return; }
    const agentId = String(item.agentId);
    const existing = agents.find(a => a.agentId === agentId);

    if (existing) {
      const status = ['active', 'waiting', 'error', 'idle'].includes(item.status) ? item.status : existing.status;
      existing.name = item.agentName || existing.name;
      existing.status = status;
      existing.task = item.taskName || existing.task;
      existing.progress = Math.min(100, Math.max(0, parseInt(item.progress) ?? existing.progress));
      existing.projectName = item.projectName ?? existing.projectName;
      existing.stage = item.stage ?? existing.stage;
      existing.notes = item.notes ?? existing.notes;
      existing.updatedAt = item.updatedAt || new Date().toISOString();
      existing.fromImport = true;
      updated++;
    } else {
      const newId = agents.length ? Math.max(...agents.map(a => a.id)) + 1 : 1;
      agents.push(buildAgentFromImport({ ...item, agentId }, newId));
      created++;
    }
  });

  saveImportedToStorage();

  statusEl.className = 'import-status success';
  statusEl.textContent = `✓ ${created} created, ${updated} updated${skipped ? `, ${skipped} skipped` : ''}`;
  setTimeout(() => { statusEl.textContent = ''; statusEl.className = 'import-status'; }, 3000);

  pushFeed('active', `JSON import: ${created} created, ${updated} updated`, 'System');
  renderStats();
  renderAgents();
  postToBackend(data);
});

// ── BACKEND ───────────────────────────────────────────────────────────────────
async function fetchAgents() {
  try {
const res = await fetch("http://76.13.0.34:3000/agents");
    if (!res.ok) return;
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return;
    backendActive = true;
    agents = data.map((item, i) => buildAgentFromImport(item, item.agentId ?? i + 1));
    renderStats();
    renderAgents();
  } catch { /* backend unavailable — keep current state */ }
}

async function postToBackend(payload) {
  try {
    await fetch('http://76.13.0.34:3000/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    await fetchAgents();

  } catch { /* backend unavailable */ }
}

// ── CLOCK ─────────────────────────────────────────────────────────────────────
function updateClock() {
  const el = document.getElementById('live-time');
  if (el) el.textContent = new Date().toLocaleString();
}
// ── BOOT ─────────────────────────────────────────────────────────────────────
initAgents(8);

// Restore imported agents from localStorage
loadImportedFromStorage().forEach(item => {
  const newId = agents.length ? Math.max(...agents.map(a => a.id)) + 1 : 1;
  agents.push(buildAgentFromImport(item, newId));
});

pushFeed('active', 'dashboard initialized', 'System');
renderStats();
renderAgents();
renderFeed();
renderChart();
updateClock();

setInterval(simulateTick, 2000);
setInterval(fetchAgents, 2000);
setInterval(updateClock, 1000);
fetchAgents();