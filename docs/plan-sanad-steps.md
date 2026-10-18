# سَنَد — نظام الخطوات (الخطة النهائية)

This is the final plan. It is rebased on the repo as of 2026-10-18 and takes in every valid point from the critique.

**What already exists:**
- **iPhone shell is on origin/main and synced to Lovable** (1042eab, a059e46). It includes viewport-fit=cover, the apple meta tags, the manifest and icons, the sticky opaque header, the sheet close button at the logical end, the light-theme status strip, the newest-40 chat history and the /knowledge fix.
- **Migrations 0011, 0012 and 0013 are applied.** Lovable applied them as 0011_apply_*, 0012_apply_* and 0013_apply_*, created both buckets and regenerated types.ts (fd1dfa0). fb0dbaa deleted our original files. Any further schema change goes into one corrective migration, 0014.
- **Uncommitted work in the working tree.** Most of T04 (number parsing and risk math) and part of T05 (one emotion vocabulary) are already done there but not committed.

**How it works:**
- **Steps.** The trader's day is one gated sequence of 7 steps (0-6). One pure engine, day-pipeline.ts, decides the current step.
- **Three engines copied from the reference skills:**
  - circuit-breaker.ts counts losses only and returns TRADING_ALLOWED, COOLDOWN or HALTED. Incomplete data (PARTIAL) counts as HALTED. Max trades and the profit cap are not breaker rules; they are a separate 'احمِ ربحك' warning.
  - pre-trade-gate.ts returns GO, REVIEW_REQUIRED, NO_GO or NO_ACTIONABLE, and every decision is journaled.
  - trade-review.ts gives each closed trade process, risk and execution scores, tags with evidence, and a verdict that only moves up in severity.
