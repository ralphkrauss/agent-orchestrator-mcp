---
pr: 29
url: https://github.com/ralphkrauss/agent-orchestrator/pull/29
branch: 13-add-support-for-claude-code
created: 2026-05-04
generated_by: Codex resolve-pr-comments (resolution-map-only)
ai_reply_prefix: "**[AI Agent]:**"
scope: "Resolution map only. No implementation, no commits, no pushes, no GitHub replies."
---

# PR #29 Resolution Map

This is the durable triage record for unresolved review feedback on PR #29,
"Harden Claude orchestration harness". The current request is to create the
resolution map only. No code, docs, tests, commits, pushes, GitHub replies, or
thread-resolution actions were performed as part of this pass.

## Counts

- 8 inline review comments
- 2 actionable outside-diff review-body comments
- 1 review-body nitpick
- 1 actionable source-cleanup item from review-body additional comments
- Skipped: CodeRabbit walkthrough, praise-only review body items, tool-output
  noise not posted as actionable feedback, and generated-file duplicates covered
  by canonical-source fixes.

Total comments: 12 | To fix: 12 | To defer: 0 | To decline: 0 | To escalate: 0

## Open Human Decisions

Open Human Decisions: none.

The two human decisions identified during triage were resolved on 2026-05-04:

### H1 - Daemon-level writable profile policy

Reviewer comment A7 asks to enforce the Claude pinned writable-profiles policy
inside `OrchestratorService.upsertWorkerProfile()`, not only in `src/server.ts`.
The suggested patch is not directly behavior-preserving because the pin is
carried in the Claude MCP server entry environment, while the daemon service
does not have per-client environment context.

- **Decision:** Implement per-request IPC policy context for
  `upsert_worker_profile`; do not use a daemon-global writable-profiles pin.
- **Rationale:** The reviewer is right that the final write primitive should
  understand the restriction, but a daemon-global pin would surprise normal
  local clients. Passing the pinned `profiles_file` policy from the MCP frontend
  into the daemon for that specific request preserves generic-client behavior
  and adds defense in depth at the write path.
- **Implementation Direction:** Thread the resolved harness-pinned profiles file
  through the IPC request context for `upsert_worker_profile`, enforce it inside
  the daemon/write primitive when present, and leave requests without policy
  context unaffected.

### H2 - Windows-specific Claude Bash monitor support

Reviewer comments A3/A4 correctly flag raw command-token quoting problems. A
POSIX-safe quoting fix is routine. Full Windows-style path support is a separate
scope question because current deny patterns intentionally include
`Bash(*\\*)`, which catches Windows paths such as `C:\Program Files\node.exe`,
and Claude Bash pattern semantics on Windows need confirmation.

- **Decision:** Fix POSIX path quoting and explicit monitor allowlist shapes in
  this PR; do not claim Windows Claude monitor support here.
- **Rationale:** Raw path quoting is a real bug and should be fixed now. Windows
  behavior is separate because the current deny list intentionally rejects
  backslashes and Claude Bash/tool pattern semantics on Windows need direct
  validation. Supporting Windows paths without that validation could weaken the
  Bash boundary.
- **Implementation Direction:** Add POSIX quoting coverage for spaces and shell
  metacharacters, keep Windows-style path behavior out of the supported contract
  for this PR, and leave full Windows monitor semantics to a dedicated
  Windows-support follow-up.

## Decisions

