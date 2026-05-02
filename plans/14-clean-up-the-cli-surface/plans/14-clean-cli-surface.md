# Clean CLI Surface After Rename

Branch: `14-clean-up-the-cli-surface`
Plan Slug: `clean-cli-surface`
Parent Issue: #14
Created: 2026-05-02
Status: planning

## Context

Issue #14 asks for a clean command surface such as `agent-orchestrator opencode`, `agent-orchestrator start`, `agent-orchestrator stop`, and `agent-orchestrator watch`, so users can install the package globally and use one memorable command family. After this branch was created, `main` performed the full package rename from `@ralphkrauss/agent-orchestrator-mcp` to `@ralphkrauss/agent-orchestrator`, with `agent-orchestrator` and `agent-orchestrator-daemon` as the primary bins. This plan now treats that rename as the baseline instead of planning or preserving the old `-mcp` names.

Sources read:

- `AGENTS.md`: use `pnpm` scripts, keep public package behavior stable unless explicitly changing an API or contract, update focused tests for CLI/release behavior, and record verification evidence.
- `.agents/rules/node-typescript.md`: Node 22+, strict TypeScript, no new package manager or dependency changes, verify human-readable and JSON CLI output where applicable.
- `.agents/rules/mcp-tool-configs.md`: never place tokens in repo files or command arguments; MCP config examples must avoid secrets and stay consistent across supported clients.
- `.agents/rules/ai-workspace-projections.md`: `.agents/` is canonical; generated projections came from `main` and are not manually edited for this CLI plan.
- GitHub issue `#14`: `clean up the cli surface`.
- `origin/main` merge on 2026-05-02: package name, repository URLs, docs, and daemon bin references now use `@ralphkrauss/agent-orchestrator`, `agent-orchestrator`, and `agent-orchestrator-daemon`.
- `package.json`: resolved merged bin surface is `agent-orchestrator`, `agent-orchestrator-daemon`, and `agent-orchestrator-opencode`.
- `src/cli.ts`: resolved merged CLI keeps no-argument and `server` MCP startup, `doctor`, and `opencode`; help text uses renamed command names.
- `src/daemon/daemonCli.ts` and `src/daemonCli.ts`: daemon lifecycle commands still live behind the standalone daemon CLI and read process argv directly.
- `src/opencode/launcher.ts` and `src/opencodeCli.ts`: OpenCode launcher is reusable and now documents `agent-orchestrator opencode` first, with `agent-orchestrator-opencode` as a standalone launcher.
- `src/__tests__/daemonCli.test.ts` and `src/__tests__/opencodeHarness.test.ts`: existing coverage validates renamed daemon help, daemon lifecycle behavior, and OpenCode launcher parsing.
- `README.md` and `docs/development/mcp-tooling.md`: merge resolution updated stale OpenCode examples to the renamed command surface.
- `PUBLISHING.md` and `scripts/check-publish-ready.mjs`: publishing docs and package metadata now target `@ralphkrauss/agent-orchestrator`; `pnpm verify` remains the release-quality gate.

Affected verification commands:

- `pnpm build`
- `node --test dist/__tests__/daemonCli.test.js dist/__tests__/opencodeHarness.test.js`
- `pnpm test`
- `pnpm verify`

## Decisions

