# Claude — start here

This is Hadi's trading app (HADI / سَنَد). Read, in this order:

@docs/CONTEXT.md
@AGENTS.md

- Owner decisions: `docs/decisions/sanad-steps.md`. They override everything else.
- The full plan, with task ids: `docs/plan-sanad-steps.md`.
- Ready-made prompts: `docs/PROMPTS.md`.

## Project skills (in `.claude/skills/`)
- `sanad-context`: load the context before any work.
- `continue-plan`: pick the next task from the plan and finish it.
- `ship-change`: verify, then commit and push to main safely.
- `lovable-migration`: any change to the database.
- `iphone-ui`: checklist for any screen.

## Hard rules
- One task at a time. Core only, no scattering. Don't touch files outside the task.
- Never push before `vitest`, `tsc` and `vite build` all pass.
- No force-push, no amending pushed commits, no new packages. Never edit `src/integrations/supabase/types.ts` by hand.
- Talk to the owner in short, clear Arabic.
