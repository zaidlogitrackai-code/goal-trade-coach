# CONTEXT — نظام هادي للتداول (سَنَد)

> Read this file in full before any work. It explains what the app is, how it is built, what is finished, and what is left.
> Architecture decisions are one line each in `AGENTS.md`. Owner decisions are in `docs/decisions/sanad-steps.md`. The full plan is in `docs/plan-sanad-steps.md`.

## 1. What is the app?
- A personal app for one trader (Hadi), mainly for forex, gold and indices. All UI is in Arabic (RTL).
- **The main device is the iPhone**, used as a Home Screen app. Desktop comes second.
- **Purpose:** discipline before profit. The day runs as clear, numbered steps instead of scattered pages, and the AI analyses and understands every trade.
- **Stack:** TanStack Start + React 19 + Vite 8, Tailwind 4, shadcn/ui, Supabase (Postgres + Auth, owner-only RLS), vitest. The AI runs through server functions only.
- **Connected to Lovable:** every push to `main` on GitHub syncs into Lovable. The live link only updates when the owner clicks **Publish**.
- **Repo:** github.com/zaidlogitrackai-code/goal-trade-coach, branch `main` (the owner chose to work on it directly).

## 2. The day = 7 steps (one engine: `src/lib/day-pipeline.ts`)
| # | Step | Main screen |
|---|---|---|
| 0 | Setup (once) | /onboarding |
| 1 | Daily gate: the circuit breaker (allowed / cooldown / halted) | /dashboard |
| 2 | Today's plan | plan sheet `src/components/today/plan-sheet.tsx` |
| 3 | Trade check: enter / review first / don't enter | /new-trade |
| 4 | Close the trade and review it | /trades + review |
| 5 | Close the day | /session |
| 6 | Weekly review | /performance, /reports |

The home screen, the nav and the AI all read their step from `day-pipeline.ts` only. Never create a second step engine.

## 3. The pure engines (each one is the single source of truth, and each has tests)
| Responsibility | File |
|---|---|
| Is new risk allowed today? (losses only) | `src/lib/circuit-breaker.ts` |
| Decision on one trade: GO / REVIEW_REQUIRED / NO_GO | `src/lib/pre-trade-gate.ts` |
| Review of a closed trade (scores + behaviour tags + verdict) | `src/lib/trade-review.ts` |
| Weekly / monthly patterns | `src/lib/patterns.ts` |
| Current step | `src/lib/day-pipeline.ts` |
| Today / week (from Monday) / month in the trader's timezone | `src/lib/trading-day.ts` |
| Dollar risk + contract size | `src/lib/trade-idea.ts` (`riskUsd`, `lotForRisk`) |
| Parsing Arabic digits | `src/lib/num.ts` (`parseDecimal`) + `NumberField` |
| Emotions + the revenge window | `src/lib/emotions.ts` |
| Discipline score | `src/lib/discipline.ts` |
| Validating risk settings | `src/lib/risk-validation.ts` |
| Today's plan and its effective limits | `src/lib/daily-plan.ts` (`effectivePlanLimits`) |
| %-based limits → dollars | `src/lib/effective-limits.ts` |
| AI actions: types and classes | `src/lib/agent-action-spec.ts` |
| Does an AI action need approval? | `src/lib/action-policy.ts` (`needsApproval`) |
| What the AI knows | `src/lib/ai-context.ts` + `src/lib/ai-context-format.ts` |
| Navigation | `src/lib/nav-registry.ts` |
| Data freshness (heartbeat) | `src/lib/heartbeat.ts` + `src/hooks/use-resume.ts` |
| The analyst's trade card | `src/lib/trade-card.ts` |

