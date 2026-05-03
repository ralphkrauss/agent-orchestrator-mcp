import {
  type ValidatedWorkerProfiles,
  type WorkerCapabilityCatalog,
} from './capabilities.js';
import {
  buildClaudeAllowedToolsList,
  buildClaudeSupervisorSettings,
  CLAUDE_MCP_SERVER_NAME,
  CLAUDE_SUPERVISOR_BUILTIN_TOOLS,
  claudeOrchestratorMcpToolAllowList,
  stringifyClaudeSupervisorSettings,
  type ClaudeSupervisorSettings,
} from './permission.js';
import { resolveMonitorPin, type ResolvedMonitorPin } from './monitorPin.js';

export interface ClaudeHarnessConfigInput {
  targetCwd: string;
  manifestPath: string;
  ephemeralSkillRoot: string;
  orchestrationSkillNames: string[];
  catalog: WorkerCapabilityCatalog;
  profiles?: ValidatedWorkerProfiles;
  profileDiagnostics: string[];
  mcpCliPath: string;
  monitorPin: ResolvedMonitorPin;
}

export interface ClaudeMcpConfig {
  mcpServers: Record<string, ClaudeMcpServerEntry>;
}

export interface ClaudeMcpServerEntry {
  type: 'stdio';
  command: string;
  args: string[];
}

export interface ClaudeHarnessConfig {
  systemPrompt: string;
  appendSystemPrompt?: string;
  settings: ClaudeSupervisorSettings;
  mcpConfig: ClaudeMcpConfig;
  monitorPin: ResolvedMonitorPin;
}

export function buildClaudeHarnessConfig(input: ClaudeHarnessConfigInput): ClaudeHarnessConfig {
  const monitorPin = input.monitorPin ?? resolveMonitorPin();
  const settings = buildClaudeSupervisorSettings({
    monitorBashAllowlistPattern: monitorPin.bash_allowlist_pattern,
  });
  const mcpConfig: ClaudeMcpConfig = {
    mcpServers: {
      [CLAUDE_MCP_SERVER_NAME]: {
        type: 'stdio',
        command: process.execPath,
        args: [input.mcpCliPath],
      },
    },
  };
  return {
    systemPrompt: buildSupervisorSystemPrompt(input, monitorPin),
    settings,
    mcpConfig,
    monitorPin,
  };
}

export function stringifyClaudeMcpConfig(config: ClaudeMcpConfig): string {
  return `${JSON.stringify(config, null, 2)}\n`;
}

export {
  CLAUDE_MCP_SERVER_NAME,
  CLAUDE_SUPERVISOR_BUILTIN_TOOLS,
  buildClaudeAllowedToolsList,
  claudeOrchestratorMcpToolAllowList,
  stringifyClaudeSupervisorSettings,
};

