'use strict';

// Run with: node tests/agent-pipeline.test.js
// Requires the server to be running on http://localhost:3000

const BASE = process.env.TEST_URL || 'http://localhost:3000';
let passed = 0, failed = 0;

async function assert(label, fn) {
  try {
    await fn();
    console.log(`  PASS  ${label}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL  ${label}`);
    console.error(`        ${err.message}`);
    failed++;
  }
}

function expect(actual, label) {
  return {
    toBe: (expected) => {
      if (actual !== expected) throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    },
    toEqual: (expected) => {
      const a = JSON.stringify(actual), b = JSON.stringify(expected);
      if (a !== b) throw new Error(`Expected ${b}, got ${a}`);
    },
    toContain: (key) => {
      if (!(key in actual)) throw new Error(`Expected object to contain key "${key}"`);
    },
    toBeArray: () => {
      if (!Array.isArray(actual)) throw new Error(`Expected array, got ${typeof actual}`);
    },
    toHaveLength: (n) => {
      if (!Array.isArray(actual) || actual.length < n) throw new Error(`Expected length >= ${n}, got ${actual?.length}`);
    },
    toHaveStatus: (code) => {
      if (actual !== code) throw new Error(`Expected HTTP ${code}, got ${actual}`);
    },
  };
}

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  return { status: res.status, body: await res.json() };
}

// ── SUITE ────────────────────────────────────────────────────────────────────
async function run() {
  console.log(`\nAgent Pipeline Tests — ${BASE}\n`);

  // 1. POST all 6 agents as in-progress
  const agents = [
    { agentId: 1, agentName: 'Planner Agent',        task: 'Plan task', status: 'in-progress', progress: 10, notes: '' },
    { agentId: 2, agentName: 'Frontend Agent',        task: 'Build UI',  status: 'in-progress', progress: 20, notes: '' },
    { agentId: 3, agentName: 'Backend Agent',         task: 'Build API', status: 'in-progress', progress: 30, notes: '' },
    { agentId: 4, agentName: 'n8n Automation Agent',  task: 'Setup n8n', status: 'in-progress', progress: 40, notes: '' },
    { agentId: 5, agentName: 'Tester Agent',          task: 'Run tests', status: 'in-progress', progress: 50, notes: '' },
    { agentId: 6, agentName: 'Debug Agent',           task: 'On standby',status: 'idle',        progress: 0,  notes: '' },
  ];

  for (const a of agents) {
    await assert(`POST /update — agent ${a.agentId} (${a.agentName})`, async () => {
      const { status, body } = await post('/update', a);
      expect(status).toBe(200);
      expect(body).toContain('success');
    });
  }

  // 2. GET /agents — all 6 present
  await assert('GET /agents — returns array', async () => {
    const { status, body } = await get('/agents');
    expect(status).toBe(200);
    expect(body).toBeArray();
    expect(body).toHaveLength(6);
  });

  // 3. Update one agent to done
  await assert('POST /update — Agent 2 status → done, progress 100', async () => {
    const { status, body } = await post('/update', {
      agentId: 2, agentName: 'Frontend Agent', task: 'Build UI',
      status: 'done', progress: 100, notes: 'Completed',
    });
    expect(status).toBe(200);
    const { body: agents } = await get('/agents');
    const a2 = agents.find(a => String(a.agentId) === '2');
    if (!a2) throw new Error('Agent 2 not found after update');
    expect(a2.status).toBe('done');
    expect(a2.progress).toBe(100);
  });

  // 4. Malformed payload — missing required fields
  await assert('POST /update — missing agentName → 400', async () => {
    const { status } = await post('/update', { agentId: 99, task: 'x', status: 'idle' });
    expect(status).toHaveStatus(400);
  });

  // 5. Invalid status value
  await assert('POST /update — invalid status → 400', async () => {
    const { status } = await post('/update', {
      agentId: 99, agentName: 'Test', task: 'x', status: 'INVALID_STATUS',
    });
    expect(status).toHaveStatus(400);
  });

  // 6. Batch array POST
  await assert('POST /update — batch array of 2 agents', async () => {
    const { status, body } = await post('/update', [
      { agentId: 'batch-1', agentName: 'Batch A', task: 'Batch task', status: 'active', progress: 50, notes: '' },
      { agentId: 'batch-2', agentName: 'Batch B', task: 'Batch task', status: 'idle',   progress: 0,  notes: '' },
    ]);
    expect(status).toBe(200);
    if (body.created + body.updated < 2) throw new Error(`Expected 2 processed, got ${JSON.stringify(body)}`);
  });

  // 7. updatedAt is set
  await assert('POST /update — response includes updatedAt', async () => {
    const { body } = await post('/update', {
      agentId: 1, agentName: 'Planner Agent', task: 'Plan task', status: 'done', progress: 100, notes: '',
    });
    if (!body.agent?.updatedAt) throw new Error('updatedAt missing from response');
  });

  // ── RESULTS ───────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(48)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch(err => { console.error(err); process.exit(1); });
