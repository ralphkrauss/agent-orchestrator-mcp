import { tools as mcpTools } from '../mcpTools.js';

export const CLAUDE_MCP_SERVER_NAME = 'agent-orchestrator';

/**
 * Built-in Claude Code tools available to the supervisor. Bash is included so
 * the supervisor can launch the pinned daemon monitor as a background task; the
 * launcher pre-approves only `Bash(<agent-orchestrator> monitor *)`.
 */
export const CLAUDE_SUPERVISOR_BUILTIN_TOOLS = ['Read', 'Glob', 'Grep', 'Bash'] as const;

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

export interface ClaudeSupervisorPermissionInput {
  monitorBashAllowlistPattern: string;
}

const CLAUDE_SUPERVISOR_DENIED_MCP_TOOL_NAMES = ['wait_for_any_run', 'wait_for_run'] as const;
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

export function buildClaudeAllowedToolsList(input: ClaudeSupervisorPermissionInput): string[] {
  return [
    'Read',
    'Glob',
    'Grep',
    `Bash(${input.monitorBashAllowlistPattern})`,
    ...claudeOrchestratorMcpToolAllowList(),
  ];
}

export function buildClaudeSupervisorSettings(input: ClaudeSupervisorPermissionInput): ClaudeSupervisorSettings {
  const allow = buildClaudeAllowedToolsList(input);
  // Do not deny bare Bash here: Claude Code deny rules shadow narrower
  // `Bash(...)` allow rules. The launcher constrains Bash through `--tools`,
  // `--allowed-tools`, and `--permission-mode dontAsk`, while these explicit
  // deny entries provide defense in depth for write/exfil tools and common
  // shell-inspection fallbacks that should use MCP tools instead.
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
