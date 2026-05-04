---
pr: 26
url: https://github.com/ralphkrauss/agent-orchestrator/pull/26
branch: 13-add-support-for-claude-code
generated_by: claude-opus-4-7 (resolve-pr-comments / phase 2, revision 3)
ai_reply_prefix: "**[AI Agent]:**"
ai_reply_prefix_source: |
  No configured prefix discovered in the repository (CLAUDE.md only requires
  that AI authorship be clear). Per user instruction, defaulting to
  `**[AI Agent]:**` for drafted reply bodies.
revision_notes: |
  Revision 3 (current) folds in two newly observed PR review items:
    - A12 (new inline): `.agents/skills/orchestrate-create-plan/SKILL.md:101`
      — MD005 list-indent fix around Step 7 "Continue until". Comment
      `3179415630` from CodeRabbit (review `4217464285`). In-scope fix.
    - B3 (new review-body outside-diff): review `4217464285` body comment on
      `.agents/skills/orchestrate-resolve-pr-comments/SKILL.md:82-106`,
      requesting clarification of how "Open Human Decisions" re-prompting
      works between Step 5 and Step 9. In-scope fix (skill-doc clarity).
    - B1 reviewer cautions made explicit: reconciliation must not recurse
      through `ensureReady`, and the fatal backfill must be idempotent
      against *both* the per-run sentinel *and* an existing journal record.
    - Counts, decisions table, and implementation order updated. Skipped
      table extended with two LGTMs from review `4217464285`.

  Revision 2 incorporated reviewer findings against revision 1:
    - A9 reclassified from "escalate" to in-scope security/plan-compliance
      fix: remove in-envelope Bash and switch Claude supervision to MCP
      notification waits (no shell, no dynamic suffix). "Accept risk" is
      removed.
    - A10 reclassified from "escalate" to in-scope fix: drop `--debug-file`
      from passthrough; add rejection tests for both `--debug-file=/path`
      and `--debug-file /path` forms; update help/docs/plan evidence.
    - B1 reclassified from "escalate" to in-scope fix: add atomic emission
      *and* idempotent reconciliation/backfill at startup; not lock-only.
    - A4 reclassified from "defer" to in-scope test fix: add focused
      tests for poller cursor advance, overlapping-tick suppression,
      tolerated push failures, and the A5 interval clamp.
    - Reviewer Questions section added.
    - Skipped items table now lists thread/comment URLs.
---

# PR #26 — Resolution Map

This map is the durable triage record for unresolved review feedback on PR #26.
Each row is a candidate comment with an independent assessment against the
current source. **No code edits, no commits, no GitHub replies have been
made.** All decisions below are routine fixes that should land in a single
implementation pass; there are no open human decisions remaining.

## Counts

- 12 inline review comments (A1–A12)
- 3 review body comments (B1–B3)
- 0 conversation comments
- 5 skipped (2 already-resolved review threads + 1 CodeRabbit walkthrough
  conversation comment + 2 LGTM "Additional comments" from review `4217464285`)

## Decisions

| ID | File:Line | Author | Verdict |
|----|-----------|--------|---------|
| A1 | `src/claude/discovery.ts:170` | coderabbitai | Fix as suggested |
| A2 | `src/claude/skills.ts:48` | coderabbitai | Fix as suggested |
| A3 | `src/monitorCli.ts:20` | coderabbitai | Decline (reasoned, see A3 detail) |
| A4 | `src/server.ts:151` | coderabbitai | Fix in scope (poller test coverage) |
| A5 | `src/server.ts:113` | coderabbitai | Fix as suggested |
| A6 | `src/__tests__/claudeDiscovery.test.ts:29` | coderabbitai | Decline (reasoned, see A6 detail) |
| A7 | `src/claude/launcher.ts:297` | coderabbitai | Fix as suggested |
| A8 | `src/claude/launcher.ts:383` | coderabbitai | Fix as suggested |
| A9 | `src/claude/monitorPin.ts:23` | ralphkrauss | Fix in scope (remove in-envelope Bash) |
| A10 | `src/claude/passthrough.ts:44` | ralphkrauss | Fix in scope (drop `--debug-file`) |
| A11 | `src/orchestratorService.ts:415` | ralphkrauss | Fix as suggested |
| A12 | `.agents/skills/orchestrate-create-plan/SKILL.md:101` | coderabbitai | Fix as suggested (MD005 list-indent) |
| B1 | `src/runStore.ts:315-367` | coderabbitai (review body) | Fix in scope (atomic + reconciliation) |
| B2 | `src/claude/config.ts:45-63` | coderabbitai (review body) | Fix as suggested |
| B3 | `.agents/skills/orchestrate-resolve-pr-comments/SKILL.md:82-106` | coderabbitai (review body) | Fix as suggested (clarify Step 5/Step 9 re-prompt) |

The remainder of this section gives the per-item rationale, concrete
implementation instructions (sufficient for a fresh implementer), and the
draft GitHub reply for each comment.

---

### A1 — `src/claude/discovery.ts:170` — accept stderr text on non-zero exit

- **Author:** coderabbitai (bot)
- **Thread:** `PRRT_kwDOSRv-qs5_MGgP` — comment `3178173727`
- **Verdict:** Fix as suggested.
- **Rationale:** `runOnce` currently rejects when `code !== 0 && stdoutChunks.length === 0`, even if the binary wrote useful help/version output to stderr. The fix is local to `runOnce` and improves resilience against alternative `claude --help` implementations without changing happy-path behavior.

**Implementation steps**

1. In `src/claude/discovery.ts`, replace the `child.on('close', ...)` handler in `runOnce` so it:
   - Decodes stdout and stderr separately.
   - Resolves with `stdout || stderr` when output is non-empty.
   - Rejects with the trimmed stderr in the error message when both are empty *or* when the close code is non-zero AND combined output is empty.
2. Match the suggested patch from the review comment exactly.
3. Add a `discovery.test.ts` (or extend `claudeDiscovery.test.ts`) case that uses a fake binary which writes help text to stderr and exits 0; assert `discoverClaudeSurface` resolves and reports surfaces correctly.

**Reply draft**

```
**[AI Agent]:** Applied the suggested patch — `runOnce` now treats non-empty
stderr as usable output when stdout is empty, and reports stderr in the
rejection message when both are empty. Discovery still requires usable
output to surface a report. Added a focused test covering the
help-on-stderr case.
```

---

### A2 — `src/claude/skills.ts:48` — symlink hardening

- **Author:** coderabbitai (bot)
- **Thread:** `PRRT_kwDOSRv-qs5_MGgQ` — comment `3178173728`
- **Verdict:** Fix as suggested.
- **Rationale:** `listOrchestrationSkills` follows symlinks via `access`, then `curateOrchestrateSkills` calls `copyFile` on the resolved target. A symlinked `SKILL.md` could pull a sensitive host file into the curated envelope. The fix is small, defensive, and aligned with the harness's "deny-by-default" boundary.

**Implementation steps**

1. In `src/claude/skills.ts`, import `lstat` from `node:fs/promises` alongside the existing imports.
2. Inside the `for (const entry of entries)` loop in `listOrchestrationSkills`, replace the `access` call with:
   - `const stat = await lstat(skillFile);`
   - `if (!stat.isFile() || stat.isSymbolicLink()) continue;`
   - then keep the existing `await access(skillFile, constants.R_OK);`
