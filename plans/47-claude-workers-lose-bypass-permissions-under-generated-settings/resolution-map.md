# PR #48 — Resolution Map (Triage Pass)

PR: https://github.com/ralphkrauss/agent-orchestrator/pull/48
Branch: `47-claude-workers-lose-bypass-permissions-under-generated-settings`
HEAD commit: `132a3e31d2099b8f632f4246e8f23e784f2411a5`
Triage date: 2026-05-07
CI: Build/Test/Pack on Node 22 + Node 24 — green; CodeRabbit review — `COMMENTED` (non-blocking).
Mergeability: `MERGEABLE` / `CLEAN` (no required-review gating).

Approved plan in scope:
- Index: `plans/47-claude-workers-lose-bypass-permissions-under-generated-settings/plan.md`
- Sub-plan: `plans/47-claude-workers-lose-bypass-permissions-under-generated-settings/plans/47-claude-worker-bypass-permissions.md`
- Locked behavior: `bypassPermissions` posture stays; `--permission-mode bypassPermissions` argv stays; `skipDangerousModePermissionPrompt: true` stays in body; `disableAllHooks: true` stays; `--dangerously-skip-permissions` is forbidden; supervisor envelope (`src/claude/launcher.ts`, `src/claude/permission.ts`) is out of scope; no profile-level worker permission knob.

Total comments fetched: 2 | Filtered out: 1 | Triaged actionable: 1
Decision counts: fix=1 | decline=0 | defer=0 | human-approval-required=0

## Source inventory

On-disk snapshots of the GitHub API responses backing this triage are
checked in next to this file under `pr-snapshot/` so any reviewer (including
sandboxed reviewers without `api.github.com` access) can independently
re-derive the inventory. Files are the literal JSON envelopes returned by
the GitHub REST and GraphQL APIs at HEAD `132a3e3`:

| File | Source command | Count |
|---|---|---|
| `pr-snapshot/issue-comments.json` | `gh api repos/ralphkrauss/agent-orchestrator/issues/48/comments` | 1 issue comment (CodeRabbit walkthrough; filtered as informational) |
| `pr-snapshot/pull-comments.json` | `gh api repos/ralphkrauss/agent-orchestrator/pulls/48/comments` | 0 inline pull-review comments |
| `pr-snapshot/reviews.json` | `gh api repos/ralphkrauss/agent-orchestrator/pulls/48/reviews` | 1 review (CodeRabbit, state `COMMENTED`, holds the single actionable nitpick triaged below) |
| `pr-snapshot/review-threads.json` | `gh api graphql` query for `pullRequest.reviewThreads(first: 50)` | 0 review threads total (0 resolved, 0 unresolved) |

| Source | URL | Status | Action |
|---|---|---|---|
| Issue comment (CodeRabbit walkthrough/summary) | https://github.com/ralphkrauss/agent-orchestrator/pull/48#issuecomment-4394502683 | Auto-generated walkthrough; status-only | **Filtered** as informational bot noise |
| Review (CodeRabbit `COMMENTED`) | https://github.com/ralphkrauss/agent-orchestrator/pull/48#pullrequestreview-4241501966 | Body holds 1 nitpick + 1 positive note (no action) | 1 actionable item triaged below |
| Pull-request review-thread inline comments | API returned `[]` | None | n/a |
| Pull-request review threads (GraphQL) | Empty `nodes` array | None | n/a |
| Conversation comments other than walkthrough | None | None | n/a |

The CodeRabbit "Additional comments" block on `src/__tests__/claudeWorkerIsolation.test.ts:14-53` is a **positive** ("Nice regression coverage on the contract change") observation, not a request — no action.

The LanguageTool style hint on `plans/.../47-claude-worker-bypass-permissions.md:54` (consider a different verb than "fix") is a tooling style nit on prose inside the plan body (the plan is the locked-decisions document for this issue). Not actionable; not surfaced as a CodeRabbit suggestion. Filtered as noise.

## Filtered (with reason)

1. **CodeRabbit walkthrough comment** (`issuecomment-4394502683`) — auto-generated PR summary / pre-merge checklist; informational only.

## Triage decisions

### Item 1 — Use `CLAUDE_WORKER_SETTINGS_BODY.permissions.defaultMode` as the source of truth in the spawn argv

