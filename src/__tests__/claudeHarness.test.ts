import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tools as mcpTools } from '../mcpTools.js';
import {
  buildClaudeSupervisorSettings,
  CLAUDE_MCP_SERVER_NAME,
  claudeOrchestratorMcpToolAllowList,
  claudeOrchestratorMcpToolDenyList,
  orchestratorMcpToolAllowList,
  stringifyClaudeSupervisorSettings,
} from '../claude/permission.js';
import { resolveMonitorPin } from '../claude/monitorPin.js';
import { validateClaudePassthroughArgs } from '../claude/passthrough.js';
import { curateOrchestrateSkills, listOrchestrationSkills } from '../claude/skills.js';
import {
  buildClaudeHarnessConfig,
  stringifyClaudeMcpConfig,
} from '../claude/config.js';
import { buildClaudeEnvelope, buildClaudeSpawnArgs, parseClaudeLauncherArgs } from '../claude/launcher.js';
import { createWorkerCapabilityCatalog } from '../harness/capabilities.js';

describe('Claude harness permission and allowlist', () => {
  it('orchestratorMcpToolAllowList matches every registered MCP tool exactly', () => {
    const expected = mcpTools.map((tool) => `mcp__${CLAUDE_MCP_SERVER_NAME}__${tool.name}`).sort();
    assert.deepStrictEqual(orchestratorMcpToolAllowList(), expected);
  });

  it('claudeOrchestratorMcpToolAllowList excludes MCP blocking wait tools', () => {
    assert.ok(!claudeOrchestratorMcpToolAllowList().includes(`mcp__${CLAUDE_MCP_SERVER_NAME}__wait_for_any_run`));
    assert.ok(!claudeOrchestratorMcpToolAllowList().includes(`mcp__${CLAUDE_MCP_SERVER_NAME}__wait_for_run`));
    assert.deepStrictEqual(claudeOrchestratorMcpToolDenyList(), [
      `mcp__${CLAUDE_MCP_SERVER_NAME}__wait_for_any_run`,
      `mcp__${CLAUDE_MCP_SERVER_NAME}__wait_for_run`,
    ]);
  });

  it('builds settings that allow Read/Glob/Grep + the pinned Bash monitor + agent-orchestrator MCP tools, denying other write/exfil tools', () => {
    const monitorPin = resolveMonitorPin({ AGENT_ORCHESTRATOR_BIN: '/abs/agent-orchestrator' });
    const settings = buildClaudeSupervisorSettings({
      monitorBashAllowlistPattern: monitorPin.bash_allowlist_pattern,
    });
    assert.deepStrictEqual(
      [...settings.permissions.allow].sort(),
      ['Glob', 'Grep', 'Read', `Bash(${monitorPin.bash_allowlist_pattern})`, ...claudeOrchestratorMcpToolAllowList()].sort(),
    );
    assert.equal(settings.permissions.defaultMode, 'dontAsk');
    for (const denied of ['Edit', 'Write', 'WebFetch', 'WebSearch', 'Task', 'NotebookEdit', 'TodoWrite']) {
      assert.ok(settings.permissions.deny.includes(denied), `${denied} must be denied`);
    }
    assert.equal(
      settings.permissions.deny.includes('Bash'),
      false,
      'bare Bash deny would shadow the narrower Bash(<monitor>) allow rule',
    );
    assert.ok(settings.permissions.deny.includes('Bash(jq *)'));
    assert.ok(settings.permissions.deny.includes('Bash(*tool-results*)'));
    assert.ok(settings.permissions.deny.includes('Bash(*.claude/projects*)'));
    assert.ok(settings.permissions.deny.includes(`mcp__${CLAUDE_MCP_SERVER_NAME}__wait_for_any_run`));
    assert.ok(settings.permissions.deny.includes(`mcp__${CLAUDE_MCP_SERVER_NAME}__wait_for_run`));
    assert.equal(settings.enableAllProjectMcpServers, false);
    const json = stringifyClaudeSupervisorSettings(settings);
    JSON.parse(json);
  });
});

