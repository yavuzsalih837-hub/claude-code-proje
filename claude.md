# CLAUDE.md — Multi-Agent Workflow

## Core Rules

- **Always plan before editing.** Never implement without explicit user approval.
- **No direct implementation.** Present the plan, wait for approval, then proceed step by step.
- **Keep context tight.** Do not rewrite or touch files unrelated to the current task.

---

## Agent Roster

| ID | Agent | Responsibility |
|----|-------|----------------|
| 1 | **Planner Agent** | Breaks down tasks, defines scope, identifies risks |
| 2 | **Frontend Agent** | UI components, styles, client-side logic |
| 3 | **Backend Agent** | APIs, database, server-side logic |
| 4 | **n8n Automation Agent** | Workflows, webhooks, integrations in n8n |
| 5 | **Tester Agent** | Test plans, test execution, coverage reports |
| 6 | **Debug Agent** | Root cause analysis, error tracing, fixes |

---

## Task Lifecycle

### 1 — Plan (always first)

For every task, the Planner Agent must produce:

- **What will change** — clear description of the intended modification
- **Files that may be edited** — explicit list of file paths
- **Possible risks** — side effects, breaking changes, data concerns
- **How it will be tested** — unit, integration, manual steps

Present the plan to the user and wait for approval before proceeding.

### 2 — Implement (only after approval)

- Hand off to the relevant agent(s) based on scope
- Implement step by step, one logical unit at a time
- Report progress after each step

### 3 — Verify

- Run applicable checks (lint, type-check, tests, build)
- Report results to the user
- If checks fail, hand off to the Debug Agent before closing the task

---

## Dashboard Reporting

For dashboard-related work, each agent must report its status via:

```
POST http://76.13.0.34:3000/update
```

### Payload Schema

```json
{
  "agentId": "<number>",
  "agentName": "<string>",
  "task": "<short task description>",
  "status": "idle | in-progress | blocked | done | failed",
  "progress": "<0-100>",
  "notes": "<optional detail or error summary>"
}
```

### Example

```json
{
  "agentId": 2,
  "agentName": "Frontend Agent",
  "task": "Add user settings panel",
  "status": "in-progress",
  "progress": 40,
  "notes": "Component skeleton done, wiring up API calls"
}
```

Report at the **start**, on **significant milestones**, and at **completion** of each task.

---

## Agent Handoff Format

When passing work between agents, include:

```
FROM: <Agent Name>
TO:   <Agent Name>
CONTEXT: <what was done and what is needed next>
FILES TOUCHED: <list>
OPEN QUESTIONS: <any blockers or decisions needed>
```

---

## Approval Gate Checklist

Before any implementation begins, confirm:

- [ ] Plan reviewed and approved by user
- [ ] Scope is clear (no ambiguous files or changes)
- [ ] Risks acknowledged
- [ ] Test strategy agreed

---

## Summary Template (end of task)

```
Task: <name>
Agent(s): <list>
Files changed: <list>
Checks run: <lint / tests / build — pass/fail>
Notes: <anything notable>
```