3. Preserve the existing `ENOENT` swallow on lstat (skip silently for missing entries; rethrow other errors).
4. Add a regression case in `src/__tests__/claudeHarness.test.ts` ("Claude skill curation"): create an `orchestrate-evil/SKILL.md` that is a symlink to `/etc/hostname` (or to a sibling file outside the source root); assert it is *not* listed and is *not* copied into the ephemeral root.

**Reply draft**

```
**[AI Agent]:** Applied the suggested hardening — `listOrchestrationSkills`
now lstats `SKILL.md` and skips anything that is not a regular file
(symlinks included). Added a focused regression test that places a symlink
under `orchestrate-*/SKILL.md` and verifies it is neither listed nor
copied into the curated envelope.
```

---

### A3 — `src/monitorCli.ts:20` — `--json-line` is a no-op

- **Author:** coderabbitai (bot)
- **Thread:** `PRRT_kwDOSRv-qs5_MGgR` — comment `3178173730`
- **Verdict:** Decline (with rationale).
- **Rationale:** The `agent-orchestrator monitor` CLI is consumed by external clients (and *was* the pinned wake handle for Claude before A9 retires that path). It only emits a single JSON line on the wake notification; that is its contract. The flag is documented in help so callers can opt into the contract explicitly and so a future text-mode default would be a strict additive change. Making the flag mandatory or repurposing it now adds churn without a real consumer requirement. After A9 lands, the monitor CLI is no longer used by the Claude harness, but it remains a supported external tool, so we keep `--json-line` documented as the current contract.

**Implementation steps**

1. No code change.
2. In the same edit that lands A9, update `monitorCliHelp()` text in `src/monitorCli.ts` to clarify: "currently always emits JSON; `--json-line` is reserved for forward-compat with future non-JSON output."
3. No test change.

**Reply draft**

```
**[AI Agent]:** Declining the rewire: the monitor CLI's contract is one
JSON line per wake, and the flag is the documented opt-in for that
contract. After the A9 change in this PR removes Bash from the Claude
envelope, this CLI is no longer the supervisor's wake handle but it
remains a supported external tool, so its single-shape JSON output stays.
Tightened the help text to call out that `--json-line` is currently always
on and reserved for forward-compat.
```

---

### A4 — `src/server.ts:151` — focused tests for poller behavior

- **Author:** coderabbitai (bot)
- **Thread:** `PRRT_kwDOSRv-qs5_MGgS` — comment `3178173731`
- **Verdict:** Fix in scope (test-only).
- **Rationale:** This PR introduces the `notifications/run/changed` MCP push poller; per `.cursor/rules/node-typescript.mdc` and `AGENTS.md` ("Add or update focused tests for daemon lifecycle, run-store persistence, backend invocation, MCP contracts, and release behavior when those areas change"), it must ship with focused tests for the load-bearing branches. Combined with the A5 clamp fix, the poller's interval-parsing path also needs coverage.

**Implementation steps**

1. In `src/server.ts`, refactor `startNotificationPushPoller` so the tick function and interval parsing are exported as testable helpers without changing runtime behavior:
   - Extract `export function parseNotificationPollIntervalMs(envValue: string | undefined): number` that returns `500` for `undefined`, non-integer, sub-50ms, or negative values, and otherwise returns the parsed integer (this is the same predicate as A5).
   - Extract `export function createNotificationPushTick(deps: { client: { request: ... }; notify: (params) => Promise<void>; })` returning an async tick function plus a `getLastSeen()` accessor and a `setRunning(boolean)` test hook (or use a closure with the same observable behavior). Keep the existing top-level wiring in `server.ts` calling these helpers.
2. Add `src/__tests__/notificationPushPoller.test.ts` with cases:
   - **A4.a Cursor advancement.** Stub `client.request` to return notifications with monotonically increasing `notification_id`s across two `tick()` calls; assert the second call uses `since_notification_id = <last id from first batch>`.
   - **A4.b Overlapping-tick suppression.** Drive the tick into an in-flight state by holding the stub `client.request` on a manual promise; call `tick()` a second time before the first resolves; assert the second call returns immediately and does *not* invoke `client.request` again.
   - **A4.c Tolerated push failures.** Stub `notify` to throw on the first call and resolve on the second; assert the tick still updates `lastSeen` and processes the next notification, and that `client.request` continues to be called on subsequent ticks.
   - **A4.d Tolerated IPC failures.** Stub `client.request` to reject on the first call and resolve on the second; assert the tick does not throw and that `lastSeen` is unchanged after the failed call.
   - **A4.e Interval parsing (covers A5).** Table-test `parseNotificationPollIntervalMs` against: `undefined`, `''`, `'abc'`, `'-1'`, `'-100'`, `'0'`, `'49'`, `'50'`, `'500'`, `'1000'`. Assert defaults to `500` for the first seven and returns the parsed value for the last three.
3. Wire the new test file into the existing test runner (no `package.json` changes needed if `pnpm test` discovers `src/__tests__/*.test.ts`).
4. Confirm `pnpm verify` still passes on Node 22 and 24 (CI matrix).

**Reply draft**

```
**[AI Agent]:** Confirmed — added focused tests for the new MCP push
poller. The new `notificationPushPoller.test.ts` covers cursor
advancement across batches, overlapping-tick suppression via the in-flight
guard, tolerated `notify`/IPC failures (the durable journal stays
authoritative), and the interval clamp from server.ts:113. Refactored the
poller into small exported helpers (`parseNotificationPollIntervalMs`,
`createNotificationPushTick`) without changing runtime wiring.
```

---

### A5 — `src/server.ts:113` — clamp poll interval

- **Author:** coderabbitai (bot)
- **Thread:** `PRRT_kwDOSRv-qs5_MGgT` — comment `3178173732`
- **Verdict:** Fix as suggested.
- **Rationale:** `Number.parseInt(...) || 500` accepts negative integers (e.g. `-1`), which would drive a near-tight poll loop. The suggested clamp is correct.

**Implementation steps**

1. In `src/server.ts`, replace the `intervalMs` line with a call to the new `parseNotificationPollIntervalMs` helper introduced for A4:
   - `const intervalMs = parseNotificationPollIntervalMs(process.env.AGENT_ORCHESTRATOR_NOTIFICATION_POLL_MS);`
2. The helper rejects `undefined`, non-integers, sub-50ms, and negative values, returning `500`.
3. Direct unit tests for the helper are covered by A4.e.

**Reply draft**

```
**[AI Agent]:** Applied the suggested clamp — invalid, sub-50ms, or
negative values now fall back to 500ms via the new
`parseNotificationPollIntervalMs` helper. Tests cover the negative,
non-integer, and below-floor paths in `notificationPushPoller.test.ts`.
```

---

### A6 — `src/__tests__/claudeDiscovery.test.ts:29` — OS-neutral fake binary

- **Author:** coderabbitai (bot)
- **Thread:** `PRRT_kwDOSRv-qs5_MvfV` — comment `3178385432`
- **Verdict:** Decline (with rationale).
- **Rationale:** Project CI runs only on `ubuntu-latest` (`.github/workflows/ci.yml`). The Claude harness uses POSIX-only primitives — 0o700 mode bits in `claude/launcher.ts`, HOME redirection that assumes a POSIX home layout, `chmod` 0755 for executables. Making one test fixture portable to win32 ahead of any project-level commitment to Windows support would imply a contract we do not yet honor.

**Implementation steps**

1. No code change.