describe('Claude monitor pin', () => {
  it('uses the AGENT_ORCHESTRATOR_BIN override when absolute and exposes a canonical command prefix', () => {
    const pin = resolveMonitorPin({ AGENT_ORCHESTRATOR_BIN: '/opt/agent-orchestrator' });
    assert.equal(pin.bin, '/opt/agent-orchestrator');
    assert.equal(pin.command_prefix_string, `${process.execPath} /opt/agent-orchestrator`);
    assert.equal(pin.bash_allowlist_pattern, `${process.execPath} /opt/agent-orchestrator monitor *`);
    assert.deepStrictEqual(pin.command_prefix, [process.execPath, '/opt/agent-orchestrator']);
  });

  it('falls back to the package CLI script when the env override is missing or relative', () => {
    const pin = resolveMonitorPin({ AGENT_ORCHESTRATOR_BIN: 'relative-path' });
    assert.match(pin.bin, /[/\\]dist[/\\]cli\.js$/);
    assert.equal(pin.nodePath, process.execPath);
  });
});

describe('Claude passthrough hardening', () => {
  it('rejects forbidden harness-owned flags', () => {
    for (const flag of [
      '--dangerously-skip-permissions',
      '--mcp-config',
      '--strict-mcp-config',
      '--allowed-tools',
      '--disallowed-tools',
      '--add-dir',
      '--settings',
      '--setting-sources',
      '--system-prompt',
      '--append-system-prompt',
      '--plugin-dir',
      '--agents',
      '--agent',
      '--permission-mode',
      '--tools',
      '--disable-slash-commands',
      // --bare disables skill / CLAUDE.md / plugin / MCP auto-discovery,
      // which would hide the curated <envelope>/.claude/skills/orchestrate-*
      // surface the supervisor depends on. Forbidden for the same reason as
      // --disable-slash-commands.
      '--bare',
    ]) {
      const result = validateClaudePassthroughArgs([flag]);
      assert.equal(result.ok, false, `expected ${flag} to be rejected`);
    }
  });

  it('accepts allowed read-only Claude flags', () => {
    const result = validateClaudePassthroughArgs(['--print', '--output-format', 'stream-json', '--verbose', '--no-session-persistence']);
    assert.equal(result.ok, true);
  });

  it('rejects unknown flags', () => {
    assert.equal(validateClaudePassthroughArgs(['--invented-flag']).ok, false);
  });
});

describe('Claude skill curation', () => {
  it('lists and copies orchestrate-* skills into an ephemeral root, ignoring non-orchestrate skills', async () => {
    const sourceRoot = await mkdtemp(join(tmpdir(), 'agent-claude-skills-'));
    await mkdir(join(sourceRoot, 'orchestrate-implement-plan'), { recursive: true });
    await writeFile(join(sourceRoot, 'orchestrate-implement-plan', 'SKILL.md'), '---\nname: orchestrate-implement-plan\n---\nbody');
    await mkdir(join(sourceRoot, 'review'), { recursive: true });
    await writeFile(join(sourceRoot, 'review', 'SKILL.md'), '---\nname: review\n---\nbody');
    await mkdir(join(sourceRoot, 'orchestrate-create-plan'), { recursive: true });
    await writeFile(join(sourceRoot, 'orchestrate-create-plan', 'SKILL.md'), '---\nname: orchestrate-create-plan\n---\nbody');

    const listed = await listOrchestrationSkills(sourceRoot);
    assert.deepStrictEqual(listed, ['orchestrate-create-plan', 'orchestrate-implement-plan']);

    const ephemeral = await mkdtemp(join(tmpdir(), 'agent-claude-skills-out-'));
    const result = await curateOrchestrateSkills({ sourceSkillRoot: sourceRoot, ephemeralSkillRoot: ephemeral });
    assert.deepStrictEqual(result.orchestrationSkillNames, ['orchestrate-create-plan', 'orchestrate-implement-plan']);
    const body = await readFile(join(ephemeral, 'orchestrate-implement-plan', 'SKILL.md'), 'utf8');
    assert.match(body, /orchestrate-implement-plan/);
    await assert.rejects(() => readFile(join(ephemeral, 'review', 'SKILL.md'), 'utf8'));
  });
});

