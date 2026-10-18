---
name: continue-plan
description: Continue building the سَنَد step-system plan — pick the next unfinished task, implement only its core, verify and push. Use when the owner says كمّل / continue / الخطوة الجاية / finish the plan, or names a task id like T14.
---

# Continue the plan, one task at a time

1. Run the `sanad-context` skill first.
2. Pick the task: the one the owner named, or else the first item under "Left" in section 7 of `docs/CONTEXT.md`.
3. Read only that task's section: `grep -n "^### T14 " docs/plan-sanad-steps.md`, then read until the next `### `.
4. Check for half-done work: if `docs/CONTEXT.md` names a worktree for this task and the folder still exists, look at it (`git -C <path> status --short`, `git -C <path> diff`) and reuse what is good instead of starting over.
5. Implement the **core the trader will see and use**. Skip polish, optional refactors and anything that depends on a deferred task (T20, T20b, T21, T29, T30, T34, T35).
6. Add or adjust tests for every pure helper you touch.
7. Run the `ship-change` skill to verify, commit as `Txx: <summary>`, and push.
8. Update section 7 ("Status") of `docs/CONTEXT.md`: move the task to done, in the same commit or one right after.
9. Tell the owner in 2–3 Arabic lines what changed on his phone, and remind him to press Publish in Lovable.

## Speed and cost
- Work directly; do not fan out agents unless the owner asks. If you must, pass `model: 'claude-opus-5-5'` explicitly (the env default model is broken).
- Do not re-run the whole test suite after every small edit; run the related test file, then the full checks once before pushing.