**Reply draft**

```
**[AI Agent]:** Declining: CI is Linux-only (`.github/workflows/ci.yml`)
and the harness uses POSIX-only primitives (mode bits, HOME redirection,
shell-style executable shim) that aren't designed for Windows today.
We'll revisit fixture portability when Windows becomes a project goal so
the entire harness moves over together.
```

---

### A7 — `src/claude/launcher.ts:297` — persist `--profiles-json` before passing `manifestPath`

- **Author:** coderabbitai (bot)
- **Thread:** `PRRT_kwDOSRv-qs5_MvfW` — comment `3178385433`
- **Verdict:** Fix as suggested.
- **Rationale:** Confirmed bug. When `--profiles-json` is provided, `options.manifestPath = resolvedProfilesFile` (`launcher.ts:107`) still resolves to the default profiles file. The supervisor system prompt advertises that path (`config.ts:138`), and downstream `start_run` / `list_worker_profiles` calls inside the supervisor target the advertised manifest — leading to either ENOENT or content mismatch.

**Implementation steps**

1. In `src/claude/launcher.ts` `buildClaudeEnvelope`, after `envelopeDir` is established but before the `buildClaudeHarnessConfig` call:
   - If `options.profilesJson` is non-empty, compute `const inlineManifestPath = join(envelopeDir, 'profiles.json');`
   - Write the inline JSON to that path with `await writeFile(inlineManifestPath, options.profilesJson + (options.profilesJson.endsWith('\n') ? '' : '\n'), { mode: 0o600 });`
   - Use `inlineManifestPath` as the `manifestPath` passed to `buildClaudeHarnessConfig`; otherwise pass `options.manifestPath` unchanged.
2. The existing `parseClaudeLauncherArgs` already populates `profilesJson`; no parser change is needed.
3. Add a test in `src/__tests__/claudeHarness.test.ts` (or extend the launcher envelope test) that:
   - Calls `parseClaudeLauncherArgs(['--cwd', cwd, '--profiles-json', '{"version":1,"profiles":{"p1":{"backend":"claude","model":"claude-opus-4-7"}}}', '--state-dir', stateDir, ...])`.
   - Calls `buildClaudeEnvelope(...)` and asserts:
     - `<envelopeDir>/profiles.json` exists with mode `0o600` and contains the inline JSON.
     - `built.systemPrompt` advertises that path on the "Writable profiles manifest path" line.

**Reply draft**

```
**[AI Agent]:** Confirmed and fixed. When `--profiles-json` is provided,
the launcher now writes the inline blob to `<envelope>/profiles.json`
(0600) and uses that path as `manifestPath`, so the supervisor's
advertised manifest, `start_run`, and `list_worker_profiles` all see the
same file. Added a launcher test covering the inline-JSON path.
```

---

### A8 — `src/claude/launcher.ts:383` — comma-join `--allowed-tools`

- **Author:** coderabbitai (bot)
- **Thread:** `PRRT_kwDOSRv-qs5_Mvfb` — comment `3178385437`
- **Verdict:** Fix as suggested.
- **Rationale:** Confirmed bug. The pinned monitor allow entry `Bash(<nodePath> <bin> monitor *)` contains spaces. With ' '-join the `--allowed-tools` value becomes a single string in which the Bash entry is no longer atomic: a tokenizer splitting on whitespace would break `Bash(/usr/bin/node` `/abs/cli.js` `monitor` `*)` apart, breaking the pre-approval and forcing prompts under `dontAsk`. Comma-join keeps the entry atomic and matches the existing comma-joined `--tools`. **Note:** A9 will remove the Bash entry from `--allowed-tools` entirely. A8 still applies because (a) `--allowed-tools` will continue to carry MCP tool names that may include characters that would be ambiguous under whitespace splitting in future Claude versions, and (b) we want the launcher to match Claude's documented "Comma or space-separated" behavior on the safer side.

**Implementation steps**

1. In `src/claude/launcher.ts:382`, change `'--allowed-tools', input.allowedTools.join(' '),` to `'--allowed-tools', input.allowedTools.join(','),`.
2. In `src/__tests__/claudeHarness.test.ts`, replace the `assert.match(allowedTools, /Read/)` style assertions with a direct token-set assertion: split the value by `,` and assert it equals the input list (sorted) so the join character cannot regress silently.
3. The leak-proof test ("does not load poisoned project-level …") and the `buildClaudeSpawnArgs` standalone test both inspect `--allowed-tools`; update both to the comma-split assertion.

**Reply draft**

```
**[AI Agent]:** Confirmed. The pinned `Bash(<prefix> monitor *)` allow
entry contained spaces; joining `--allowed-tools` with spaces made that
single token splittable by Claude's CLI parser. Switched to comma-join
(matches `--tools`) and tightened the tests to assert the entry survives
intact via comma-split. (Note: A9 in this same PR removes the Bash entry
from the allowed list entirely; A8 still applies for the remaining MCP
tool entries and to keep the launcher on the safer side of Claude's
"Comma or space-separated" contract.)
```

---

### A9 — `src/claude/monitorPin.ts:23` — Bash allowlist suffix-injection (in-scope security/plan-compliance fix)

- **Author:** ralphkrauss (human)
- **Thread:** `PRRT_kwDOSRv-qs5_PsvM` — comment `3179370648`
- **Verdict:** Fix in scope. Reviewer answer: remove in-envelope Bash and switch Claude supervision back to the MCP notification surface (`wait_for_any_run`, `list_run_notifications`, `ack_run_notification`). No "accept risk" path. The pinned Bash allowlist `Bash(<prefix> monitor *)` is a glob with no argument grammar; the supervisor can append `; …`, `&& …`, `| …`, command substitution, redirection, or extra flags after the approved prefix and Claude will pre-approve the whole line, which the shell then executes as multiple commands. The targeted `Bash(jq *)` / `Bash(cat *)` denies do not catch suffix injection behind the allowed prefix. This is a correctness/isolation hole introduced by this PR; it must be fixed within this PR, not deferred.
- **Rationale:** The harness's documented invariant is "deny-by-default; the supervisor reads the workspace only via worker runs, and waits via durable notifications." In-envelope Bash is incompatible with that invariant unless we ship a no-shell wrapper, which we do not have today. Removing Bash and pointing the supervisor at the existing MCP notification surface restores the invariant with no new attack surface.

**Implementation steps (concrete, sufficient for a fresh implementer)**

Tool surface changes:

1. In `src/claude/permission.ts`:
   - Change `CLAUDE_SUPERVISOR_BUILTIN_TOOLS` from `['Read', 'Glob', 'Grep', 'Bash']` to `['Read', 'Glob', 'Grep']`.
   - Drop `monitorBashAllowlistPattern` from `ClaudeSupervisorPermissionInput`. Update both `buildClaudeAllowedToolsList` and `buildClaudeSupervisorSettings` to take no input (or `void`).
   - In `buildClaudeAllowedToolsList`, remove the `Bash(${input.monitorBashAllowlistPattern})` entry. The list is now `['Read', 'Glob', 'Grep', ...claudeOrchestratorMcpToolAllowList()]`.
   - In `claudeOrchestratorMcpToolDenyList`, remove `'wait_for_any_run'` and `'list_run_notifications'` from `CLAUDE_SUPERVISOR_DENIED_MCP_TOOL_NAMES` (they are now the *primary* wake path). Keep `'wait_for_run'` denied (single-run blocking wait is still the wrong shape for a Claude-style supervisor).
   - Update `CLAUDE_SUPERVISOR_DENIED_BASH_PATTERNS` to be irrelevant (Bash is no longer allowed at all). Either remove it, or keep it as defense-in-depth in case a future Claude release lets Bash leak through `--tools`. Recommend: keep the array, document the rationale in a comment.