describe('Claude harness config builder', () => {
  it('builds a system prompt that uses pinned Bash monitors as the only blocking wait and lists curated orchestrate-* skill names', () => {
    const monitorPin = resolveMonitorPin({ AGENT_ORCHESTRATOR_BIN: '/opt/agent-orchestrator' });
    const catalog = createWorkerCapabilityCatalog(null);
    const config = buildClaudeHarnessConfig({
      targetCwd: '/tmp/work',
      manifestPath: '/tmp/work/profiles.json',
      ephemeralSkillRoot: '/tmp/skills',
      orchestrationSkillNames: ['orchestrate-create-plan', 'orchestrate-implement-plan'],
      catalog,
      profileDiagnostics: [],
      mcpCliPath: '/opt/agent-orchestrator/dist/cli.js',
      monitorPin,
    });
    assert.match(config.systemPrompt, /agent-orchestrator/);
    assert.match(config.systemPrompt, /orchestrate-create-plan/);
    assert.match(config.systemPrompt, /persistent agent-orchestrator daemon owns worker subprocesses/);
    assert.match(config.systemPrompt, /runs continue in the daemon after the supervisor returns control/);
    assert.match(config.systemPrompt, /durable notification records are authoritative/);
    assert.match(config.systemPrompt, /Bash is allowed only for the pinned monitor command pattern/);
    assert.match(config.systemPrompt, /\/opt\/agent-orchestrator monitor <run_id> --json-line/);
    assert.match(config.systemPrompt, /Bash run_in_background: true/);
    assert.match(config.systemPrompt, /For each active run, use exactly one active wait mechanism at a time/);
    assert.match(config.systemPrompt, /Progress and status checks/);
    assert.match(config.systemPrompt, /mcp__agent-orchestrator__get_run_progress first/);
    assert.match(config.systemPrompt, /Never use Bash, jq, cat, head, tail, grep, rg, sed, awk, or Claude Code tool-result files/);
    assert.match(config.systemPrompt, /Do not inspect Claude Code internal files under \.claude\/projects or tool-results/);
    assert.match(config.systemPrompt, /While a Bash monitor is active for a run, do not call any MCP blocking wait tool/);
    assert.match(config.systemPrompt, /If you inherit active run_ids without live monitor handles.*launch a new pinned Bash monitor/s);
    assert.match(config.systemPrompt, /Do not call wait_for_any_run or wait_for_run in the Claude supervisor/);
    assert.doesNotMatch(config.systemPrompt, /^- mcp__agent-orchestrator__wait_for_any_run$/m);
    assert.doesNotMatch(config.systemPrompt, /^- mcp__agent-orchestrator__wait_for_run$/m);
    assert.match(config.systemPrompt, /Cross-turn reconciliation/);
    assert.deepStrictEqual(Object.keys(config.mcpConfig.mcpServers), [CLAUDE_MCP_SERVER_NAME]);
    const mcpJson = stringifyClaudeMcpConfig(config.mcpConfig);
    JSON.parse(mcpJson);
  });
});

