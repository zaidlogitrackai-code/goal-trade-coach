---
name: sanad-context
description: Load the full context of Hadi's trading app (HADI / سَنَد) before any work on it — what the app is, the 7 day steps, the pure engines, owner decisions, what is done and what is left. Use at the start of every session or task in this repo, or when unsure where something lives.
---

# Load the project context

1. Read `docs/CONTEXT.md` in full. It is the map.
2. Read `docs/decisions/sanad-steps.md` (owner decisions — they win over the plan).
3. Skim `AGENTS.md`: one line per architecture decision; find the line for the area you will touch.
4. Run `git fetch -q origin && git status -sb && git log --oneline -5` — know whether you are behind origin/main. If behind and the tree is clean: `git pull --ff-only origin main`.
5. Before editing anything, state in one line: which task/area, which files, which engine is the source of truth for it.

## Do not
- Do not create a second source of truth (a second step engine, a second risk calc, a second "today").
- Do not read the whole `docs/plan-sanad-steps.md`; search for your task's `### Txx` section only.