2. In `src/claude/config.ts`:
   - Remove `monitorPin` from `ClaudeHarnessConfigInput` and from `ClaudeHarnessConfig`.
   - Drop the `?? resolveMonitorPin()` line (this also resolves B2 by deletion).
   - Stop calling `buildClaudeSupervisorSettings({ monitorBashAllowlistPattern })`; just call `buildClaudeSupervisorSettings()`.
   - Rewrite `buildSupervisorSystemPrompt` so the prompt:
     - Drops the "Permitted built-in tools includes Bash" line; the new line is `Permitted built-in tools: Read, Glob, Grep, plus the agent-orchestrator MCP tools listed below.`
     - Drops the entire "Bash is allowed only for the pinned monitor command pattern" sentence and the "Primary wake path" / "Cursored monitor command" / "While a Bash monitor is active …" / "If you inherit active run_ids without live monitor handles" / "Do not call wait_for_any_run or wait_for_run" sections.
     - Adds a new "Primary wake path for runs started in this turn" section that pins the MCP wait flow:
       - "After each `start_run` or `send_followup` returns a `run_id`, immediately call `mcp__agent-orchestrator__wait_for_any_run` with `run_ids: [<run_id>, ...]`, `wait_seconds: 60`, `kinds: ['terminal','fatal_error']`, and `after_notification_id` set to your highest seen notification id. Repeat until it returns a notification or `wait_exceeded: true`; on `wait_exceeded`, call again."
       - "When `wait_for_any_run` returns a notification, parse `notification_id`, then call `get_run_result` / `get_run_status` to fetch authoritative state, and call `ack_run_notification` once handled."
     - Rewrites the "Cross-turn reconciliation" section to use `list_run_notifications` with `since_notification_id = <highest seen>` (already mostly there; remove the "monitor recovery path" subsection that referenced Bash).
3. Delete `src/claude/monitorPin.ts` **only after** the launcher and tests stop importing it. Keep the *external* `agent-orchestrator monitor` CLI (`src/monitorCli.ts` and the `agent-orchestrator-monitor` bin entry, if any) — it is used by external clients like the OpenCode mode. Just stop pinning it inside the Claude envelope.
4. In `src/claude/launcher.ts`:
   - Remove the `import { resolveMonitorPin } from './monitorPin.js';` line.
   - Drop the `const monitorPin = resolveMonitorPin(env);` line in `buildClaudeEnvelope`.
   - Remove `monitorPin` from the `buildClaudeHarnessConfig` call.
   - Remove `monitorBashAllowlistPattern` argument from the `buildClaudeAllowedToolsList` call. The call site becomes `allowedTools: buildClaudeAllowedToolsList()`.
   - Remove the "AGENT_ORCHESTRATOR_BIN (override the pinned monitor binary)" line from `claudeLauncherHelp()`.

Test changes:

5. In `src/__tests__/claudeHarness.test.ts`:
   - Update the "permission and allowlist" `it` to assert `CLAUDE_SUPERVISOR_BUILTIN_TOOLS` is exactly `['Read', 'Glob', 'Grep']` and `buildClaudeAllowedToolsList()` does not include any `Bash(...)` entry.
   - Update the deny-list test to assert `claudeOrchestratorMcpToolDenyList()` includes `wait_for_run` only (not `wait_for_any_run`, not `list_run_notifications`).
   - Replace the "monitor pin" describe block with a regression test asserting `monitorPin.ts` is no longer imported by the launcher (e.g. via a structural import-check) — or just delete the describe block once the file is removed.
   - Update the "harness config builder" `it`:
     - Drop the `monitorPin` argument from `buildClaudeHarnessConfig` calls.
     - Replace `assert.match(config.systemPrompt, /Bash run_in_background: true/)` etc. with positive assertions that the prompt advertises `mcp__agent-orchestrator__wait_for_any_run` and `mcp__agent-orchestrator__list_run_notifications` as the primary and reconciliation wake paths.
     - Add `assert.doesNotMatch(config.systemPrompt, /Bash/)` and `assert.doesNotMatch(config.systemPrompt, /pinned monitor/i)` to lock the new contract.
   - Update the "launcher envelope" and "leak-proof" `it`s:
     - Assert `built.spawnArgs[built.spawnArgs.indexOf('--tools') + 1]` equals `'Read,Glob,Grep'`.
     - Assert `--allowed-tools` value (after A8 split-by-comma) does *not* match `/Bash/`.
     - Assert `--allowed-tools` value contains `mcp__agent-orchestrator__wait_for_any_run` and `mcp__agent-orchestrator__list_run_notifications`.
     - Drop the `process.execPath /opt/agent-orchestrator monitor *` regex; remove `AGENT_ORCHESTRATOR_BIN` from the test envs that exercise these paths.
6. Add a focused regression test in `src/__tests__/claudeHarness.test.ts` named `"does not allow any Bash variant in the Claude supervisor envelope"` that asserts:
   - `built.spawnArgs` contains no `Bash` token (anywhere) in the `--tools` value or `--allowed-tools` value.
   - `settings.permissions.allow` contains no `Bash(...)` entries.
   - `built.systemPrompt` contains no occurrence of `Bash`.

Docs and plan evidence:

7. `README.md`: in the "Claude Code orchestration mode" section, replace the "supervisor wait behavior" table and the "pinned Bash monitor" description with the new MCP notification flow. Remove the AGENT_ORCHESTRATOR_BIN env entry. Update the "exit-code table" / monitor CLI references to clarify the monitor CLI is for non-Claude clients.
8. `docs/development/mcp-tooling.md`: drop the "(orchestrate-* only)" + "pinned monitor" paragraph that describes the Bash pin; replace with a paragraph describing `wait_for_any_run` as the supervisor's wake path.
9. `plans/13-add-support-for-claude-code/plans/13-claude-code-support.md`: add a "Plan amendment" entry stating that the original plan's "pinned Bash monitor" approach was retracted during PR review on security grounds (suffix injection through `Bash(<prefix> *)` glob), and the supervisor now uses the MCP `wait_for_any_run` / `list_run_notifications` surface instead. Reference the new tests as evidence.

Verification:

10. Run `pnpm verify` after the change. Expect the snapshot of the supervisor system prompt to change; update `src/__tests__/claudeHarness.test.ts` assertions inline rather than carrying a snapshot.

**Reply draft**

