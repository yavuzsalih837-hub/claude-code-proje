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
const TASK_STATUS_COLORS = {
  pending: '#3b82f6',
  active:  '#22c55e',
  done:    '#6366f1',
  failed:  '#ef4444',
};

let agents = [];
let feed = [];
let tasksDone = 0;
let throughputHistory = new Array(10).fill(0);
let currentFilter = 'all';
let currentSearchTerm = '';
let notifCount = 0;
let tickTasksDone = 0;
let backendActive = false;

// agentKey → Task[]
let tasksMap = {};

// ── LOCALSTORAGE KEYS ─────────────────────────────────────────────────────────
const LS_KEY            = 'agentDashboard_imported';
const LS_USER_AGENTS    = 'agentos_user_agents';
const LS_TASKS          = 'agentos_tasks';

// ── LOCALSTORAGE: IMPORTED (existing) ─────────────────────────────────────────
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

// ── LOCALSTORAGE: USER-CREATED AGENTS ─────────────────────────────────────────
function saveUserAgentsToStorage() {
  const userAgents = agents.filter(a => a.userCreated).map(a => ({
    id:             a.id,
    agentId:        a.agentId,
    name:           a.name,
    type:           a.type,
    emoji:          a.emoji,
    description:    a.description,
    status:         a.status,
    progress:       a.progress,
    task:           a.task,
    uptime:         a.uptime,
    tasksCompleted: a.tasksCompleted,
    errorCount:     a.errorCount,
    created:        a.created,
    notes:          a.notes,
    userCreated:    true,
  }));
  localStorage.setItem(LS_USER_AGENTS, JSON.stringify(userAgents));
}