| ID | Type | File:Line | Author | Decision |
|----|------|-----------|--------|----------|
| A1 | review-inline | `.agents/skills/orchestrate-create-plan/SKILL.md:103` | coderabbitai | Fix as suggested |
| A2 | review-inline | `README.md:695` | coderabbitai | Fix as suggested |
| A3 | review-inline | `src/claude/monitorPin.ts:27` | coderabbitai | Alternative fix: POSIX quoting, see resolved H2 |
| A4 | review-inline | `src/claude/permission.ts:120` | coderabbitai | Alternative fix: POSIX quoting, Windows support deferred by H2 |
| A5 | review-inline | `src/claude/skills.ts:37` | coderabbitai | Fix as suggested |
| A6 | review-inline | `src/opencode/launcher.ts:250` | coderabbitai | Fix as suggested, plus Claude parity |
| A7 | review-inline | `src/orchestratorService.ts:325` | coderabbitai | Fix via per-request IPC policy context, see resolved H1 |
| A8 | review-inline | `src/orchestratorService.ts:362` | coderabbitai | Fix as suggested |
| B1 | review-body | `src/claude/skills.ts:81-92` | coderabbitai | Fix as suggested |
| B2 | review-body | `src/claude/launcher.ts:330-337` | coderabbitai | Alternative fix |
| N1 | review-body nitpick | `scripts/local-orchestrator-home.mjs:10-14` | coderabbitai | Fix as suggested |
| B3 | review-body additional | `AGENTS.md:131-134` | coderabbitai | Fix as suggested |

## A1 - Skill Markdown List Indentation

- **Comment Type:** review-inline
- **File:** `.agents/skills/orchestrate-create-plan/SKILL.md:103`
- **Comment ID:** `3181605315`
- **URL:** https://github.com/ralphkrauss/agent-orchestrator/pull/29#discussion_r3181605315
- **Comment:** Fix inconsistent nested-list indentation around the reviewer
  instruction list; markdownlint MD005 expected 4 spaces, found 3.
- **Independent Assessment:** Valid. The bullets under Step 4 have mixed
  indentation. The generated `.claude/skills/orchestrate-create-plan/SKILL.md`
  will need to be regenerated from the canonical `.agents` source.
- **Decision:** fix-as-suggested
- **Approach:** Normalize the affected bullets in
  `.agents/skills/orchestrate-create-plan/SKILL.md` to the sibling indentation,
  then run `node scripts/sync-ai-workspace.mjs` and
  `node scripts/sync-ai-workspace.mjs --check` so the `.claude` projection
  matches.
- **Files To Change:** `.agents/skills/orchestrate-create-plan/SKILL.md`,
  generated `.claude/skills/orchestrate-create-plan/SKILL.md`
- **Reply Draft:**
  > **[AI Agent]:** Fixed the MD005 list-indent issue in the canonical
  > `.agents/skills/orchestrate-create-plan/SKILL.md` source and regenerated
  > the Claude skill projection.

## A2 - Stale README Monitor Paragraph

- **Comment Type:** review-inline
- **File:** `README.md:695`
- **Comment ID:** `3181605319`
- **URL:** https://github.com/ralphkrauss/agent-orchestrator/pull/29#discussion_r3181605319
- **Comment:** Remove the stale README paragraph saying Claude no longer uses
  the monitor CLI and waits via MCP instead.
- **Independent Assessment:** Valid. `README.md:648-651` still says the Claude
  Code supervisor no longer uses `agent-orchestrator monitor` and waits via MCP,
  while `README.md:691-695` says Claude uses the pinned background Bash monitor.
- **Decision:** fix-as-suggested
- **Approach:** Rewrite the monitor CLI paragraph around `README.md:648-655` so
  it describes both current uses coherently: Claude uses the pinned background
  Bash monitor for current-turn wake and reconciles cross-turn with
  `list_run_notifications`; OpenCode and generic MCP clients use
  `wait_for_any_run`. Keep the exit-code table intact.
- **Files To Change:** `README.md`
- **Reply Draft:**
  > **[AI Agent]:** Fixed the stale README paragraph so the monitor CLI section
  > now matches the Claude Code orchestration section: Claude uses the pinned
  > background monitor for current-turn wake, while OpenCode/generic MCP clients
  > use `wait_for_any_run`.

## A3 - Quote Monitor Command Tokens