```
**[AI Agent]:** You're right, and I'm fixing this in this PR. The pinned
`Bash(<prefix> monitor *)` glob does not constrain shell metacharacters
in the suffix, so the supervisor could append `;`, `&&`, `|`, `$( )`,
redirections, or extra flags after the approved prefix and execute
arbitrary commands inside the envelope. The targeted Bash deny patterns
only catch commands that *start with* the denied binary, not suffix
injection behind the allowed prefix.

Removing in-envelope Bash entirely:

- `CLAUDE_SUPERVISOR_BUILTIN_TOOLS` becomes `['Read','Glob','Grep']`;
  no Bash in `--tools` or `--allowed-tools`.
- The supervisor's primary wake path becomes
  `mcp__agent-orchestrator__wait_for_any_run` (cursor + 60s chunks),
  with `mcp__agent-orchestrator__list_run_notifications` for cross-turn
  reconciliation and `ack_run_notification` for cleanup. These were
  previously denied for the supervisor; they are now allowlisted.
  `wait_for_run` stays denied (wrong shape for supervisor flows).
- `monitorPin.ts` is dropped from the harness; the
  `agent-orchestrator monitor` external CLI stays for non-Claude clients.
- System prompt, README, mcp-tooling doc, and plan doc are updated to
  describe the new MCP wake path.
- New regression test asserts the supervisor envelope contains no `Bash`
  token in `--tools`, `--allowed-tools`, `settings.permissions.allow`,
  or the system prompt.

This is a plan amendment; the original "pinned Bash monitor" wake path
is retracted. The plan doc records the amendment and the security
rationale.
```

---

### A10 — `src/claude/passthrough.ts:44` — drop `--debug-file` from passthrough

- **Author:** ralphkrauss (human)
- **Thread:** `PRRT_kwDOSRv-qs5_Psvy` — comment `3179370690`
- **Verdict:** Fix in scope.
- **Rationale:** Confirmed. `--debug-file` lets a caller specify a path *outside* the daemon-owned envelope/state dir. That breaks the "Claude only writes inside `${stateDir}`" isolation invariant. The clean fix is to drop the flag from the passthrough allowlist; the harness has no need for it today, and a caller who wants Claude debug logs can run Claude directly outside the harness. (Option (b) — rewriting to a harness-owned path — adds plumbing and a way for callers to consume the debug log that we have not designed; defer that until there is a real consumer.)

**Implementation steps**

1. In `src/claude/passthrough.ts`, delete `'--debug-file'` from the `ALLOWED_FLAG_TOKENS` set.
2. In `src/claude/launcher.ts` `claudeLauncherHelp()`, remove `--debug-file` from the "Allowed Claude flags" line.
3. In `src/__tests__/claudeHarness.test.ts` "Claude passthrough hardening":
   - Add a test that asserts both forms are rejected:
     - `assert.equal(validateClaudePassthroughArgs(['--debug-file', '/tmp/x.log']).ok, false);`
     - `assert.equal(validateClaudePassthroughArgs(['--debug-file=/tmp/x.log']).ok, false);`
   - Remove `--debug-file` from the "accepts allowed read-only Claude flags" list if present.
4. `README.md`: remove `--debug-file` from the "Allowed passthrough flags" enumeration in the Claude orchestration mode section.
5. `plans/13-add-support-for-claude-code/plans/13-claude-code-support.md`: add a one-line note in the "Plan amendments" section that `--debug-file` was removed from the passthrough allowlist on isolation-policy grounds, with a pointer to the rejection tests as evidence.

**Reply draft**

```
**[AI Agent]:** Agreed and fixed. `--debug-file` is removed from
`ALLOWED_FLAG_TOKENS`; both `--debug-file=/tmp/...` and
`--debug-file /tmp/...` now hit the "rejects unknown flag" branch in
`validateClaudePassthroughArgs`. Added regression tests for both forms,
removed the flag from the launcher help and README's allowed-flags list,
and noted the amendment in the plan doc. If a future consumer needs
Claude debug logs from inside the harness, we'll add a harness-owned
path (under `stateDir`) explicitly rather than reopening the free
passthrough.
```

---

### A11 — `src/orchestratorService.ts:415` — cursor-mode `get_run_progress` drops latest-event metadata

- **Author:** ralphkrauss (human)
- **Thread:** `PRRT_kwDOSRv-qs5_PswU` — comment `3179370728`
- **Verdict:** Fix as suggested.
- **Rationale:** Confirmed bug. Current code calls `readEventSummary(run_id, after_sequence === undefined ? limit : 0)`. `RunStore.readEventSummary` derives `last_event` from the `recent_events` tail (`runStore.ts:298`), so cursor mode passes 0 and gets `last_event = null`, making `latest_event_sequence`/`latest_event_at` unconditionally null on cursor pages. Existing cursor-mode test (`runProgress.test.ts:52-69`) does not assert these fields.

**Implementation steps**

1. In `src/runStore.ts`, change `readEventSummary` so the latest-event metadata is always derived from a 1-event tail regardless of `recentLimit`:
   - Read `event_count` via `getLastSequence(runId, true)`.
   - Read `last_event` via a *separate* 1-event tail read (e.g. extract a `readLastEvent(runId)` helper that returns the final parsed line of `events.jsonl`).
   - Read `recent_events` as before with `recentLimit`.
   - Return `{ event_count, last_event, recent_events }` where `last_event` is independent of `recent_events`.
2. Adjust the existing non-cursor-mode caller to keep current behavior: when the caller does want a tail, `recent_events.at(-1)` will agree with `last_event`.
3. In `src/orchestratorService.ts:415`, call `readEventSummary(run_id, after_sequence === undefined ? limit : 1)` — but with the change in (1), the `recentLimit` value no longer affects `last_event`; the explicit second arg can stay `0` for cursor mode if the caller does not need recent events from the summary.
4. In `src/__tests__/runProgress.test.ts:52-69` ("supports cursor-based progress pages …"), add assertions:
   - `assert.equal(progress.progress.latest_event_sequence, 4);`
   - `assert.match(progress.progress.latest_event_at ?? '', /\d{4}-\d{2}-\d{2}T/);`
5. In `src/__tests__/runStore.test.ts` (or add one if absent), add a unit test for `readEventSummary` confirming `last_event` is populated even when `recentLimit = 0`.

**Reply draft**

```
**[AI Agent]:** Confirmed and fixed. `RunStore.readEventSummary` now
reads the latest-event metadata from a dedicated 1-event tail
independent of `recentLimit`, so cursor-mode `get_run_progress` returns
real `latest_event_sequence` / `latest_event_at`. Extended the
cursor-mode test to assert both fields, and added a unit test on
`readEventSummary` that exercises the `recentLimit = 0` path.
```

---

### A12 — `.agents/skills/orchestrate-create-plan/SKILL.md:101` — MD005 list-indent around Step 7 "Continue until"

- **Author:** coderabbitai (bot)
- **Source:** review `4217464285`, inline comment `3179415630`
- **Thread:** https://github.com/ralphkrauss/agent-orchestrator/pull/26#discussion_r3179415630
- **Verdict:** Fix as suggested.
- **Context:** `markdownlint-cli2` warning at `.agents/skills/orchestrate-create-plan/SKILL.md:99-99: Inconsistent indentation for list items at the same level (MD005). Expected: 3; Actual: 4`. The "Continue until:" sub-bullets under numbered Step 7 use mixed leading whitespace — the first bullet is indented with 3 spaces, the second with 4 — and the second bullet's continuation line is also at 4. The warning is real and the linter is part of CodeRabbit's path-based instructions for this file. Fix is mechanical.
- **Rationale:** This is a canonical `.agents/` file. Per `.cursor/rules/ai-workspace-projections.mdc`, `.agents/` is the source of truth and `.claude/skills/...` is generated by `scripts/sync-ai-workspace.mjs`. The fix must be applied to the canonical file and the projection regenerated; otherwise the next sync would either drift or revert the change. The actionable comments table on lines 15-24, 51-66, 78-87, 121-131 of the same file is informational LGTM (no action required) — see Skipped Items.

**Implementation steps**