function loadUserAgentsFromStorage() {
  try {
    const raw = localStorage.getItem(LS_USER_AGENTS);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

// ── LOCALSTORAGE: TASKS ───────────────────────────────────────────────────────
function saveTasksToStorage() {
  localStorage.setItem(LS_TASKS, JSON.stringify(tasksMap));
}

function loadTasksFromStorage() {
  try {
    const raw = localStorage.getItem(LS_TASKS);
    tasksMap = raw ? JSON.parse(raw) : {};
  } catch { tasksMap = {}; }
}

// ── HELPERS ───────────────────────────────────────────────────────────────────
function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function getAgentKey(a) {
  return a.agentId || String(a.id);
}

function findAgentByKey(key) {
  return agents.find(a => getAgentKey(a) === String(key));
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
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

// ── TASK CRUD ─────────────────────────────────────────────────────────────────
function getTasksForAgent(agentKey) {
  return tasksMap[agentKey] || [];
}

function createTask(agentKey, title, description) {
  const task = {
    taskId:      newId(),
    agentKey,
    title,
    description: description || '',
    status:      'pending',
    progress:    0,
    createdAt:   new Date().toISOString(),
    startedAt:   null,
    completedAt: null,
    logs:        [{ time: new Date().toISOString(), message: 'Task created' }],
  };
  if (!tasksMap[agentKey]) tasksMap[agentKey] = [];
  tasksMap[agentKey].unshift(task);
  saveTasksToStorage();
  return task;
}

function updateTaskStatus(agentKey, taskId, status) {
  const list = tasksMap[agentKey] || [];
  const t = list.find(x => x.taskId === taskId);
  if (!t) return;
  t.status = status;
  if (status === 'active' && !t.startedAt) t.startedAt = new Date().toISOString();
  if ((status === 'done' || status === 'failed') && !t.completedAt) {
    t.completedAt = new Date().toISOString();
  }
  if (status === 'done') t.progress = 100;
  appendTaskLog(agentKey, taskId, `Status → ${status}`, /*persist*/ false);
  saveTasksToStorage();
}

function appendTaskLog(agentKey, taskId, message, persist = true) {
  const list = tasksMap[agentKey] || [];
  const t = list.find(x => x.taskId === taskId);
  if (!t) return;
  if (!t.logs) t.logs = [];
  if (t.logs.length >= 100) t.logs.shift();
  t.logs.push({ time: new Date().toISOString(), message });
  if (persist) saveTasksToStorage();
}

function deleteTask(agentKey, taskId) {
  const list = tasksMap[agentKey] || [];
  const idx = list.findIndex(x => x.taskId === taskId);
  if (idx === -1) return;
  list.splice(idx, 1);
  saveTasksToStorage();
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

  const displayed = currentSearchTerm
    ? filtered.filter(a =>
        a.name.toLowerCase().includes(currentSearchTerm) ||
        (a.task || '').toLowerCase().includes(currentSearchTerm) ||
        (a.type || '').toLowerCase().includes(currentSearchTerm)
      )
    : filtered;

  if (displayed.length === 0) {
    list.innerHTML = `<div style="text-align:center;padding:40px;color:var(--muted);font-size:0.85rem;">No agents match this filter.</div>`;
    return;
  }

  list.innerHTML = displayed.map(a => {
    const status = normalizeStatus(a.status);
    const pendingTasks = getTasksForAgent(getAgentKey(a)).filter(t => t.status !== 'done' && t.status !== 'failed').length;
    const badge = pendingTasks > 0
      ? `<span class="agent-task-pill" title="${pendingTasks} open task(s)">${pendingTasks} task${pendingTasks > 1 ? 's' : ''}</span>`
      : '';
    return `
    <div class="agent-card" data-id="${escapeHtml(a.id)}">
      <div class="agent-avatar" style="background:${STATUS_COLORS[status]}22">${a.emoji || '⬡'}</div>
      <div class="agent-info">
        <div class="agent-row1">
          <span class="agent-name">${escapeHtml(a.name)}</span>
          <span class="status-badge ${status}">${status}</span>
        </div>
        <div class="agent-task">${escapeHtml(a.task || '—')} ${badge}</div>
        <div class="progress-row">
          <div class="progress-bar">
            <div class="progress-fill ${status}" style="width:${a.progress}%"></div>
          </div>
          <span class="progress-pct">${a.progress}%</span>
        </div>
      </div>
    </div>
  `;
  }).join('');

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
      <span class="feed-text"><strong>${escapeHtml(f.agentName)}</strong> ${escapeHtml(f.message)}</span>
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

  ctx.beginPath();
  points.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
  ctx.strokeStyle = '#6366f1';
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.stroke();

  points.forEach(p => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#6366f1';
    ctx.fill();
  });
}

// ── MODAL: AGENT DETAIL ───────────────────────────────────────────────────────
function openModal(id) {
  const a = agents.find(x => String(x.id) === String(id));
  if (!a) return;

  const status = normalizeStatus(a.status);
  const uptimeStr = a.uptime >= 60 ? `${Math.floor(a.uptime / 60)}h ${a.uptime % 60}m` : `${a.uptime || 0}m`;
  const agentKey = getAgentKey(a);
  const tasks = getTasksForAgent(agentKey);

  const importSection = a.fromImport ? `
    <div class="modal-section">
      <div class="modal-section-title">Import Details</div>
      <div class="modal-kv">
        ${a.projectName ? `<div class="kv-item"><div class="kv-label">Project</div><div class="kv-value">${escapeHtml(a.projectName)}</div></div>` : ''}
        ${a.stage ? `<div class="kv-item"><div class="kv-label">Stage</div><div class="kv-value">${escapeHtml(a.stage)}</div></div>` : ''}
        ${a.updatedAt ? `<div class="kv-item"><div class="kv-label">Updated At</div><div class="kv-value" style="font-size:0.78rem">${new Date(a.updatedAt).toLocaleString()}</div></div>` : ''}
        ${a.agentId ? `<div class="kv-item"><div class="kv-label">Agent ID</div><div class="kv-value" style="font-size:0.78rem">${escapeHtml(a.agentId)}</div></div>` : ''}
      </div>
      ${a.notes ? `<div style="background:var(--bg3);border-radius:8px;padding:10px 14px;font-size:0.82rem;color:var(--muted);margin-top:8px;">${escapeHtml(a.notes)}</div>` : ''}
    </div>
  ` : '';

  const userMetaSection = (a.userCreated && a.description) ? `
    <div class="modal-section">
      <div class="modal-section-title">Description</div>
      <div style="background:var(--bg3);border-radius:8px;padding:10px 14px;font-size:0.85rem;line-height:1.5;">
        ${escapeHtml(a.description)}
      </div>
    </div>
  ` : '';

  const taskAssignSection = `
    <div class="modal-section">
      <div class="modal-section-title">Assign Task</div>
      <form id="task-create-form" class="modal-form-inline" data-agent-key="${escapeHtml(agentKey)}">
        <input class="form-input" type="text" name="title" required maxlength="80" placeholder="Task title..." />
        <textarea class="form-input" name="description" rows="2" placeholder="Description (optional)"></textarea>
        <button type="submit" class="btn-primary btn-small">+ Assign Task</button>
      </form>
    </div>
  `;

  const taskListSection = `
    <div class="modal-section">
      <div class="modal-section-title">Tasks (${tasks.length})</div>
      <div class="task-list-real">
        ${tasks.length === 0
          ? '<div class="task-empty">No tasks assigned yet.</div>'
          : tasks.map(t => renderTaskCard(t, agentKey)).join('')}
      </div>
    </div>
  `;

  const taskLogSection = a.taskLog && a.taskLog.length ? `
    <div class="modal-section">
      <div class="modal-section-title">Activity Snapshot</div>
      <div class="task-list-modal">
        ${a.taskLog.map(t => `
          <div class="task-item-modal">
            <span class="ti-status" style="color:${t.status === 'done' ? 'var(--green)' : t.status === 'error' ? 'var(--red)' : 'var(--yellow)'}">
              ${t.status === 'done' ? '✓' : t.status === 'error' ? '✗' : '◌'}
            </span>
            <span class="ti-name">${escapeHtml(t.name)}</span>
            <span class="ti-time">${escapeHtml(t.duration)}</span>
          </div>
        `).join('')}
      </div>
    </div>
  ` : '';

  const deleteBtn = a.userCreated
    ? `<button class="btn-danger btn-small" id="btn-delete-agent">Delete Agent</button>`
    : '';

  document.getElementById('modal-body').innerHTML = `
    <div class="modal-agent-header">
      <div class="modal-agent-avatar" style="background:${STATUS_COLORS[status]}22">${a.emoji || '⬡'}</div>
      <div style="flex:1">
        <div class="modal-agent-name">${escapeHtml(a.name)}</div>
        <div class="modal-agent-type">${escapeHtml(a.type || '')} · <span class="status-badge ${status}">${status}</span></div>
      </div>
      ${deleteBtn}
    </div>

    <div class="modal-section">
      <div class="modal-section-title">Metrics</div>
      <div class="modal-kv">
        <div class="kv-item"><div class="kv-label">Progress</div><div class="kv-value">${a.progress}%</div></div>
        <div class="kv-item"><div class="kv-label">Uptime</div><div class="kv-value">${uptimeStr}</div></div>
        <div class="kv-item"><div class="kv-label">Tasks Done</div><div class="kv-value">${a.tasksCompleted || 0}</div></div>
        <div class="kv-item"><div class="kv-label">Errors</div><div class="kv-value" style="color:${(a.errorCount||0) > 0 ? 'var(--red)' : 'inherit'}">${a.errorCount || 0}</div></div>
      </div>
    </div>

    <div class="modal-section">
      <div class="modal-section-title">Current Task</div>
      <div style="background:var(--bg3);border-radius:8px;padding:12px 14px;font-size:0.88rem;">${escapeHtml(a.task || '—')}</div>
    </div>

    ${userMetaSection}
    ${importSection}
    ${taskAssignSection}
    ${taskListSection}
    ${taskLogSection}
  `;

  document.getElementById('modal-overlay').classList.add('open');
  wireAgentModalHandlers(a, agentKey);
}

function renderTaskCard(t, agentKey) {
  const color = TASK_STATUS_COLORS[t.status] || '#64748b';
  const created = new Date(t.createdAt).toLocaleString();
  return `
    <div class="task-card-real" data-task-id="${escapeHtml(t.taskId)}" data-agent-key="${escapeHtml(agentKey)}">
      <div class="tcr-header">
        <span class="tcr-dot" style="background:${color}"></span>
        <span class="tcr-title">${escapeHtml(t.title)}</span>
        <select class="form-input form-input-sm" data-action="task-status">
          <option value="pending" ${t.status==='pending'?'selected':''}>Pending</option>
          <option value="active"  ${t.status==='active'?'selected':''}>Active</option>
          <option value="done"    ${t.status==='done'?'selected':''}>Done</option>
          <option value="failed"  ${t.status==='failed'?'selected':''}>Failed</option>
        </select>
        <button class="tcr-delete" data-action="task-delete" title="Delete task">✕</button>
      </div>
      ${t.description ? `<div class="tcr-desc">${escapeHtml(t.description)}</div>` : ''}
      <div class="tcr-meta">
        <span class="tcr-time">Created ${created}</span>
        ${t.completedAt ? `<span class="tcr-time">· Done ${new Date(t.completedAt).toLocaleTimeString()}</span>` : ''}
      </div>
      <details class="tcr-logs">
        <summary>Log (${t.logs ? t.logs.length : 0})</summary>
        <div class="tcr-log-list">
          ${(t.logs || []).map(l => `
            <div class="tcr-log-line">
              <span class="log-time">${new Date(l.time).toLocaleTimeString()}</span>
              <span class="log-msg">${escapeHtml(l.message)}</span>
            </div>
          `).join('')}
        </div>
        <form class="tcr-log-form" data-action="task-log">
          <input type="text" name="message" maxlength="120" placeholder="Add log entry..." required />
          <button type="submit" class="btn-small">+ Log</button>
        </form>
      </details>
    </div>
  `;
}

function wireAgentModalHandlers(agent, agentKey) {
  const localId = agent.id;

  // Task creation
  const createForm = document.getElementById('task-create-form');
  if (createForm) {
    createForm.addEventListener('submit', e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const title = (fd.get('title') || '').trim();
      const desc  = (fd.get('description') || '').trim();
      if (!title) return;

      const task = createTask(agentKey, title, desc);
      pushFeed('active', `was assigned task "${task.title}"`, agent.name);
      notifCount++;

      // Best-effort backend sync
      postTaskToBackend(agentKey, task).catch(() => {});

      renderStats();
      renderAgents();
      openModal(localId); // re-render modal
    });
  }

  // Per-task handlers
  document.querySelectorAll('.task-card-real').forEach(card => {
    const taskId = card.dataset.taskId;
    const aKey   = card.dataset.agentKey;

    const statusSelect = card.querySelector('[data-action="task-status"]');
    if (statusSelect) {
      statusSelect.addEventListener('change', e => {
        const newStatus = e.target.value;
        const t = (tasksMap[aKey] || []).find(x => x.taskId === taskId);
        updateTaskStatus(aKey, taskId, newStatus);
        const feedType = newStatus === 'done' ? 'done'
          : newStatus === 'failed' ? 'error'
          : newStatus === 'active' ? 'active' : 'waiting';
        pushFeed(feedType, `task "${t ? t.title : taskId}" → ${newStatus}`, agent.name);
        if (newStatus === 'done') tasksDone++;
        renderStats();
        renderAgents();
        openModal(localId);
      });
    }

    const deleteBtn = card.querySelector('[data-action="task-delete"]');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', () => {
        if (!confirm('Delete this task and all its logs?')) return;
        deleteTask(aKey, taskId);
        renderStats();
        renderAgents();
        openModal(localId);
      });
    }

    const logForm = card.querySelector('[data-action="task-log"]');
    if (logForm) {
      logForm.addEventListener('submit', e => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const msg = (fd.get('message') || '').trim();
        if (!msg) return;
        appendTaskLog(aKey, taskId, msg);
        openModal(localId);
      });
    }
  });

  // Agent delete
  const delAgent = document.getElementById('btn-delete-agent');
  if (delAgent) {
    delAgent.addEventListener('click', () => {
      if (!confirm(`Delete agent "${agent.name}" and all its tasks?`)) return;
      const idx = agents.findIndex(x => x.id === agent.id);
      if (idx !== -1) agents.splice(idx, 1);
      delete tasksMap[agentKey];
      saveUserAgentsToStorage();
      saveTasksToStorage();
      pushFeed('error', `was deleted`, agent.name);
      closeModal();
      renderStats();
      renderAgents();
    });
  }
}