| # | Decision | Choice | Rationale | Rejected Alternatives |
|---|---|---|---|---|
| 1 | Rename baseline | Accept `main`'s full rename: package `@ralphkrauss/agent-orchestrator`, primary bin `agent-orchestrator`, daemon bin `agent-orchestrator-daemon`. | The rename already landed on `main`; this branch should not reintroduce stale `-mcp` package or bin names. | Preserve `@ralphkrauss/agent-orchestrator-mcp`; keep `agent-orchestrator-mcp` or `agent-orchestrator-mcp-daemon` aliases in this branch. |
| 2 | MCP server invocation | Preserve no-argument and `server` behavior on `agent-orchestrator` as stdio MCP server startup. | MCP clients invoke the package with no command arguments, and the renamed package still needs stable stdio behavior. | Require all clients to pass `server`; move the MCP server behind a separate executable. |
| 3 | Daemon command shape | Add direct daemon aliases to the top-level CLI: `agent-orchestrator status`, `runs`, `watch`, `start`, `stop`, `restart`, and `prune`, while keeping `agent-orchestrator-daemon`. | This matches issue #14's desired surface and keeps the standalone daemon CLI as an explicit compatibility and scripting path. | Keep only `agent-orchestrator-daemon`; require `agent-orchestrator daemon start`; hide daemon commands from human shell usage. |
| 4 | OpenCode command | Prefer `agent-orchestrator opencode`; keep `agent-orchestrator-opencode` as a standalone launcher. | The top-level command is the clean user-facing flow, and the standalone launcher remains useful for scripts and direct bin discovery. | Remove the standalone launcher; only expose the standalone launcher; document old `agent-orchestrator-mcp opencode`. |
| 5 | CLI implementation structure | Refactor daemon CLI logic into a reusable runner that accepts argv, then delegate from `src/cli.ts`. | The current daemon CLI assumes `process.argv[2]` is the command, which is brittle when called from another CLI entry point. | Mutate `process.argv`; shell out to the daemon CLI bin; duplicate daemon command implementations in `src/cli.ts`. |

## Scope

### In Scope

- Resolve the merge onto the renamed `main` baseline without reintroducing old `-mcp` names.
- Refactor daemon CLI handling so top-level routing can invoke daemon lifecycle commands without relying on fixed global `process.argv` positions.
- Route `status`, `runs`, `watch`, `start`, `stop`, `restart`, and `prune` from `agent-orchestrator`.
- Keep `agent-orchestrator-daemon` working through the same daemon implementation.
- Keep `agent-orchestrator opencode` and `agent-orchestrator-opencode` aligned in help text and docs.
- Preserve `agent-orchestrator` no-arg and `server` MCP startup.
- Update README/help/tests for renamed package and direct top-level daemon aliases.
- Add or update focused tests for command routing, help output, JSON/human daemon output where touched, OpenCode help text, and package bin metadata.

### Out Of Scope

- Reverting or softening the full package rename already merged on `main`.
- Restoring `@ralphkrauss/agent-orchestrator-mcp` package naming or old `agent-orchestrator-mcp*` bins.
- Changing MCP tool names, schemas, request/response contracts, or daemon IPC protocol.
- Changing run-store paths, daemon persistence semantics, worker backend invocation, or OpenCode permission behavior.
- Editing user-level MCP configs, secrets, hooks, or external service state.
- Publishing, versioning, pushing, or force-pushing the package.

## Risks And Edge Cases

| # | Scenario | Mitigation | Covered By |
|---|---|---|---|
| 1 | Stale `agent-orchestrator-mcp` references survive the merge. | Search active docs/source for old package and bin names; update current-facing examples to `agent-orchestrator`. | T0, T3 |
| 2 | Top-level daemon delegation reads option indexes incorrectly because current parser assumes `process.argv[2]` is the command. | Move daemon CLI to an argv-driven runner and make option parsing relative to that argv. | T1, T2, T4 |
| 3 | `agent-orchestrator status --json` or `runs --json` regresses human or JSON output. | Add tests that invoke the built top-level CLI with isolated `AGENT_ORCHESTRATOR_HOME` and compare existing output expectations. | T2, T4 |
| 4 | Adding direct daemon aliases changes MCP stdio startup. | Keep no-arg and `server` branches before daemon command dispatch and test help/known commands separately. | T2, T4 |
| 5 | Standalone daemon and top-level daemon aliases drift. | Route both through the same daemon runner. | T1, T2, T4 |
| 6 | OpenCode docs/help drift from package rename. | Prefer `agent-orchestrator opencode` in help and docs, with `agent-orchestrator-opencode` as the standalone alternative. | T0, T3, T4 |

## Implementation Tasks