1. In `.agents/skills/orchestrate-create-plan/SKILL.md`, locate Step 7 ("Iterate to alignment.") and its sub-bullets that start with "Continue until:". Currently lines 97-100 are:
   ```
      Decisions with a concise reason and concrete options. Continue until:
      - the reviewer says the plan is ready or has no blocking feedback; and
       - the plan creator agrees Reviewer Questions are resolved, explicitly
       documented as assumptions, or promoted to Open Human Decisions.
   ```
   Normalize both bullets to the same 3-space indent (matching the parent numbered-list content indent), with continuation lines at 5 spaces. The result should be:
   ```
      Decisions with a concise reason and concrete options. Continue until:
      - the reviewer says the plan is ready or has no blocking feedback; and
      - the plan creator agrees Reviewer Questions are resolved, explicitly
        documented as assumptions, or promoted to Open Human Decisions.
   ```
   No semantic changes; whitespace only.
2. Run `node scripts/sync-ai-workspace.mjs` to regenerate `.claude/skills/orchestrate-create-plan/SKILL.md`. Do not hand-edit the projection.
3. Run `node scripts/sync-ai-workspace.mjs --check` (or `pnpm verify` if the workspace check is wired into it) to confirm there is no projection drift after the regeneration.
4. No test changes; no source changes.

**Reply draft**

```
**[AI Agent]:** Fixed. Normalized the "Continue until:" sub-bullets
under Step 7 to a consistent 3-space indent with 5-space continuation
lines so MD005 is clean. Edited the canonical
`.agents/skills/orchestrate-create-plan/SKILL.md` and regenerated
`.claude/skills/orchestrate-create-plan/SKILL.md` via
`node scripts/sync-ai-workspace.mjs`.
```

---

### B1 — `src/runStore.ts:315-367` — terminal notification durability (atomic + reconciliation)

- **Author:** coderabbitai (review body, outside-diff)
- **Source:** review `4216354204` body, "Outside diff range comments" section
- **Verdict:** Fix in scope (atomic emission AND idempotent backfill/reconciliation).
- **Rationale:** Confirmed gap. `RunStore.markTerminal` commits `meta.json` / `result.json` / the lifecycle event inside `withRunLock`, then appends notifications **outside** the lock. A crash or `appendFile` failure between the lock release and the notification append leaves the run in a "terminal forever, no journal entry" state, and `OrchestratorService.waitForAnyRun` waits exclusively from `listNotifications`, so monitor flows hang on an already-finished run. The reviewer is explicit that lock-only is not enough: lock-only narrows the window but does not handle a process kill between the `meta.json` write and the journal append, nor does it recover already-stuck runs. Both atomic emission and a startup reconciliation pass are required.
- **Reviewer cautions to honor in implementation:**
  1. **No `ensureReady` recursion.** `RunStore.appendNotification` (line 468) and `RunStore.appendFatalErrorNotificationIfNew` (line 376) currently call `await this.ensureReady()`. If `reconcileTerminalNotifications` is invoked from inside `ensureReady` and itself calls those public helpers, we recurse forever (ensureReady → reconcile → appendNotification → ensureReady). Mitigations (pick one and implement explicitly): (a) make `ensureReady` idempotent via a `this.#ready` boolean that short-circuits on second entry, set to `true` *before* reconciliation starts so reentrant calls fall through; (b) have `reconcile…` call private internal helpers (`#appendNotificationInternal`, `#appendFatalErrorNotificationIfNewInternal`) that skip `ensureReady`; or (c) wire reconciliation from `OrchestratorService` startup (just after `await this.store.ensureReady()` in the constructor / `start()` path) instead of from `RunStore.ensureReady` itself. Option (a) is least invasive; option (c) is the cleanest separation of concerns. Whichever is chosen, the test suite must include a "construct two RunStore instances over the same root and call ensureReady on both" case to prove no recursion / no duplicate emission.
  2. **Fatal backfill idempotency against both sentinels and journal records.** `appendFatalErrorNotificationIfNew` already uses a `.fatal_notification` sentinel, but a run created on an older daemon version (or a run where the sentinel write failed but the journal append succeeded) may have a journal record with no sentinel. The reconciliation path must therefore: (i) check the per-run sentinel first; if present, skip; (ii) otherwise, scan the journal via `listNotifications({ runIds: [run_id], kinds: ['fatal_error'], includeAcked: true, limit: 1 })`; if a record exists, *write the missing sentinel* and skip the append; (iii) only when both sentinel and journal record are absent, append + write sentinel atomically (append first, then sentinel — same ordering as `appendFatalErrorNotificationIfNew`). The same three-step check applies to the new `terminal` reconciliation: sentinel `.terminal_notification` first, then journal scan, then append+sentinel. Tests must cover the "journal record present, sentinel missing" case explicitly (B1.g below).

**Implementation steps**

Atomic emission (narrows the window):

1. In `src/runStore.ts` `markTerminal`, move the `appendNotification` (and `appendFatalErrorNotificationIfNew`) calls *inside* `withRunLock`, immediately after the `events.jsonl` / `.events.seq` writes and before the `return next;`. The lock now holds across a small extra fsync; that is acceptable for terminalization. The journal append is still ordered after `meta.json` and `result.json` so a partial write leaves the meta authoritative.

Idempotent reconciliation/backfill:

2. Add an idempotent helper `RunStore.reconcileTerminalNotifications(): Promise<{ backfilled_terminal: number; backfilled_fatal: number; skipped: number }>`:
   - Read all run directories under `runs/`.
   - For each run, load `meta.json`. If `isTerminalStatus(meta.status)` is false, skip (counted as `skipped`).
   - **Terminal record reconciliation** (three-step idempotency, in order):
     1. If the per-run sentinel file `.terminal_notification` (analogous to `.fatal_notification`) exists, skip.
     2. Otherwise, scan the journal via `listNotifications({ runIds: [run_id], kinds: ['terminal'], includeAcked: true, limit: 1 })`. If a record exists, write the missing sentinel best-effort and skip. (This handles upgrades from a daemon version that did not write the sentinel.)
     3. Otherwise, call the internal append (see step 4 below for the recursion-safe call shape) to write a `terminal` record built from `meta.status`, `meta.terminal_reason`, `meta.latest_error`, then write the sentinel. Append first, sentinel second (same ordering as `appendFatalErrorNotificationIfNew`).
   - **Fatal-error record reconciliation** (only if `meta.latest_error?.fatal === true`, same three-step idempotency):
     1. If `.fatal_notification` exists, skip.
     2. Otherwise, scan the journal via `listNotifications({ runIds: [run_id], kinds: ['fatal_error'], includeAcked: true, limit: 1 })`. If a record exists, write the missing sentinel best-effort and skip.
     3. Otherwise, append a `fatal_error` record + write sentinel (same ordering).
   - Catch and log per-run errors; do not let a single bad run dir abort the entire reconciliation pass.