- **Comment Type:** review-inline
- **File:** `src/claude/monitorPin.ts:27`
- **Comment ID:** `3181605322`
- **URL:** https://github.com/ralphkrauss/agent-orchestrator/pull/29#discussion_r3181605322
- **Comment:** Quote monitor command tokens before building the Bash allowlist.
- **Independent Assessment:** Valid. `resolveMonitorPin()` and
  `buildMonitorBashCommand()` join raw paths with spaces. That can break the
  command and desynchronize the allowlist from the actual invocation.
- **Decision:** alternative-fix; POSIX quoting in scope, Windows monitor support
  deferred by resolved H2
- **Approach:** Add a command-token quoting helper in `src/claude/monitorPin.ts`
  and use it for `command_prefix_string` and `buildMonitorBashCommand()`.
  Preserve raw `command_prefix` tokens for structured diagnostics. Add tests for
  POSIX paths containing spaces and single quotes. Do not add Windows-style path
  support or claim Windows monitor compatibility in this PR.
- **Files To Change:** `src/claude/monitorPin.ts`,
  `src/__tests__/claudeHarness.test.ts`; likely `src/claude/permission.ts`,
  `src/claude/config.ts`, and docs/tests touched by the explicit monitor
  allowlist-shape change in B2.
- **Reply Draft:**
  > **[AI Agent]:** Quoted the monitor command tokens before constructing both
  > the supervisor command string and the Bash allow patterns, and added
  > regression coverage for paths with spaces/metacharacters.

## A4 - Escape Pinned Monitor Path In Bash Patterns

- **Comment Type:** review-inline
- **File:** `src/claude/permission.ts:120`
- **Comment ID:** `3181605334`
- **URL:** https://github.com/ralphkrauss/agent-orchestrator/pull/29#discussion_r3181605334
- **Comment:** Escape the pinned monitor path before embedding it in Claude
  `Bash(...)` patterns; Windows backslashes and parentheses can break matching
  and collide with `Bash(*\\*)`.
- **Independent Assessment:** Partially valid with a scope decision. Escaping
  raw paths is valid and overlaps A3. The Windows-specific part is broader
  because the current deny list deliberately rejects backslashes.
- **Decision:** alternative-fix; POSIX quoting in scope, Windows monitor support
  deferred by resolved H2
- **Approach:** Fold this into the A3/B2 monitor hardening. Ensure the monitor
  allow patterns are derived from the same quoted command string that the prompt
  and `buildMonitorBashCommand()` use. Leave the `Bash(*\\*)` deny behavior and
  Windows-specific path semantics unchanged for this PR unless a dedicated
  Windows-support task is opened.
- **Files To Change:** `src/claude/monitorPin.ts`, `src/claude/permission.ts`,
  `src/claude/config.ts`, `src/claude/launcher.ts`,
  `src/__tests__/claudeHarness.test.ts`
- **Reply Draft:**
  > **[AI Agent]:** Aligned the monitor command string and permission patterns
  > so they are generated from quoted monitor tokens. Windows-specific path
  > behavior is handled according to the recorded project decision.

## A5 - Revalidate Skill Files At Copy/Read Time

- **Comment Type:** review-inline
- **File:** `src/claude/skills.ts:37`
- **Comment ID:** `3181605347`
- **URL:** https://github.com/ralphkrauss/agent-orchestrator/pull/29#discussion_r3181605347
- **Comment:** Re-validate `SKILL.md` at copy/read time, not only during
  discovery, to close a symlink swap window.
- **Independent Assessment:** Valid. `listClaudeSkills()` uses `lstat`, but
  `curateOrchestrateSkills()` later calls `copyFile()` and `readFile()` on the
  original path. A path swapped between discovery and copy/read can still escape
  the intended regular-file check.
- **Decision:** fix-as-suggested
- **Approach:** Add a helper that `lstat`s `SKILL.md` immediately before use and
  reads the content only if it is a regular non-symlink file. Prefer reading the
  validated content and writing it to the target file over `copyFile()` so the
  copied content and embedded prompt content come from the same validation step.
  Add a regression test that swaps a discovered `SKILL.md` to a symlink before
  curation and asserts the unsafe file is not copied or embedded.
