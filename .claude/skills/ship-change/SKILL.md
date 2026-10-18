---
name: ship-change
description: Verify and push a change to main safely in this Lovable-connected repo (tests, typecheck, build, routeTree line endings, commit format, rebase on Lovable's commits, push). Use before every commit/push in this repo.
---

# Ship a change to main

main syncs to Lovable on every push, so it must always build.

1. Checks (all must pass):
   ```bash
   npx vitest run && npx tsc --noEmit -p . && npx vite build
   ```
   If something you did not touch fails, say so instead of hiding it.
2. Generated file: if `src/routeTree.gen.ts` shows modified but `git diff --quiet -- src/routeTree.gen.ts` exits 0, it is line endings only → `git checkout -- src/routeTree.gen.ts`. Keep it if routes really changed.
3. Stage project paths only (never plain `git add -A`; `.claude/` holds worktrees):
   ```bash
   git add -A -- src docs drizzle public AGENTS.md CLAUDE.md roadmap.md .claude/skills
   ```
4. Commit message: `Txx: <short summary>` (or a plain summary), a short body, last line:
   `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
5. Lovable may have pushed meanwhile:
   ```bash
   git pull --rebase origin main   # only rebases YOUR unpushed commits
   ```
   If anything came in, re-run `npx tsc --noEmit -p .` and the related tests.
6. `git push origin main` (from a worktree: `git push origin HEAD:main`). If rejected, repeat step 5.

## Never
- `--force`, `--amend` on pushed commits, `--no-verify`, editing `src/integrations/supabase/types.ts` by hand, touching `package.json` / `package-lock.json` / `bun.lock`.