// ── MODAL: AGENT CREATION ─────────────────────────────────────────────────────
function openCreateAgentModal() {
  const typeOptions = AGENT_TYPES
    .map(t => `<option value="${escapeHtml(t.label)}">${t.emoji} ${escapeHtml(t.label)}</option>`)
    .join('');

  document.getElementById('modal-body').innerHTML = `
    <div class="modal-form-header">
      <div class="modal-form-icon">＋</div>
      <div>
        <div class="modal-form-title">Create New Agent</div>
        <div class="modal-form-sub">Define a new agent to deploy on the dashboard</div>
      </div>
    </div>
    <form id="agent-create-form" class="modal-form">
      <label class="form-label">Agent Name <span class="req">*</span></label>
      <input class="form-input" type="text" name="agentName" required maxlength="40"
             placeholder="e.g. Alpha-Crawler-01" autocomplete="off" />

      <label class="form-label">Type</label>
      <select class="form-input" name="type">${typeOptions}</select>

      <label class="form-label">Description</label>
      <textarea class="form-input" name="description" rows="3"
                placeholder="What does this agent do?" maxlength="500"></textarea>

      <label class="form-label">Initial Status</label>
      <select class="form-input" name="status">
        <option value="idle">Idle</option>
        <option value="active" selected>Active</option>
        <option value="waiting">Waiting</option>
      </select>

      <div class="form-actions">
        <button type="button" class="btn-secondary" id="form-cancel">Cancel</button>
        <button type="submit" class="btn-primary">Create Agent</button>
      </div>
    </form>
  `;

  document.getElementById('modal-overlay').classList.add('open');

  document.getElementById('form-cancel').addEventListener('click', closeModal);

  document.getElementById('agent-create-form').addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const typeLabel = fd.get('type');
    const typeMeta  = AGENT_TYPES.find(t => t.label === typeLabel) || AGENT_TYPES[0];

    const agentId = newId();
    const agent = {
      id:             agentId,
      agentId:        agentId,
      name:           (fd.get('agentName') || '').trim(),
      type:           typeLabel,
      emoji:          typeMeta.emoji,
      description:    (fd.get('description') || '').trim(),
      status:         fd.get('status') || 'idle',
      progress:       0,
      task:           'Awaiting task assignment',
      uptime:         0,
      tasksCompleted: 0,
      errorCount:     0,
      taskLog:        [],
      created:        Date.now(),
      userCreated:    true,
      notes:          '',
    };

    if (!agent.name) return;

    agents.push(agent);
    saveUserAgentsToStorage();

    pushFeed(normalizeStatus(agent.status), 'was created', agent.name);
    notifCount++;

    renderStats();
    renderAgents();

    // Best-effort backend sync
    postToBackend([{
      agentId:   agent.agentId,
      agentName: agent.name,
      task:      agent.task,
      status:    agent.status,
      progress:  agent.progress,
      notes:     agent.description,
    }]);

    openModal(agentId); // jump straight into detail/task view
  });
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
}