- **Files To Change:** `src/claude/skills.ts`,
  `src/__tests__/claudeHarness.test.ts`
- **Reply Draft:**
  > **[AI Agent]:** Revalidated `SKILL.md` at the copy/read boundary and now
  > write the curated copy from the validated content. Added regression coverage
  > for a symlink swap after discovery.

## A6 - Invalid Inline Profiles JSON Should Fail Fast

- **Comment Type:** review-inline
- **File:** `src/opencode/launcher.ts:250`
- **Comment ID:** `3181605356`
- **URL:** https://github.com/ralphkrauss/agent-orchestrator/pull/29#discussion_r3181605356
- **Comment:** Fail invalid `--profiles-json` manifests instead of downgrading
  them to diagnostics.
- **Independent Assessment:** Valid. Syntax errors from explicit
  `--profiles-json` already hard-fail, but schema/manifest validation errors
  currently become diagnostics and continue with `profiles: undefined`. The
  Claude launcher has the same pattern and should be kept in parity.
- **Decision:** fix-as-suggested
- **Approach:** In both `src/opencode/launcher.ts` and `src/claude/launcher.ts`,
  make `loadProfilesForLaunch()` return `{ ok: false, errors: parsed.errors }`
  when `options.profilesJson` is present and `parseWorkerProfileManifest()` fails.
  Keep file-backed manifest validation as diagnostics-only where that is the
  existing behavior. Add launcher tests for invalid inline schema in both
  harnesses.
- **Files To Change:** `src/opencode/launcher.ts`, `src/claude/launcher.ts`,
  `src/__tests__/opencodeHarness.test.ts`,
  `src/__tests__/claudeHarness.test.ts`
- **Reply Draft:**
  > **[AI Agent]:** Fixed explicit inline manifests to fail fast on validation
  > errors in both OpenCode and Claude launchers, matching the existing syntax
  > error behavior. File-backed manifest diagnostics remain non-fatal.

## A7 - Enforce Writable Profiles Policy In Daemon

- **Comment Type:** review-inline
- **File:** `src/orchestratorService.ts:325`
- **Comment ID:** `3181605383`
- **URL:** https://github.com/ralphkrauss/agent-orchestrator/pull/29#discussion_r3181605383
- **Comment:** Enforce the pinned writable-profiles policy inside the daemon
  write primitive too.
- **Independent Assessment:** Valid concern, but the suggested patch is a
  behavior/trust-boundary change. The pin exists in the MCP frontend environment
  for the Claude harness; `OrchestratorService` runs in the daemon process and
  does not know which client-level policy applied to the request unless that
  context is passed through IPC or made daemon-global.
- **Decision:** fix via per-request IPC policy context
- **Approach:** Thread an optional writable-profiles policy context from the MCP
  frontend into the daemon request for `upsert_worker_profile`. The MCP frontend
  should continue resolving the harness pin from
  `AGENT_ORCHESTRATOR_WRITABLE_PROFILES_FILE`; when present, pass the resolved
  allowed path alongside the tool request. Enforce the policy in the daemon/write
  path before `readWorkerProfileManifestForUpdate()`. Requests without policy
  context remain unaffected so generic local clients keep current behavior. Add
  tests for allowed pinned-path upsert, denied non-pinned upsert, and no-policy
  generic-client upsert.
- **Files To Change:** `src/server.ts`, `src/orchestratorService.ts`,
  request/IPC types as needed, `src/serverPolicy.ts`,
  `src/__tests__/serverPolicy.test.ts`,
  `src/__tests__/integration/orchestrator.test.ts`
- **Reply Draft:**
  > **[AI Agent]:** Added per-request writable-profile policy context so the
  > Claude MCP frontend can pass its pinned manifest path through IPC and the
  > daemon write path enforces it before updating profiles. Generic requests with
  > no policy context keep their existing behavior.