- **Comment Type:** review-body (CodeRabbit nitpick under "🧹 Nitpick comments (1)")
- **Source:** CodeRabbit (bot)
- **Author:** `coderabbitai[bot]`
- **Review ID:** `4241501966` (review-level node `PRR_kwDOSRv-qs780C8O`)
- **Comment ID:** none (no separate review-thread inline comment was created — the suggestion lives inside the review body; reply must be posted as a review reply or a top-level PR comment with a marker)
- **Thread Node ID:** none (review threads are empty per GraphQL `reviewThreads.nodes`)
- **File:line:** `src/backend/claude.ts:51-55` (definition of `CLAUDE_WORKER_SETTINGS_BODY`) and `src/backend/claude.ts:83` (the spawn argv tuple in `prepareWorkerIsolation()`)
- **Comment (verbatim):** "Use the settings body as the single source of truth for the permission mode. This fix depends on the file contents and spawned argv never drifting. Reusing the value already pinned in `CLAUDE_WORKER_SETTINGS_BODY` makes that coupling explicit." Proposed diff: replace the literal `'bypassPermissions'` in the returned argv with `CLAUDE_WORKER_SETTINGS_BODY.permissions.defaultMode`.
- **Independent Assessment:** Verified against the code at HEAD `132a3e3`.
  - `src/backend/claude.ts:51-55`:
    ```ts
    export const CLAUDE_WORKER_SETTINGS_BODY = {
      disableAllHooks: true,
      permissions: { defaultMode: 'bypassPermissions' },
      skipDangerousModePermissionPrompt: true,
    } as const;
    ```
    Because the object is `as const`, the inferred type of `permissions.defaultMode` is the literal `'bypassPermissions'` (not widened to `string`). It is therefore assignable into a `string[]` argv tuple with no cast and is identity-equal to the literal `'bypassPermissions'` used today at line 83.
  - `src/backend/claude.ts:83`:
    `return ['--settings', settingsPath, '--setting-sources', 'user', '--permission-mode', 'bypassPermissions'];`
    Substituting `CLAUDE_WORKER_SETTINGS_BODY.permissions.defaultMode` for the trailing literal yields an argv whose runtime contents are byte-identical.
  - Wire contract: in `src/__tests__/claudeWorkerIsolation.test.ts`, the `start` test (lines 36-46) and the `resume` test (lines 78-88) are the ones that assert `--permission-mode bypassPermissions` in `invocation.args` against the literal string `'bypassPermissions'`. The user-hook regression test (lines 165-172) asserts the literal `'bypassPermissions'` only against the per-run on-disk settings file's `permissions.defaultMode` — it does not re-assert the argv flag. All of those assertions continue to pass without modification because the runtime value is unchanged.
  - Plan parity: Decision 2 of `plans/.../47-claude-worker-bypass-permissions.md` explicitly favors keeping the body and the argv aligned. The change makes that alignment structural rather than two literals that must be hand-kept in sync.
  - Forbidden flag check: `--dangerously-skip-permissions` is not introduced; `--permission-mode bypassPermissions` continues to be the surface used.
  - Scope: changes only an internal expression in `prepareWorkerIsolation()`; supervisor envelope (`src/claude/launcher.ts`, `src/claude/permission.ts`) is untouched; no profile-level knob added.

  **Verdict:** behavior-preserving; scope-compatible; consistent with the locked plan. Routine internal refactor.

- **Decision:** **fix-as-suggested**
- **Classification:** routine (no human approval required — internal refactor, no behavior change, no public contract change, no permission/tool surface change)
- **Behavior-preserving:** yes
- **Files To Change:** `src/backend/claude.ts` (argv literal only). No test changes.

#### Implementation instructions (self-contained)

1. **File:** `src/backend/claude.ts`
2. **Function:** `ClaudeBackend.prepareWorkerIsolation()` (declared at line 75 in HEAD `132a3e3`).
3. **Change:** replace the single-line return at line 83
   ```ts
   return ['--settings', settingsPath, '--setting-sources', 'user', '--permission-mode', 'bypassPermissions'];
   ```
   with the multi-line form that reuses the constant
   ```ts
   return [
     '--settings',
     settingsPath,
     '--setting-sources',
     'user',
     '--permission-mode',
     CLAUDE_WORKER_SETTINGS_BODY.permissions.defaultMode,
   ];
   ```
4. **Type / lint:** `CLAUDE_WORKER_SETTINGS_BODY` is `as const`, so `permissions.defaultMode` has the literal type `'bypassPermissions'` and is assignable into the `string[]` returned by `prepareWorkerIsolation()` with no cast. No `tsconfig.json` change needed. No new imports needed (`CLAUDE_WORKER_SETTINGS_BODY` is already declared in this same module a few lines above).
5. **Doc:** the existing module-level JSDoc on lines 7-49 already states "mirrored on the spawn argv as `--permission-mode bypassPermissions`" — leave the doc as-is; the wording "mirrored on" still describes the runtime argv after this change. Do not remove or rewrite the doc.
6. **Test impact:** none. The existing assertions in `src/__tests__/claudeWorkerIsolation.test.ts` (`assert.equal(invocation.args[permissionModeIndex + 1], 'bypassPermissions')` at lines 38 and 80, plus the on-disk `permissions.defaultMode` assertions at 52, 96, 171) intentionally compare against the string literal `'bypassPermissions'` and that is correct: the test is the wire-contract guard for what gets passed to the `claude` binary on stdin. Do **not** rewrite those assertions to dereference the constant — keeping them as string literals is what makes them a meaningful contract test.
7. **Verification commands** (the implementer should run, not the triage agent):
   - `pnpm build` — type-check + build.
   - `pnpm test` — full test suite; the `Claude worker isolation (issue #40, T5 / Decision 9)` describe block must remain green with no test changes. To narrow the human eyeballs, optionally pipe through `pnpm build && pnpm test 2>&1 | grep -E "Claude worker isolation|PASS|FAIL"`.
   - `pnpm verify` — final end-to-end gate, the same one used by the original plan's verification step.
8. **Commit guidance:** single-purpose commit, message along the lines of `refactor(claude): reuse settings body defaultMode in worker argv (PR #48 review)`. No CHANGELOG entry required (internal refactor; no behavior change).

#### Pre-drafted reply

```text
<!-- ao:resolve-pr-comments:pr48-rev4241501966-claude-ts-83 -->
Applied as suggested in commit `<sha>`. The argv at `src/backend/claude.ts:83` now reads `CLAUDE_WORKER_SETTINGS_BODY.permissions.defaultMode` instead of the duplicated `'bypassPermissions'` literal, so the on-disk settings body and the spawn argv share a single source of truth (matches Decision 2 in `plans/47-claude-workers-lose-bypass-permissions-under-generated-settings/plans/47-claude-worker-bypass-permissions.md`). The runtime argv is byte-identical, so the wire-contract assertions in `src/__tests__/claudeWorkerIsolation.test.ts` keep their string-literal comparisons against `'bypassPermissions'` — that is intentional.

(AI-assisted reply on behalf of @ralphkrauss.)
```

## Reviewer Questions

none

## Open Human Decisions

none
