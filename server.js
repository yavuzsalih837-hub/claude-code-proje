const express = require('express');
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json());

const REQUIRED_FIELDS = ['agentId', 'agentName', 'task', 'status'];
const VALID_STATUSES = ['idle', 'in-progress', 'blocked', 'done', 'failed', 'running', 'active', 'waiting', 'error'];

let agents = [];

app.post('/update', (req, res) => {
  const data = req.body;

  if (Array.isArray(data)) {
    let created = 0, updated = 0;
    for (const item of data) {
      if (!item.agentId) continue;
      const existing = agents.find(a => String(a.agentId) === String(item.agentId));
      if (existing) { Object.assign(existing, item, { updatedAt: new Date().toISOString() }); updated++; }
      else { agents.push({ ...item, agentId: String(item.agentId), updatedAt: new Date().toISOString() }); created++; }
    }
    return res.json({ success: true, created, updated, agents });
  }

  const missing = REQUIRED_FIELDS.filter(f => !data[f]);
  if (missing.length) {
    return res.status(400).json({ error: 'Missing required fields', missing });
  }

  if (!VALID_STATUSES.includes(data.status)) {
    return res.status(400).json({ error: 'Invalid status', valid: VALID_STATUSES });
  }

  const agentId = String(data.agentId);
  const existing = agents.find(a => a.agentId === agentId);

  if (existing) {
    Object.assign(existing, data, { agentId, updatedAt: new Date().toISOString() });
  } else {
    agents.push({ ...data, agentId, updatedAt: new Date().toISOString() });
  }

  res.json({ success: true, agent: agents.find(a => a.agentId === agentId) });
});

app.get('/agents', (req, res) => {
  res.json(agents);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});