## 4. The two agents
- **سَنَد** (system manager): /session and the chat pages, built on `SessionAgent`. **It runs everything by itself, except deletes and any loosening of a limit, which wait for a click** (owner decision).
- **المحلل** (trade analyst): /analyst. It reads the chart and live market data and produces a ```trade card. The **"مرّرها على البوابة"** button opens /new-trade pre-filled from the card. It can say "watch" (intent=watch).
- All AI calls go through `src/lib/ai.functions.ts` → `src/lib/ai.server.ts`. The API key never leaves the server.

## 5. Owner decisions (do not change without asking him)
1. **NO_GO is a warning, never a hard block.** The trader can continue with a reason (chips or one line), and a `rule_violations` row is written with source='gate'.
2. سَنَد runs by itself except **deletes and loosening a limit**.
3. Blank answers on the pre-trade check → REVIEW_REQUIRED.
4. The analyst may say "watch".
5. Revenge window = max(30, cooldown_minutes) minutes.
6. Names: the app is HADI / هادي, the manager is سَنَد, the analyst is المحلل.

## 6. Database (managed by Lovable)
- **Main tables:** trades, trading_settings, trading_sessions, daily_plans, rule_violations, trading_rules, strategies, strategy_examples, knowledge_notes, coach_threads, coach_messages, chart_analyses, notifications, reminders, user_visits.
- **Tables added for the step system (migrations 0011–0014, all applied):** circuit_breaks, pre_trade_checks, trade_reviews, trade_events, agent_action_log, capital_movements.
- **Never hand-edit** `src/integrations/supabase/types.ts`.
- **How to change the schema:** use the `lovable-migration` skill (write the SQL, Lovable applies it, then pull the new types).

## 7. Status (last updated 2026-10-18)
**Done and on main:** iPhone work (safe areas, icon/PWA, keyboard, 44pt targets, iOS nav bar, heartbeat), risk maths and Arabic digits, a single "today", alerts that never get lost, the circuit breaker, the pre-trade decision, trade review, patterns, the step engine, the AI action policy, the analyst agent (T31), the plan sheet (T22), and grounding the AI in computed numbers (T27).

**Left, in priority order** (task ids are in `docs/plan-sanad-steps.md`):
1. **T14:** the "your step now" card on the home screen + the stop editor. Unfinished work sits uncommitted in the old worktree `C:\Users\zero\goal-trade-coach\.claude\worktrees\wf_391060e5-182-1`.
2. **T23:** one shared save path for trades (`src/lib/trade-write.ts`) that logs every check. Unfinished work is in `C:\Users\zero\goal-trade-coach\.claude\worktrees\wf_3e2abe34-02c-1`.
3. **T32:** سَنَد's single day thread as system manager.
4. **T24:** a step-by-step pre-trade check screen (reads symbol, direction, entry, sl, tp, analysis_id from the URL).
5. **T26 + T28:** close the trade, then the review sheet, then the AI's explanation of the review.
6. **T33:** 4 tabs (اليوم | فحص صفقة | السجل | سَنَد) + a gear for settings.

Deferred: T20, T20b, T21, T29, T30, T34, T35.

## 8. How to work (golden rules)
1. **One task at a time.** Read its section in the plan, implement the core only, then push. Don't touch unrelated files.
2. **Before every push:** `npx vitest run && npx tsc --noEmit -p . && npx vite build`. All three must pass.
3. **Never** force-push, amend or rebase commits that are already pushed (Lovable loses its history).
4. **No new npm packages** (Lovable uses bun.lock).
5. If `src/routeTree.gen.ts` shows as modified with no content change, it is line endings only: `git checkout -- src/routeTree.gen.ts`.
6. **iPhone first:** 44pt targets, 16px inputs, safe-area utilities in `src/styles.css`, no hover-only UI, sheets via `ResponsiveSheet`, confirmations via `ConfirmDialog`.
7. When a task changes an architecture decision, edit its line in `AGENTS.md` in the same commit.
8. Talk to the owner in Levantine/Gulf Arabic: short and clear, no long lists.

## 9. Machine notes (the owner's own machine)
- The environment sets `CLAUDE_CODE_SUBAGENT_MODEL=deepseek-v4-flash`, which does not work. Any agent or workflow needs an explicit model: `model: 'claude-opus-5-5'`.
- The machine is an i3 with 4 cores, so at most two parallel agents. Parallel agents also burn through the usage allowance fast; prefer working directly.
- `npm ci` fails (the lockfile is out of sync). Use `npm install --no-audit --no-fund --package-lock=false`.