describe('Claude launcher envelope', () => {
  it('builds an isolated envelope: --strict-mcp-config + pinned Bash monitor allowlist, no --add-dir, no --dangerously-skip-permissions, no --disable-slash-commands', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'agent-claude-launch-'));
    const skillsPath = join(cwd, '.agents', 'skills');
    await mkdir(join(skillsPath, 'orchestrate-foo'), { recursive: true });
    await writeFile(join(skillsPath, 'orchestrate-foo', 'SKILL.md'), '---\nname: orchestrate-foo\n---\nbody');
    const profilesPath = join(cwd, 'profiles.json');
    await writeFile(profilesPath, JSON.stringify({ version: 1, profiles: { 'p1': { backend: 'claude', model: 'claude-opus-4-7' } } }));
    const stateDir = join(cwd, 'claude-state');
    await mkdir(join(stateDir, 'claude-config'), { recursive: true });
    await writeFile(join(stateDir, 'claude-config', '.credentials.json'), '{"legacy":true}\n');

    const parsed = parseClaudeLauncherArgs(
      ['--cwd', cwd, '--profiles-file', profilesPath, '--skills', skillsPath, '--state-dir', stateDir],
      { AGENT_ORCHESTRATOR_BIN: '/opt/agent-orchestrator' },
      cwd,
    );
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const built = await buildClaudeEnvelope({
      options: parsed.value,
      env: { AGENT_ORCHESTRATOR_BIN: '/opt/agent-orchestrator' },
      catalog: createWorkerCapabilityCatalog(null),
      profilesResult: { profiles: undefined, diagnostics: [] },
    });
    try {
      const settings = JSON.parse(built.settingsContent);
      assert.equal(settings.enableAllProjectMcpServers, false);
      assert.ok(Array.isArray(settings.permissions.allow));
      assert.equal(settings.permissions.defaultMode, 'dontAsk');
      assert.ok(settings.permissions.allow.includes(`Bash(${process.execPath} /opt/agent-orchestrator monitor *)`));
      assert.equal(settings.permissions.deny.includes('Bash'), false, 'bare Bash deny would shadow the pinned monitor allow rule');
      assert.ok(settings.permissions.deny.includes('Bash(jq *)'));
      assert.ok(settings.permissions.deny.includes('Bash(*tool-results*)'));
      const mcp = JSON.parse(built.mcpConfigContent);
      assert.deepStrictEqual(Object.keys(mcp.mcpServers), [CLAUDE_MCP_SERVER_NAME]);
      assert.ok(built.spawnArgs.includes('--strict-mcp-config'), 'spawn args must include --strict-mcp-config');
      assert.ok(!built.spawnArgs.includes('--dangerously-skip-permissions'), 'spawn args must never include --dangerously-skip-permissions');
      assert.ok(!built.spawnArgs.includes('--disable-slash-commands'), 'spawn args must not include --disable-slash-commands (would also disable orchestrate-* skills)');
      assert.ok(!built.spawnArgs.includes('--add-dir'), 'spawn args must NOT include --add-dir: Claude scans add-dir paths for project skills/commands/agents/hooks/CLAUDE.md, which would re-introduce target workspace .claude/* leakage');
      assert.ok(built.spawnArgs.includes('--tools'), 'spawn args must restrict built-in tool availability via --tools');
      const toolsValue = built.spawnArgs[built.spawnArgs.indexOf('--tools') + 1] ?? '';
      assert.equal(toolsValue, 'Read,Glob,Grep,Bash', '--tools must contain only Read,Glob,Grep,Bash');
      assert.ok(built.spawnArgs.includes('--allowed-tools'), 'spawn args must pre-approve the pinned Bash monitor and safe MCP tools');
      const allowedTools = built.spawnArgs[built.spawnArgs.indexOf('--allowed-tools') + 1] ?? '';
      assert.match(allowedTools, /Read/);
      assert.match(allowedTools, /Bash\(.*\/opt\/agent-orchestrator monitor \*\)/);
      assert.match(allowedTools, /mcp__agent-orchestrator__start_run/);
      assert.doesNotMatch(allowedTools, /mcp__agent-orchestrator__wait_for_any_run/);
      assert.doesNotMatch(allowedTools, /mcp__agent-orchestrator__wait_for_run/);
      assert.ok(built.spawnArgs.includes('--permission-mode'), 'spawn args must set dontAsk so non-allowlisted Bash does not prompt');
      assert.equal(built.spawnArgs[built.spawnArgs.indexOf('--permission-mode') + 1], 'dontAsk');
      assert.equal(built.stateDir, stateDir);
      assert.equal(built.spawnEnv.HOME, join(stateDir, 'home'));
      assert.equal(built.spawnEnv.XDG_CONFIG_HOME, join(stateDir, 'home', '.config'));
      assert.equal(built.spawnEnv.CLAUDE_CONFIG_DIR, join(stateDir, 'home', '.claude'));
      assert.equal(built.spawnEnv.NO_COLOR, undefined, 'interactive Claude supervisor must not force-disable terminal colors');
      assert.equal(built.spawnEnv.AGENT_ORCHESTRATOR_HOME, process.env.AGENT_ORCHESTRATOR_HOME ?? join(process.env.HOME ?? '', '.agent-orchestrator'));
      assert.notEqual(built.spawnEnv.HOME, join(built.envelopeDir, 'home'), 'Claude auth state must not be tied to the workspace envelope');
      assert.ok(built.envelopeDir.startsWith(join(stateDir, 'envelopes')), 'supervisor cwd must be stable under the durable state dir, not a random temp dir');
      assert.deepStrictEqual(
        JSON.parse(await readFile(join(stateDir, 'home', '.claude', '.credentials.json'), 'utf8')),
        { legacy: true },
        'legacy durable credentials must migrate into HOME/.claude, which Claude auth actually reads',
      );
      // Skill curation: orchestrate-* lives at <envelope>/.claude/skills/<name>/SKILL.md so
      // Claude's cwd-rooted skill discovery can find them when the spawn cwd = envelopeDir.
      assert.equal(built.skillsRoot, join(built.envelopeDir, '.claude', 'skills'));
      const curated = await readFile(join(built.skillsRoot, 'orchestrate-foo', 'SKILL.md'), 'utf8');
      assert.match(curated, /orchestrate-foo/);

      await mkdir(join(built.envelopeDir, '.claude', 'commands'), { recursive: true });
      await writeFile(join(built.envelopeDir, '.claude', 'commands', 'stale.md'), 'stale command');
      await writeFile(join(built.envelopeDir, '.mcp.json'), '{"mcpServers":{"stale":{"command":"evil"}}}');
      await writeFile(join(built.envelopeDir, 'CLAUDE.md'), 'stale project memory');
      const rebuilt = await buildClaudeEnvelope({
        options: parsed.value,
        env: { AGENT_ORCHESTRATOR_BIN: '/opt/agent-orchestrator' },
        catalog: createWorkerCapabilityCatalog(null),
        profilesResult: { profiles: undefined, diagnostics: [] },
      });
      try {
        assert.equal(rebuilt.envelopeDir, built.envelopeDir, 'same target workspace must reuse the same isolated supervisor cwd');
        await assert.rejects(() => readFile(join(rebuilt.envelopeDir, '.claude', 'commands', 'stale.md'), 'utf8'));
        await assert.rejects(() => readFile(join(rebuilt.envelopeDir, '.mcp.json'), 'utf8'));
        await assert.rejects(() => readFile(join(rebuilt.envelopeDir, 'CLAUDE.md'), 'utf8'));
        assert.match(await readFile(join(rebuilt.skillsRoot, 'orchestrate-foo', 'SKILL.md'), 'utf8'), /orchestrate-foo/);
      } finally {
        await rebuilt.cleanup();
      }
    } finally {
      await built.cleanup();
    }
    assert.equal((await stat(built.envelopeDir)).isDirectory(), true, 'stable supervisor cwd must survive cleanup so Claude trust and session history stay reusable');
    assert.equal((await stat(stateDir)).isDirectory(), true, 'durable Claude state must survive envelope cleanup so login persists');
  });

  it('buildClaudeSpawnArgs sets the canonical isolation flags, pinned monitor pre-approval, and deny-by-default mode', () => {
    const args = buildClaudeSpawnArgs({
      settingsPath: '/x/settings.json',
      mcpConfigPath: '/x/mcp.json',
      systemPromptPath: '/x/system.md',
      builtinTools: ['Read', 'Glob', 'Grep', 'Bash'],
      allowedTools: ['Read', 'Glob', 'Grep', 'Bash(node /abs/cli.js monitor *)', 'mcp__agent-orchestrator__start_run'],
      passthrough: ['--print', '--output-format', 'json'],
    });
    assert.ok(args.includes('--strict-mcp-config'));
    assert.ok(args.includes('--mcp-config'));
    assert.ok(args.includes('--settings'));
    assert.ok(args.includes('--setting-sources'));
    assert.equal(args[args.indexOf('--setting-sources') + 1], '');
    assert.ok(args.includes('--append-system-prompt-file'));
    assert.ok(args.includes('--tools'));
    assert.equal(args[args.indexOf('--tools') + 1], 'Read,Glob,Grep,Bash');
    assert.ok(args.includes('--allowed-tools'));
    assert.match(args[args.indexOf('--allowed-tools') + 1] ?? '', /Bash\(node \/abs\/cli\.js monitor \*\)/);
    assert.ok(args.includes('--permission-mode'));
    assert.equal(args[args.indexOf('--permission-mode') + 1], 'dontAsk');
    assert.ok(!args.includes('--dangerously-skip-permissions'));
    assert.ok(!args.includes('--disable-slash-commands'), '--disable-slash-commands would also disable skills; harness must not set it');
    assert.ok(!args.includes('--add-dir'), '--add-dir would scan target workspace for project skills/commands/agents/hooks; harness must not set it');
    assert.deepStrictEqual(args.slice(-3), ['--print', '--output-format', 'json'], 'passthrough args appended last');
  });
});