- **Who decides what.** Code decides the numbers. The AI explains and can only raise severity. Saving a trade is never blocked (the owner's decision in b15aeb3).
- **Screens.** 17 screens collapse to 4 thumb tabs (اليوم | فحص صفقة | السجل | سَنَد), two full-screen flows (setup and the gate stepper) and a gear that opens the 'نظامي' hub. Old routes become thin redirects.
- **Two agents, as the owner asked:**
  - المحلل (/analyst) analyses trades, knows the breaker state, hands ideas to the gate and reviews closed trades.
  - سَنَد (/session, one thread per day) manages the whole system. Its actions fall into three classes: JOURNAL runs automatically, STATE needs a click when the breaker is not ALLOWED or the change loosens a limit, DESTRUCTIVE always needs a click. A trade the AI logs that is already placed, while the breaker is ALLOWED, counts as JOURNAL, pending the owner's sign-off.

**Fixes from the critique:**
- Closed trades count as 'unreviewed' only if they closed after a reviews_since cutoff, so years of history cannot lock the gate.
- One loader for limits, anchored on the start-of-day balance, so every screen shows the same numbers.
- trade-review.ts ports the skill's critical process rules: entering on a NO_GO, entering during a halt, and an explicit 'no' answer.
- Each AI action is claimed in agent_action_log before it runs, so a re-approval after a crash cannot repeat it.
- 0014 adds coach_messages to the realtime publication, fixes the session backfill, adds paused_until, partial-close realized_pnl, the 'watch' intent, the legacy source tag and a capital_movements table.
- Urgent bugs are fixed early in T04b: floating P&L closing open trades, strategy examples defaulting to 'good', and silently swallowed balance errors.
- The deposit and balance UI moves before the breaker goes live (T20b). A stop editor ships together with the 'حط الوقف' card.
- Both lockfiles are regenerated together.
- AGENTS.md is edited in the same task that changes each decision, not left to the end.

**Order:**
- Phase A (T00-T09): visible iPhone wins and urgent fixes, with no schema work.
- Phase B (T10-T18): pure engines with tests.
- Phase C (T19-T24): verify the schema and apply 0014, repair data and capital, switch the breaker on, then the setup and plan step, trade writes and the gate stepper.
- Phase D (T26-T35): reviews, AI depth, the two agents, navigation, cleanup and an optional offline fallback.

Every task leaves `npm test` and `npm run build` green and is checked on a real Dynamic Island iPhone, both as a Safari tab and from the Home Screen.

## Step flow

### 0. الإعداد (مرة وحدة)
- purpose: Capture once what every later gate needs:
- live balance and timezone
- limits as % of balance: survival defaults of 2% daily / 5% weekly / 8% monthly, a 2-loss streak and a 24h cooldown, proposed but not forced
- optional session hours
- focus markets and the trader's weak point
- one strategy with written entry conditions and a stop rule
- at least 3 rules

This replaces today's one-shot AiSetup textarea. It also fixes the loop where 'خلصت' bounces back to /onboarding, because onboarded is currently set only by update_settings (agent-actions.ts:~435, route.tsx:~22).
- screen: /onboarding: a full-screen سَنَد setup thread (coach_threads.kind='setup', column already live from 0013), no tab bar. It can be reopened from نظامي › 'إدارة النظام مع سَنَد'.
- gate: finishSetup() sets onboarded=true when the pure setupComplete(state) holds:
- balance > 0
- limits are set, or the defaults card was accepted (limits_accepted_at)
- at least one allowed strategy with entry_conditions and a stop rule (the one-tap template does not count)
- at least one active rule
- a valid timezone

'كمّل لاحقاً' also finishes, but the defaults stay advisory: they warn, never block, and step 1 asks again every day.

If the settings fetch fails or is paused, show an offline/retry screen. Redirect to onboarding only when data===null.
- ai: سَنَد runs in setup mode with only update_settings, add_strategy, add_rule and update_focus allowed.

It asks one question per bubble with chip answers. Each answer becomes an approve card (STATE, so a click).

risk-validation.ts checks the answers:
- daily ≤ weekly ≤ monthly
- the streak is an integer ≥ 1
- the currency is ISO
- session_start < session_end, or both empty
- iphone: Uses the T07 keyboard-proof chat frame: --vvh, tab bar hidden. Chips are 44pt, and number answers use chips, so the keyboard rarely opens. The safe-area top is respected in both themes.

### 1. بوابة اليوم
- purpose: Answer one question: is new risk allowed today?

circuit-breaker.ts counts losses only, as in drawdown-circuit-breaker. It reads:
- realized P&L for the day, the Monday week and the month in settings.timezone: closed trades by closed_at plus partial-close trade_events.realized_pnl
- % limits anchored to daily_plans.start_balance
- the losing streak, by exit time
- manual pause (paused_until) and manual cooldown
- latched circuit_breaks rows
- data quality

It returns one state, every triggered rule, and a release time for each.

Max trades and the profit cap are not breaker rules. They are a separate 'احمِ ربحك' warning.
- screen: /dashboard (tab 'اليوم'). The BreakerCard is StepCard step 1. A breaker chip in the nav bar opens a sheet listing every triggered rule.
- gate: - TRADING_ALLOWED: go to step 2.
- COOLDOWN (losing streak, manual cooldown): the plan and gate buttons are hidden. The main button becomes 'راجع آخر خسارتين مع المحلل', with a live countdown.
- HALTED (daily, weekly or monthly loss, or manual pause): only managing, closing and reviewing open trades is available. The release time shows weekday + date + time. A manual pause ends at the next trading-day start unless the trader chose 'لين أرجّعه', which is asked again each morning.
- PARTIAL counts as HALTED. It covers blocking data problems in rows written after breaker_since, and shows 'صلّح الصفقات' links. Duplicates are left out of P&L and the streak until repaired, and the state clears on repair.
- Problems in rows from before breaker_since, and limits that are only unaccepted defaults: warnings only, with a daily 'حدودك غير مفعّلة' chip.
- A session left open from an earlier day must be closed first.
- On the first open of a new ISO week with no weekly review, step 6 comes first. It can be deferred once.
- ai: One morning brief per day, using a claim-first lock. It replaces morningGreeting, riskMorning and disciplineMorning.

It quotes breakerForPrompt: the state, the release time, and the distance to each limit ('باقي لك 120$ (1.2%) قبل إيقاف اليوم'). It repeats yesterday's next_rule and praises NO_GOs that were skipped.

On COOLDOWN, المحلل runs a fixed 4-question review of the losses:
1. على استراتيجيتك؟
2. داخل نافذة الانتقام؟
3. الوقف صح؟
4. وش يتغيّر؟
- iphone: One card above the fold:
- a state chip
- a one-line reason
- a release line with a leaf Countdown
- one thin bar ('خسارة اليوم 180 من 200'), from the same loader as the StatusStrip so the numbers never disagree
- one 44pt button

The chip sits inside the safe area. Data refreshes in about 1s on visibilitychange/pageshow. Overscroll is disabled, so a 'آخر تحديث' line refreshes on tap.

### 2. خطة اليوم
- purpose: Write today's numbers before the first trade:
- target, capped by the profit cap
- max trades
- risk per trade
- max loss, never looser than settings
- one thing forbidden today
- mood

Acknowledge any active temporary rules, or declare a rest day. Saving snapshots start_balance and starts the session.
- screen: /dashboard → PlanSheet (a ResponsiveSheet with a form, a vaul drawer on the phone), or the same thing said to سَنَد in the day thread (/session?intent=start).
- gate: A daily_plans row exists for dayKey(now, tz) with:
- effectivePlanLimits (the stricter of plan and settings)
- start_balance
- rules_ack_at, when rules_today is not empty

It is linked to a trading_session.

Without a plan, every gate check is REVIEW_REQUIRED 'ما في خطة مكتوبة لليوم'.

no_trading=true is a rest day: go to step 5 'يوم راحة', which is neutral for the streak.

revised_count increments only when a value that was already set changes after a trade was opened today.
- ai: سَنَد proposes one set_daily_plan card (STATE). It uses the last 5 days, yesterday's next_rule and patterns, for example 0.5× risk after a red week.

It never writes trading_settings.daily_target: remove that instruction from AGENT_GUIDE rule 5 (ai.functions.ts:~220).
- iphone: Four NumberFields: decimal pad, Arabic digits and ٫ normalized, Return moves to the next field. A row of forbidden-thing chips and mood chips. A sticky 'ثبّت الخطة' bar above the home indicator. The tab bar hides while the keyboard is open.

### 3. فحص الصفقة
- purpose: The last checkpoint before the order goes to the broker. An idea arrives as a screenshot, voice, text, or المحلل's 'مرّرها على البوابة' card. It is checked against:
- the plan and the stop
- size (lotForRisk)
- planned vs actual risk (riskUsd with contract size)
- the revenge window: at least 30 minutes, partial-close losses included
- the upstream breaker
- the protect-profit warning
- unreviewed closes after reviews_since
- active temporary rules

The result is one decision, journaled for every candidate, GO included.
- screen: /new-trade (tab 'فحص صفقة'): a stepper with ?step=0..6, each step pushed to history:
حالة يومك → الصفقة → خطتك → الوقف → الحجم → بعد خسارة؟ → القرار
- gate: The pre_trade_checks row is inserted first. If that fails, the result is REVIEW_REQUIRED 'ما انحفظ القرار'.

- NO_GO: an explicit لا on plan, stop or size; actual risk above planned; a loss inside the revenge window; self-declared revenge; bad levels; upstream COOLDOWN, HALTED or PARTIAL.
- REVIEW_REQUIRED: a blank answer on a pre-entry ticket (T00 item 5); missing risk; no plan; an unreviewed close after reviews_since; max trades or profit cap reached; outside session hours (only if set); an AI plan mismatch; missing settings.
- On NO_GO the main button is 'ما رح أدخل' (proceeded=false, counted as a discipline win). The secondary 'دخلت رغم القرار' saves the trade and adds rule_violations (source='gate') with the 3 reason chips.
- Historical or already-closed rows and المحلل 'watch' cards are NO_ACTIONABLE and only journaled.
- After saving, return to /dashboard.
- ai: parseTrade extracts the levels, opened_at and missing_fields.

gateOpinion compares the setup with the strategy's entry_conditions and its 2-4 nearest examples. It returns {plan_match, met[], missing[], explain, question} and can only raise the decision to REVIEW_REQUIRED. It never answers the trader's yes/no questions and never computes money.

'حلّلها مع المحلل أول' opens المحلل. Its card comes back prefilled with analysis_id.
- iphone: - One question per screen, with 56pt نعم/لا buttons.
- Steps answered automatically show '✓ محسوبة' and are skipped.
- A sticky decision bar shows the colour, risk $ / % / R and التالي. It respects the safe area and hides with the keyboard.
- Return focuses the next field and never submits.
- One '+' image picker.
- The back chevron and edge-swipe step back; verify in Home-Screen mode too.
- Errors appear inline.

### 4. سكّر وراجع الصفقة
- purpose: Keep open trades honest and review every close for process, not money.

On Today:
- A missing stop is a danger row, opening a working SetStopSheet from T14.
- Stop and TP moves are written to trade_events with 'مخطط؟'.
- Partial closes write trade_events.realized_pnl.
- Open heat is compared with the remaining daily loss.

Every close path goes through closeTrade() and then onTradeClosed(), which opens a 4-screen review:
1. exit reason
2. stop moved?
3. why did you enter
4. result card: verdict, 'العملية 85/100 · النتيجة −40$', up to 3 'نمط محتمل' cards with evidence, and one time-boxed next rule
- screen: /dashboard open trades → TradeDetailSheet (/trades?trade=<id>) → CloseSheet → TradeReviewSheet (/trades?review=<id>). The review card is also posted into the day thread.
- gate: - An open trade with no stop is the current step (danger).
- Every trade closed after reviews_since needs a trade_reviews row with exit_reason and one answered question. Until then the next gate is REVIEW_REQUIRED and step 5 cannot finish.
- Older closes never block. 'سجّل القديمة كتوثيق فقط' bulk-journals them.
- Saving re-runs the breaker (a second loss starts COOLDOWN) and returns to step 1.
- The default decision is journal_only. 'اعتمد القاعدة' goes through an approval card.
- ai: trade-review.ts decides the verdict, scores and tags. Entering on a NO_GO or during an active break is a critical finding.

reviewTradeAI (medium effort, under keepAlive, screenshot through a signed URL) explains it:
- A tag is kept only if its evidence_quote is a verbatim substring of the trader's notes after Arabic normalization.
- It never lowers the verdict and gives no buy/sell advice.
- It stays behind REVIEW_AI_ENABLED.

One-line event notes go into the day thread. pendingReviews catches up at most 3 closes per app open.
- iphone: - CloseSheet: a ربح/خسارة toggle plus an absolute amount (the decimal pad has no minus), and a warning when the sign disagrees with the prices.
- Close time defaults to now.
- Exit reasons are chips.
- Progress dots 1/4 to 4/4.
- max-h-[85dvh] with bottom safe-area padding.
- Usable with the keyboard open; about 30 seconds in total.

### 5. سكّر يومك
- purpose: Close the session with a structured review built from today's trade reviews:
- plan kept or not
- the top behaviour tag
- P&L vs target
- best and worst decision
- one rule for tomorrow

This updates the disciplined-day streak (dayVerdict) and replaces the 2-line 21:00 eveningReview. Reaching max trades or the profit cap (احمِ ربحك) makes this the main step.
- screen: /session?intent=close: the day thread opens with the closing greeting and quick replies. The Today StepCard button opens the same thread.
- gate: Requires:
- every trade closed today is reviewed
- no open trades, or an explicit carry-over
- end_session saved with the structured review

dayVerdict:
- ok: the plan was set before the first trade, kept, and reviewed
- neutral: rest day
- recovered: a violation followed by a written review
- broken: otherwise

An accepted rule for tomorrow goes into tomorrow's daily_plans.rules_today and next_rule. If the day was never closed, it is offered on the next open.
- ai: سَنَد drafts the review from the stored trade_reviews, so the trader is not asked again. It asks one question per trade entered on a NO_GO ('ليش دخلت؟'), praises the $ the gate saved, and proposes tomorrow's single rule as an approval card.
- iphone: One card with 3 numbers and 2-3 quick-reply chips above the composer. Nothing depends on the app being open at 21:00. Streak dots open a tap sheet; there are no hover-only tooltips.

### 6. مراجعة الأسبوع
- purpose: Turn the week's reviews into learning. patterns.ts computes:
- tag counts and the trend against the previous 4-8 weeks
- recurring tags (≥2) and rule drift (≥3)
- clean-process vs rule-breaking P&L, clean losses and lucky wins
- violations by rule
- $ saved by the gate
- ideas watched but not taken
- the analyst's hit-rate by confidence
- whether last week's rule was kept

It ends with 1-2 time-boxed rules for next week. The first open of a new month also shows a short monthly card built by the same function.
- screen: /trades?tab=week (tab 'السجل'; /reports redirects here). On the first open of a new week, the weekly card also shows first on Today.
- gate: A trade_reviews row exists with review_type='weekly', period_key 'YYYY-Www' (Monday week in the trader's timezone) and a decision of accept_rules, modify_rules, defer or journal_only. It is due before Monday's plan and can be deferred once.

Accepted rules go into rules_today for their duration and show at the gate as REVIEW-level warnings ('قاعدة مؤقتة: مخاطرة نص حدك لصفقتين — باقي 1').
- ai: سَنَد narrates the computed facts with the numbers behind them ('٣ من آخر ٤ صفقات بعد خسارة كانت صفقة تعويض محتملة'). It compares the week with last week's chosen rule and proposes next week's rules as approval cards. The last 4 weekly reviews go into every later prompt.
- iphone: A vertical stack of cards, each with a one-line headline. Tag chips filter the trade list. Sharing uses navigator.share(File). There are no raw markdown tables.

## Merges and removals
- **Step engines.** day-flow.ts, journey.ts and nav-plan.ts's pin reordering merge into one pure src/lib/day-pipeline.ts. day-flow and journey stay as thin adapters until their importers move: dashboard.tsx:12, components/dashboard/day-flow.tsx:4, journey-steps.tsx:4, use-journey.ts:4, app-shell.tsx:14 and ai.functions.ts:9. After that, they, their tests and the hard-coded 'من 5' are deleted in T34.
- **Screens.** 17 screens become:
- 4 tabs: /dashboard, /new-trade, /trades?tab=trades|perf|week, /session
- 2 full-screen flows: /onboarding and the /new-trade stepper
- the نظامي hub: /settings with /strategies, /rules, /knowledge

The old routes become thin beforeLoad redirects driven by a pure redirects.ts map: /coach→/session, /risk→/settings?s=limits, /discipline and /performance→/trades?tab=perf, /reports→/trades?tab=week, /training→/strategies. /analyst stays as its own route.
- **Agents.** 7 chats become 2. سَنَد is one day thread (coach_threads.kind='day', with a unique index on day already live), and risk, discipline and strategy become mode chips inside it. المحلل is a separate thread (kind='analyst') with analysis-only tools. coach.tsx's duplicate chat engine (~27-279) is replaced by SessionAgent. The 4 thread-history implementations become one useAgentChats.
- **Morning and evening.** morningGreeting, riskMorning, disciplineMorning and GREETING_START become one morningBrief, using a claim-first lock that reuses the existing notifications_daily_once index. The 21:00 eveningReview poll (risk-watcher.tsx:~65-68) is replaced by step 5 plus lazy catch-up.
- **Today's plan.** trading_sessions.plan, the AI's update_settings daily_target and daily_plans become daily_plans only, using its real columns (already live from 0012). effectivePlanLimits replaces effectiveDailyTarget everywhere.
- **Limits.** Every % → $ conversion goes through one loader, src/lib/effective-settings.ts: applyPctLimits(settings, anchorBalance(todayPlan, liveBalance)). It is used by settingsQuery, the gate, RiskWatcher, needsApproval and the server buildContext, which brings the anchor to start_balance into the same numbers everywhere. The queries.ts:27-31 inline calculation is deleted.
- **Capital.** The knowledge_notes '__capital' JSON blob (a read-modify-write race, and the oldest row was read) becomes a capital_movements table (0014), imported once and idempotently. The deposit, withdraw and correct UI moves from the unused CapitalCard into نظامي › حدودي ورأس مالي in T20b, before the breaker goes live.
- **Trade writes.** The /new-trade insert, trades.tsx CloseDialog, OpenTrades 'سكّرتها' and agent-actions create_trade/close_trade/update_trade all go through src/lib/trade-write.ts (createTrade/closeTrade/moveStop/partialClose). The close_trade fallback that invents 'long' with risk 0 (agent-actions.ts:~606-622) is deleted, as is the dead override path (new-trade.tsx:~167, ~253-261, ~752-802).
- **Status logic.** trade-gate.ts's duplicated threshold warnings move into pre-trade-gate.ts; trade-gate.ts keeps only metrics and R:R. computeStatus becomes a tone mapper over BreakerDecision plus the protect-profit warning. Max trades and the profit cap leave the breaker. trading-status.ts's Sunday startOfWeek is deleted.
- **Stop controls.** The trading_paused toggles (risk.tsx:~71-77, session.tsx:~171-182) and the discipline.tsx cooldown panel merge into the breaker sheet as manual_pause and manual_cooldown. manual_pause gains paused_until (0014); a pause with no end date is an explicit choice.
- **Discipline.** stats.ts disciplineReport and GREEDY are deleted; discipline.ts is the only source. The 15/5/60-minute revenge windows become REVENGE_WINDOW_MIN = max(30, cooldown_minutes). One pure checklistStatus(trade) returns passed, failed or unknown, used by discipline.ts, performance.tsx:63 and trades.tsx:82, so legacy chat trades are no longer counted as failures.
- **Validators.** risk-limits.ts and its test are deleted once, in T15; their strict checks move into risk-validation.ts. RiskGuardian's private conflict fix and LimitsProgress's copy are deleted.
- **Vocabulary.** The five emotion lists are already merged into src/lib/emotions.ts in the working tree. Still to do: REVENGE_WINDOW_MIN, and the market-symbols.ts:12 bare 'ين' alias.
- **Reports.** /reports, /performance and the discipline stats sheet become /trades?tab=perf|week. perf.ts customRange replaces reports.tsx:~37-40. performanceInsight and reportSummary are replaced by the stored weekly and monthly reviews.
- **Strategy and training.** STRATEGY_MODE and TRAINING_MODE become one 'استراتيجيتي' mode. Strategy examples are saved only with an explicit good or bad verdict.
- **'Today'.** Every variant of the current day (browser midnight, UTC+3, server UTC, toLocaleDateString, unpadded keys) becomes src/lib/trading-day.ts using settings.timezone.
- **Timers.** Five pollers become one visibility-aware heartbeat plus realtime on coach_messages (publication added in 0014), with an incremental gt(created_at) fetch on resume as the guaranteed fallback.
- **Navigation.** The 'المزيد' sheet and planNav reordering are removed, and one nav-registry.ts drives everything. Logout gets an AlertDialog confirm now (T01) and moves into نظامي later. The desktop <aside> mounts only at ≥1024px.
- **Notifications.** The bell becomes a phone drawer with tappable rows, routed by a pure notificationTarget(kind, dedupe_key). Alert toasts collapse to one per RiskWatcher run.
- **Dead code.** dashboard/{activity-list, behavior-widget, capital-card, focus-card, journey-steps, limits-progress, session-widget, status-banner, day-flow}.tsx, limits-form.tsx, analyzeChart, DETAILED_RULE, loginStreak/disciplineStreak, SessionAgent's title-based thread creation, the browser Notification path and settings.tsx's three fake switches. capital-card and status-banner are not imported anywhere today, so no task edits them any further.
- **Settings.** A native timezone select. A theme setting of فاتح | داكن | تلقائي (follow iPhone). Export of every table via navigator.share(File). Clear-history behind a typed AlertDialog that checks each `.error`.

## AI upgrades
- **Two agents.** المحلل's tools are save_analysis, add_strategy_example, attach_trade_image and send_to_gate. Its watch cards are journaled as pre_trade_checks with intent='watch' and NO_ACTIONABLE, so 'watched, not taken' reaches patterns. It also has a review sub-mode and answers the COOLDOWN 4-question review. سَنَد gets the full action set under the three action classes.
- **Code decides, AI explains.** Every prompt starts with computed blocks the model must quote and never recompute:
- breakerForPrompt
- pipelineForPrompt
- 'حالة اليوم (محسوبة، لا تعيد حسابها)' from the effective-settings loader
- today's gate decisions
- 'آخر خسارة قبل N دقيقة'

RISK_MODE's 'احسب كم يخاطر' and riskAdvice's free arithmetic are removed.
- **Per-trade understanding.** trade-review.ts produces the facts and verdict, including the ported skill rules: market_regime_gate, setup_confirmation, pre_entry_thesis_record, per-trade rule_drift, a mandatory no_pattern_detected tag, overconfidence_after_winner from data, and adds/trims.

reviewTradeAI adds summary_ar, root_cause, extra tags with verbatim evidence (checked on the server after Arabic normalization), one question and one time-boxed rule card. It can never lower the verdict, and it stays behind a flag until it passes fixtures built from the owner's real notes.
- **Pre-trade second opinion.** gateOpinion replaces riskAdvice (ai.functions.ts:~394-403). It uses a slim context (strategy entry and exit conditions, the 2-4 nearest examples plus images), returns strict JSON, is debounced and can only raise the decision. The result is stored in pre_trade_checks.ai_plan_match and ai_note.
- **Gate questions in chat.** Trades the AI logs as already placed are journaled with answers=null. With the breaker ALLOWED they run automatically as JOURNAL (T00 item 4). سَنَد then asks the 4 questions in one line and records the literal reply with answer_pre_trade_check. A click is needed only during COOLDOWN/HALTED/PARTIAL or on an actual NO_GO.
- **Action policy.** agent-action-spec.ts holds the types, zod schemas, classes and allowedActions(mode). action-policy.ts needsApproval() compares against the effective-settings loader, which is anchored to the start balance:
- STATE needs a click when the breaker is not ALLOWED or the change loosens anything, including lowering a cooldown.
- DESTRUCTIVE always needs a click and is excluded from 'وافق على الكل'.

The server validates actions before saving them.
- **Claim-first idempotency.** INSERT agent_action_log(message_id, action_index, status='running') ON CONFLICT DO NOTHING. If the claim fails, skip; otherwise run, then update the row to done or failed with before/after. STATE or DESTRUCTIVE rows stuck in 'running' show 'ما أدري إذا تنفّذ — تحقق' instead of re-running. 'تراجع' is offered for the last settings or focus change.
- **Auto-run kept.** coach_auto moves into trading_settings (column live). It is seeded from localStorage 'coach-auto' !== 'off' (session-agent.tsx:85), so the owner keeps the full control he merged; origin/coach-full-control is already an ancestor of main. A تلقائي/يدوي chip sits in every composer.
- **Outcome feedback.** Assistant history rows carry '[نتيجة: create_trade XAUUSD تم | update_settings ⏳]'. The duplicate image turn in coachReply is removed: the user row inserted at ai.functions.ts:308 is in hist and is pushed again at :318.
- **Screenshot memory.** The full image is stored in the private chat-images bucket (coach_messages.image_path, bucket live). The latest thread image is re-attached on follow-ups. Actions bind to their own message's image, not the module-global lastImage (agent-actions.ts:~108).
- **Memory over weeks and months.** patternsForPrompt carries the last 4 weekly reviews, the last monthly review, the last 10 trade reviews, 30-day tag counts, violations by rule, gate-saved $ and the analyst's hit-rate.
- **Grounding fixes.** loadContextData uses one Promise.all, timezone day bounds, closed trades by closed_at, paging and thrown errors. A pure formatContext adds strategy markets and timeframes (missing at ai.functions.ts:29) and truncated knowledge-note content when knowledge is on (:35). Trade lines include notes, close_notes, R, hold minutes, exit_reason and any linked violation.
- **Prompt truth.**
- Delete AGENT_GUIDE 1.2 'الBوابة ترفض', the false streak sentence, ANALYST ~276, DETAILED_RULE and the repeated asset paragraph.
- Analyst 'never say wait' follows T00 item 6.
- Add a per-symbol capability line (no Volume/POC claims when volume is 0).
- Show a data-freshness chip instead of 'لا تذكر مصدر البيانات'.
- **Phone-shaped replies.** AGENT_SCHEMA gains `suggestions` (2-3 quick replies) and `step`. A shared PHONE_FORMAT rule: at most 6 short lines, no tables, one next action.
- **Model plumbing and cost.**
- callAI with format, effort and maxTokens options.
- response.incomplete is treated as an error and retried once.
- A console usage log.
- A daily cap of 15 AI reviews, counted from today's trade_reviews.ai_summary, after which the review is deterministic only.
- transcribeAudio moves into ai.server.ts with a 30s timeout.
- Staged progress text.
- Check Lovable's waitUntil window (about 30s?) before turning reviews on, and cap the call at 25s if needed.

## DB migrations
**0011, 0012, 0013: already applied. Verify only.** Lovable applied them on 2026-10-18 as drizzle/migrations/0011_apply_notifications_once_per_day.sql, 0012_apply_discipline_journal.sql and 0013_apply_reviews_threads.sql. It created the trade-screenshots and chat-images buckets with its storage tooling and regenerated types.ts in fd1dfa0. fb0dbaa removed our original 0012/0013 files; do not re-add or re-apply them.

Run these checks in Lovable SQL:
- notifications_daily_once exists and the old UNIQUE(user_id, kind, day) is gone.
- Two kind='risk' rows on the same day both insert.
- A second user selects 0 rows from circuit_breaks, pre_trade_checks, trade_reviews, trade_events and agent_action_log.
- Both buckets exist and are private.

**0014_corrective.sql (new).** Idempotent, with owner-only RLS on the new table. Checks are dropped by looking up the real constraint name in pg_constraint, using the 0011 DO-block pattern.

(a) agent_action_log: re-create the status CHECK as ('running','done','failed','rejected','needs_confirmation','undone'), so actions can be claimed first.

(b) Realtime: `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='coach_messages') THEN ALTER PUBLICATION supabase_realtime ADD TABLE public.coach_messages; END IF; END $$;`

(c) Session backfill repair. The 0012 backfill matched coalesce(ended_at, now()), so a session left open absorbed later trades. No app code writes trades.session_id yet, so reset and redo it:
- `UPDATE trades SET session_id = NULL;`
- then UPDATE … FROM (SELECT DISTINCT ON (t.id) t.id, s.id sid FROM trades t JOIN trading_sessions s ON s.user_id = t.user_id AND (s.started_at AT TIME ZONE 'Asia/Riyadh')::date = (t.opened_at AT TIME ZONE 'Asia/Riyadh')::date AND t.opened_at >= s.started_at AND t.opened_at <= coalesce(s.ended_at, date_trunc('day', s.started_at AT TIME ZONE 'Asia/Riyadh') + interval '1 day' AT TIME ZONE 'Asia/Riyadh') ORDER BY t.id, s.started_at DESC).
- 0014 must be applied before T23 starts writing session_id.

(d) trading_settings: ADD reviews_since timestamptz (NULL means the unreviewed-trade rule is off) and paused_until timestamptz. Backfill: for trading_paused=true, set paused_until to the next local midnight in coalesce(timezone, 'Asia/Riyadh'), so an old forgotten pause ends.

(e) trade_events: ADD realized_pnl numeric, for partial_close.

(f) pre_trade_checks: re-create the intent CHECK as ('pre_entry','already_placed','historical','watch').

(g) trades: `UPDATE trades SET source='backfill' WHERE source IS NULL;` (all legacy rows).

(h) CREATE TABLE public.capital_movements:
- id uuid PK
- user_id uuid NOT NULL
- at timestamptz NOT NULL
- kind text NOT NULL CHECK ('deposit','withdrawal','adjust') (matches capital.ts:15)
- amount numeric NOT NULL
- note text
- legacy_id text
- created_at timestamptz DEFAULT now()
- UNIQUE(user_id, legacy_id)
- owner-only RLS policy plus grants, copied from 0012

Afterwards, Lovable regenerates types.ts.

**Workflow for every migration (recorded in AGENTS.md by T00):**
1. Write idempotent SQL in drizzle/migrations/00NN_name.sql.
2. Paste exactly that SQL into Lovable chat and ask it to apply it and regenerate types.ts.
3. Lovable registers its own 00NN_apply_* copy. Delete our original in the next commit, as fb0dbaa did, so it is never applied twice.
4. Pull, then run the post-apply checks: RLS denies a second user, and the expected columns are in types.ts.
5. Only then merge code that reads the new columns or tables.

Never hand-edit types.ts, never force-push main, and freeze the Lovable editor for the files a task touches.

## Tasks

### T00 [S] Owner sign-off on eight policies and the working rules
files: AGENTS.md, docs/decisions/sanad-steps.md (new)
deps: 

Write one Arabic decision sheet and get the owner's explicit answer to each item:
(1) NO_GO friction: 'دخلت رغم القرار' is one tap plus 3 reason chips, no typing, and auto-inserts rule_violations with source='gate'. Saving is never blocked (b15aeb3).
(2) Unreviewed trades: REVIEW_REQUIRED stays on the next gate until the last trade closed after reviews_since is reviewed. Older closes never block.
(3) Action classes: JOURNAL runs automatically. STATE needs a click while the breaker is not ALLOWED, or for any loosening. DESTRUCTIVE always needs a click. Existing users keep their current auto setting.
(4) AI-logged trades that are already placed (MT5 screenshot or chat) with the breaker ALLOWED run automatically as JOURNAL, and سَنَد asks the 4 gate questions afterwards. A click is needed only during COOLDOWN/HALTED/PARTIAL or on an actual NO_GO. Recommended, because otherwise auto-run ends on his main input path.
(5) A blank answer on a pre-entry ticket gives REVIEW_REQUIRED (recommended), not the skill's strict NO_GO.
(6) The analyst's 'never say انتظر' rule (ai.functions.ts:~273): allow intent=watch only when the breaker is not ALLOWED or R:R < 1.5.
(7) Survival defaults (2/5/8%, 2 losses, 24h): offered on one card, warnings only until accepted, and shown again daily as 'حدودك غير مفعّلة' until accepted or explicitly declined.
(8) Naming and timing: the app is HADI/هادي, the manager is سَنَد, the analyst is المحلل. Revenge window = max(30, cooldown_minutes). A manual pause ends at the next trading-day start unless he picks 'لين أرجّعه'.

Working rules:
- one branch per phase, fast-forward to main
- never force-push
- freeze the touched files in the Lovable editor
- deploy timezone changes outside 00:00-03:00 Riyadh
- every task that changes an architecture decision edits its own AGENTS.md line in the same commit (each task lists its line)
- the migration workflow from db_migrations[2]

After the answers, rewrite AGENTS.md:16. It is false: auto-run is ON by default (session-agent.tsx:61), and coach-full-control is already merged into main. Describe the three action classes instead.

TESTS: Docs only. npm test and npm run build still pass.

### T01 [M] iPhone shell leftovers (the rest already shipped in 1042eab/a059e46)
files: src/components/ui/dialog.tsx, src/components/app-shell.tsx, src/routes/__root.tsx, src/styles.css, src/routes/_authenticated/settings.tsx, src/components/ui/sonner.tsx, src/lib/error-page.ts, src/components/ui/alert-dialog.tsx, src/lib/theme.ts (new), src/lib/theme.test.ts (new), src/lib/nav-plan.test.ts (new)
deps: 

Already on main: cover viewport, apple meta, manifest and icons, sticky opaque header (app-shell.tsx:214), sheet close at the logical end with 'إغلاق', the dark status strip, newest-40 history, the /knowledge nav fix.

Still to do:
(a) dialog.tsx:47-49 has the close button at physical right-4 with the English label 'Close'. Move it to end-3 with a 44px hit area and the label 'إغلاق', and make headers text-start. Under max-sm, use a bottom-sheet layout: inset-x-0 bottom-0 top-auto, no translate, rounded-t-3xl, safe-area bottom padding, max-h var(--vvh,100dvh), overflow-y-auto.
(b) Delete the [&>button]:left-4 [&>button]:right-auto override at app-shell.tsx:240.
(c) Remove the Google Fonts preconnect and stylesheet (__root.tsx:97-101).
(d) Theme:
- Pure theme.ts resolves a light, dark or system choice.
- settings.tsx:28-35 and the inline boot script in __root.tsx offer فاتح | داكن | تلقائي. Automatic follows matchMedia('(prefers-color-scheme: light)') with a change listener.
- meta theme-color updates at runtime (today it is fixed at #0a0a0a, __root.tsx:73).
- Fix styles.css:5 `@custom-variant dark (&:is(.dark *))` (nothing ever sets .dark) to `(&:is(:root:not(.light) *))`.
(e) Sonner: theme from the html class, dir='rtl', visibleToasts=2, offset below the header (calc(env(safe-area-inset-top) + 56px)).
(f) error-page.ts: Arabic, lang=ar dir=rtl, 100dvh (today lang=en and 100vh).
(g) The html background matches the body gradient's end colour in both themes.
(h) Logout in the More sheet (app-shell.tsx:259) gets an AlertDialog confirm. A mis-tap forces a full re-login in Home-Screen mode.
(i) If the ITEM cast at app-shell.tsx:~64 is still there, type it as Partial<Record<NavPath,NavItem>>.

Commit only these files. The uncommitted T04/T05 files stay out of this commit.

TESTS: - theme.test: system resolves from the matchMedia mock; theme-color per theme.
- nav-plan.test: every planNav path exists in NAV.
- npm test and npm run build.
- On a real Dynamic Island iPhone, as a Safari tab and from the Home Screen, in light, dark and automatic:
  - the dialog X does not cover the title
  - the clock is readable
  - no overscroll seam
  - logout asks first

### T02 [S] Remove the duplicate image turn and add action outcomes to history
files: src/lib/chat-history.ts (new), src/lib/chat-history.test.ts (new), src/lib/ai.functions.ts
deps: 

Newest-40 is already done (ai.functions.ts:315-317). The bug that remains: the user row inserted at :308 is inside hist, and :318 pushes it again with the image.

Add a pure toModelInput(rows, current, {hasImage}) that:
- keeps chronological order
- drops the last row when it equals the current message and an image turn is pushed separately
- appends the current message if it is missing
- appends '[نتيجة: …]' status lines to assistant rows from coach_messages.actions (add actions to the select)

Use it in coachReply.

TESTS: chat-history.test:
- 60 rows give the newest 40 in order, ending with the current message
- the image turn appears once
- a missing current message is appended
- status lines for done, failed and pending

Also npm run build.

### T03 [M] Stop dropping risk alerts and reminders, and collapse alert toasts
files: src/components/risk-watcher.tsx, src/lib/agent-actions.ts, src/lib/agent-actions.test.ts, src/components/notifications-bell.tsx, src/lib/ai.functions.ts
deps: 

0011 is already applied, so this task is code only:
- risk-watcher.tsx:~46-62: treat 23505 as 'already delivered'. Log and toast any other error. Advance next_at, or deactivate a reminder, only after its insert succeeds.
- delete_notifications (agent-actions.ts:~874-877) becomes .update({dismissed:true, read:true}), relabelled 'إخفاء التنبيهات'.
- Remove the bell's per-fetch hard DELETE (notifications-bell.tsx:~37) and filter in the SELECT instead.
- riskMorning and disciplineMorning lock rows (ai.functions.ts:~534, ~551) are inserted with dismissed=true.
- Each RiskWatcher run shows at most one toast: the worst alert's title, plus '+N تنبيهات' when there are more. Duration 6s. The rest stay in the bell, so they no longer stack over the header.

AGENTS.md:29 stays true; no change.

TESTS: - agent-actions.test: delete_notifications issues an update, never a delete.
- Lovable SQL: two kind='risk' rows on the same day both insert.
- Manual: loss_80 then loss_hit on the same day give one toast each and two bell rows; three alerts at once give one toast.
- npm run build.

### T04 [M] Finish and commit the money-risk and Arabic-number work already in the working tree
files: src/routes/_authenticated/new-trade.tsx, src/lib/num.ts, src/lib/num.test.ts, src/components/ui/number-field.tsx, src/lib/trade-idea.ts, src/lib/trade-idea.test.ts, src/lib/trade-gate.ts, src/routes/_authenticated/trades.tsx, src/routes/_authenticated/discipline.tsx, src/components/dashboard/capital-card.tsx
deps: 

Already uncommitted in the tree:
- parseDecimal/numOrNull (num.ts) and NumberField
- money() using riskUsd with contract size, lotForRisk 'استخدم', withinRiskLimit for the 'risk' auto-check
- NumberField in new-trade, trades and discipline
- the CloseDialog ربح/خسارة toggle

Still to do:
(a) Pure expectedPnlSign(direction, entry, exit) in trade-idea.ts, plus a warning in CloseDialog when the toggle disagrees.
(b) A close-time field in CloseDialog defaulting to now (today closed_at is always now).
(c) trade-gate.ts:~108 returns null instead of Number(x)||0 when a value is unknown.
(d) The iOS Return key saves half-typed trades through the form's implicit submit (new-trade.tsx:391). Add a form onKeyDown: Enter on an INPUT calls preventDefault and focuses the next field. NumberField sets enterKeyHint='next'. The save button is enabled only when the symbol, entry and SL all parse.

capital-card.tsx is not imported anywhere. Keep its small parseDecimal hunk, because T20b moves its MoveDialog into settings, but don't extend it.

Commit these files as one commit.

TESTS: - num.test: '١٫٠٨'→1.08, '1,5'→1.5, 'abc'→invalid, ''→null.
- trade-idea.test: EURUSD 1.0850/1.0800 at 1 lot = 500; XAUUSD 2350/2340 at 0.1 = 100; expectedPnlSign for long and short.
- Component test: Enter on the symbol field saves nothing.
- npm test and npm run build.
- Arabic-region iPhone: the decimal pad saves 1.08.

### T04b [S] Urgent data-integrity fixes that feed the breaker
files: src/lib/agent-actions.ts, src/lib/agent-actions.test.ts, src/lib/queries.ts, src/lib/capital-store.ts, src/lib/fetch-all.ts (new), src/lib/fetch-all.test.ts (new)
deps: 

(a) agent-actions.ts:506 treats any finite pnl as closed, so floating P&L on an MT5 Trade-tab screenshot closes the trade, and the dedupe branch (~524-529) closes the existing open trade. Change it to closed = status==='closed' || exit_price != null. Floating pnl on an open trade is ignored.
(b) agent-actions.ts:264 `verdict: z.enum(['good','bad']).catch('good')` saves wrong examples as correct. Replace it with a preprocess: صح/صحيح/good → good, غلط/خطأ/bad → bad, anything else rejects the action with 'حدد: صح أو غلط؟'.
(c) queries.ts:27-31:
- throw on errors from the closed-trades and capital sub-queries
- page closed trades past PostgREST's 1000-row cap with a pure fetchAll(range) helper
- read the same __capital row that capital-store.ts writes, and log when there is more than one

loadCapital in capital-store.ts gets the same fixes. T20b replaces the blob entirely.

TESTS: agent-actions.test:
- an open trade with pnl -35 and no exit_price stays open
- a re-upload never closes the open duplicate
- verdict 'غلط' maps to bad; 'Wrong' is rejected

fetch-all.test: 2,500 mocked rows arrive in 3 pages; an error throws.

npm run build.

### T05 [S] Finish the one vocabulary: revenge window and Arabic symbol aliases
files: src/lib/emotions.ts, src/lib/emotions.test.ts, src/lib/discipline.ts, src/lib/discipline.test.ts, src/lib/focus.ts, src/lib/market-symbols.ts, src/lib/market-symbols.test.ts, src/lib/ai-trade.ts, src/lib/stats.ts, src/lib/perf.ts, src/lib/perf.test.ts, src/components/performance/widgets.tsx, src/routes/_authenticated/performance.tsx
deps: 

Already in the tree: EMOTIONS (with 'خوف من الفوات'), GREED, SENSITIVE, REVENGE_MARKER and revengeLine, used in new-trade, ai-trade, trade-gate, discipline, stats and the parseTrade enum; perf.ts sideSplit long/short with its test; the widgets label.

Still missing:
- REVENGE_WINDOW_MIN(s) = max(30, s.cooldown_minutes || 30) in emotions.ts.
- discipline.ts:25 REVENGE_MS = 15 minutes moves to that window, and so does focus.ts:~206.
- market-symbols.ts:12: match Arabic aliases only on Arabic-letter boundaries, with optional ال/ب/بال prefixes, and drop the bare 'ين' (it matches وين/الحين/بين and injects USDJPY into gold analyses).

Commit as one commit after T04.

TESTS: - emotions.test: the window is never under 30.
- discipline.test: a re-entry 20 minutes after a loss counts as revenge.
- market-symbols.test: وين الـ POC, الحين, بين 2400, تعطيني, يمين → none; 'بالذهب' → XAUUSD.
- perf.test: the long/short split is non-zero.
- npm test and npm run build.

### T06 [M] Native touch targets, sheets, confirmations, Arabic typography and a tappable bell
files: src/components/ui/button.tsx, src/components/ui/input.tsx, src/components/ui/checkbox.tsx, src/styles.css, src/components/responsive-sheet.tsx (new), src/hooks/use-media-query.ts (new), src/lib/notification-target.ts (new), src/lib/notification-target.test.ts (new), src/components/app-shell.tsx, src/components/notifications-bell.tsx, src/components/agent-actions.tsx, src/components/session-agent.tsx, src/components/md.tsx, src/components/risk-gauges.tsx, src/routes/_authenticated/trades.tsx, src/routes/_authenticated/rules.tsx, src/routes/_authenticated/strategies.tsx, src/routes/_authenticated/settings.tsx, src/routes/_authenticated/session.tsx, src/routes/_authenticated/coach.tsx, src/components/agent-chats.tsx, src/routes/_authenticated/analyst.tsx, src/routes/_authenticated/knowledge.tsx, src/routes/_authenticated/new-trade.tsx, src/components/paper-test-panel.tsx, src/routes/auth.tsx
deps: T01

Touch:
- Coarse-pointer sizes: Button h-11, sm h-10, icon size-11; Input h-11; native selects text-base h-11; Checkbox size-5.
- active:scale-[.97]; hover styles only under @media(hover:hover).

ResponsiveSheet: a vaul drawer under 768px that wraps a <form>, a Dialog above 768px. Use it for CloseDialog, the More sheet and session details.

Confirmations:
- Replace window.prompt/confirm with AlertDialog at rules.tsx:~36 (cancel still logs a violation today) and ~48, strategies.tsx:~150, settings.tsx:~212 and session.tsx:~165.
- Thread deletes get a confirm plus an undo toast.
- AgentActions: approve and reject 8px apart; 'وافق على الكل' skips DESTRUCTIVE.

Arabic typography:
- Chat bubbles (session-agent.tsx:193) and Md: 16px with leading-[1.75] on the phone.
- Remove tracking-[0.2em] from Arabic text (auth.tsx:100, sidebar headings).
- Replace leading-none + truncate on Arabic labels (new-trade checklist) with leading-normal + line-clamp-2.
- All labels ≥12px (risk-gauges, session status, coach subtitle).

Bell:
- A ResponsiveSheet drawer on the phone instead of the 320px popover.
- Rows are tappable through pure notificationTarget(kind, dedupe_key): risk → /dashboard; nosl:<id> and longopen:<id> → /trades?trade=<id>; morning → /session.
- A tapped row expands instead of line-clamp-3.
- A 44px trigger.

Other:
- Mount the <aside> only at ≥1024px: one bell and one greet() at boot.
- auth.tsx: autoComplete attributes, and remove the public sign-up toggle (also ask Lovable to disable signups).

TESTS: - notification-target.test: every kind and dedupe_key prefix maps to a route.
- Component test: cancelling the violation AlertDialog inserts nothing.
- npm run build.
- Device: targets ≥44pt; chat text is 16px; no clipped Arabic diacritics; tapping a 'حط الوقف' notification opens the trade.

### T07 [L] Keyboard-proof chat frame, one chat component, safer images
files: src/hooks/use-visual-viewport.ts (new), src/lib/chat-ui.ts (new), src/lib/chat-ui.test.ts (new), src/lib/image.ts, src/lib/image.test.ts, src/styles.css, src/components/app-shell.tsx, src/components/session-agent.tsx, src/routes/_authenticated/coach.tsx, src/components/md.tsx, package.json, bun.lock, package-lock.json
deps: T06

Viewport and layout:
- useVisualViewport sets --vvh and html[data-kb]; [data-tabbar] hides under data-kb.
- A grid chat frame sized from var(--vvh,100dvh), with body scroll locked on chat routes.

Scrolling:
- Scroll the list container itself, not scrollIntoView (session-agent.tsx:~125, coach.tsx:~79).
- A ResizeObserver keeps the view pinned as images and cards grow.
- A 'جديد ↓' pill when rows arrive while scrolled up.

Composer:
- enterKeyHint='send'; on coarse pointers Return inserts a newline
- isComposing guard
- pointerdown preventDefault on the buttons, then refocus
- one '+' sheet for photo, camera and voice
- a preview chip with a 44px remove
- pasted images are taken only on the composer textarea; remove the window-level paste listener (session-agent.tsx:74-83) that grabs pastes in sheets and other inputs

Rendering:
- Memoized MessageRow and Md.
- Logical RTL bubbles and dir=auto.
- An in-app lightbox replaces the data: URL with target=_blank (session-agent.tsx:~200).
- coach.tsx renders SessionAgent.
- md.tsx gets remark-gfm, a table overflow wrapper and unicode-bidi:plaintext.

Dependency: install remark-gfm with both `bun add remark-gfm` and `npm install remark-gfm`, so bun.lock (Lovable uses bun, bunfig.toml) and package-lock.json change in the same commit.

Images: prepareImage (image.ts:31) decodes 24-48MP camera photos at full size. Decode at a reduced size instead: createImageBitmap(file, {resizeWidth, resizeQuality:'high'}) where supported, otherwise img.decode() into a capped canvas. Replace the misleading '>5MB' error (image.ts:47) with the real reason.

TESTS: - chat-ui.test: shouldAutoScroll, enterSends, keyboardOpen.
- image.test: targetSize(8064, 6048, 1600) keeps the aspect ratio.
- npm test and npm run build; bun install --frozen-lockfile succeeds.
- iPhone: the composer stays above the keyboard; a newline can be typed; image-only send works; pasting into a sheet input does not attach an image; a 48MP photo attaches without error.

### T08 [M] Fresh data on resume, one heartbeat, iOS audio, offline-safe boot
files: src/hooks/use-resume.ts (new), src/lib/heartbeat.ts (new), src/lib/heartbeat.test.ts (new), src/lib/safe-storage.ts (new), src/router.tsx, src/lib/queries.ts, src/components/risk-watcher.tsx, src/components/notification-sound.tsx, src/routes/_authenticated/route.tsx, src/routes/__root.tsx, src/components/session-agent.tsx, src/routes/_authenticated/session.tsx, src/components/dashboard/quick-coach.tsx, AGENTS.md
deps: T07

Resume: on visibilitychange→visible, pageshow or online, when the app was hidden more than 15s or the day changed, invalidate trades, settings, notifications, daily_plan, sessions and the open thread, and run RiskWatcher at once.

Timers:
- One 60s heartbeat that runs only while visible replaces refetchInterval in queries.ts:~43 and ~103 and NotificationSound's timer.
- RiskWatcher reads through qc.fetchQuery.
- router.tsx invalidates settings only when trades actually changed.
- uid() uses getSession.

Boot: route.tsx shows an offline/retry screen on error or a paused fetch, and redirects to onboarding only when data===null.

Audio:
- Unlock on touchend, click or keydown, keeping the listeners until play() resolves.
- navigator.audioSession.type='transient' where it exists.
- An 'اضغط لتفعيل الصوت' chip when play() is rejected.

Also:
- vite:preloadError triggers one guarded reload.
- A safe-storage wrapper.
- An <Elapsed/> leaf replaces session.tsx's 1s clock.
- The 15s poll becomes an incremental gt(created_at) fetch.

AGENTS.md: rewrite :27 (query defaults → heartbeat plus resume) and :20 (the minute loop → heartbeat).

TESTS: heartbeat.test:
- shouldRefreshOnResume
- one tick per minute while visible, an immediate tick on resume, none while hidden

iPhone:
- Switch to MT5 for 60s: P&L refreshes in about 1s.
- An offline cold start shows the retry screen.
- Sound plays after the first tap.
- ≤4 requests per idle minute.

### T09 [M] iOS navigation bar and one route registry
files: src/lib/nav-registry.ts (new), src/lib/nav-registry.test.ts (new), src/components/app-shell.tsx, src/lib/nav-plan.ts, src/lib/nav-plan.test.ts, src/lib/focus.test.ts, src/lib/journey.test.ts, src/routes/_authenticated/risk.tsx, src/routes/_authenticated/session.tsx, src/routes/_authenticated/analyst.tsx, src/routes/_authenticated/coach.tsx, src/routes/_authenticated/discipline.tsx, src/routes/_authenticated/strategies.tsx, src/routes/_authenticated/training.tsx
deps: T01,T06

- nav-registry.ts holds {path, title, label, icon, group, tabRoot}.
- The mobile header becomes an iOS nav bar:
  - large page title
  - an RTL back chevron that falls back to /dashboard
  - trailing slots for the breaker chip (from T14), the bell and a gear
- Remove the duplicate per-page headers on agent pages and add one ChatHeader slot.
- For now keep the 4 tabs and the More sheet, grouped in step order (اليوم → المراجعة → الإعداد → النظام) and covering every route.
- Delete planNav's reorder and its unused .mobile field. Update the tests that assert them in the same commit: focus.test.ts:123-156 and journey.test.ts:90-91.

TESTS: - nav-registry.test: every route is reachable; backTarget is correct.
- The updated focus and journey tests pass.
- npm test and npm run build.
- iPhone standalone: the chevron works and chat pages have no double headers.

### T10 [M] One timezone-correct 'today' (trading-day.ts)
files: src/lib/trading-day.ts (new), src/lib/trading-day.test.ts (new), src/lib/trading-status.ts, src/lib/trading-status.test.ts, src/lib/perf.ts, src/lib/streak.ts, src/lib/ai.functions.ts, src/lib/queries.ts, src/lib/agent-actions.ts, src/components/risk-watcher.tsx, src/lib/risk-watch.ts, src/routes/_authenticated/discipline.tsx, src/routes/_authenticated/risk.tsx, src/components/notifications-bell.tsx, src/components/visit-recorder.tsx, src/routes/_authenticated/settings.tsx
deps: 

trading-day.ts provides:
- dayKey, re-exported from streak.ts and perf.ts
- dayStart, weekStart (Monday), monthStart, zonedMidnight, nextTradingDayStart, isoWeekKey, monthKey
- safeTz, falling back to Asia/Riyadh

It replaces:
- browser midnight and the Sunday week (trading-status.ts:~46-63)
- server-UTC and the +3h hacks (ai.functions.ts:~32, ~55, ~64, ~366, ~382)
- toLocaleDateString (queries.ts:~99, agent-actions.ts:~441)
- the UTC notification day (risk-watcher.tsx)
- unpadded keys (risk-watch.ts:~18-21)
- the local-day uses in discipline, risk and the bell

Pass settings.timezone to the server functions. Settings gets a native timezone select with a detect button, and timezone joins the update_settings zod schema.

Deploy outside 00:00-03:00 Riyadh.

TESTS: trading-day.test with a frozen now:
- 2026-10-17T22:30Z in Riyadh → '2026-10-18'
- Friday 23:59 → that week's Monday
- nextTradingDayStart on Friday evening → Monday 00:00
- an invalid tz falls back

trading-status.test passes with the Monday week.

### T11 [L] Pure circuit breaker engine (losses only) and anchorBalance
files: src/lib/circuit-breaker.ts (new), src/lib/circuit-breaker.test.ts (new), src/lib/effective-limits.ts, src/lib/effective-limits.test.ts, src/lib/capital.ts, src/lib/capital.test.ts, src/lib/trading-status.ts, src/lib/trading-status.test.ts, AGENTS.md
deps: T10,T04

Copied from drawdown-circuit-breaker. The rule set is exactly the circuit_breaks CHECK in 0012: max_daily_loss, weekly_drawdown_halt, monthly_drawdown_halt, losing_streak_cooldown, manual_pause, manual_cooldown, incomplete_data.

Not in the breaker:
- Max trades and the profit cap become a pure protectProfit(metrics, limits) warning in trading-status.ts.

evaluateBreaker inputs: settings, startBalance, balance, trades, partialEvents (trade_events partial_close with realized_pnl), ledgerIssues, latched[], planMaxLoss, limitsAcceptedAt, breakerSince, pausedUntil, tz, now.

Rules:
- Realized P&L by closed_at, plus partial-close realized_pnl by `at`.
- % limits apply to startBalance.
- The strictest state wins, and every triggered rule is kept.
- Release times: next Mon-Fri 00:00 (daily), next Monday (weekly), first weekday of next month (monthly).
- Streak: losing closes ordered by closed_at, ignoring future closes; break-even counts as a win. COOLDOWN until lastLossAt + streak_cooldown_hours.
- manual_pause is active while trading_paused and (pausedUntil > now, or pausedUntil null as an explicit indefinite pause, flagged for a daily reminder).
- PARTIAL (null pnl, a bad closed_at, a duplicate pair, dropped ledger entries on rows after breakerSince) returns HALTED. While PARTIAL, the later row of a duplicate pair is left out of P&L and the streak.
- Defaults-only limits and pre-breakerSince issues are warnings.
- breakerSince null means preview.

Pure anchorBalance(plan, live) in effective-limits.ts returns start_balance when it is > 0, otherwise the live balance. parseLedger returns {dropped, corrupt}. Export breakerForPrompt and breakerCopy.

AGENTS.md:12: new-risk permission comes from circuit-breaker.ts; trading-status.ts only maps tone and the protect-profit warning.

TESTS: circuit-breaker.test with a frozen now:
- daily −2% on Friday 23:59 → HALTED until Monday
- weekly and monthly release times
- 2 losses at 23:50 → COOLDOWN +24h
- break-even breaks the streak
- a partial-close realized loss counts toward the daily limit
- a duplicate pair is counted once and gives PARTIAL → HALTED
- the same bad row before breakerSince → a warning
- defaults-only → ALLOWED with a warning
- paused_until in the past → ALLOWED
- reaching max trades is not a breaker state
- intraday losses don't move the threshold
- a latched row survives a pnl edit

effective-limits.test: anchorBalance.

### T12 [L] Pure pre-trade decision engine
files: src/lib/pre-trade-gate.ts (new), src/lib/pre-trade-gate.test.ts (new), src/lib/trade-gate.ts, src/lib/trade-gate.test.ts
deps: T11,T04,T05

Copied from pre-trade-discipline-gate. Exports:
- GateDecision, DECISION_RANK
- GateIntent: pre_entry, already_placed, historical, watch
- Answers {in_written_plan, stop_predefined, size_within_plan, not_revenge}
- GateReason
- plannedRisk
- lastLossWithin(trades, partialEvents, REVENGE_WINDOW_MIN, now), counting partial trims with realized_pnl < 0
- evaluatePreTrade, aggregateDecisions
- applyAiOpinion (can only raise)
- DECISION_META

Rules:
- historical and watch → NO_ACTIONABLE.
- Upstream COOLDOWN, HALTED or PARTIAL → NO_GO. PARTIAL is HALTED, and there is no PARTIAL→REVIEW rule.
- Missing settings → REVIEW_REQUIRED.
- protectProfit (max trades or profit cap reached) → REVIEW_REQUIRED 'وصلت حدّ ربحك/صفقاتك اليوم'.
- actualRisk = max(typed, riskUsd); if unknown → REVIEW; actual > planned → NO_GO.
- size_within_plan = lots ≤ lotForRisk + 0.01.
- Bad levels → NO_GO.
- An explicit false answer → NO_GO; a blank answer on pre_entry → REVIEW_REQUIRED (T00 item 5).
- A loss within the window (≥30 min) or self-declared revenge → NO_GO.
- No plan, or outside session hours (only when both are set) → REVIEW.
- An unreviewed closed trade only when closed_at ≥ reviewsSince and reviewsSince is not null → REVIEW.
- Temporary rules → warnings.
- The decision only rises; reasons accumulate.

trade-gate.ts keeps only metrics. Fix the dead nextAction branch (~202).

TESTS: pre-trade-gate.test:
- all pass → GO
- a missing plan, stop or size → NO_GO
- actual > planned → NO_GO
- invalid risk → REVIEW
- NO_GO outranks REVIEW
- historical or watch → NO_ACTIONABLE
- a loss 29 minutes ago with cooldown_minutes=15 → NO_GO
- a partial-trim loss 10 minutes ago → NO_GO
- upstream PARTIAL → NO_GO
- max trades reached → REVIEW
- an unreviewed close before reviewsSince → GO; after it → REVIEW
- applyAiOpinion never lowers
- EURUSD 1 lot / 50 pips = 500

### T13 [M] One day engine (day-pipeline.ts) behind the existing adapters
files: src/lib/day-pipeline.ts (new), src/lib/day-pipeline.test.ts (new), src/lib/day-flow.ts, src/lib/day-flow.test.ts, src/lib/journey.ts, src/lib/journey.test.ts, src/lib/use-journey.ts
deps: T11,T12

dayPipeline(state) returns {steps[0..6] with the step_flow titles, current, cta, secondary, blockers}.

State includes unreviewedClosed, counting only closes after reviewsSince, and protectProfit.

Priority order:
1. setup → 0
2. stale session → 1
3. PARTIAL → 1 (repair)
4. weekly due → 6
5. HALTED or COOLDOWN → 1
6. missing stop → 4 (danger)
7. unreviewed → 4
8. no plan → 2
9. plan reached or protectProfit → 5 as the main step, with 'صفقة جديدة' hidden
10. rest day → 5
11. otherwise → 3

Export pipelineForPrompt. day-flow and journey become thin adapters, and isBlocked = breaker.state !== 'TRADING_ALLOWED'.

TESTS: day-pipeline.test:
- fresh account → 0
- stale session
- HALTED → 1
- unreviewed after the cutoff → 4; unreviewed before the cutoff → not 4
- no plan → 2
- max trades → 5
- Monday → 6
- rest day → 5
- missing stop → 4 danger

A parity test between the adapter and pipelineForPrompt.

### T14 [M] Today StepCard, one effective-settings loader and a working stop editor
files: src/routes/_authenticated/dashboard.tsx, src/components/today/step-card.tsx (new), src/components/today/breaker-card.tsx (new), src/components/today/breaker-sheet.tsx (new), src/components/today/breaker-chip.tsx (new), src/components/today/countdown.tsx (new), src/components/today/status-strip.tsx (new), src/components/trade/set-stop-sheet.tsx (new), src/lib/effective-settings.ts (new), src/lib/effective-settings.test.ts (new), src/lib/today-ui.ts (new), src/lib/today-ui.test.ts (new), src/lib/notification-target.ts, src/components/app-shell.tsx, src/lib/queries.ts, src/components/dashboard/core-metrics.tsx, src/components/dashboard/open-trades.tsx
deps: T13,T09,T08,T04b

Loader: loadEffectiveSettings(sb, tz) fetches the settings row, the paged closed trades, the capital entries and today's daily_plans.start_balance (column already live). It returns applyPctLimits(raw, anchorBalance(plan, live)) and throws on any sub-error. settingsQuery uses it, so every screen gets the same numbers.

Today screen:
- dayPipeline(state).current renders as one StepCard with one main button and an optional secondary.
- The breaker runs in preview ('معاينة') until T21.
- BreakerCard: state chip, breakerCopy, release as weekday + date + time with a Countdown leaf, one thin bar.
- BreakerChip goes in the T09 nav slot and opens BreakerSheet; notificationTarget('risk') now opens it.
- The sticky main button appears only when the card scrolls away (shouldShowStickyCta).
- StatusStrip replaces CoreMetrics' four link cards and shows 'آخر تحديث قبل Ns' with tap-to-refresh.

SetStopSheet: open trades with no stop get a danger row 'حط الوقف' that opens it. It is one NumberField that updates stop_loss, and sets initial_stop_loss when that is null (column live). T26 upgrades it to moveStop.

Also add sessionsQuery with distinct keys, fixing the shared ['sessions'] key in dashboard.tsx:~36, session.tsx:~89 and new-trade.tsx:~60.

TESTS: - effective-settings.test: start_balance anchors the % limits; null falls back to live; a sub-query error throws.
- today-ui.test: shouldShowStickyCta, formatRelease.
- Component tests: COOLDOWN shows a countdown; a missing stop opens SetStopSheet and saves; no plan → the step-2 button.
- iPhone: the card fits above the fold; the BreakerCard and StatusStrip numbers match.

### T15 [M] One discipline report and one validator
files: src/lib/risk-validation.ts, src/lib/risk-validation.test.ts, src/lib/risk-limits.ts, src/lib/risk-limits.test.ts, src/lib/stats.ts, src/lib/discipline.ts, src/lib/discipline.test.ts, src/routes/_authenticated/discipline.tsx, src/routes/_authenticated/reports.tsx, src/lib/agent-actions.ts, src/lib/queries.ts, src/components/dashboard/core-metrics.tsx, src/components/risk-gauges.tsx, AGENTS.md
deps: T05,T10

Validator:
- risk-validation.ts takes the strict checks: an ISO-4217 whitelist (USDT maps to USD with a note), daily ≤ weekly ≤ monthly, an integer streak, session_start < session_end.
- Delete risk-limits.ts and its test. This is the only task that deletes them.
- update_settings zod drops null and '' keys, uses a currency enum, and adds session_start and session_end.
- One fmtMoney with a fallback.

Discipline:
- discipline.tsx and reports.tsx render discipline.ts disciplineReport.
- Delete stats.ts disciplineReport and GREEDY.
- The loss-streak suggestion uses today's streak and cooldown_minutes.

AGENTS.md:15: discipline numbers come from discipline.ts; stats.ts keeps only performance helpers.

TESTS: - risk-validation.test: USDT; weekly < daily is an error; null and '' keys are ignored; session hours are validated.
- discipline.test.
- A non-ISO currency doesn't throw in fmtMoney.
- npm test and npm run build.

### T16 [L] Pure per-trade review engine with the skill's process rules
files: src/lib/trade-review.ts (new), src/lib/trade-review.test.ts (new)
deps: T12,T05

Copied from trade-performance-coach. reviewTrade(trade, ctx{settings, allTrades, violations, check, events, plan, latchedBreaks, analysisCard, now}) returns verdict, outcome, rootCause, secondary, confidence, scores, process/risk/execution findings, tags, quadrant, nextRules, questions and missingFields.

Process findings:
- market_regime_gate: opened_at inside an active latched break, or proceeded on a NO_GO → critical.
- setup_confirmation: an explicit false on in_written_plan → critical plus a fomo_entry tag.
- An explicit false on stop_predefined or size_within_plan → critical.
- pre_entry_thesis_record: no notes, no analysis and no plan before entry → warning.
- check.answers null → unclear, never missed.

Risk findings:
- size ratio >1.25× critical, >1× warning (exactly 1.25× is a warning)
- risk_source unknown, legacy or backfill with risk 0 → unknown_size
- heat >0.9× warning, >1× critical
- 3 prior losses warning, 4 critical
- weekly P&L within 10% of the limit → warning
- overconfidence_after_winner: risk above plan right after a winner → warning plus tag

Execution findings:
- stop moved (initial_stop_loss vs stop_loss, or an unplanned event)
- premature exit: fear and |exitR| < 0.8 × planned R:R
- size_added on a losing trade → critical; an unplanned add → warning

Journal regexes catch revenge, FOMO, premature exit, overconfidence and hesitation.

Tags:
- rule_drift when there are ≥3 process warnings or criticals
- tags are never empty: no_pattern_detected when nothing else applies
- questions = the first 4 tags' questions

root_cause is picked in this order: the trader's own postmortem, then rule_violation, risk_sizing, execution, market_environment, then randomness for a clean loss.

Scoring: 100 − 30 per critical − 15 per warning; quality = 40 + 60 × present/7.

Verdict:
- cooldown: ≥2 criticals, or revenge with ≥2 prior losses
- violation: ≥1 critical
- review: a non-data warning
- warn: data-only warnings
- ok: otherwise

Also export activeTempRules, realizedR, exitR, heatAtEntry and lossesBefore.

TESTS: trade-review.test ports the skill's 7 fixtures, plus:
- NO_GO proceeded at 1.0× during HALTED → violation
- explicit plan=false → critical with fomo_entry
- no thesis → a pre_entry_thesis_record warning
- adding to a loser → critical
- risk over plan after a winner → overconfidence_after_winner
- a clean on-plan loss → tags [no_pattern_detected], خسارة نظيفة, randomness
- 3 process warnings → rule_drift
- backfill risk 0 → unknown_size
- activeTempRules expiry

### T17 [M] Pure pattern memory (weekly and monthly)
files: src/lib/patterns.ts (new), src/lib/patterns.test.ts (new)
deps: T16

periodReview(reviews, trades, violations, rules, checks, period{kind: week|month, key}, tz) returns:
- verdict
- tagCounts and the trend against the previous 4-8 periods
- recurring and ruleDrift
- cleanLosses and luckyWins
- processPnl
- avgScores and maxLosingStreak
- violationsByRule, split by source
- gateSaved (only NO_GO checks with proceeded=false)
- enteredOnNoGo
- watchedNotTaken (intent='watch')
- analystHitRate
- lastRuleAdherence
- nextRules

The month variant feeds review_type='monthly', which the 0013 CHECK already allows. patternsForPrompt renders at most 4 weeks plus the last month.

TESTS: patterns.test:
- 3 revenge tags in a week → rule_drift
- the clean/dirty P&L split
- gateSaved counts only proceeded=false
- watch checks are counted
- trend arrows across 3 weeks
- 2 violations within 7 days → cooldown
- month boundaries in Riyadh

### T18 [M] Pure action policy and one action spec
files: src/lib/agent-action-spec.ts (new), src/lib/action-policy.ts (new), src/lib/action-policy.test.ts (new), src/lib/agent-actions.ts, src/lib/agent-actions.test.ts, src/lib/ai.functions.ts, src/components/agent-actions.tsx, AGENTS.md
deps: T11,T12

agent-action-spec.ts has no browser imports. It holds the types, zod schemas, labels, the class of each action (JOURNAL/STATE/DESTRUCTIVE) and allowedActions(mode) for analyst, setup, day and manager. AGENT_SCHEMA's enum is built per mode, and coachReply validates actions on the server.

needsApproval(action, ctx) uses the effective-settings loader values (anchored):
- DESTRUCTIVE: always a click.
- STATE: a click when the breaker is not TRADING_ALLOWED, or when the change loosens anything compared with effective values: raising max_daily_profit, targets or starting_balance; set_balance or withdrawal; pnl or exit edits on closed trades; deactivating a rule; re-allowing a strategy; raising plan values after a trade today; lowering cooldown_minutes or streak_cooldown_hours.
- create_trade with intent='already_placed' while ALLOWED is JOURNAL, so it runs automatically (T00 item 4). It needs a click only on COOLDOWN, HALTED or PARTIAL, or when evaluatePreTrade gives NO_GO. REVIEW_REQUIRED from null answers does not force a click.
- JOURNAL: auto.

It replaces loosenedLimits (agent-actions.ts:~147-165, ~418-425).

AGENTS.md:26 and :16: action classes plus needsApproval are the real auto-run policy.

TESTS: action-policy.test:
- tightening against stale raw $ → auto
- loosening against effective → click
- raising the profit cap → click
- an already_placed trade while ALLOWED with null answers → auto
- the same trade during COOLDOWN → click
- an explicit NO_GO → click
- lowering a cooldown → click
- destructive → always a click

agent-actions.test: an unknown action type is rejected.

### T19 [M] Verify the applied schema and ship corrective migration 0014
files: drizzle/migrations/0014_corrective.sql (new; removed again after Lovable registers 0014_apply_*), src/integrations/supabase/types.ts (regenerated by Lovable), docs/lovable-migrations.md
deps: T00

(1) Run the verify-only checks for 0011, 0012 and 0013 from db_migrations[0] and record the results in docs/lovable-migrations.md.
(2) Write 0014 exactly as in db_migrations[1]: agent_action_log 'running', the realtime publication for coach_messages, the session_id re-backfill limited to the same Riyadh day, trading_settings.reviews_since and paused_until (with the backfill), trade_events.realized_pnl, the pre_trade_checks 'watch' intent, trades.source='backfill', and the capital_movements table.
(3) Paste it into Lovable, let it apply and regenerate types.ts, pull, then delete our original once Lovable's 0014_apply_* copy exists.

No app code reads the new columns in this task. It must land before T20, T20b, T21, T23 and T32.

TESTS: - types.ts has reviews_since, paused_until, realized_pnl and capital_movements.
- `select count(*) from trades t join trading_sessions s on s.id = t.session_id where (s.started_at at time zone 'Asia/Riyadh')::date <> (t.opened_at at time zone 'Asia/Riyadh')::date` returns 0.
- pg_publication_tables lists coach_messages.
- An insert with agent_action_log status 'running' succeeds.
- A second user sees 0 capital_movements.
- npm run build.

### T20 [M] Legacy data audit, one-tap repair, and legacy checklist marked unknown
files: src/lib/data-audit.ts (new), src/lib/data-audit.test.ts (new), src/lib/discipline.ts, src/lib/discipline.test.ts, src/routes/_authenticated/performance.tsx, src/routes/_authenticated/trades.tsx, src/routes/_authenticated/settings.tsx, src/lib/queries.ts
deps: T19,T04,T04b

Step 1: audit SQL in Lovable. Count:
- closed trades with null pnl
- risk_amount = 0
- the fabricated 'long'/risk-0 closes
- closed_at < opened_at, and closed_at in the future
- duplicates
- dropped ledger entries

Step 2: pure helpers:
- recomputeLegacyRisk returns legacy_recomputed via riskUsd when lots and SL exist, otherwise unknown. Legacy rows were saved as |entry−sl|×size with no contract size.
- auditTrades.
- checklistStatus(trade, check) returns passed, failed or unknown. It is unknown when the check answers are null, or when there is no check row, source is backfill, ai_chat, screenshot or import, and checklist_passed=false.

Use checklistStatus in discipline.ts:111, performance.tsx:63 and trades.tsx:82, which shows 'غير معروف' instead of 'غير مطابقة للقائمة'. The discipline score then stops penalizing chat-logged history.

Step 3: a 'البيانات › تدقيق' section in settings that previews before/after and applies only on 'طبّق التصحيح'. Null-pnl rows deep-link to edit.

This must finish before the review and pattern engines read history, and before breaker_since is set.

TESTS: data-audit.test:
- EURUSD legacy 1 lot → 500
- no size → unknown
- running twice is idempotent
- the audit lists null-pnl and future rows

discipline.test: a backfill row with checklist_passed=false is unknown and excluded from the denominator.

Manual: the counts match the SQL audit.

### T20b [M] Capital movements table, balance and deposit UI before the breaker
files: src/lib/capital.ts, src/lib/capital.test.ts, src/lib/capital-store.ts, src/lib/effective-settings.ts, src/lib/agent-actions.ts, src/lib/agent-actions.test.ts, src/components/settings/capital-section.tsx (new), src/routes/_authenticated/settings.tsx, AGENTS.md
deps: T19,T06,T04b

Import: on first load, an idempotent import copies the __capital JSON entries into capital_movements with legacy_id = entry.id, protected by UNIQUE(user_id, legacy_id).

Writes: moveCapital and deleteCapitalEntry write rows, with no read-modify-write. computeCapital reads the rows, paged. effective-settings.ts reads them too. agent-actions capital_move inserts a row; set_balance writes an 'adjust' row.

UI: a 'حدودي ورأس مالي' section in settings, moved forward from T33:
- balance
- the last 5 movements with undo
- a deposit/withdraw/correct ResponsiveSheet reusing CapitalCard's MoveDialog
- effective $ and % limits
- 'عدّل مع سَنَد'

The blob stays read-only for one release, then T34 removes it. Add an AGENTS.md line: capital movements live only in capital_movements.

TESTS: - capital.test: the balance from rows equals the blob balance after import; re-running the import adds nothing; two concurrent deposits are both counted.
- agent-actions.test: set_balance writes an adjust row.
- iPhone: deposit 100, then undo; the limits update.

### T21 [L] The breaker goes live: anchor, latching, pauses, alerts, defaults prompt
files: src/components/risk-watcher.tsx, src/lib/risk-watch.ts, src/lib/risk-watch.test.ts, src/lib/circuit-breaker.ts, src/lib/trading-status.ts, src/lib/trading-status.test.ts, src/lib/daily-plan.ts, src/lib/daily-plan.test.ts, src/lib/effective-settings.ts, src/lib/effective-limits.ts, src/lib/queries.ts, src/lib/agent-actions.ts, src/components/today/breaker-card.tsx, src/components/today/breaker-sheet.tsx, src/routes/_authenticated/discipline.tsx, src/lib/journey.ts, AGENTS.md
deps: T19,T20,T20b,T14,T11,T18

Switching on:
- 'شغّل قاطع الحماية' appears only after the T20 audit and the T20b balance check. It sets breaker_since.
- If limits are 0, the survival-defaults card shows; accepting sets limits_accepted_at. Until then a daily 'حدودك غير مفعّلة' chip with 'فعّل' stays on step 1, so the breaker never quietly stays off.

Anchor:
- start_balance is written on the first open of the day, or when the plan is saved.
- RiskWatcher, agent-actions needsApproval and the gate all read the effective-settings loader, so every consumer uses the same anchor.

Latching:
- RiskWatcher upserts circuit_breaks on each new trigger. period_key is the day, ISO week, month or last loss id.
- evaluateBreaker receives the unexpired latched rows.

Pause controls in BreakerSheet:
- 'إيقاف لليوم' sets trading_paused and paused_until = nextTradingDayStart.
- 'لين أرجّعه' sets paused_until null and gets a daily reminder ('موقوف من ٣ أيام — ترجّع؟').
- When paused_until has passed, the client clears trading_paused.
- 'إنهاء التهدئة مبكراً' is offered only for manual cooldowns.

Status:
- effectiveDailyLoss in daily-plan.ts.
- computeStatus checks stops and broken rules before target_hit, and drops the today-only streak hack.

Alerts are built from transitions:
- keys cb:max_daily_loss:<day>, cb:weekly:<isoWeek>, cb:monthly:<yyyy-mm>, cb:streak:<lastLossId>, cb:release:<rule>:<period>
- new alerts: weekly and monthly halt, heat, release ('رجع التداول مسموح. ابدأ بخطة جديدة، لا تعوّض.')
- money in the user's currency; the streak threshold from settings
- remove the floor(date/7) week key

A new COOLDOWN posts the 4-question prompt into today's session thread.

Copy:
- discipline.tsx: drop 'الإلزامية' (~154); ~166 and ~178 say 'تنبهك وتنحسب لو دخلت فيها'.
- journey.ts uses breakerCopy.
- Remove 'معاينة'.

status-banner.tsx is not imported anywhere, so leave it for T34.

AGENTS.md:
- :12, the breaker
- :20, alerts from breaker transitions
- :32, % limits become dollars only through effective-settings.ts, using applyPctLimits with anchorBalance (the start-of-day balance, falling back to live)

TESTS: - risk-watch.test: weekly, monthly, heat and release alerts fire once per key.
- trading-status.test: a weekly target hit plus a 3-loss streak → stopped.
- daily-plan.test: effectiveDailyLoss.
- effective-settings.test: needsApproval and RiskWatcher get the same anchored values.
- Manual:
  - a −2% day → HALTED until Monday
  - editing that pnl to positive → still HALTED
  - a null-pnl row after breaker_since → PARTIAL
  - 'إيقاف لليوم' ends at the next day start

### T22 [M] Step 0 setup finish and the step 2 plan sheet
files: src/routes/_authenticated/onboarding.tsx, src/components/ai-setup.tsx, src/routes/_authenticated/route.tsx, src/lib/setup.ts (new), src/lib/setup.test.ts (new), src/lib/daily-plan.ts, src/lib/daily-plan.test.ts, src/lib/queries.ts, src/components/today/plan-sheet.tsx (new), src/routes/_authenticated/dashboard.tsx, src/lib/agent-actions.ts, src/lib/ai.functions.ts, AGENTS.md
deps: T19,T13,T14,T10,T18,T15

Onboarding:
- SessionAgent in setup mode, full screen, on a setup thread.
- setupComplete() implements the step-0 gate. finishSetup() sets onboarded; 'كمّل لاحقاً' also finishes.
- ai-setup.tsx:~38 no longer finishes when every action was rejected.
- The interview includes optional session hours (chip 'ما عندي ساعات محددة' → null). These are the only editor for session_start and session_end, now in zod since T15.
- The defaults are one STATE card.

Plan:
- effectivePlanLimits(plan, settings) replaces effectiveDailyTarget everywhere (dashboard.tsx:~67, risk-watcher.tsx:~41, the gate, buildContext).
- todayPlanQuery selects the full row.
- PlanSheet: NumberFields, forbidden chips, mood, rules_today with 'شفتها' (rules_ack_at), and 'يوم راحة'. Saving upserts the plan with start_balance and starts the linked session.
- set_daily_plan increments revised_count only when a set value changes after a trade today.
- AGENT_GUIDE rule 5 (ai.functions.ts:~220): start_session never calls update_settings for daily_target.

AGENTS.md:25 describes effectivePlanLimits and the real plan columns.

TESTS: - setup.test: a strategy needs entry_conditions and a stop rule; the template doesn't count; session hours are optional.
- daily-plan.test: effectivePlanLimits picks the stricter values; revised_count is not bumped on a null fill.
- Manual: onboard and reach step 1; a 2-trade plan shows 2 trades left; a rest day goes to step 5.

### T23 [L] Shared trade writes with pre-trade journaling on every path
files: src/lib/trade-write.ts (new), src/lib/trade-write-pure.ts (new), src/lib/trade-write-pure.test.ts (new), src/lib/agent-actions.ts, src/lib/agent-actions.test.ts, src/routes/_authenticated/trades.tsx, src/components/dashboard/open-trades.tsx, src/lib/ai.functions.ts, src/lib/discipline.ts, src/lib/discipline.test.ts
deps: T19,T12,T18,T04,T04b,T20

Pure helpers:
- buildTradeRow: forexSymbol, checkLevels, riskUsd, risk_source, initial_stop_loss, source, session_id, client_ref. A trade is closed only when status is 'closed' or exit_price is present (keeps the T04b fix).
- parseBrokerTime
- resolveCloseTarget
- inferExitReason

createTrade:
1. Insert pre_trade_checks; on failure return REVIEW 'ما انحفظ القرار'.
2. findDuplicate on every path.
3. Insert the trade with pre_trade_check_id, client_ref and checklist_passed = decision==='GO'.
4. NO_GO + proceeded → a violation with source='gate'.
5. Breaker not ALLOWED → a violation with source='breaker'.
6. Upload the image.

closeTrade guards with .eq('status','open') and calls onTradeClosed. moveStop writes trade_events. partialClose writes trade_events {kind:'partial_close', realized_pnl}, which the breaker and revenge window read.

session_id is written only after 0014 is applied (T19).

agent-actions:
- create_trade (open) goes through createTrade with already_placed and answers null; needsApproval follows T18.
- close_trade takes a trade_id, and the no-match fallback asks for the direction.
- update_trade stop and TP changes go through moveStop.
- New answer_pre_trade_check.

TRADE_SCHEMA gains opened_at, closed_at and missing_fields. CloseDialog and 'سكّرتها' use closeTrade. discipline.ts uses checklistStatus from T20.

TESTS: trade-write-pure.test:
- MT5 time parse
- a long with SL above entry is rejected
- EURUSD risk
- two open XAUUSD → 'أي وحدة؟'
- floating pnl without an exit → stays open

trade-write with a mock client:
- the check is written before the trade
- a failed check → no trade
- NO_GO + proceeded → a gate violation
- the same client_ref twice → one row
- a partial close writes realized_pnl

agent-actions.test: an already_placed trade while ALLOWED runs automatically; during COOLDOWN it needs confirmation.

### T24 [L] Step 3: /new-trade becomes the iPhone gate stepper
files: src/routes/_authenticated/new-trade.tsx, src/components/gate/gate-step.tsx (new), src/components/gate/decision-card.tsx (new), src/components/gate/sticky-gate-bar.tsx (new), src/lib/gate-stepper.ts (new), src/lib/gate-stepper.test.ts (new), src/components/ai-trade-input.tsx, src/components/ui/image-picker.tsx (new), src/routes/_authenticated/trades.tsx
deps: T23,T22,T07

The scrolling form becomes 7 screens at ?step=0..6, each pushed to history:
0. day state (from the loader)
1. the trade: AiTradeInput, a '+' ImagePicker, a mic, decision-coloured queue chips, and a link to المحلل
2. the plan: an explicit لا records false
3. the stop: live checkLevels and 'اقلب الاتجاه'
4. size: 'مخططة $50 · فعلية $62 · الحجم الصح 0.08 لوت' with 'صح'
5. after a loss: shown inside the revenge window or for a sensitive emotion
6. the decision: DecisionCard

Behaviour:
- nextStep skips steps that were computed.
- On NO_GO the main button is 'ما رح أدخل'; the secondary is 'دخلت رغم القرار' with the T00 chips.
- Return focuses the next field.
- A sticky bar respects the safe area.
- Saving goes through createTrade, then to /dashboard.
- Prefill params include analysis_id.
- trades.tsx:~33-35 passes the parsed open trade through router state.
- Remove the 'إلزامي' and 'توقف إجباري' copy.

TESTS: - gate-stepper.test: nextStep skips; the after-loss step appears only in the window; back from 4 goes to 3.
- Component tests: 'ما رح أدخل' writes a check and no trade; 'دخلت رغم القرار' writes the trade plus a violation.
- iPhone: an EURUSD 1-lot screenshot with a 50-pip stop shows $500; a loss 5 minutes ago → NO_GO; edge-swipe steps back.

### T26 [L] Step 4: close and review sheets, reviews_since cutoff, lazy catch-up
files: src/components/trade/close-sheet.tsx (new), src/components/trade/trade-review-sheet.tsx (new), src/components/trade/trade-review-card.tsx (new), src/components/trade/trade-detail-sheet.tsx (new), src/components/trade/set-stop-sheet.tsx, src/lib/pending-reviews.ts (new), src/lib/pending-reviews.test.ts (new), src/lib/review-card.ts (new), src/lib/review-card.test.ts (new), src/lib/trade-write.ts, src/lib/notification-target.ts, src/routes/_authenticated/trades.tsx, src/routes/_authenticated/dashboard.tsx, src/components/md.tsx, src/components/risk-watcher.tsx, src/lib/queries.ts
deps: T19,T16,T23,T06,T14

Cutoff: on the first load of this build, if reviews_since is null, set it to now(). Only closes after the cutoff count as unreviewed. A one-tap 'سجّل القديمة كتوثيق فقط' in /trades bulk-inserts journal_only trade_reviews for older closes (optional).

Sheets:
- CloseSheet: exit-reason chips, the toggle with the sign warning, close time, live R, and a 'إغلاق جزئي' mode through partialClose.
- onTradeClosed opens TradeReviewSheet from every close path. Its 4 screens end with the reviewTrade verdict, the quadrant, up to 3 'نمط محتمل' cards and the next rule. Buttons: 'سجّل المراجعة بس' (main), 'اعتمد القاعدة', 'عدّلها مع سَنَد', 'بعدين'. Saving inserts trade_reviews.
- TradeDetailSheet (/trades?trade=<id>): moveStop/TP (SetStopSheet now writes trade_events), plan vs actual, and the screenshot via a signed URL. notificationTarget nosl:/longopen: now opens it.
- /trades rows show a verdict chip and R.

Catch-up: pure pendingReviews returns at most 3 closes after the cutoff, the last weekday without a day review, and the last week without a weekly review. It replaces the 21:00 poll.

md.tsx splits ```review blocks. The review here is deterministic only.

TESTS: - pending-reviews.test: capped at 3; closes before the cutoff are ignored; weekends skipped.
- review-card.test.
- Component test: journal_only is the main button.
- iPhone: a sheet close, a chat close and an MT5 close each produce one review; old history does not block the gate.

### T27 [L] Ground every agent in computed facts and the trader's own words
files: src/lib/ai-context.ts (new), src/lib/ai-context-format.ts (new), src/lib/ai-context-format.test.ts (new), src/lib/effective-settings.ts, src/lib/ai.functions.ts, src/lib/ai.server.ts, src/lib/analyst-skills.ts, src/components/agent-actions.tsx, AGENTS.md
deps: T11,T12,T13,T16,T17,T19,T14

loadContextData(sb, tz, mode):
- one Promise.all
- the same effective-settings loader on the server
- closed trades by closed_at, paged
- errors thrown
- strategies with markets and timeframes (missing at ai.functions.ts:29)
- truncated knowledge-note content when knowledge is on (today only titles, :35)

A pure formatContext(data, mode) has per-mode caps and emits blocks in this order:
1. breaker
2. pipeline
3. 'حالة اليوم (محسوبة، لا تعيد حسابها)'
4. today's gate decisions and the last 10 checks
5. 'آخر خسارة قبل N دقيقة'
6. the last 10 reviews and tag counts
7. patterns (4 weeks plus 1 month)
8. violations by rule
9. the last 3 session reviews
10. one line per trade, with notes and close_notes
11. today's ids

Prompt truth deletions and the persona rule for a breaker that is not ALLOWED. Add PHONE_FORMAT. AGENT_SCHEMA gains suggestions and step.

callAI: retry once on incomplete, log usage, apply the daily cap. transcribeAudio moves into ai.server.ts with a 30s timeout.

AGENTS.md:31: examples and strategy metadata reach agents through formatContext.

TESTS: ai-context-format.test, a snapshot of a HALTED day:
- the breaker line comes first
- the step matches dayPipeline
- notes are included
- strategy markets are present
- caps are respected

A mocked callAI retries on incomplete.

Manual: 'كم باقي لي اليوم؟' matches the Today card.

### T28 [L] Trade-review AI behind a flag, with a tested Arabic normalizer
files: src/lib/review-ai.ts (new), src/lib/review-ai.test.ts (new), src/lib/__fixtures__/owner-notes.json (new), src/lib/ai.functions.ts, src/components/trade/trade-review-sheet.tsx, src/lib/trade-write.ts, AGENTS.md
deps: T26,T27

reviewTradeAI runs under keepAlive and fire-and-forget after the sheet saves. It reads:
- the trade with notes and close_notes
- the screenshot via a signed URL
- the check, events, plan, strategy and examples
- the last 5 reviews

It calls callAI (medium effort) with a strict REVIEW_SCHEMA.

Pure postCheck:
- normalizeArabic: strip tashkeel and tatweel; unify ي/ى, ة/ه and أ/إ/آ; normalize digits and dictation punctuation
- drop any tag whose evidence_quote isn't a substring of the notes
- never lower the verdict
- strip buy/sell/size advice

It updates ai_summary and ai_extra and posts a ```review card into today's thread, with the guardrail text.

REVIEW_AI_ENABLED stays false until the owner-note fixtures pass. Respect the daily cap and the waitUntil limit (25s cap if needed).

AGENTS.md:13: list the server writers (reviewTradeAI writes trade_reviews and posts into the day thread).

TESTS: review-ai.test:
- a fabricated quote is dropped
- a quote with different tashkeel, ى/ي or ة/ه is kept
- the fixtures pass
- a verdict downgrade is rejected

Manual: a close with the note 'دخلت عشان أعوض' gets a summary citing it within about 30s.

### T29 [M] AI second opinion at the gate and gate questions in chat
files: src/lib/ai.functions.ts, src/routes/_authenticated/new-trade.tsx, src/components/gate/decision-card.tsx, src/lib/pre-trade-gate.ts, src/lib/agent-actions.ts
deps: T24,T27

gateOpinion replaces riskAdvice:
- a slim context and strict JSON
- the prompt 'قرار البوابة محسوب ومثبت… لا تغيّر القرار ولا تحسب أرقام'
- debounced, re-run on edits, run for manual entries too
- saving never waits for it
- applyAiOpinion raises to REVIEW 'سَنَد شايف إن شرط «…» ناقص'
- stored in ai_plan_match and ai_note

AGENT_GUIDE rule 4: after recording MT5 trades, which run automatically as JOURNAL while ALLOWED, ask the 4 questions in one line and record the literal answer with answer_pre_trade_check.

RISK_MODE: 'استخدم قرار البوابة المحسوب ولا تحسب بنفسك'.

TESTS: - pre-trade-gate.test: a mismatch moves GO to REVIEW; NO_GO stays; unclear changes nothing.
- Component test: save stays enabled while the opinion loads.
- Manual: a missing condition is named; a chat-logged screenshot gets the 4 questions and moves to GO after a literal yes.

### T30 [L] Steps 5 and 6: close the day, weekly and monthly review, السجل tabs
files: src/lib/streak.ts, src/lib/streak.test.ts, src/lib/week-review.ts (new), src/lib/week-review.test.ts (new), src/components/streak-card.tsx, src/routes/_authenticated/session.tsx, src/components/session-agent.tsx, src/routes/_authenticated/trades.tsx, src/components/journal/perf-section.tsx (new), src/components/journal/week-section.tsx (new), src/routes/_authenticated/performance.tsx, src/routes/_authenticated/reports.tsx, src/routes/_authenticated/discipline.tsx, src/components/performance/widgets.tsx, src/lib/perf.ts, src/lib/perf.test.ts, src/lib/ai.functions.ts, src/lib/pre-trade-gate.ts, AGENTS.md
deps: T26,T17,T22

Streak: pure dayVerdict replaces loginStreak; update the copy.

Closing the day (session.tsx ?intent=close|start):
- closeDay drafts from today's reviews, asks one question per NO_GO-entered trade, praises gate-saved $, and proposes tomorrow's rule as an approval card.
- end_session stores the review as review_type='day'.

Weekly and monthly (week-review.ts):
- weeklyDue and monthlyDue (pure).
- The weekly review runs lazily on the first open of a new ISO week; the monthly card on the first open of a new month (review_type='monthly'). Both come from patterns.ts plus the AI narrative.
- Accepted rules go into rules_today and feed activeTempRules.

/trades ?tab=trades|perf|week:
- perf: the performance widgets plus discipline.
  - The equity YAxis width is computed from the compact-formatted max, so 5-digit balances aren't cut (today width=50).
  - The P&L calendar is aligned to weekdays with Arabic weekday labels, flexible cells of about 30px and tap details.
- week: the cards, the month card, and navigator.share(File).

perf.ts gains customRange. reportSummary and performanceInsight are replaced.

AGENTS.md:22: the streak is the dayVerdict streak, shown on Today and when closing the day.

TESTS: - streak.test: a rest day is neutral; violation + review = recovered; a plan after the first trade is not ok.
- week-review.test: weeklyDue on Monday 00:30 Riyadh; monthlyDue on the 1st; one defer.
- perf.test: customRange.
- Manual: Monday's first open shows the weekly card; an accepted 0.5× rule shows at the gate; a 12,345 balance is fully visible on the axis.

### T31 [L] The trade-analysis agent (المحلل) plus paper self-test fixes
files: src/lib/ai.functions.ts, src/lib/trade-card.ts, src/lib/trade-card.test.ts, src/components/trade-card.tsx, src/lib/market-symbols.ts, src/lib/market-symbols.test.ts, src/lib/market.server.ts, src/lib/market.test.ts, src/routes/_authenticated/analyst.tsx, src/components/agent-chats.tsx, src/components/paper-test-panel.tsx, src/lib/paper-test.ts, src/lib/paper-test.test.ts, src/lib/agent-action-spec.ts, AGENTS.md
deps: T24,T27,T18,T19

ANALYST_MODE:
- adds the breaker block
- applies T00 item 6
- removes ~276

Trade card:
- The ```trade block gains symbol, timeframe, strategy, intent and gate.
- parseTradeCard checks skills against the symbol's capabilities.
- TradeCardView shows a gate banner, lotForRisk lots and the $ risk, with 'مرّرها على البوابة' as the main button.
- The Arabic 'style · hold' row is no longer forced dir=ltr (trade-card.tsx:12, 38); only the numbers are wrapped in <bdi dir=ltr>.

save_analysis stores the card. When intent=watch, it also writes pre_trade_checks {intent:'watch', decision:'NO_ACTIONABLE', source:'ai'}.

Threads: kind='analyst' through useAgentChats. A review sub-mode, and the COOLDOWN 4 questions.

market.server.ts:
- 4s timeouts
- 24h CFDs for indices
- returns {source, at, fresh, hasVolume} as a freshness chip
- 'غير متاح' instead of null

Paper self-test (paper-test-panel.tsx, paperIdea ai.functions.ts:~585-590):
- re-fetch the entry price after the AI returns
- skip failed ticks (count them) instead of aborting and losing the report
- navigator.wakeLock while running, released on hide
- the panel gets max-h-[60dvh] overflow-y-auto
- invalidate only that thread
- label the result 'عيّنة صغيرة — مو نسبة نجاح' instead of 'نسبة النجاح %'

AGENTS.md:33 reflects the fixes.

TESTS: - trade-card.test: watch is valid; out-of-capability skills are dropped.
- market.test: index mapping; a timeout returns fresh=false.
- paper-test.test: a failed tick is skipped, not aborted; the entry comes from the post-AI price.
- Manual: on a HALTED day the card shows the banner; 'مرّرها' opens the prefilled stepper; a watch card appears in the week's 'watched not taken'.

### T32 [L] سَنَد day thread as the system manager, with safe rails and memory
files: src/lib/day-thread.ts (new), src/lib/day-thread.test.ts (new), src/lib/action-run.ts (new), src/lib/action-run.test.ts (new), src/lib/morning-lock.ts (new), src/lib/morning-lock.test.ts (new), src/components/session-agent.tsx, src/components/agent-chats.tsx, src/routes/_authenticated/session.tsx, src/routes/_authenticated/coach.tsx, src/components/agent-actions.tsx, src/lib/agent-actions.ts, src/lib/agent-actions.test.ts, src/lib/chat-retry.ts, src/lib/chat-retry.test.ts, src/components/risk-watcher.tsx, src/components/notifications-bell.tsx, src/components/dashboard/quick-coach.tsx, src/components/dashboard/open-trades.tsx, src/lib/ai.functions.ts, src/lib/queries.ts, src/routes/_authenticated/settings.tsx, AGENTS.md
deps: T19,T27,T18,T21

Day thread:
- getOrCreateDayThread upserts on coach_threads_one_day.
- Drafts, closes, step buttons and alerts route into it, written as coach_messages.kind alert, review or morning. retryDecision ignores non-chat kinds.
- An in-flight marker prevents parallel runs.
- Risk, discipline and strategy are mode chips.

Morning brief, claim-first: insert notifications {kind:'morning', day, dismissed:true, body:''}. A conflict on notifications_daily_once means skip. On success, update the body, set dismissed=false and post the message; on failure, delete the claim. This works across the Safari tab and the Home-Screen app.

Realtime (publication added in 0014): a coach_messages subscription by thread_id. Fallbacks: an incremental gt(created_at) fetch on resume, and a 5s fetch while a reply is pending.

Screenshot memory: chat-images plus image_path, re-attach the latest image, bind actions to their own message's image (agent-actions.ts:~108).

Claim-first action log (action-run.ts):
- Claim with upsert ignoreDuplicates, status 'running'. If no row comes back, skip.
- Run, then update to done or failed with before/after.
- STATE or DESTRUCTIVE rows stuck in 'running' for >5 minutes show 'ما أدري إذا تنفّذ — تحقق'.
- 'تراجع' for the last settings or focus change.
- delete_thread and rename_thread are removed from the AI tools.

coach_auto: seeded from localStorage, then read from settings. A chip in every composer, and 'صلاحيات سَنَد' in settings.

A voice transcript with numbers goes into the composer for confirmation instead of being sent.

AGENTS.md updates:
- :16, action classes plus the claim-first log
- :17, morningBrief with a claim-first lock
- :21 and :24, one سَنَد day thread with mode chips, plus المحلل
- :30, full images in chat-images and image_path

TESTS: - day-thread.test.
- action-run.test: the same key twice runs once; a claim conflict skips; DESTRUCTIVE is never auto.
- morning-lock.test: two claims, one wins; a failure releases the claim.
- chat-retry.test: an alert row is not taken as the answer.
- agent-actions.test: editing pnl while HALTED needs confirmation.
- iPhone: a full day stays in one thread; kill the tab mid-batch and re-approve → no duplicate add_rule; Safari and the Home-Screen app open together → one morning message; a reply finished after an app switch appears via realtime.

### T33 [M] Navigation consolidation: 4 tabs, gear, نظامي hub, thin redirects
files: src/components/app-shell.tsx, src/lib/nav-registry.ts, src/lib/nav-registry.test.ts, src/lib/redirects.ts (new), src/lib/redirects.test.ts (new), src/routes/_authenticated/coach.tsx, src/routes/_authenticated/risk.tsx, src/routes/_authenticated/discipline.tsx, src/routes/_authenticated/performance.tsx, src/routes/_authenticated/reports.tsx, src/routes/_authenticated/training.tsx, src/routes/_authenticated/settings.tsx, src/routes/_authenticated/strategies.tsx, src/routes/_authenticated/rules.tsx, src/routes/_authenticated/knowledge.tsx, src/routes/_authenticated/session.tsx, src/test/app-routing.test.tsx, src/routeTree.gen.ts (regenerated by the router plugin), AGENTS.md
deps: T30,T31,T32,T09,T20b

Tabs: اليوم | فحص صفقة | السجل | سَنَد. The سَنَد tab has a two-segment switch to المحلل. The More sheet is removed.

The gear opens the نظامي hub:
- حسابي
- حدودي ورأس مالي (already built in T20b; add breaker history here)
- استراتيجياتي (archive instead of delete)
- قواعدي
- ما يعرفه سَنَد
- صلاحيات سَنَد
- الإشعارات والصوت
- البيانات (audit, export, typed clear)
- تسجيل الخروج (confirm)

The fake switches are deleted.

Redirect files come from redirects.ts and keep their search params. The desktop sidebar reads the registry.

AGENTS.md:18: 4 tabs, a gear and the نظامي hub, driven by nav-registry.ts.

TESTS: - redirects.test.
- nav-registry.test: every route is reachable.
- app-routing.test: exactly 4 tab links.
- iPhone walkthrough of steps 0-6 with no dead ends.

### T34 [S] Remove dead code, check every AGENTS.md line, write release notes
files: AGENTS.md, roadmap.md, docs/audit/phase-0-2.md, docs/release-notes/sanad-steps.md (new), src/components/dashboard/activity-list.tsx, src/components/dashboard/behavior-widget.tsx, src/components/dashboard/capital-card.tsx, src/components/dashboard/focus-card.tsx, src/components/dashboard/journey-steps.tsx, src/components/dashboard/limits-progress.tsx, src/components/dashboard/session-widget.tsx, src/components/dashboard/status-banner.tsx, src/components/dashboard/day-flow.tsx, src/components/limits-form.tsx, src/lib/day-flow.ts, src/lib/day-flow.test.ts, src/lib/journey.ts, src/lib/journey.test.ts, src/lib/use-journey.ts, src/lib/capital-store.ts, src/lib/ai.functions.ts, src/components/risk-watcher.tsx
deps: T33,T28,T29

Delete:
- the dead widgets, limits-form and analyzeChart
- the day-flow/journey adapters together with their tests, use-journey.ts and components/dashboard/day-flow.tsx, once nothing imports them
- loginStreak and disciplineStreak
- title-based thread creation
- the browser Notification path
- the read-only __capital blob reader

risk-limits.ts is not listed here; T15 already deleted it.

Re-read every AGENTS.md line against the code; each one should already have been updated by its own task.

Arabic release notes:
- log in again once on the Home Screen (its storage is separate from Safari)
- the week is now Monday-based
- the breaker turns on only when you tap it
- defaults only warn until accepted
- old trades never block the gate

TESTS: - npm run lint, npm test and npm run build.
- grep finds no imports of the deleted files.
- A full manual run of steps 0→6 on a real iPhone in Home-Screen mode before the final push.

### T35 [M] (Optional) Offline launch fallback for the Home-Screen app
files: public/sw.js (new), src/lib/sw-register.ts (new), src/lib/offline-snapshot.ts (new), src/lib/offline-snapshot.test.ts (new), src/routes/__root.tsx, src/components/today/breaker-card.tsx
deps: T14,T08,T21

A minimal service worker registered only in standalone display mode on the production host, never in the Lovable preview.

Navigation is network-first with an offline fallback page. No cached JS bundles, so a deploy is never stale. The fallback page renders the last known Today snapshot (breaker state, release time, remaining loss, saved by offline-snapshot.ts in safe-storage) with 'آخر تحديث قبل …' and a retry button.

Versioned cache with skipWaiting and cleanup of old caches.

TESTS: - offline-snapshot.test: serialize and restore; stale age.
- iPhone in airplane mode: launching from the Home Screen shows the snapshot page, not Safari's error.
- After a new deploy, the app loads fresh code on the next online launch.

## Risks
- **Uncommitted work in the tree.** 16 modified and 5 new files hold the T04/T05 work. Nothing else should be committed on top of them. Finish T04 and T05 and commit them as two focused commits on a phase branch. T01 must not sweep them in, because every push to main syncs to Lovable.
- **The 0012 session backfill already ran with the wrong window.** A session left open absorbed later trades. Until 0014 (T19) re-runs it limited to the same Riyadh day, no code may read trades.session_id. T23 writes it only after 0014 is applied.
- **Friction versus b15aeb3.** NO_GO reason chips, REVIEW_REQUIRED for unreviewed trades, and clicks for STATE actions are all added friction. They ship only as approved in T00, saving is never blocked, and closes from before reviews_since never block.
- **Auto-run.** The owner merged full control (coach-full-control is an ancestor of main), and auto mode is ON by default (session-agent.tsx:61). T00 item 4 keeps already-placed AI trades automatic while the breaker is ALLOWED, and coach_auto is seeded from localStorage. If he rejects item 4, every screenshot-logged trade needs a click; explain that trade-off before he answers.
- **Wrong data tripping the breaker.** Before the fixes, the breaker could react to floating P&L treated as closed, a wrong balance (an unpaged 1000-row read, swallowed errors, the capital-blob race), or corrupt legacy risk_amount. T04b, T20 and T20b fix these before T21 sets breaker_since. Old rows warn instead of halting.
- **Disagreeing numbers.** Limit numbers would disagree if any consumer converts % with a different balance. Only effective-settings.ts may call applyPctLimits (anchorBalance). A test asserts that RiskWatcher, needsApproval and the Today screen get identical values.
- **Survival defaults.** These could make an owner who never accepted them think the app is broken. They only warn until limits_accepted_at is set, but the daily re-prompt keeps the breaker from staying off quietly.
- **Lovable coupling.** Migrations run only when pasted into Lovable, and Lovable registers its own _apply_ copy. Delete our originals right after (as fb0dbaa did) to avoid a double apply. Regenerate types.ts before dependent code merges. CHECK changes in 0014 must look up the real constraint names, as the 0011 DO-block does. Never force-push. Freeze the Lovable editor for files a task is touching.
- **Realtime and keepAlive.** Without the 0014 publication the subscription never fires, so the fetch-on-resume and pending-reply fallbacks must stay. Lovable's waitUntil window (about 30s?) may be shorter than callAI's 90s timeout; verify it before turning on review AI and the morning brief.
- **Timezone and the Monday week (T10).** Historic day and week keys shift with this change, so expect one duplicate morning message or a 'missing' plan on rollout day. Deploy outside 00:00-03:00 Riyadh and mention it in the release notes.
- **AI cost and latency.** A vision review per close, a gate opinion per ticket and a morning brief all add up. Mitigations: deterministic results first, debouncing, slim contexts, a cap of 15 reviews a day, at most 3 pending reviews, and claim-first locks so two clients never pay twice.
- **Arabic quote checks.** Tashkeel, ى/ي, ة/ه or dictation punctuation can make the verbatim check drop real evidence. Review AI stays behind REVIEW_AI_ENABLED until fixtures from the owner's real notes pass.
- **Service worker (T35).** It could serve stale code after a Lovable deploy. Keep it optional, register it only in standalone mode on the production host, and never cache JS bundles.
- **Habit change.** 7 chats become 2 agents and 17 screens become 4 tabs. Legacy threads stay readable, old routes stay as redirects, and المحلل is one tap away inside the سَنَد tab.
- **Real-device checks.** Safe areas, the Dynamic Island, standalone mode, the keyboard, edge-swipe, audio unlock and Home-Screen storage cannot be checked at 390px in Playwright. Every shell, chat and gate task needs a real-iPhone check in both Safari-tab and Home-Screen modes.
- **Scope.** 37 tasks. Phase A (T00-T09) plus T14 deliver visible iPhone value first. Every task must leave main green, because every push syncs to Lovable.
