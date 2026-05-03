# PR #25 Resolution Map

Branch: `16-add-coding-backend-for-cursor-sdk`
PR: https://github.com/ralphkrauss/agent-orchestrator/pull/25
Created: 2026-05-03

Total actionable comments: 9 | To fix: 6 | To defer: 3 | To decline: 0 | To escalate (human decision): 0

All actionable comments come from the CodeRabbit AI reviewer. Each was independently verified against the current code.

## Comment 1 | defer | minor

- **Comment Type:** review-inline
- **File:** `plans/16-add-coding-backend-for-cursor-sdk/plans/16-cursor-agent-backend.md:86,89`
- **Comment ID:** 3177831321
- **Review ID:** 4216064364
- **Thread Node ID:** PRRT_kwDOSRv-qs5_LEau
- **Author:** coderabbitai[bot]
- **Comment:** MD056 — pipe characters inside table cells (lines 86 and 89) confuse the column count; suggest escaping `|` as `\|` inside cell text.
- **Independent Assessment:** Valid markdownlint warning. The rows include inline code spans like `` `kind: 'cli' \| 'sdk'` `` where the `\` escape doesn't apply inside backticks under GitHub-flavored markdown — the raw `|` inside the code span is parsed as a column boundary, which is exactly what MD056 reports. Effect is confined to an archived plan document; readers can still get the gist on GitHub but the affected rows do show as malformed (truncated/merged columns) under strict GFM table parsing.
- **Decision:** defer
- **Approach:** None for this PR. Plan archive doc is finalized; lint cleanup on archived plans is out of scope here. Optional follow-up: a janitorial pass that escapes raw pipes inside code spans across the plan archive (replace `'cli' \| 'sdk'` inside backticks with non-backtick wording like ``kind: 'cli' or 'sdk'`` or by splitting the code span).
- **Files To Change:** none
- **Reply Draft:**
  > **[AI Agent]:** Deferring as out of scope for this PR. The warning is real — `\|` doesn't escape pipes inside inline code spans under GFM, so MD056 fires on rows D3 and D6 — but the file is an archived plan document and lint cleanup on plan archives isn't in this PR's scope. Tracking as a janitorial follow-up if we sweep plan-archive lint warnings as a batch.

## Comment 2 | fix-as-suggested | minor

- **Comment Type:** review-inline
- **File:** `src/__tests__/opencodeCapabilities.test.ts:158`
- **Comment ID:** 3177831323
- **Review ID:** 4216064364
- **Thread Node ID:** PRRT_kwDOSRv-qs5_LEaw
- **Author:** coderabbitai[bot]
- **Comment:** Add a standalone happy-path test for the cursor profile (validates a minimal `cursor` manifest with just `model`).
- **Independent Assessment:** Valid. The existing test at lines 131-158 only proves rejection for `cursorBadEffort`/`cursorMissingModel`; the `cursorOk` entry is in the same manifest, so the assertion `result.ok === false` does not prove the happy-path validates. A separate test covering only `cursorOk` and asserting `result.ok === true` would close the regression hole.
- **Decision:** fix-as-suggested
- **Approach:** In `src/__tests__/opencodeCapabilities.test.ts` add a new `it('accepts a minimal cursor profile', ...)` block immediately after the existing `it('accepts cursor profiles that pass model only and rejects unsupported settings', ...)`. The new test parses a manifest containing only a `cursorOk` profile (`backend: 'cursor'`, `model: 'composer-2'`), runs `validateWorkerProfiles`, and asserts both `manifest.ok === true` and `result.ok === true`. Do not change the existing rejection test.
- **Files To Change:** `src/__tests__/opencodeCapabilities.test.ts`
- **Reply Draft:**
  > **[AI Agent]:** Done. Added a standalone `it('accepts a minimal cursor profile', ...)` test that validates a `cursor`+`model` profile and asserts `result.ok === true`, complementing the existing rejection coverage.

## Comment 3 | fix-as-suggested | major

- **Comment Type:** review-inline
- **File:** `src/backend/cursor/cursorEvents.ts:73-79`
- **Comment ID:** 3177831327
- **Review ID:** 4216064364
- **Thread Node ID:** PRRT_kwDOSRv-qs5_LEa0
- **Author:** coderabbitai[bot]
- **Comment:** `handleAssistant` pushes a raw `assistant_message` and then a second `assistant_message` whenever text is present, duplicating the same assistant turn downstream. Fold into a single normalized event.
- **Independent Assessment:** Valid bug. Lines 73 and 78 in `src/backend/cursor/cursorEvents.ts` both push `{ type: 'assistant_message', ... }` for the same `rec`. Existing `cursorEvents.test.ts:13-32` only checks `types.includes('assistant_message')` so the duplication is untested. Downstream consumers persist these events to `events.jsonl` via `processCursorMessage` → `store.appendEvent`, so duplicate emission ends up in the durable run log. Tool-use blocks are unaffected (handled separately in the loop after the message push).
- **Decision:** fix-as-suggested
- **Approach:** In `src/backend/cursor/cursorEvents.ts` modify `handleAssistant` so it pushes exactly one `assistant_message`. When extracted text exists, the payload is `{ text, raw: rec }`; otherwise the payload is the raw record. Keep the subsequent tool_use loop unchanged. Update `src/__tests__/cursorEvents.test.ts` so the assistant-message test asserts the count is exactly 1 (e.g., `assert.equal(types.filter((t) => t === 'assistant_message').length, 1)`) and that the payload has the expected `text` when text is present. Do not change the function signature or the `tool_use`/`filesChanged`/`commandsRun` extraction.
- **Files To Change:** `src/backend/cursor/cursorEvents.ts`, `src/__tests__/cursorEvents.test.ts`
- **Reply Draft:**
  > **[AI Agent]:** Fixed. `handleAssistant` now emits exactly one `assistant_message` event per Cursor turn, with payload `{ text, raw }` when text is present and the raw record otherwise. Updated `cursorEvents.test.ts` to assert the count and payload shape.

## Comment 4 | fix-as-suggested | major

- **Comment Type:** review-inline
- **File:** `src/backend/cursor/runtime.ts:258-273`
- **Comment ID:** 3177831329
- **Review ID:** 4216064364
- **Thread Node ID:** PRRT_kwDOSRv-qs5_LEa1
- **Author:** coderabbitai[bot]
- **Comment:** Cancellation timeout is bypassed for late cancel requests. `state.cancelStatus` is snapshot-checked once at lines 258 and 266; a `cancel()` arriving after those checks lets the path block on unbounded `await drainPromise` / `await state.run.wait()`, so `cancelDrainMs` is not enforced. Heavy-lift suggestion: track cancel as a `Promise<void>` signal and race remaining work against it.
- **Independent Assessment:** Verified bug and a D12 plan-compliance gap. Plan decision D12 (`plans/16-cursor-agent-backend.md:95`) commits the cursor backend to `run.cancel()` followed by a **bounded** drain. The current code in `drainAndFinalize` (`runtime.ts:258-273`) only honors that bound on the early branch where `state.cancelStatus` is already truthy at line 258. When a user cancel lands after that snapshot — the common shape, since `run.cancel()` is invoked from `handle.cancel(...)` independently of the drain loop — execution is on the `else` branch and waits unboundedly on `drainPromise`, then unboundedly on `state.run.wait()`. The bound only re-applies to `state.run.wait()` if `cancelStatus` was set by line 266; same race. So in the majority of real cancels the documented `cancelDrainMs` bound is not enforced. The SDK terminating the stream on `run.cancel()` is a happy-path mitigation, not a guarantee, and the plan does not allow the implementation to depend on it. Existing tests cover only early cancel. The fix is non-trivial but contained to `drainAndFinalize` plus one regression test, and lives entirely within the approved plan scope.
- **Decision:** fix-as-suggested
- **Approach:** In `src/backend/cursor/runtime.ts`, add a `cancelRequested` deferred to `CursorRunState` — a `Promise<void>` plus its resolver — initialized when the handle is created. In `handle.cancel(...)` (currently `runtime.ts:215-220`), resolve `cancelRequested` before invoking `state.run.cancel()` so the signal is observable independent of the `cancelStatus` snapshot. In `drainAndFinalize`, replace the two `if (state.cancelStatus) { ... } else { ... }` snapshot blocks (`runtime.ts:258-273`) with a single sequence that bounds both phases once cancel is requested: (1) `await Promise.race([drainPromise, state.cancelRequested])`; if cancel was requested but `drainPromise` has not resolved, `await Promise.race([drainPromise, sleep(state.cancelDrainMs)])`. (2) The same pattern for `state.run.wait()`: race against `cancelRequested`, then race the remaining `state.run.wait()` against `sleep(state.cancelDrainMs)`. Reuse the existing `setTimeout`-based sleep helpers already used at lines 261 and 271. The synthesized `runResult` fallback (`{ status: state.run.status }`) on the timeout path stays as today. Add a regression test in `src/__tests__/cursorRuntime.test.ts` using a fake `CursorRun` whose `stream()` and `wait()` ignore `run.cancel()` (i.e. never resolve naturally), call `service.cancelRun(...)` after the run is registered, and assert `service.waitForRun(...)` returns `cancelled` within roughly `cancelDrainMs * 2` (the helper added in Comment 8 can be reused for the active-handle wait).
- **Files To Change:** `src/backend/cursor/runtime.ts`, `src/__tests__/cursorRuntime.test.ts`
- **Reply Draft:**
  > **[AI Agent]:** Fixed (D12 plan-compliance). Reworked `drainAndFinalize` to track cancel as a deferred `Promise<void>` resolved inside `handle.cancel(...)`, and to race both stream drain and `state.run.wait()` against `cancelDrainMs` once a cancel is observed regardless of when it arrives. Added a regression test that drives a late cancel against a fake SDK that ignores `run.cancel()` and asserts finalization completes within the bound.

## Comment 5 | fix-as-suggested | major

- **Comment Type:** review-inline
- **File:** `src/backend/cursor/sdk.ts:171-189`
- **Comment ID:** 3177831331
- **Review ID:** 4216064364
- **Thread Node ID:** PRRT_kwDOSRv-qs5_LEa3
- **Author:** coderabbitai[bot]
- **Comment:** `extractAgentApi()` throws when `@cursor/sdk` exists but lacks the expected `Agent` factory. In `available()` (line 177) this rejects the promise instead of returning `{ ok: false, reason }`, breaking the adapter contract and causing diagnostics to crash. Wrap the call in `available()` and `loadAgentApi()` in try/catch and convert to `{ ok: false, reason: error.message }`.
- **Independent Assessment:** Valid contract bug. `CursorSdkAdapter.available()` is documented at `sdk.ts:147` as returning `{ ok: false, reason }` rather than throwing; consumers (e.g. `runtime.ts:76`, diagnostics) rely on that. If a future or partially-incompatible `@cursor/sdk` exports something other than the expected `Agent` factory, `extractAgentApi` throws and breaks the contract. The reviewer's suggested diff for `loadAgentApi` has a small scope bug (declares `api` inside the `try` but uses it after) — must hoist `api` into the outer scope when implementing.
- **Decision:** fix-as-suggested (with the small scope correction)
- **Approach:** In `src/backend/cursor/sdk.ts` wrap the `extractAgentApi(result.module)` call in `available()` (around line 177) in a try/catch that sets `state.available = { ok: false, reason: errorMessage }` on throw and returns it. In `loadAgentApi()` (around line 187) declare `const api: CursorAgentApi` via `let api: CursorAgentApi`, wrap `extractAgentApi(result.module)` in a try/catch that, on throw, sets `state.available = { ok: false, reason: errorMessage }` and rethrows — preserving the existing behavior that `loadAgentApi` rejects when the SDK is unusable while keeping `available()` total. Add a unit test in `cursorRuntime.test.ts` (or a new dedicated file) that mocks `@cursor/sdk` to expose an unexpected shape and asserts `adapter.available()` resolves to `{ ok: false, reason: <Agent factory message> }` rather than rejecting.
- **Files To Change:** `src/backend/cursor/sdk.ts`, `src/__tests__/cursorRuntime.test.ts`
- **Reply Draft:**
  > **[AI Agent]:** Fixed. Wrapped `extractAgentApi` calls in both `available()` and `loadAgentApi()` so a malformed SDK shape now surfaces as `{ ok: false, reason }` from `available()` (preserving the contract) and is rethrown from `loadAgentApi()` after caching the failure. Added a regression test for the malformed-shape path.

## Comment 6 | defer | nit

- **Comment Type:** review-body (Nitpick, lines 27-34)
- **File:** `.agents/skills/orchestrate-create-plan/SKILL.md:27-34`
- **Comment ID:** (no separate inline comment; bundled in review body 4216064364)
- **Review ID:** 4216064364
- **Author:** coderabbitai[bot]
- **Comment:** Line 31-34 derives the GitHub issue from the branch name; suggest adding a one-step human confirmation (resolved issue URL/number + confirm/override) before workers fetch.
- **Independent Assessment:** Workflow-ergonomics suggestion. The current skill already says "Ask the human for an issue URL/number only when the branch and user request do not identify one clearly," which implicitly trusts the branch derivation. CodeRabbit suggests an explicit confirm step on every auto-derive. Reasonable but adds friction; this is a process choice the human (Ralph) should make rather than a bug.
- **Decision:** defer
- **Approach:** None in this PR. If accepted later, the change is a small wording tweak to step 1 (lines 27-34) of `.agents/skills/orchestrate-create-plan/SKILL.md` followed by `node scripts/sync-ai-workspace.mjs` to refresh projections.
- **Files To Change:** none
- **Reply Draft:**
  > **[AI Agent]:** Deferring. Adding an explicit confirm step on every auto-derive is a workflow-ergonomics choice for the supervisor flow, not a bug. The current wording already routes ambiguous cases to the human. Open to revisiting if the branch-derivation path produces a wrong-issue incident.

## Comment 7 | defer | nit

- **Comment Type:** review-body (Nitpick, lines 39-43)
- **File:** `.agents/skills/orchestrate-implement-plan/SKILL.md:39-43`
- **Comment ID:** (no separate inline comment; bundled in review body 4216064364)
- **Review ID:** 4216064364
- **Author:** coderabbitai[bot]
- **Comment:** Require the worker to report explicit dirty-state evidence (porcelain status / tracked+untracked file list) before implementation begins.
- **Independent Assessment:** Workflow-ergonomics suggestion. The current preflight already says "If unrelated or risky dirty files exist, stop and ask the human before implementation begins" — it relies on the worker to report before deciding. Adding a requirement for explicit porcelain output is reasonable but is a process refinement; not a bug.
- **Decision:** defer
- **Approach:** None in this PR. If accepted later, the change is a small wording tweak to step 1 (lines 39-43) of `.agents/skills/orchestrate-implement-plan/SKILL.md` followed by `node scripts/sync-ai-workspace.mjs`.
- **Files To Change:** none
- **Reply Draft:**
  > **[AI Agent]:** Deferring. The current preflight already requires the worker to report status before implementation; making porcelain output mandatory is a process refinement rather than a defect.

## Comment 8 | fix-as-suggested | nit

- **Comment Type:** review-body (Nitpick, lines 225-227, 541-543, 590-591)
- **File:** `src/__tests__/cursorRuntime.test.ts:225-227, 541-543, 590-591`
- **Comment ID:** (no separate inline comment; bundled in review body 4216064364)
- **Review ID:** 4216064364
- **Author:** coderabbitai[bot]
- **Comment:** Replace `setTimeout(50)` waits with a deterministic poll on the actual condition (active handle present, run not running, etc.) to remove CI flakiness.
- **Independent Assessment:** Valid. Lines 226, 542, and 590 each `setTimeout(resolve, 50)` to wait for the orchestrator to register the active run handle before cancel/timeout testing. This is a known flake-source pattern under load.
- **Decision:** fix-as-suggested
- **Approach:** In `src/__tests__/cursorRuntime.test.ts` add a small helper near the top (e.g. `async function waitForActiveHandle(service: OrchestratorService, runId: string, timeoutMs = 2_000)`). The helper polls `(service as unknown as { activeRuns: Map<string, unknown> }).activeRuns.has(runId)` (or equivalent) every 5-10ms until true, throwing on timeout. Replace each of the three `setTimeout(50)` calls with `await waitForActiveHandle(service, runId)`. Keep the rest of each test unchanged.
- **Files To Change:** `src/__tests__/cursorRuntime.test.ts`
- **Reply Draft:**
  > **[AI Agent]:** Fixed. Replaced the three `setTimeout(50)` waits with a polling helper that resolves as soon as `service.activeRuns` registers the run id, with a bounded timeout. Reduces flakiness without slowing down the happy path.

## Comment 9 | fix-as-suggested | major

- **Comment Type:** review-body (Additional comments → `src/backend/cursor/errors.ts (1)`, lines 20-27 with "Also applies to: 54-65")
- **File:** `src/backend/cursor/errors.ts:20-65`
- **Comment ID:** (no separate inline comment; bundled in review body 4216064364 under "Additional comments")
- **Review ID:** 4216064364
- **Author:** coderabbitai[bot]
- **Comment:** Verify the SDK error-class mapping before relying on it. `ConfigurationError` is treated as `invalid_model` unless the message matches the agent-specific regex; if the Cursor SDK also uses that class for auth or transport failures, those runs will be categorized incorrectly and retry behavior will be off.
- **Independent Assessment:** Valid bug. Verified against the locally installed `@cursor/sdk` 1.0.12 type definitions at `node_modules/@cursor/sdk/dist/esm/errors.d.ts:74-81`: `ConfigurationError` is documented as covering 400/404 with examples **"Bad API key, invalid model name, invalid request parameters"** — i.e. it is intentionally overloaded for at least three categories. The current `knownClassCategory` map (`errors.ts:23`) sets `ConfigurationError → invalid_model`, and the sole reclassification block at `errors.ts:54-59` only catches stale-agent messages (rerouted to `protocol`). Bad-API-key cases under `ConfigurationError` are therefore reported as `invalid_model` instead of `auth`, which (a) misleads operators, (b) breaks retry semantics (auth is non-retryable but is not currently retried anyway, so the practical retry-policy regression is small), and (c) drives the wrong diagnostics hint. Note: `IntegrationNotConnectedError` extends `ConfigurationError` but is matched by class name first in `knownClassCategory` (→ `auth`), so that subclass is unaffected.
- **Decision:** fix-as-suggested (refine, not rewrite — keep `ConfigurationError → invalid_model` as the default, but add message-based reclassification for the two known overloads)
- **Approach:** In `src/backend/cursor/errors.ts`, extend the `if (errorClass === 'ConfigurationError')` block (lines 54-59) so it also reclassifies bad-API-key and invalid-request-parameter messages: when `lower` matches `/(api[ _]?key|unauthor[iz]ed|authentication)/` set `category = 'auth'`; when `lower` matches `/(invalid request|invalid parameter|missing parameter|bad request)/` set `category = 'protocol'`. Keep the existing stale-agent → `protocol` branch first so it remains authoritative for that case. Do **not** remove `ConfigurationError` from `knownClassCategory` — leaving it as `invalid_model` keeps the documented "invalid model name" example correct as the default. Add focused tests in `src/__tests__/cursorRuntime.test.ts` (or a new dedicated file) that drive `normalizeCursorSdkError` (or run a failing start through the existing test harness) for: (a) `ConfigurationError` with a "bad api key" message → `auth`, (b) `ConfigurationError` with an "invalid request parameter" message → `protocol`, and (c) the existing "Invalid model: composer-99 not found" case still → `invalid_model` (regression).
- **Files To Change:** `src/backend/cursor/errors.ts`, `src/__tests__/cursorRuntime.test.ts`
- **Reply Draft:**
  > **[AI Agent]:** Fixed. Verified against `@cursor/sdk` 1.0.12 (`errors.d.ts:74-81`): `ConfigurationError` is documented as covering bad API keys, invalid model names, and invalid request parameters. Extended the existing `ConfigurationError` reclassification block in `errors.ts` so bad-API-key messages map to `auth` and invalid-parameter messages map to `protocol`, while keeping `invalid_model` as the default for "invalid model name" (the stable case). Added regression tests for all three message shapes.

## Filtered (non-actionable)

- Conversation comment id=4365717132 (coderabbitai walkthrough summary) — auto-generated PR walkthrough, informational only.
- Review body "Additional comments" entries other than `errors.ts` (Comment 9 above) — affirmations of correctly-implemented decisions (`.agents/skills/orchestrate-create-plan/SKILL.md` 78-83, `.agents/skills/orchestrate-implement-plan/SKILL.md` 89-111 + 150-154, `package.json` 57-59, `src/contract.ts` 32-33, `src/opencode/capabilities.ts` 87-105 + 181-197, `src/__tests__/contract.test.ts` 3-10, `plans/.../plan.md` 1-10), no action.
- Review body "Review info / Path-based instructions / Files selected / Run configuration / Files ignored" — review metadata, no action.

## Open Human Decisions

Open Human Decisions: none.

## Implementation Evidence (2026-05-03)

Fix-now items (Comments 2, 3, 4, 5, 8, 9) implemented; Comments 1, 6, 7 deferred per map.

- **Comment 2:** Added `it('accepts a minimal cursor profile', ...)` in `src/__tests__/opencodeCapabilities.test.ts` with a manifest containing only `cursorOk` (`backend: 'cursor'`, `model: 'composer-2'`) and asserting `manifest.ok === true` and `result.ok === true`.
- **Comment 3:** `handleAssistant` in `src/backend/cursor/cursorEvents.ts` now pushes exactly one `assistant_message`, with payload `{ text, raw }` when extracted text is present and the raw record otherwise. Updated `src/__tests__/cursorEvents.test.ts` to assert the count is exactly 1, validate the `{ text, raw }` payload shape, and added a no-text regression test that asserts the payload is the raw record.
- **Comment 4:** Added `cancelRequested: Promise<void>` plus `resolveCancelRequested` to `CursorRunState`. `handle.cancel(...)` now resolves the deferred before invoking `state.run.cancel()`, so the cancel signal is observable independent of the `cancelStatus` snapshot. `drainAndFinalize` races both stream drain and `state.run.wait()` against `cancelRequested` first, then bounds each phase by `cancelDrainMs` once cancel is observed (using the existing `setTimeout`-based fallback for `state.run.status`). Added regression test `bounds drain when a late cancel arrives against an SDK that ignores run.cancel()` in `src/__tests__/cursorRuntime.test.ts` driving a fake SDK whose `stream()`/`wait()` never resolve and whose `cancel()` is a no-op; asserts the run finalizes as `cancelled` within 2s with `cancelDrainMs: 25`.
- **Comment 5:** Wrapped `extractAgentApi` calls in both `available()` and `loadAgentApi()` in `src/backend/cursor/sdk.ts`. `available()` now returns `{ ok: false, reason }` on shape failure (preserving the contract); `loadAgentApi()` caches the failure on `state.available` and rethrows. Added `CursorSdkAdapterOptions` (test seam: `importer`, `resolveModulePath`) so `defaultCursorSdkAdapter` is testable without touching the real SDK. Added `defaultCursorSdkAdapter contract` describe block with two regression tests (malformed shape → `ok: false` from `available()`; `loadAgentApi()` rejects and caches failure).
- **Comment 8:** Added `waitForActiveHandle(service, runId, timeoutMs)` helper near the top of `src/__tests__/cursorRuntime.test.ts` that polls `(service as ...).activeRuns.has(runId)` every 5ms with a 2s default bound. Replaced all three `setTimeout(50)` waits (cancellation path, idle-timeout synthesis, user-cancel synthesis) with `await waitForActiveHandle(service, runId)`.
- **Comment 9:** Extended the `if (errorClass === 'ConfigurationError')` block in `src/backend/cursor/errors.ts` so the existing stale-agent → `protocol` branch remains authoritative, and additionally bad-API-key/authentication messages map to `auth` and invalid-request/parameter messages map to `protocol`. `ConfigurationError → invalid_model` remains the default in `knownClassCategory`. Added two regression tests in `src/__tests__/cursorRuntime.test.ts` ("Bad API key" → `auth`; "Invalid request parameter" → `protocol`); the existing "Invalid model: composer-99 not found" → `invalid_model` test confirms the default is preserved.

### Verification

- `pnpm build` — green (tsc compiles with no errors).
- `pnpm test` — 150 passed, 0 failed, 1 skipped (Windows-only IPC test). Suite duration ~14.2s. Includes:
  - `OpenCode worker capability profiles › accepts a minimal cursor profile` ✔
  - `cursor SDK event mapping` ✔ (including the new no-text and exact-count assertions)
  - `defaultCursorSdkAdapter contract` ✔ (both new tests)
  - `CursorSdkRuntime success and cancellation paths` ✔ (including the new late-cancel/no-op-cancel test)
  - `CursorSdkRuntime SDK error normalization` ✔ (including the two new ConfigurationError reclassification tests)
  - `CursorSdkRuntime finalize artifacts and timeout/cancel error synthesis` ✔ (still green after switching to `waitForActiveHandle`)

`pnpm verify` was not run (no release/publish-affecting changes; runtime/test changes only). No commit, push, or GitHub reply has been made.

### Files Changed

- `src/backend/cursor/cursorEvents.ts`
- `src/backend/cursor/runtime.ts`
- `src/backend/cursor/sdk.ts`
- `src/backend/cursor/errors.ts`
- `src/__tests__/cursorEvents.test.ts`
- `src/__tests__/cursorRuntime.test.ts`
- `src/__tests__/opencodeCapabilities.test.ts`
- `plans/16-add-coding-backend-for-cursor-sdk/resolution-map.md` (this evidence section)