describe('Claude launcher leak-proof tests', () => {
  it('does not load poisoned project-level .claude/* or .mcp.json from the target workspace and exposes only orchestrate-* skills', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'agent-claude-leak-'));
    await writeFile(join(cwd, '.mcp.json'), JSON.stringify({ mcpServers: { evil: { command: 'evil' } } }));
    await mkdir(join(cwd, '.claude'), { recursive: true });
    await writeFile(join(cwd, '.claude', 'settings.json'), JSON.stringify({ permissions: { allow: ['*'] } }));
    await mkdir(join(cwd, '.claude', 'skills', 'evil-skill'), { recursive: true });
    await writeFile(join(cwd, '.claude', 'skills', 'evil-skill', 'SKILL.md'), '---\nname: evil\n---\n');
    await mkdir(join(cwd, '.claude', 'commands'), { recursive: true });
    await writeFile(join(cwd, '.claude', 'commands', 'evil.md'), 'evil');
    await mkdir(join(cwd, '.claude', 'agents'), { recursive: true });
    await writeFile(join(cwd, '.claude', 'agents', 'evil-agent.md'), 'evil');
    await mkdir(join(cwd, '.claude', 'hooks'), { recursive: true });
    await writeFile(join(cwd, '.claude', 'hooks', 'evil.sh'), '#!/bin/sh\n');
    const skillsPath = join(cwd, '.agents', 'skills');
    await mkdir(join(skillsPath, 'orchestrate-good'), { recursive: true });
    await writeFile(join(skillsPath, 'orchestrate-good', 'SKILL.md'), '---\nname: orchestrate-good\n---\n');
    // Pre-existing non-orchestrate skill in the same source root must not leak.
    await mkdir(join(skillsPath, 'review'), { recursive: true });
    await writeFile(join(skillsPath, 'review', 'SKILL.md'), '---\nname: review\n---\n');
    const stateDir = join(cwd, 'claude-state');

    const parsed = parseClaudeLauncherArgs(['--cwd', cwd, '--skills', skillsPath, '--state-dir', stateDir], {}, cwd);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const built = await buildClaudeEnvelope({
      options: parsed.value,
      env: {},
      catalog: createWorkerCapabilityCatalog(null),
      profilesResult: { profiles: undefined, diagnostics: [] },
    });
    try {
      // MCP server allowlist is exactly the agent-orchestrator server.
      const mcp = JSON.parse(built.mcpConfigContent);
      assert.deepStrictEqual(Object.keys(mcp.mcpServers), [CLAUDE_MCP_SERVER_NAME]);
      assert.ok(!('evil' in mcp.mcpServers));
      const settings = JSON.parse(built.settingsContent);
      assert.equal(settings.enableAllProjectMcpServers, false);
      // Setting sources is empty so user/project/local settings.json files are not loaded.
      assert.ok(built.spawnArgs.includes('--setting-sources'));
      const settingSourcesValue = built.spawnArgs[built.spawnArgs.indexOf('--setting-sources') + 1];
      assert.equal(settingSourcesValue, '');
      // Curated skills root contains orchestrate-good only.
      const curated = await readFile(join(built.skillsRoot, 'orchestrate-good', 'SKILL.md'), 'utf8');
      assert.match(curated, /orchestrate-good/);
      await assert.rejects(() => readFile(join(built.skillsRoot, 'evil-skill', 'SKILL.md'), 'utf8'));
      await assert.rejects(() => readFile(join(built.skillsRoot, 'review', 'SKILL.md'), 'utf8'));
      // The envelope's .claude/ contains only the curated skills directory; no commands, agents, or hooks.
      const projectClaude = join(built.envelopeDir, '.claude');
      const entries = (await readFile(join(projectClaude, 'skills', 'orchestrate-good', 'SKILL.md'), 'utf8'));
      assert.match(entries, /orchestrate-good/);
      await assert.rejects(() => readFile(join(projectClaude, 'commands', 'evil.md'), 'utf8'));
      await assert.rejects(() => readFile(join(projectClaude, 'agents', 'evil-agent.md'), 'utf8'));
      await assert.rejects(() => readFile(join(projectClaude, 'hooks', 'evil.sh'), 'utf8'));
      await assert.rejects(() => readFile(join(projectClaude, 'settings.json'), 'utf8'));
      await assert.rejects(() => readFile(join(built.envelopeDir, '.mcp.json'), 'utf8'));
      // No --add-dir: Claude Code scans add-dir paths for project .claude/skills,
      // .claude/commands, .claude/agents, .claude/hooks and CLAUDE.md, so passing
      // --add-dir <target> would re-introduce the leak this test is guarding
      // against. The supervisor reads the target workspace only indirectly, by
      // dispatching worker runs with cwd = target via mcp__agent-orchestrator__start_run.
      assert.ok(!built.spawnArgs.includes('--add-dir'), 'harness must not pass --add-dir; would leak target .claude/* into discovery');
      // --tools restricts built-in availability to read-only tools plus Bash
      // for the pinned monitor. --allowed-tools pre-approves only that Bash
      // pattern and safe orchestrator MCP tools, while dontAsk denies anything
      // else instead of prompting.
      assert.equal(built.spawnArgs[built.spawnArgs.indexOf('--tools') + 1], 'Read,Glob,Grep,Bash');
      assert.ok(built.spawnArgs.includes('--allowed-tools'));
      assert.match(built.spawnArgs[built.spawnArgs.indexOf('--allowed-tools') + 1] ?? '', /Bash\(.* monitor \*\)/);
      assert.doesNotMatch(built.spawnArgs[built.spawnArgs.indexOf('--allowed-tools') + 1] ?? '', /mcp__agent-orchestrator__wait_for_any_run/);
      assert.doesNotMatch(built.spawnArgs[built.spawnArgs.indexOf('--allowed-tools') + 1] ?? '', /mcp__agent-orchestrator__wait_for_run/);
      assert.equal(built.spawnArgs[built.spawnArgs.indexOf('--permission-mode') + 1], 'dontAsk');
      assert.equal(settings.permissions.deny.includes('Bash'), false, 'bare Bash deny would shadow the pinned monitor allow rule');
      // HOME, XDG_CONFIG_HOME, CLAUDE_CONFIG_DIR are redirected to durable
      // orchestrator-owned state, not the user's normal home or the stable
      // workspace envelope.
      assert.notEqual(built.spawnEnv.HOME, process.env.HOME);
      assert.equal(built.spawnEnv.HOME, join(stateDir, 'home'));
      assert.equal(built.spawnEnv.CLAUDE_CONFIG_DIR, join(stateDir, 'home', '.claude'));
      assert.equal(built.spawnEnv.NO_COLOR, undefined, 'interactive Claude supervisor must inherit terminal color behavior');
      assert.notEqual(built.spawnEnv.HOME, join(built.envelopeDir, 'home'), 'Claude auth state must live outside the stable workspace envelope');
      // System prompt teaches the supervisor to launch the pinned monitor as
      // the only blocking wait path.
      const promptText = built.systemPrompt;
      assert.match(promptText, /Bash run_in_background: true/);
      assert.match(promptText, /monitor <run_id> --json-line/);
      assert.match(promptText, /For each active run, use exactly one active wait mechanism at a time/);
      assert.match(promptText, /mcp__agent-orchestrator__get_run_progress first/);
      assert.match(promptText, /Never use Bash, jq, cat, head, tail, grep, rg, sed, awk, or Claude Code tool-result files/);
      assert.match(promptText, /While a Bash monitor is active for a run, do not call any MCP blocking wait tool/);
      assert.match(promptText, /If you inherit active run_ids without live monitor handles.*launch a new pinned Bash monitor/s);
      assert.match(promptText, /Do not call wait_for_any_run or wait_for_run in the Claude supervisor/);
      assert.doesNotMatch(promptText, /^- mcp__agent-orchestrator__wait_for_any_run$/m);
      assert.doesNotMatch(promptText, /^- mcp__agent-orchestrator__wait_for_run$/m);
    } finally {
      await built.cleanup();
    }
    assert.equal((await stat(stateDir)).isDirectory(), true, 'durable Claude state must survive envelope cleanup');
  });
});