| Task ID | Title | Depends On | Status | Acceptance Criteria |
|---|---|---|---|---|
| T0 | Merge renamed `main` baseline and resolve stale command names | None | completed | `origin/main` fetched and merged; conflicts in `package.json` and `src/cli.ts` resolved by accepting the package rename and preserving OpenCode wiring; active docs/source no longer reference `agent-orchestrator-mcp`; `git diff --check` passes. |
| T1 | Refactor daemon CLI into a reusable argv-driven runner | T0 | pending | `src/daemon/daemonCli.ts` exports a runner that accepts daemon args; `src/daemonCli.ts` remains a thin standalone wrapper; option parsing no longer depends on fixed global `process.argv` indexes; existing daemon lifecycle tests still pass. |
| T2 | Add direct top-level daemon routing | T1 | pending | `agent-orchestrator status`, `runs`, `watch`, `start`, `stop`, `restart`, and `prune` delegate to daemon behavior; no args and `server` still start the stdio MCP server; `doctor` and `opencode` still work. |
| T3 | Update user-facing docs and help text | T2 | pending | README examples prefer `agent-orchestrator ...` for human shell usage; MCP client config examples use `@ralphkrauss/agent-orchestrator`; daemon and OpenCode help text show the canonical commands; no secret-bearing config examples are introduced. |
| T4 | Add focused tests for renamed CLI surface compatibility | T1, T2, T3 | pending | Tests cover canonical help output, direct daemon command routing through `dist/cli.js`, standalone daemon bin compatibility, OpenCode help text, and package bin metadata; JSON output touched by daemon routing remains valid. |
| T5 | Run verification and record evidence | T4 | pending | `pnpm build` passes; targeted CLI/OpenCode tests pass; `pnpm test` passes; `pnpm verify` passes or any failure is documented with concrete output and next action. |

## Rule Candidates

| # | Candidate | Scope | Create After |
|---|---|---|---|
| 1 | After the package rename, document `@ralphkrauss/agent-orchestrator` and `agent-orchestrator` as canonical names; do not reintroduce `-mcp` names unless a migration issue explicitly asks for compatibility aliases. | Future CLI/docs changes | After implementation if this naming rule is expected to recur. |

## Quality Gates

- [ ] Merge-resolution sanity passes: `git diff --check`.
- [ ] Affected build command passes: `pnpm build`.
- [ ] Affected tests pass: `node --test dist/__tests__/daemonCli.test.js dist/__tests__/opencodeHarness.test.js`.
- [ ] Full test suite passes: `pnpm test`.
- [ ] Release-quality check passes or failure is recorded: `pnpm verify`.
- [ ] Relevant `.agents/rules/` checks are satisfied, especially Node/TypeScript CLI output and MCP config safety.

## Execution Log

### T0: Merge renamed `main` baseline and resolve stale command names
- **Status:** completed
- **Evidence:** `git fetch origin main` completed; `git merge origin/main` stopped on `package.json` and `src/cli.ts`; conflicts resolved to `@ralphkrauss/agent-orchestrator`, `agent-orchestrator`, `agent-orchestrator-daemon`, and `agent-orchestrator-opencode`; active docs/source search found no remaining `agent-orchestrator-mcp` references; `git diff --check` passed; `pnpm build` was attempted but could not run because `node_modules` is missing and `tsc` is not installed.
- **Notes:** User approved concluding the merge commit on 2026-05-02. Run `pnpm install --frozen-lockfile` before build/test verification.

### T1: Refactor daemon CLI into a reusable argv-driven runner
- **Status:** pending
- **Evidence:** pending
- **Notes:** pending

### T2: Add direct top-level daemon routing
- **Status:** pending
- **Evidence:** pending
- **Notes:** pending

### T3: Update user-facing docs and help text
- **Status:** pending
- **Evidence:** pending
- **Notes:** pending

### T4: Add focused tests for renamed CLI surface compatibility
- **Status:** pending
- **Evidence:** pending
- **Notes:** pending

### T5: Run verification and record evidence
- **Status:** pending
- **Evidence:** pending
- **Notes:** pending
