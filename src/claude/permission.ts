import { tools as mcpTools } from '../mcpTools.js';

export const CLAUDE_MCP_SERVER_NAME = 'agent-orchestrator';

/**
 * Built-in Claude Code tools available to the supervisor. Bash is intentionally
 * excluded: a `Bash(<prefix> *)` allowlist glob does not constrain shell
 * metacharacters in the suffix, so any pinned monitor prefix could be followed
 * by `;`, `&&`, `|`, command substitution, or redirection and Claude would
 * still pre-approve the line. The supervisor waits for runs through the MCP
 * notification surface (`wait_for_any_run` / `list_run_notifications`) instead.
 */
export const CLAUDE_SUPERVISOR_BUILTIN_TOOLS = ['Read', 'Glob', 'Grep'] as const;

export interface ClaudeSupervisorSettings {
  permissions: {
    defaultMode: 'dontAsk';
    allow: string[];
    deny: string[];
  };
  enableAllProjectMcpServers: false;
  hooks: Record<string, never>;
  enabledPlugins: Record<string, never>;
}

// `wait_for_any_run` and `list_run_notifications` are the supervisor's primary
// wake path; only `wait_for_run` (single-run blocking wait) stays denied since
// it is the wrong shape for a Claude-style supervisor.
const CLAUDE_SUPERVISOR_DENIED_MCP_TOOL_NAMES = ['wait_for_run'] as const;
// Defense-in-depth: even though Bash is no longer in the built-in tool list,
// keep the deny patterns in case a future Claude release leaks Bash through
// `--tools`. They have no effect when Bash is not part of the surface.
const CLAUDE_SUPERVISOR_DENIED_BASH_PATTERNS = [
  'Bash(jq *)',
  'Bash(cat *)',
  'Bash(head *)',
  'Bash(tail *)',
  'Bash(grep *)',
  'Bash(rg *)',
  'Bash(sed *)',
  'Bash(awk *)',
  'Bash(find *)',
  'Bash(ls *)',
  'Bash(*tool-results*)',
  'Bash(*.claude/projects*)',
] as const;

export function orchestratorMcpToolAllowList(): string[] {
  return mcpTools.map((tool) => `mcp__${CLAUDE_MCP_SERVER_NAME}__${tool.name}`).sort();
}

export function claudeOrchestratorMcpToolAllowList(): string[] {
  const denied = new Set(claudeOrchestratorMcpToolDenyList());
  return orchestratorMcpToolAllowList().filter((name) => !denied.has(name));
}

export function claudeOrchestratorMcpToolDenyList(): string[] {
  return CLAUDE_SUPERVISOR_DENIED_MCP_TOOL_NAMES
    .map((name) => `mcp__${CLAUDE_MCP_SERVER_NAME}__${name}`)
    .sort();
}

export function buildClaudeAllowedToolsList(): string[] {
  return [
    'Read',
    'Glob',
    'Grep',
    ...claudeOrchestratorMcpToolAllowList(),
  ];
}

export function buildClaudeSupervisorSettings(): ClaudeSupervisorSettings {
  const allow = buildClaudeAllowedToolsList();
  // Defense-in-depth deny entries: write/exfil tools and shell-inspection
  // fallbacks remain explicitly denied even though the built-in tool list and
  // `--allowed-tools` already exclude them.
  const deny = [
    'Edit',
    'Write',
    'WebFetch',
    'WebSearch',
    'Task',
    'NotebookEdit',
    'TodoWrite',
    ...CLAUDE_SUPERVISOR_DENIED_BASH_PATTERNS,
    ...claudeOrchestratorMcpToolDenyList(),
  ];
  return {
    permissions: {
      defaultMode: 'dontAsk',
      allow,
      deny,
    },
    enableAllProjectMcpServers: false,
    hooks: {},
    enabledPlugins: {},
  };
}

export function stringifyClaudeSupervisorSettings(settings: ClaudeSupervisorSettings): string {
  return `${JSON.stringify(settings, null, 2)}\n`;
}
