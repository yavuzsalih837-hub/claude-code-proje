'use strict';

const express = require('express');
const cors    = require('cors');
const fs      = require('fs');
const path    = require('path');

const app     = express();
const DB_PATH = path.join(__dirname, 'db.json');

// ── PERSISTENCE ───────────────────────────────────────────────────────────────
function loadDb() {
  try { return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); }
  catch { return { agents: [], tasks: [] }; }
}

function saveDb() {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

let db = loadDb();

// ── MIDDLEWARE ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ── HELPERS ───────────────────────────────────────────────────────────────────
function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function now() {
  return new Date().toISOString();
}

// ── LEGACY /update (backward compatible — CLAUDE.md schema) ──────────────────
const LEGACY_REQUIRED = ['agentId', 'agentName', 'task', 'status'];
const VALID_STATUSES  = ['idle', 'in-progress', 'blocked', 'done', 'failed', 'running', 'active', 'waiting', 'error'];

app.post('/update', (req, res) => {
  const data = req.body;

  if (Array.isArray(data)) {
    let created = 0, updated = 0;
    for (const item of data) {
      if (!item.agentId) continue;
      const existing = db.agents.find(a => String(a.agentId) === String(item.agentId));
      if (existing) {
        Object.assign(existing, item, { updatedAt: now() });
        updated++;
      } else {
        db.agents.push({ ...item, agentId: String(item.agentId), createdAt: now(), updatedAt: now() });
        created++;
      }
    }
    saveDb();
    return res.json({ success: true, created, updated });
  }

  const missing = LEGACY_REQUIRED.filter(f => !data[f]);
  if (missing.length) return res.status(400).json({ error: 'Missing required fields', missing });
  if (!VALID_STATUSES.includes(data.status)) return res.status(400).json({ error: 'Invalid status', valid: VALID_STATUSES });

  const agentId  = String(data.agentId);
  const existing = db.agents.find(a => a.agentId === agentId);

  if (existing) {
    Object.assign(existing, data, { agentId, updatedAt: now() });
  } else {
    db.agents.push({ ...data, agentId, createdAt: now(), updatedAt: now() });
  }

  saveDb();
  res.json({ success: true, agent: db.agents.find(a => a.agentId === agentId) });
});

// ── GET /agents ───────────────────────────────────────────────────────────────
app.get('/agents', (req, res) => res.json(db.agents));

// ── POST /agents ───────────────────────────────────────────────────────────────
app.post('/agents', (req, res) => {
  const { agentName, type, description } = req.body;
  if (!agentName) return res.status(400).json({ error: 'agentName required' });

  const agent = {
    agentId:     newId(),
    agentName,
    type:        type        || 'LLM Agent',
    description: description || '',
    status:      'idle',
    progress:    0,
    notes:       '',
    createdAt:   now(),
    updatedAt:   now(),
  };

  db.agents.push(agent);
  saveDb();
  res.status(201).json(agent);
});

// ── GET /agents/:id ───────────────────────────────────────────────────────────
app.get('/agents/:id', (req, res) => {
  const agent = db.agents.find(a => a.agentId === req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  res.json(agent);
});

// ── PATCH /agents/:id ─────────────────────────────────────────────────────────
app.patch('/agents/:id', (req, res) => {
  const agent = db.agents.find(a => a.agentId === req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });

  const allowed = ['agentName', 'type', 'description', 'status', 'progress', 'notes'];
  for (const field of allowed) {
    if (req.body[field] !== undefined) agent[field] = req.body[field];
  }
  agent.updatedAt = now();

  saveDb();
  res.json(agent);
});

// ── DELETE /agents/:id ────────────────────────────────────────────────────────
app.delete('/agents/:id', (req, res) => {
  const idx = db.agents.findIndex(a => a.agentId === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Agent not found' });

  db.agents.splice(idx, 1);
  db.tasks = db.tasks.filter(t => t.agentId !== req.params.id);
  saveDb();
  res.json({ success: true });
});

// ── POST /agents/:id/tasks ────────────────────────────────────────────────────
app.post('/agents/:id/tasks', (req, res) => {
  const agent = db.agents.find(a => a.agentId === req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });

  const { title, description } = req.body;
  if (!title) return res.status(400).json({ error: 'title required' });

  const task = {
    taskId:      newId(),
    agentId:     req.params.id,
    title,
    description: description || '',
    status:      'pending',
    progress:    0,
    createdAt:   now(),
    startedAt:   null,
    completedAt: null,
    logs:        [{ time: now(), message: 'Task created' }],
  };

  db.tasks.push(task);

  agent.status    = 'active';
  agent.progress  = 0;
  agent.updatedAt = now();

  saveDb();
  res.status(201).json(task);
});

// ── GET /agents/:id/tasks ─────────────────────────────────────────────────────
app.get('/agents/:id/tasks', (req, res) => {
  const tasks = db.tasks
    .filter(t => t.agentId === req.params.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json(tasks);
});

// ── PATCH /agents/:id/tasks/:taskId ──────────────────────────────────────────
app.patch('/agents/:id/tasks/:taskId', (req, res) => {
  const task = db.tasks.find(
    t => t.taskId === req.params.taskId && t.agentId === req.params.id
  );
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const { status, progress } = req.body;

  if (status !== undefined) {
    task.status = status;
    if (status === 'active'  && !task.startedAt)   task.startedAt   = now();
    if (status === 'done' || status === 'failed')   task.completedAt = now();
    task.logs.push({ time: now(), message: `Status → ${status}` });
  }

  if (progress !== undefined) {
    task.progress = Math.min(100, Math.max(0, Number(progress)));
  }

  saveDb();
  res.json(task);
});

// ── POST /agents/:id/tasks/:taskId/log ───────────────────────────────────────
app.post('/agents/:id/tasks/:taskId/log', (req, res) => {
  const task = db.tasks.find(
    t => t.taskId === req.params.taskId && t.agentId === req.params.id
  );
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });

  if (task.logs.length >= 100) task.logs.shift();
  task.logs.push({ time: now(), message });

  saveDb();
  res.json({ success: true, logCount: task.logs.length });
});

// ── STATIC + ROOT (must come after API routes) ───────────────────────────────
app.use(express.static(__dirname));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`AgentOS running on http://localhost:${PORT}`));