document.getElementById('modal-close').addEventListener('click', closeModal);
document.getElementById('modal-overlay').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeModal();
});

// ── SIMULATION ────────────────────────────────────────────────────────────────
function simulateTick() {
  tickTasksDone = 0;

  agents.forEach(a => {
    // User-created and imported agents are user-controlled
    if (a.fromImport || a.userCreated) return;

    const roll = Math.random();

    if (a.status === 'active') {
      a.progress = Math.min(100, a.progress + randomInt(1, 8));

      if (a.progress >= 100) {
        a.progress = 0;
        a.task = randomItem(TASK_TEMPLATES);
        a.tasksCompleted++;
        tasksDone++;
        tickTasksDone++;
        pushFeed('done', `completed task: "${a.task}"`, a.name);

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

// ── SEARCH ────────────────────────────────────────────────────────────────────
document.getElementById('agent-search').addEventListener('input', e => {
  currentSearchTerm = e.target.value.toLowerCase();
  renderAgents();
});

// ── ADD AGENT (replaces random creation with real modal) ──────────────────────
document.getElementById('btn-add-agent').addEventListener('click', openCreateAgentModal);

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
      const numIds = agents.map(a => Number(a.id)).filter(n => Number.isFinite(n));
      const newLocalId = numIds.length ? Math.max(...numIds) + 1 : 1;
      agents.push(buildAgentFromImport({ ...item, agentId }, newLocalId));
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

// ── BACKEND (best-effort sync) ────────────────────────────────────────────────
async function fetchAgents() {
  try {
    const res = await fetch("http://76.13.0.34:3000/agents");
    if (!res.ok) return;
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return;
    backendActive = true;

    // Merge: keep local user-created agents, replace others with backend snapshot
    const userCreated = agents.filter(a => a.userCreated);
    const fromBackend = data.map((item, i) => buildAgentFromImport(item, item.agentId ?? i + 1));
    agents = [...userCreated, ...fromBackend];
    renderStats();
    renderAgents();
  } catch { /* backend unavailable — keep local state */ }
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

async function postTaskToBackend(agentKey, task) {
  try {
    await fetch(`http://76.13.0.34:3000/agents/${encodeURIComponent(agentKey)}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: task.title, description: task.description }),
    });
  } catch { /* backend unavailable */ }
}

// ── CLOCK ─────────────────────────────────────────────────────────────────────
function updateClock() {
  const el = document.getElementById('live-time');
  if (el) el.textContent = new Date().toLocaleString();
}

// ── BOOT ──────────────────────────────────────────────────────────────────────
initAgents(8);
loadTasksFromStorage();

// Restore user-created agents
loadUserAgentsFromStorage().forEach(item => {
  agents.push({ ...item, taskLog: item.taskLog || [], userCreated: true });
});

// Restore imported agents
loadImportedFromStorage().forEach(item => {
  const numIds = agents.map(a => Number(a.id)).filter(n => Number.isFinite(n));
  const newLocalId = numIds.length ? Math.max(...numIds) + 1 : 1;
  agents.push(buildAgentFromImport(item, newLocalId));
});

pushFeed('active', 'dashboard initialized', 'System');
renderStats();
renderAgents();
renderFeed();
renderChart();
updateClock();

setInterval(simulateTick, 2000);
setInterval(fetchAgents, 5000);
setInterval(updateClock, 1000);
fetchAgents();