## A8 - Concurrent Upserts Can Lose Updates

- **Comment Type:** review-inline
- **File:** `src/orchestratorService.ts:362`
- **Comment ID:** `3181605391`
- **URL:** https://github.com/ralphkrauss/agent-orchestrator/pull/29#discussion_r3181605391
- **Comment:** `upsert_worker_profile` can lose concurrent updates because it
  performs a read/modify/write with awaits between steps.
- **Independent Assessment:** Valid. Multiple overlapping upserts in the daemon
  can read the same manifest and the last writer can clobber unrelated profile
  changes.
- **Decision:** fix-as-suggested
- **Approach:** Add an in-process per-profiles-file mutex/queue around the entire
  `upsertWorkerProfile()` read/validate/inspect/write sequence. Clean up lock map
  entries after completion. Add an integration test that fires concurrent upserts
  to different profile names in the same manifest and verifies both changes
  persist.
- **Files To Change:** `src/orchestratorService.ts`,
  `src/__tests__/integration/orchestrator.test.ts`
- **Reply Draft:**
  > **[AI Agent]:** Added a per-manifest update lock around
  > `upsert_worker_profile` so overlapping repairs serialize on the same file.
  > Added a concurrent-upsert regression test that preserves both profile
  > changes.

## B1 - Reject Unsafe Skill Directory Names

- **Comment Type:** review-body outside-diff
- **File:** `src/claude/skills.ts:81-92`
- **Review ID:** `4220138810`
- **URL:** https://github.com/ralphkrauss/agent-orchestrator/pull/29#pullrequestreview-4220138810
- **Comment:** Reject unsafe skill directory names before adding them to the
  prompt surface.
- **Independent Assessment:** Valid. `entry.name` is currently accepted as-is
  after the file check and is later interpolated into prompt text and skill
  listings. A directory name with newlines/control characters can inject prompt
  lines.
- **Decision:** fix-as-suggested
- **Approach:** Add a conservative skill-name guard before `names.push()`, for
  example `^[A-Za-z0-9][A-Za-z0-9._-]*$` with a reasonable max length if desired.
  Skip unsafe names. Add tests for newline/control-character names and confirm
  valid names are still mirrored/curated.
- **Files To Change:** `src/claude/skills.ts`,
  `src/__tests__/claudeHarness.test.ts`
- **Reply Draft:**
  > **[AI Agent]:** Added a conservative skill directory-name guard before names
  > enter the Claude prompt or mirrored skill surface, with regression coverage
  > for newline/control-character injection.

## B2 - Tighten Monitor Bash Allowlist Shapes

- **Comment Type:** review-body outside-diff
- **File:** `src/claude/launcher.ts:330-337`
- **Review ID:** `4220138810`
- **URL:** https://github.com/ralphkrauss/agent-orchestrator/pull/29#pullrequestreview-4220138810
- **Comment:** Tighten the Bash allowlist to the monitor argv shapes actually
  supported by the prompt and `buildMonitorBashCommand()`.
- **Independent Assessment:** Valid. `Bash(<prefix> monitor *)` is broader than
  the two intended shapes: `<run_id> --json-line` and
  `<run_id> --json-line --since <notification_id>`.
- **Decision:** alternative-fix
- **Approach:** Replace the single `bash_allowlist_pattern` with explicit monitor
  allow patterns generated from `ResolvedMonitorPin`, such as the no-cursor and
  cursored monitor shapes. Update `buildClaudeAllowedToolsList()` to accept an
  array of monitor patterns and map each to `Bash(...)`. Update prompt text,
  docs, and tests to assert the generic `monitor *` allow pattern is gone.
  Combine with A3/A4 so quoting and pattern generation share one source of truth.
- **Files To Change:** `src/claude/monitorPin.ts`, `src/claude/permission.ts`,
  `src/claude/config.ts`, `src/claude/launcher.ts`,
  `src/__tests__/claudeHarness.test.ts`, README/docs if they print the allowed
  tool examples.