3. Sentinel writing during reconciliation must be best-effort: if the sentinel write fails (e.g. ENOENT due to a deleted run dir mid-scan), log and continue. Journal append failures are *not* swallowed; they propagate to the caller so daemon startup surfaces a real I/O fault rather than silently leaving runs unreconciled.
4. **Recursion-safe wiring (see B1 reviewer cautions).** Pick *one* of:
   - **(a)** Make `ensureReady` idempotent via a `this.#ready` boolean. Set it to `true` *before* invoking reconciliation, so any reentrant `appendNotification` / `appendFatalErrorNotificationIfNew` calls from inside the reconciliation pass fall through `ensureReady` immediately. Document the ordering with a comment.
   - **(b)** Implement reconciliation against private internal helpers `#appendNotificationInternal` and `#appendFatalErrorNotificationIfNewInternal` that skip the `ensureReady()` call but otherwise duplicate the existing append logic. Have the public `appendNotification` / `appendFatalErrorNotificationIfNew` delegate to these internal helpers after their `ensureReady()` gate.
   - **(c)** Move the reconciliation call out of `RunStore` entirely: invoke `await this.store.reconcileTerminalNotifications()` from `OrchestratorService` immediately after `await this.store.ensureReady()` (see `orchestratorService.ts:106`). `RunStore.ensureReady` itself stays unchanged.
   The implementer should pick (a) or (c) (they are smaller and cleaner than (b)) and call out which one in the commit message and plan amendment. Whichever is chosen, *no* code path may have `ensureReady → reconcile → append* → ensureReady` form a cycle.
5. Make reconciliation defensive at the run-loop level: try/catch per run, log to the existing daemon log on per-run failure, increment a counter, and continue. A single corrupted `meta.json` should not block other runs from being backfilled.

Tests (crash-gap simulation):

6. Add `src/__tests__/runStoreTerminalDurability.test.ts`:
   - **B1.a Atomic emission.** Construct a `RunStore`, create a run, call `markTerminal('completed', ...)`, then assert immediately (no startup, no reconciliation) that `listNotifications({ runIds: [run_id] })` contains a `terminal` record. Confirms the atomic-in-lock path.
   - **B1.b Crash-gap reconciliation, completed.** Construct a `RunStore`, create a run, then *manually* simulate the crash gap by writing `meta.json` with `status: 'completed'` and `finished_at` set, *without* appending any journal record. Construct a *new* `RunStore` over the same root and call `ensureReady()`. Assert `listNotifications({ runIds: [run_id], kinds: ['terminal'] })` returns exactly one record with `status: 'completed'` and that the `.terminal_notification` sentinel exists.
   - **B1.c Crash-gap reconciliation, fatal_error.** As B1.b but with `meta.latest_error = { fatal: true, ... }`. Assert both `terminal` and `fatal_error` records are present after `ensureReady`.
   - **B1.d Idempotent across restarts.** As B1.b, then construct a *third* `RunStore` and call `ensureReady()` again. Assert the journal still has exactly one `terminal` record (no duplicates).
   - **B1.e Already-emitted runs are skipped.** As B1.a, then construct a second `RunStore` and call `ensureReady()`. Assert no second journal entry is written and the sentinel is created if it was missing.
   - **B1.f Non-terminal runs are skipped.** Create a run, leave it in `'running'`, call `ensureReady()`. Assert no notification is written.
   - **B1.g Journal record present, sentinel missing.** Construct a `RunStore`, create a terminal run via `markTerminal('completed', ...)` (which now atomically appends), then *delete* the `.terminal_notification` sentinel under the run dir. Construct a second `RunStore` and call `ensureReady()` (or whichever wiring point was chosen in step 4). Assert: (i) `listNotifications` still has exactly one `terminal` record (no duplicate), and (ii) the sentinel has been re-created. Repeat for the fatal-error variant with the `.fatal_notification` sentinel.
   - **B1.h No `ensureReady` recursion.** Construct two `RunStore` instances over the same root with terminal-without-sentinel runs present, and call `ensureReady()` on both. Assert no test timeout (i.e. no infinite recursion) and exactly one journal record per run.
7. Tests use the same `mkdtemp` pattern as `runStore.test.ts`.

Docs and plan evidence:

8. `plans/13-add-support-for-claude-code/plans/13-claude-code-support.md`: add a "Plan amendment" note that the run-store now atomically emits terminal notifications inside the run lock and reconciles missing notifications on startup, addressing the CodeRabbit outside-diff comment on `markTerminal`.

**Reply draft**

```
**[AI Agent]:** Agreed — both pieces are needed. Implemented:

1. Atomic emission. `markTerminal` now appends the terminal (and any
   `fatal_error`) notification inside `withRunLock`, immediately after
   the `meta.json` / `result.json` / events writes. The journal append
   is ordered after the meta write so a partial failure still leaves
   `meta.json` authoritative.
2. Idempotent reconciliation. New `RunStore.reconcileTerminalNotifications`
   scans run dirs at `ensureReady()`; for each run with a terminal
   `meta.status` and no journal `terminal` record, it backfills the
   record and writes a per-run `.terminal_notification` sentinel so the
   operation is idempotent across restarts. Fatal-error backfill reuses
   the existing `.fatal_notification` sentinel and
   `appendFatalErrorNotificationIfNew`.

Tests in `runStoreTerminalDurability.test.ts` cover: the atomic path, a
simulated crash gap (meta-only) for both completed and fatal cases,
idempotency across restarts, already-emitted runs being skipped, and
non-terminal runs being skipped. Plan doc records the amendment.
```

---

### B2 — `src/claude/config.ts:45-63` — redundant `?? resolveMonitorPin()`

- **Author:** coderabbitai (review body, nitpick)
- **Source:** review `4216354204` body, "Nitpick comments" section
- **Verdict:** Fix as suggested.
- **Rationale:** The fallback is unreachable because `monitorPin` is non-optional. **Note:** A9 deletes `monitorPin` from `ClaudeHarnessConfigInput` entirely, which makes B2 a delete-by-side-effect. We keep this row in the map so the implementer remembers to verify the fallback is gone after A9 lands.

**Implementation steps**

1. After A9 lands, verify there is no remaining `?? resolveMonitorPin()` reference anywhere in `src/`. A `grep -nF 'resolveMonitorPin' src/` should return only the deleted file (if not yet removed) or no matches.
2. No additional change is needed if A9 is implemented as described.

**Reply draft**

```
**[AI Agent]:** Fixed via A9 in this PR — `monitorPin` is removed from
`ClaudeHarnessConfigInput` entirely, so the unreachable
`?? resolveMonitorPin()` fallback is deleted along with the field.
```

---

### B3 — `.agents/skills/orchestrate-resolve-pr-comments/SKILL.md:82-106` — clarify "Open Human Decisions" re-prompting between Step 5 and Step 9

- **Author:** coderabbitai (review body, outside-diff)
- **Source:** review `4217464285` body, "Outside diff range comments" section
- **Verdict:** Fix as suggested.
- **Context:** Step 5 of the skill ("Ask remaining human decisions in one batch") asks the human for any open decisions before implementation. Step 9 ("Final human-decision checkpoint") then asks again before commit/push. The skill text does not say whether Step 9 is meant to (a) re-prompt the same Step-5 decisions for confirmation, or (b) only surface *new or changed* decisions that emerged during implementation/review. The reviewer's concern is real: without the clarification, an executor of this skill will either duplicate prompts (annoying, error-prone) or skip Step 9 silently (loses the safety net for late-emerging decisions). The reviewer's suggested patch is precisely targeted and matches our actual intent (Step 5 is the contract; Step 9 catches drift).
- **Rationale:** This is a canonical `.agents/` file (same projection rules as A12). The fix is a small text edit that makes the contract between Step 5 and Step 9 explicit and avoids re-prompting for already-answered decisions while still surfacing late-arriving ones.

**Implementation steps**

