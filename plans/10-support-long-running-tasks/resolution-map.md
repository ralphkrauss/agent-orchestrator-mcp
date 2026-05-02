# PR #19 Resolution Map

Branch: `10-support-long-running-tasks`
Created: 2026-05-02
Updated: 2026-05-02 after commit `83fb0f2`
PR: https://github.com/ralphkrauss/agent-orchestrator/pull/19
Head reviewed: `83fb0f2ad2831a5f2f31a93afe19fddfc9092ab9`

Current unique unresolved comments: 1 | To fix: 1 | To defer: 0 | To decline: 0 | To escalate: 0

Skipped:

- CodeRabbit walkthrough/conversation summary comment: informational bot output.
- Earlier AI Agent PR conversation reply for Comments 5-7: already posted.
- Prior CodeRabbit inline threads for Comments 1-4: resolved/outdated after commit `83fb0f2`.
- Prior CodeRabbit review-body items for Comments 5-7: handled in the previous review round.
- CodeRabbit docstring coverage warning: bot pre-merge check noise for this TypeScript repository.
- CodeRabbit LanguageTool note in the latest review body: writing-style noise, no behavioral fix needed.

Reply prefix: `**[AI Agent]:**`

## Summary

| # | Decision | Severity | Files |
|---|---|---|---|
| 8 | alternative-fix | high | `src/processManager.ts`, `src/__tests__/processManager.test.ts` |

## Comment 8 | alternative-fix | high

- **Comment Type:** review-inline
- **File:** `src/processManager.ts:54`
- **Also Applies To:** `src/processManager.ts:187-191`
- **Comment ID:** `discussion_r3177107595`
- **Review ID:** `4215417719`
- **Author:** `coderabbitai[bot]`
- **Thread URL:** https://github.com/ralphkrauss/agent-orchestrator/pull/19#discussion_r3177107595
- **Comment:** Do not suppress persistence failures for the new stream-side activity/error writes. `trackPersistence()` currently converts every rejection into a fulfilled promise, so `Promise.allSettled(persistenceTasks)` cannot detect failed `recordActivity()`, `updateMeta(latest_error)`, or stderr `appendEvent()` writes before terminal finalization.
- **Independent Assessment:** Valid. The current implementation records stream-side persistence work in `persistenceTasks`, but `trackPersistence()` uses `task.then(() => undefined, () => undefined)`. That prevents unhandled rejections, but it also erases failures. A run can finalize as successful even if the new supervision metadata or stderr error event failed to persist.
- **Decision:** alternative-fix
- **Reason For Alternative:** CodeRabbit's proposed shape is directionally correct, but throwing `persistenceError` before the existing `try` block would reject `managed.completion` directly instead of routing the failure through `failFinalization()`. The fix should preserve the first persistence failure and let the existing finalization failure path mark the run terminal with `terminal_reason: finalization_failed`.

### Required Code Changes

1. In `src/processManager.ts`, keep tracking every persistence task, but preserve the first rejection instead of erasing it completely.

   Recommended shape:

   ```ts
   const persistenceTasks: Promise<void>[] = [];
   let persistenceFailed = false;
   let persistenceError: unknown;

   const trackPersistence = (task: Promise<unknown>) => {
     persistenceTasks.push(task.then(
       () => undefined,
       (error) => {
         if (!persistenceFailed) {
           persistenceFailed = true;
           persistenceError = error;
         }
       },
     ));
   };
   ```

   Use a boolean sentinel rather than `persistenceError ??=` so even a promise rejected with `undefined` is still treated as a failure.

2. Keep awaiting all stream, parse, and persistence work before terminal finalization:

   ```ts
   await stdoutClosed;
   await stderrClosed;
   await Promise.allSettled(parseTasks);
   await Promise.allSettled(persistenceTasks);
   ```

3. Move the persistence failure check inside the existing finalization `try` block:

   ```ts
   try {
     if (persistenceFailed) throw persistenceError;
     return await this.finalizeRun(/* existing args */);
   } catch (error) {
     return this.failFinalization(runId, error, Array.from(filesFromEvents), commandsRun);
   }
   ```

   This makes activity/latest-error/stderr-event persistence failures fail the run through the existing `finalization_failed` path instead of silently succeeding or rejecting `managed.completion`.

4. Do not change `parseTasks` behavior in this fix. The review comment is specifically about persistence of the new supervision metadata/events.

### Required Test Coverage

Add a focused regression in `src/__tests__/processManager.test.ts`.

Suggested shape:

- Add a test `RunStore` subclass near `ThrowingTerminalStore` that throws once from `recordActivity()` for a stream-side source such as `stderr` or `stdout`.
- Start a mock worker that otherwise exits successfully and emits a valid result event.
- Ensure the worker produces the stream-side activity source that triggers the failing `recordActivity()` write.
- Await `managed.completion`.
- Assert:
  - `meta.status === 'failed'`
  - `meta.terminal_reason === 'finalization_failed'`
  - `meta.latest_error?.source === 'finalization'`
  - `meta.latest_error?.message === 'run finalization failed'`
  - `meta.latest_error?.context?.error` includes the injected persistence failure message
  - `meta.result?.summary === 'run finalization failed'`

If using `stderr`, make the emitted stderr line benign so the test isolates persistence failure handling instead of fatal stderr classification.

### Files To Change

- `src/processManager.ts`
- `src/__tests__/processManager.test.ts`

### Verification

Run the narrow checks first:

```text
git diff --check
node scripts/sync-ai-workspace.mjs --check
pnpm test -- --test-name-pattern persistence
```

Then run broader checks if dependencies are installed:

```text
pnpm build
pnpm test
pnpm verify
```

If `node_modules` is still missing locally, record that `pnpm build`/`pnpm test` are blocked by the missing install and include any checks that did run.

### Reply Draft

> **[AI Agent]:** Fixed. Persistence tracking now preserves the first failed activity/error/event write and routes it through the existing finalization failure path before terminal marking, so the run cannot silently complete after dropping supervision metadata. Added regression coverage for a failed stream-side activity persistence write. <!-- agent-orchestrator:pr19:c8 -->

## Previously Handled Review Items

These were mapped and handled before the latest CodeRabbit review. They are retained here only to avoid reopening already-resolved feedback.

| # | Prior Decision | Current State | Notes |
|---|---|---|---|
| 1 | decline | resolved | Formatter assertion comment was stale; CodeRabbit later confirmed the clarification. |
| 2 | fix-as-suggested | resolved/outdated | Fatal backend classifier was tightened and structured suffix cases were added. |
| 3 | fix-as-suggested | resolved/outdated | Observability sessions/prompts now use the freshest observed timestamp. |
| 4 | fix-as-suggested | resolved/outdated | Stderr classification now uses complete lines and finalization waits for stderr processing. |
| 5 | alternative-fix | handled | Runtime parsing remains forward-compatible while internal terminal reasons are closed. |
| 6 | fix-as-suggested | handled | Split-chunk fatal stderr regression was added. |
| 7 | decline | handled | RunStore per-run locking already prevents the metadata field-loss race described. |

## Developer Handoff

Implement only Comment 8 in this round. Do not post PR replies or resolve GitHub threads until the fix is committed, pushed, and the maintainer approves posting replies.
