# قرارات نظام الخطوات (سَنَد) — 2026-10-18

The owner answered two of the eight policy items directly in chat. For the rest, the plan's recommendation was taken, because the owner asked not to be stopped for approvals. Full plan: [docs/plan-sanad-steps.md](../plan-sanad-steps.md).

| # | Item | Decision | Source |
|---|---|---|---|
| 1 | Friction on NO_GO | Saving is never blocked (b15aeb3). Proceeding past a NO_GO needs a reason: one of 3 chips, or a short typed line. This automatically inserts `rule_violations` with `source='gate'`. | Owner: «تحذير + سبب» |
| 2 | Unreviewed trades | REVIEW_REQUIRED stays on the next gate until the last trade closed after `reviews_since` has been reviewed. Older trades never block. | Recommended |
| 3 | AI action classes | سَنَد runs everything on its own (JOURNAL and STATE), **except** deleting (DESTRUCTIVE) and loosening any limit, which always need a click. | Owner: «ينفّذ لحاله إلا الحذف» |
| 4 | Already-placed trades the AI logs | These run automatically as JOURNAL and are journaled with their gate decision. If the decision is NO_GO, a violation is recorded and سَنَد asks for the reason afterwards. | Follows from 3 |
| 5 | Blank answer on a pre-entry ticket | REVIEW_REQUIRED, not NO_GO | Recommended |
| 6 | Analyst's «never say wait» rule | Removed. intent=watch is allowed when the breaker is not ALLOWED, or when R:R < 1.5. | Recommended |
| 7 | Survival defaults (2/5/8%, 2 losses, 24h) | Offered on one card. They only warn until accepted, and are offered again each day until accepted or explicitly declined. They never overwrite existing limits. | Recommended |
| 8 | Names and timing | App: HADI / هادي. Manager: سَنَد. Analyst: المحلل. Revenge window = max(30, cooldown_minutes) minutes. A manual pause ends at the start of the next trading day, unless «لين أرجّعه» is chosen. | Recommended |

## Working rules

- The owner chose to work directly on `main`, which is connected to Lovable. Every pushed commit must pass `vitest`, `tsc` and `vite build`.
- No force-push, and no rewriting of pushed history.
- Migrations follow the flow in [docs/lovable-migrations.md](../lovable-migrations.md):
  1. Write idempotent SQL.
  2. Lovable applies it as `*_apply_*` and regenerates `types.ts`.
  3. Delete our original copy.
  4. Merge code that reads the new columns only after that.
- Every task that changes an architecture decision updates its line in AGENTS.md in the same commit.