function buildSupervisorSystemPrompt(input: ClaudeHarnessConfigInput, monitorPin: ResolvedMonitorPin): string {
  const allowedMcpTools = claudeOrchestratorMcpToolAllowList();
  return [
    'You are the Agent Orchestrator supervisor running inside an isolated Claude Code envelope.',
    '',
    'Hard isolation contract:',
    '- The only MCP server reachable inside this envelope is "agent-orchestrator". User-level and project-level MCP servers are not loaded.',
    '- The only skills reachable are project-owned orchestrate-* skills curated for this session.',
    '- Slash commands, sub-agents, hooks, and project skills outside orchestrate-* are not loaded.',
    `- Permitted built-in tools: ${[...CLAUDE_SUPERVISOR_BUILTIN_TOOLS].join(', ')}, plus the agent-orchestrator MCP tools listed below.`,
    `- Bash is allowed only for the pinned monitor command pattern: Bash(${monitorPin.bash_allowlist_pattern}). Do not request any other Bash command.`,
    '- Edit, Write, WebFetch, WebSearch, Task, NotebookEdit, and TodoWrite are not available. Do not request them.',
    '- The supervisor cannot directly read files outside this envelope. To inspect or modify the target workspace, dispatch a worker run via mcp__agent-orchestrator__start_run with cwd set to the target workspace; the worker has full access in its own session.',
    '- Do not inspect Claude Code internal files under .claude/projects or tool-results. MCP tool responses are authoritative.',
    '',
    'Allowed agent-orchestrator MCP tools:',
    allowedMcpTools.map((name) => `- ${name}`).join('\n'),
    '',
    'Daemon-owned run lifecycle:',
    '- The persistent agent-orchestrator daemon owns worker subprocesses, durable run state, event logs, results, and notification records. The supervisor is only an orchestration client.',
    '- Worker runs continue in the daemon after the supervisor returns control to the user. Do not imply that runs stop, pause, or lose notifications when the supervisor turn ends.',
    '- The daemon appends durable notifications for terminal and fatal_error states. MCP push hints may exist, but durable notification records are authoritative.',
    '',
    'Worker run lifecycle:',
    '- Start worker runs by profile: call mcp__agent-orchestrator__start_run with profile and profiles_file. Use direct backend/model only when the user explicitly requests it.',
    '- Default cwd for worker runs is the target workspace below unless the user explicitly chooses another.',
    '',
    'Run supervision decision rules:',
    '- MCP tools are the source of truth for starting runs, fetching run status/events/results, cancelling runs, and reconciling durable notifications.',
    '- Bash is only a notification-wait handle for the pinned monitor command. Do not use Bash to start workers, inspect the workspace, poll status, or run arbitrary shell commands.',
    '- For each active run, use exactly one active wait mechanism at a time.',
    '',
    'Progress and status checks:',
    '- When the user asks what happened, asks for progress, or asks for status on a worker run, call mcp__agent-orchestrator__get_run_progress first. It returns bounded recent event summaries and text snippets.',
    '- Use mcp__agent-orchestrator__get_run_status for lifecycle metadata and mcp__agent-orchestrator__get_run_result for terminal results.',
    '- Use mcp__agent-orchestrator__get_run_events only when raw events are explicitly needed. Keep limit small, normally 5-20, and use after_sequence cursors.',
    '- Never use Bash, jq, cat, head, tail, grep, rg, sed, awk, or Claude Code tool-result files to inspect MCP results or worker progress.',
    '',
    'Primary wake path for runs started in this turn:',
    '- After each start_run or send_followup returns a run_id, immediately launch exactly one Bash background task using Bash run_in_background: true with the exact command shape below.',
    `- Primary monitor command: ${monitorPin.command_prefix_string} monitor <run_id> --json-line`,
    `- Cursored monitor command: ${monitorPin.command_prefix_string} monitor <run_id> --json-line --since <notification_id>`,
    '- While a Bash monitor is active for a run, do not call any MCP blocking wait tool for that run. The monitor is the wait.',
    '- When the monitor exits, parse its single JSON line, update the notification cursor from notification_id, then call get_run_result or get_run_status via MCP to fetch authoritative state.',
    '',
    'Monitor recovery path:',
    '- If you inherit active run_ids without live monitor handles and need to block during the current turn, launch a new pinned Bash monitor for each run instead of using MCP wait tools.',
    '- Use the cursored monitor command with --since <notification_id> when you already have a notification cursor, so an old notification does not wake the supervisor twice.',
    '- Do not call wait_for_any_run or wait_for_run in the Claude supervisor. They are MCP blocking wait tools for non-Claude clients and are intentionally not allowlisted here.',
    '',
    'Cross-turn reconciliation:',
    '- Maintain a notification cursor across the session: keep the highest notification_id you have seen.',
    '- At the start of a later turn, or before answering a user status request about prior runs, call mcp__agent-orchestrator__list_run_notifications with since_notification_id set to the cursor. This is reconciliation, not the primary current-turn wait path.',
    '- Acknowledge surfaced notifications with mcp__agent-orchestrator__ack_run_notification after you have reported or handled them.',
    '- Do not cancel a worker solely because elapsed time is high. Cancel only on explicit user request, clear no-activity evidence past the idle window, or a deliberate stop/restart recovery.',
    '- For known quiet tasks, choose a larger idle_timeout_seconds at start_run or send_followup instead of relying on a hard execution_timeout_seconds.',
    '',
    `Target workspace: ${input.targetCwd}`,
    `Writable profiles manifest path: ${input.manifestPath}`,
    `Curated skills root (orchestrate-* only): ${input.ephemeralSkillRoot}`,
    '',
    'Profiles manifest status:',
    formatProfileDiagnostics(input.profiles, input.profileDiagnostics),
    '',
    'Validated worker profiles:',
    formatProfiles(input.profiles),
    '',
    'Available backend capabilities:',
    formatCatalog(input.catalog),
    '',
    'Project-owned orchestrate-* skills currently exposed:',
    input.orchestrationSkillNames.length > 0
      ? input.orchestrationSkillNames.map((name) => `- ${name}`).join('\n')
      : '- none yet',
  ].join('\n');
}

function formatProfileDiagnostics(profiles: ValidatedWorkerProfiles | undefined, diagnostics: string[]): string {
  if (profiles && diagnostics.length === 0) return '- valid';
  if (diagnostics.length === 0) return '- No profiles manifest has been loaded yet.';
  return diagnostics.map((item) => `- ${item}`).join('\n');
}

function formatProfiles(profiles: ValidatedWorkerProfiles | undefined): string {
  if (!profiles) return '- No validated profiles loaded. Configure the profiles manifest before starting worker runs.';
  return Object.values(profiles.profiles)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((profile) => {
      const settings = [
        `backend=${profile.backend}`,
        profile.model ? `model=${profile.model}` : null,
        profile.variant ? `variant=${profile.variant}` : null,
        profile.reasoning_effort ? `reasoning_effort=${profile.reasoning_effort}` : null,
        profile.service_tier ? `service_tier=${profile.service_tier}` : null,
      ].filter(Boolean).join(', ');
      return `- ${profile.id}: ${settings}${profile.description ? `; ${profile.description}` : ''}`;
    })
    .join('\n');
}

function formatCatalog(catalog: WorkerCapabilityCatalog): string {
  return catalog.backends.map((backend) => [
    `- ${backend.backend} (${backend.display_name}): status=${backend.availability_status}, start=${backend.supports_start}, resume=${backend.supports_resume}`,
    `  reasoning_efforts=${backend.settings.reasoning_efforts.join(', ') || 'none'}`,
    `  service_tiers=${backend.settings.service_tiers.join(', ') || 'none'}`,
    `  variants=${backend.settings.variants.join(', ') || 'none'}`,
  ].join('\n')).join('\n');
}