1. In `.agents/skills/orchestrate-resolve-pr-comments/SKILL.md`, replace the current Step 9 bullet (lines 103-106) with the reviewer's suggested wording:

   ```
   9. **Final human-decision checkpoint.** Before commit/push, present a final
      **Open Human Decisions** section **only if the resolution map gained new or
      changed Open Human Decisions after Step 5** (e.g., during implementation/review).
      If there are no remaining decisions, say `Open Human Decisions: none.` Do not
      hide release, dependency, external-write, or behavior-changing decisions under
      residual risks.
   ```

   Preserve the surrounding step numbers and the existing prose around it (Steps 8 and 10 should be unchanged).
2. Cross-reference: confirm that Step 5 still records the answered/deferred state of each Open Human Decision in the resolution map (so Step 9 has something concrete to compare against). The current Step 5 wording already says "record `Open Human Decisions: none`" when none remain; that is sufficient as the comparison anchor. No further edit to Step 5 is required.
3. Run `node scripts/sync-ai-workspace.mjs` to regenerate `.claude/skills/orchestrate-resolve-pr-comments/SKILL.md`. Do not hand-edit the projection.
4. Run `node scripts/sync-ai-workspace.mjs --check` to confirm no projection drift after regeneration.
5. No test changes; no source changes.

**Reply draft**

```
**[AI Agent]:** Adopted the suggested patch. Step 9 of
`orchestrate-resolve-pr-comments` now says explicitly that the final
**Open Human Decisions** checkpoint fires *only if the resolution map
gained new or changed decisions after Step 5* (e.g. during
implementation/review), so Step 5 stays the single contract for
already-answered decisions and Step 9 catches drift instead of
duplicating prompts. Edited the canonical `.agents/skills/...` file and
regenerated the `.claude/skills/...` projection via
`node scripts/sync-ai-workspace.mjs`.
```

---

## Skipped Items

These were excluded from the candidate set during Phase 1 and remain excluded.
Listed here with thread / comment URLs and reasons for the durable record.

| Source | URL | File:Line | Author | Reason |
|--------|-----|-----------|--------|--------|
| review thread `PRRT_kwDOSRv-qs5_MGgN` (resolved) | https://github.com/ralphkrauss/agent-orchestrator/pull/26#discussion_r3178173724 | `docs/development/mcp-tooling.md` (~L113-114) | coderabbitai | MD037 emphasis fix; CodeRabbit reply on the same thread reads "✅ Addressed in commit 7db562a". Resolved upstream, no further action. |
| review thread `PRRT_kwDOSRv-qs5_MGgO` (resolved) | https://github.com/ralphkrauss/agent-orchestrator/pull/26#discussion_r3178173726 | `src/__tests__/claudeHarness.test.ts:29` | coderabbitai | Allowlist-coupling concern about the MCP tool list; CodeRabbit reply on the same thread reads "✅ Addressed in commit 7db562a". Resolved upstream. |
| issue comment `4366258445` (informational bot summary) | https://github.com/ralphkrauss/agent-orchestrator/pull/26#issuecomment-4366258445 | n/a | coderabbitai | Auto-generated walkthrough/summary, no actionable content. |
| review `4217464285` body, "Additional comments" entry on `.agents/skills/orchestrate-resolve-pr-comments/SKILL.md` lines 34-77 | https://github.com/ralphkrauss/agent-orchestrator/pull/26#pullrequestreview-4217464285 | `.agents/skills/orchestrate-resolve-pr-comments/SKILL.md:34-77` | coderabbitai | Informational LGTM ("Looks consistent with the batched triage / Reviewer Questions → Open Human Decisions flow."). No action required. |
| review `4217464285` body, "Additional comments" entry on `.agents/skills/orchestrate-create-plan/SKILL.md` lines 15-24 (also applies to 51-66, 78-87, 121-131) | https://github.com/ralphkrauss/agent-orchestrator/pull/26#pullrequestreview-4217464285 | `.agents/skills/orchestrate-create-plan/SKILL.md:15-24, 51-66, 78-87, 121-131` | coderabbitai | Informational LGTM ("No further changes needed — uncertainty routing and escalation language are coherent."). No action required. |

## Open Human Decisions

none.

(Revision 1 listed four open decisions; all four have been reclassified as
in-scope routine fixes per the reviewer's instructions and addressed in the
A4, A9, A10, and B1 entries above. There are no remaining product, scope, or
policy decisions blocking implementation.)

## Reviewer Questions

none.

## Phase 3 Implementation Order

Suggested batching for the implementer:

1. **Test infrastructure / helpers.** Land the A4 helper extraction
   (`parseNotificationPollIntervalMs`, `createNotificationPushTick`) and the
   `notificationPushPoller.test.ts` skeleton first; this gives the rest of
   the changes a stable test surface. Apply A5 in the same change (one-line
   call site update).
2. **Run-store durability (B1).** Atomic emission + idempotent
   reconciliation (with the no-`ensureReady`-recursion guarantee and the
   sentinel-or-journal idempotency in the fatal/terminal backfill paths),
   plus `runStoreTerminalDurability.test.ts` including the new B1.g
   (journal-record-present-sentinel-missing) and B1.h (no-recursion) cases.
   Independent of the Claude harness changes.
3. **Claude harness security (A9 + A10 + B2).** Single change set: remove
   in-envelope Bash, repoint supervision to MCP notification waits, drop
   `--debug-file`, and update README, mcp-tooling doc, plan amendment, and
   tests. B2 falls out for free.
4. **Claude launcher correctness (A7 + A8).** Inline-JSON manifest
   persistence and comma-join `--allowed-tools`, with the test tightening
   from A8.
5. **Discovery / curation hardening (A1 + A2).** Small isolated patches with
   focused regression tests.
6. **Cursor-mode progress (A11).** RunStore tail-read change plus
   `runProgress.test.ts` assertion tightening.
7. **AI-workspace skill-doc fixes (A12 + B3).** Edit the canonical
   `.agents/skills/orchestrate-create-plan/SKILL.md` (MD005 list-indent fix
   under Step 7) and `.agents/skills/orchestrate-resolve-pr-comments/SKILL.md`
   (clarify Step 9 fires only on new/changed Open Human Decisions after
   Step 5). Then run `node scripts/sync-ai-workspace.mjs` to regenerate the
   `.claude/skills/...` projections, and `node scripts/sync-ai-workspace.mjs
   --check` to confirm no drift. No source or test changes.

Run `pnpm verify` after each batch (or at the end if the implementer is
confident; the CI matrix is Node 22 + 24 on Linux). After step 7 in
particular, also run the workspace-projection drift check explicitly so the
generated `.claude/skills/...` files do not regress.

## Notes

- AI reply prefix: no repository convention is configured for AI-authored PR
  replies; the project's `CLAUDE.md` only requires that AI authorship be
  clear. This map and the drafted replies use `**[AI Agent]:**` per the
  user's instruction. Document this assumption to the user before any reply
  is posted.
- Working tree at the start of triage: clean, branch up-to-date with
  `origin/13-add-support-for-claude-code`. Untracked artifacts present
  (`brussels_poem_2000.md`, `plans/13-add-support-for-claude-code/reviews/`)
  were left untouched.
- A9 is a plan amendment relative to the original
  `plans/13-add-support-for-claude-code/plans/13-claude-code-support.md`;
  the implementer must record the amendment in that plan doc as evidence
  alongside the code change.