- **Reply Draft:**
  > **[AI Agent]:** Replaced the broad `monitor *` Bash permission with explicit
  > monitor invocation shapes generated from the same pinned command prefix used
  > by the supervisor prompt and command builder.

## N1 - Normalize Local Base To Absolute Path

- **Comment Type:** review-body nitpick
- **File:** `scripts/local-orchestrator-home.mjs:10-14`
- **Review ID:** `4220138810`
- **URL:** https://github.com/ralphkrauss/agent-orchestrator/pull/29#pullrequestreview-4220138810
- **Comment:** Resolve `AGENT_ORCHESTRATOR_LOCAL_BASE` once so relative values do
  not depend on the caller's working directory.
- **Independent Assessment:** Valid and low-risk.
- **Decision:** fix-as-suggested
- **Approach:** Introduce `configuredBase`, then set
  `const base = resolve(configuredBase);`. `resolve` is already imported.
- **Files To Change:** `scripts/local-orchestrator-home.mjs`
- **Reply Draft:**
  > **[AI Agent]:** Normalized the local orchestrator base to an absolute path
  > before composing the per-checkout local daemon home.

## B3 - AGENTS Smoke Checklist Numbering

- **Comment Type:** review-body additional comment
- **File:** `AGENTS.md:131-134`
- **Review ID:** `4220138810`
- **URL:** https://github.com/ralphkrauss/agent-orchestrator/pull/29#pullrequestreview-4220138810
- **Comment:** Fix duplicated source numbering in the local Claude smoke prompt
  checklist.
- **Independent Assessment:** Valid. Markdown renders ordered lists
  automatically, but the source currently has two `4.` entries. This is an easy
  documentation cleanup.
- **Decision:** fix-as-suggested
- **Approach:** Renumber the last two checklist entries to `5.` and `6.`.
- **Files To Change:** `AGENTS.md`
- **Reply Draft:**
  > **[AI Agent]:** Fixed the duplicated ordered-list numbering in the AGENTS
  > local Claude smoke checklist source.

## Skipped Items

| Source | Reason |
|--------|--------|
| Issue comment `4371073442` | CodeRabbit walkthrough, file summary, finishing-touch checkboxes, and internal state. No direct actionable review request. |
| Review-body praise-only "Additional comments" | Informational positive comments on daemon CLI, docs, MCP schema, skill docs, and tests. No action required. |
| Review-info ast-grep ReDoS warnings in `src/__tests__/daemonCli.test.ts` | Tool warning against test-only regexes built from escaped temporary paths; not posted as an actionable PR comment. Leave out unless a reviewer opens a concrete thread. |
| Review-info LanguageTool and markdownlint warnings outside posted actionable comments | Tool noise or generated/projection duplicates. The actionable `.agents` skill indentation issue is covered by A1. |

## Suggested Implementation Order After Approval

1. Monitor hardening group: A3, A4, B2. Keep command construction, prompt text,
   and `Bash(...)` allow patterns generated from one source of truth.
   Fix POSIX path quoting and explicit monitor allowlist shapes. Do not claim or
   test Windows monitor support in this PR.
2. Writable-profile policy hardening: A7 via per-request IPC policy context,
   not a daemon-global pin.
3. Skill-surface hardening group: A5 and B1.
4. Inline manifest failure parity: A6 in both OpenCode and Claude launchers.
5. `upsert_worker_profile` concurrency: A8.
6. Documentation/small cleanups: A2, N1, B3, A1 with AI workspace sync.
7. Run targeted tests during implementation, then `pnpm test` or `pnpm verify`
   before any commit/push request.

## Current State Notes

- PR metadata at triage time: PR #29 is open, non-draft, base `main`, head
  `13-add-support-for-claude-code`, merge state `CLEAN`.
- Working tree before writing this map was clean against
  `origin/13-add-support-for-claude-code`.
- The only intended working-tree change from this pass is this resolution map.
