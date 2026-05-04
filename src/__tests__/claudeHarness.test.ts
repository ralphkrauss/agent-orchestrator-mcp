import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tools as mcpTools } from '../mcpTools.js';
import {
  buildClaudeAllowedToolsList,
  buildClaudeSupervisorSettings,
  CLAUDE_MCP_SERVER_NAME,
  CLAUDE_SUPERVISOR_BUILTIN_TOOLS,
  claudeOrchestratorMcpToolAllowList,
  claudeOrchestratorMcpToolDenyList,
  orchestratorMcpToolAllowList,
  stringifyClaudeSupervisorSettings,
} from '../claude/permission.js';
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

  it('built-in tool surface excludes Bash entirely', () => {
    assert.deepStrictEqual([...CLAUDE_SUPERVISOR_BUILTIN_TOOLS], ['Read', 'Glob', 'Grep']);
    for (const entry of buildClaudeAllowedToolsList()) {
      assert.ok(!entry.startsWith('Bash'), `--allowed-tools must not contain a Bash entry, got ${entry}`);
    }
  });

  it('claudeOrchestratorMcpToolDenyList denies only wait_for_run; wait_for_any_run and list_run_notifications are now allowlisted', () => {
    assert.deepStrictEqual(claudeOrchestratorMcpToolDenyList(), [
      `mcp__${CLAUDE_MCP_SERVER_NAME}__wait_for_run`,
    ]);
    const allow = claudeOrchestratorMcpToolAllowList();
    assert.ok(allow.includes(`mcp__${CLAUDE_MCP_SERVER_NAME}__wait_for_any_run`));
    assert.ok(allow.includes(`mcp__${CLAUDE_MCP_SERVER_NAME}__list_run_notifications`));
    assert.ok(!allow.includes(`mcp__${CLAUDE_MCP_SERVER_NAME}__wait_for_run`));
  });

  it('builds settings that allow Read/Glob/Grep + agent-orchestrator MCP tools, denying other write/exfil tools', () => {
    const settings = buildClaudeSupervisorSettings();
    assert.deepStrictEqual(
      [...settings.permissions.allow].sort(),
      ['Glob', 'Grep', 'Read', ...claudeOrchestratorMcpToolAllowList()].sort(),
    );
    assert.equal(settings.permissions.defaultMode, 'dontAsk');
    for (const denied of ['Edit', 'Write', 'WebFetch', 'WebSearch', 'Task', 'NotebookEdit', 'TodoWrite']) {
      assert.ok(settings.permissions.deny.includes(denied), `${denied} must be denied`);
    }
    assert.ok(settings.permissions.deny.includes(`mcp__${CLAUDE_MCP_SERVER_NAME}__wait_for_run`));
    assert.equal(settings.enableAllProjectMcpServers, false);
    const json = stringifyClaudeSupervisorSettings(settings);
    JSON.parse(json);
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

  it('rejects --debug-file in both space and equals forms (would let Claude write outside the harness state dir)', () => {
    assert.equal(validateClaudePassthroughArgs(['--debug-file', '/tmp/x.log']).ok, false);
    assert.equal(validateClaudePassthroughArgs(['--debug-file=/tmp/x.log']).ok, false);
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

  it('skips and does not copy SKILL.md entries that are symlinks (defends against host-file exfiltration through symlinked SKILL.md)', async () => {
    const sourceRoot = await mkdtemp(join(tmpdir(), 'agent-claude-skills-symlink-'));
    // Real legitimate skill
    await mkdir(join(sourceRoot, 'orchestrate-good'), { recursive: true });
    await writeFile(join(sourceRoot, 'orchestrate-good', 'SKILL.md'), '---\nname: orchestrate-good\n---\n');
    // Decoy file outside of the source root that should never be copied
    const sensitiveFile = join(sourceRoot, '..', 'sensitive.txt');
    await writeFile(sensitiveFile, 'do-not-copy');
    // Skill that uses a SKILL.md symlink pointing at sensitive content
    await mkdir(join(sourceRoot, 'orchestrate-evil'), { recursive: true });
    await symlink(sensitiveFile, join(sourceRoot, 'orchestrate-evil', 'SKILL.md'));

    const listed = await listOrchestrationSkills(sourceRoot);
    assert.deepStrictEqual(listed, ['orchestrate-good'], 'symlinked SKILL.md must not be listed');

    const ephemeral = await mkdtemp(join(tmpdir(), 'agent-claude-skills-symlink-out-'));
    const result = await curateOrchestrateSkills({ sourceSkillRoot: sourceRoot, ephemeralSkillRoot: ephemeral });
    assert.deepStrictEqual(result.orchestrationSkillNames, ['orchestrate-good']);
    await assert.rejects(() => readFile(join(ephemeral, 'orchestrate-evil', 'SKILL.md'), 'utf8'));
  });
});

describe('Claude harness config builder', () => {
  it('builds a system prompt that uses MCP wait_for_any_run as the primary wake path and excludes Bash entirely', () => {
    const catalog = createWorkerCapabilityCatalog(null);
    const config = buildClaudeHarnessConfig({
      targetCwd: '/tmp/work',
      manifestPath: '/tmp/work/profiles.json',
      ephemeralSkillRoot: '/tmp/skills',
      orchestrationSkillNames: ['orchestrate-create-plan', 'orchestrate-implement-plan'],
      catalog,
      profileDiagnostics: [],
      mcpCliPath: '/opt/agent-orchestrator/dist/cli.js',
    });
    assert.match(config.systemPrompt, /agent-orchestrator/);
    assert.match(config.systemPrompt, /orchestrate-create-plan/);
    assert.match(config.systemPrompt, /persistent agent-orchestrator daemon owns worker subprocesses/);
    assert.match(config.systemPrompt, /runs continue in the daemon after the supervisor returns control/);
    assert.match(config.systemPrompt, /durable notification records are authoritative/);
    assert.match(config.systemPrompt, /Bash is not available in this envelope/);
    assert.match(config.systemPrompt, /mcp__agent-orchestrator__wait_for_any_run/);
    assert.match(config.systemPrompt, /mcp__agent-orchestrator__list_run_notifications/);
    assert.match(config.systemPrompt, /For each active run, use exactly one active wait mechanism at a time/);
    assert.match(config.systemPrompt, /Progress and status checks/);
    assert.match(config.systemPrompt, /mcp__agent-orchestrator__get_run_progress first/);
    assert.match(config.systemPrompt, /Do not inspect Claude Code internal files under \.claude\/projects or tool-results/);
    assert.match(config.systemPrompt, /Cross-turn reconciliation/);
    assert.doesNotMatch(config.systemPrompt, /pinned monitor/i);
    assert.doesNotMatch(config.systemPrompt, /run_in_background/);
    assert.deepStrictEqual(Object.keys(config.mcpConfig.mcpServers), [CLAUDE_MCP_SERVER_NAME]);
    const mcpJson = stringifyClaudeMcpConfig(config.mcpConfig);
    JSON.parse(mcpJson);
  });
});

describe('Claude launcher envelope', () => {
  it('builds an isolated envelope: --strict-mcp-config + MCP-only wake path, no Bash, no --add-dir, no --dangerously-skip-permissions, no --disable-slash-commands', async () => {
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
      {},
      cwd,
    );
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const built = await buildClaudeEnvelope({
      options: parsed.value,
      env: {},
      catalog: createWorkerCapabilityCatalog(null),
      profilesResult: { profiles: undefined, diagnostics: [] },
    });
    try {
      const settings = JSON.parse(built.settingsContent);
      assert.equal(settings.enableAllProjectMcpServers, false);
      assert.ok(Array.isArray(settings.permissions.allow));
      assert.equal(settings.permissions.defaultMode, 'dontAsk');
      for (const entry of settings.permissions.allow) {
        assert.ok(!String(entry).startsWith('Bash'), `settings.permissions.allow must not include any Bash entry, got ${entry}`);
      }
      const mcp = JSON.parse(built.mcpConfigContent);
      assert.deepStrictEqual(Object.keys(mcp.mcpServers), [CLAUDE_MCP_SERVER_NAME]);
      assert.ok(built.spawnArgs.includes('--strict-mcp-config'), 'spawn args must include --strict-mcp-config');
      assert.ok(!built.spawnArgs.includes('--dangerously-skip-permissions'));
      assert.ok(!built.spawnArgs.includes('--disable-slash-commands'));
      assert.ok(!built.spawnArgs.includes('--add-dir'));
      assert.ok(built.spawnArgs.includes('--tools'));
      const toolsValue = built.spawnArgs[built.spawnArgs.indexOf('--tools') + 1] ?? '';
      assert.equal(toolsValue, 'Read,Glob,Grep', '--tools must contain only Read,Glob,Grep (no Bash)');
      assert.ok(built.spawnArgs.includes('--allowed-tools'));
      const allowedTools = built.spawnArgs[built.spawnArgs.indexOf('--allowed-tools') + 1] ?? '';
      const allowedTokens = allowedTools.split(',');
      assert.ok(allowedTokens.includes('Read'));
      assert.ok(allowedTokens.includes('Glob'));
      assert.ok(allowedTokens.includes('Grep'));
      assert.ok(allowedTokens.includes('mcp__agent-orchestrator__start_run'));
      assert.ok(allowedTokens.includes('mcp__agent-orchestrator__wait_for_any_run'));
      assert.ok(allowedTokens.includes('mcp__agent-orchestrator__list_run_notifications'));
      for (const token of allowedTokens) {
        assert.ok(!token.startsWith('Bash'), `--allowed-tools must not contain a Bash entry, got ${token}`);
      }
      assert.ok(!allowedTokens.includes('mcp__agent-orchestrator__wait_for_run'));
      assert.ok(built.spawnArgs.includes('--permission-mode'));
      assert.equal(built.spawnArgs[built.spawnArgs.indexOf('--permission-mode') + 1], 'dontAsk');
      assert.equal(built.stateDir, stateDir);
      assert.equal(built.spawnEnv.HOME, join(stateDir, 'home'));
      assert.equal(built.spawnEnv.XDG_CONFIG_HOME, join(stateDir, 'home', '.config'));
      assert.equal(built.spawnEnv.CLAUDE_CONFIG_DIR, join(stateDir, 'home', '.claude'));
      assert.equal(built.spawnEnv.NO_COLOR, undefined);
      assert.equal(built.spawnEnv.AGENT_ORCHESTRATOR_HOME, process.env.AGENT_ORCHESTRATOR_HOME ?? join(process.env.HOME ?? '', '.agent-orchestrator'));
      assert.notEqual(built.spawnEnv.HOME, join(built.envelopeDir, 'home'));
      assert.ok(built.envelopeDir.startsWith(join(stateDir, 'envelopes')));
      assert.deepStrictEqual(
        JSON.parse(await readFile(join(stateDir, 'home', '.claude', '.credentials.json'), 'utf8')),
        { legacy: true },
      );
      assert.equal(built.skillsRoot, join(built.envelopeDir, '.claude', 'skills'));
      const curated = await readFile(join(built.skillsRoot, 'orchestrate-foo', 'SKILL.md'), 'utf8');
      assert.match(curated, /orchestrate-foo/);

      await mkdir(join(built.envelopeDir, '.claude', 'commands'), { recursive: true });
      await writeFile(join(built.envelopeDir, '.claude', 'commands', 'stale.md'), 'stale command');
      await writeFile(join(built.envelopeDir, '.mcp.json'), '{"mcpServers":{"stale":{"command":"evil"}}}');
      await writeFile(join(built.envelopeDir, 'CLAUDE.md'), 'stale project memory');
      const rebuilt = await buildClaudeEnvelope({
        options: parsed.value,
        env: {},
        catalog: createWorkerCapabilityCatalog(null),
        profilesResult: { profiles: undefined, diagnostics: [] },
      });
      try {
        assert.equal(rebuilt.envelopeDir, built.envelopeDir);
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
    assert.equal((await stat(built.envelopeDir)).isDirectory(), true);
    assert.equal((await stat(stateDir)).isDirectory(), true);
  });

  it('writes inline --profiles-json to <envelope>/profiles.json (0600) and points the supervisor manifest at it', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'agent-claude-inline-manifest-'));
    const skillsPath = join(cwd, '.agents', 'skills');
    await mkdir(join(skillsPath, 'orchestrate-foo'), { recursive: true });
    await writeFile(join(skillsPath, 'orchestrate-foo', 'SKILL.md'), '---\nname: orchestrate-foo\n---\nbody');
    const stateDir = join(cwd, 'claude-state');
    const profilesJson = '{"version":1,"profiles":{"p1":{"backend":"claude","model":"claude-opus-4-7"}}}';
    const parsed = parseClaudeLauncherArgs(
      ['--cwd', cwd, '--profiles-json', profilesJson, '--skills', skillsPath, '--state-dir', stateDir],
      {},
      cwd,
    );
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const built = await buildClaudeEnvelope({
      options: parsed.value,
      env: {},
      catalog: createWorkerCapabilityCatalog(null),
      profilesResult: { profiles: undefined, diagnostics: [] },
    });
    try {
      const inlineManifestPath = join(built.envelopeDir, 'profiles.json');
      const info = await stat(inlineManifestPath);
      assert.equal(info.isFile(), true);
      assert.equal(info.mode & 0o777, 0o600);
      const written = await readFile(inlineManifestPath, 'utf8');
      assert.equal(written, `${profilesJson}\n`);
      const manifestLine = built.systemPrompt.split('\n').find((line) => line.startsWith('Writable profiles manifest path:'));
      assert.ok(manifestLine, 'system prompt must include the manifest path line');
      assert.ok(manifestLine!.includes(inlineManifestPath), `manifest path must point at the inline file, got: ${manifestLine}`);
    } finally {
      await built.cleanup();
    }
  });

  it('buildClaudeSpawnArgs sets the canonical isolation flags, comma-joined --allowed-tools, and deny-by-default mode', () => {
    const args = buildClaudeSpawnArgs({
      settingsPath: '/x/settings.json',
      mcpConfigPath: '/x/mcp.json',
      systemPromptPath: '/x/system.md',
      builtinTools: ['Read', 'Glob', 'Grep'],
      allowedTools: ['Read', 'Glob', 'Grep', 'mcp__agent-orchestrator__start_run', 'mcp__agent-orchestrator__wait_for_any_run'],
      passthrough: ['--print', '--output-format', 'json'],
    });
    assert.ok(args.includes('--strict-mcp-config'));
    assert.ok(args.includes('--mcp-config'));
    assert.ok(args.includes('--settings'));
    assert.ok(args.includes('--setting-sources'));
    assert.equal(args[args.indexOf('--setting-sources') + 1], '');
    assert.ok(args.includes('--append-system-prompt-file'));
    assert.ok(args.includes('--tools'));
    assert.equal(args[args.indexOf('--tools') + 1], 'Read,Glob,Grep');
    assert.ok(args.includes('--allowed-tools'));
    const allowedValue = args[args.indexOf('--allowed-tools') + 1] ?? '';
    assert.deepStrictEqual(
      allowedValue.split(','),
      ['Read', 'Glob', 'Grep', 'mcp__agent-orchestrator__start_run', 'mcp__agent-orchestrator__wait_for_any_run'],
      '--allowed-tools must be comma-joined and round-trip the input list exactly',
    );
    assert.ok(args.includes('--permission-mode'));
    assert.equal(args[args.indexOf('--permission-mode') + 1], 'dontAsk');
    assert.ok(!args.includes('--dangerously-skip-permissions'));
    assert.ok(!args.includes('--disable-slash-commands'));
    assert.ok(!args.includes('--add-dir'));
    assert.deepStrictEqual(args.slice(-3), ['--print', '--output-format', 'json'], 'passthrough args appended last');
  });
});

describe('Claude launcher leak-proof tests', () => {
  it('does not load poisoned project-level .claude/* or .mcp.json from the target workspace, exposes only orchestrate-* skills, and never exposes Bash to the supervisor', async () => {
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
      const mcp = JSON.parse(built.mcpConfigContent);
      assert.deepStrictEqual(Object.keys(mcp.mcpServers), [CLAUDE_MCP_SERVER_NAME]);
      assert.ok(!('evil' in mcp.mcpServers));
      const settings = JSON.parse(built.settingsContent);
      assert.equal(settings.enableAllProjectMcpServers, false);
      assert.ok(built.spawnArgs.includes('--setting-sources'));
      assert.equal(built.spawnArgs[built.spawnArgs.indexOf('--setting-sources') + 1], '');
      const curated = await readFile(join(built.skillsRoot, 'orchestrate-good', 'SKILL.md'), 'utf8');
      assert.match(curated, /orchestrate-good/);
      await assert.rejects(() => readFile(join(built.skillsRoot, 'evil-skill', 'SKILL.md'), 'utf8'));
      await assert.rejects(() => readFile(join(built.skillsRoot, 'review', 'SKILL.md'), 'utf8'));
      const projectClaude = join(built.envelopeDir, '.claude');
      const entries = (await readFile(join(projectClaude, 'skills', 'orchestrate-good', 'SKILL.md'), 'utf8'));
      assert.match(entries, /orchestrate-good/);
      await assert.rejects(() => readFile(join(projectClaude, 'commands', 'evil.md'), 'utf8'));
      await assert.rejects(() => readFile(join(projectClaude, 'agents', 'evil-agent.md'), 'utf8'));
      await assert.rejects(() => readFile(join(projectClaude, 'hooks', 'evil.sh'), 'utf8'));
      await assert.rejects(() => readFile(join(projectClaude, 'settings.json'), 'utf8'));
      await assert.rejects(() => readFile(join(built.envelopeDir, '.mcp.json'), 'utf8'));
      assert.ok(!built.spawnArgs.includes('--add-dir'));
      assert.equal(built.spawnArgs[built.spawnArgs.indexOf('--tools') + 1], 'Read,Glob,Grep');
      assert.ok(built.spawnArgs.includes('--allowed-tools'));
      const allowedValue = built.spawnArgs[built.spawnArgs.indexOf('--allowed-tools') + 1] ?? '';
      const allowedTokens = allowedValue.split(',');
      assert.ok(allowedTokens.includes('mcp__agent-orchestrator__wait_for_any_run'));
      assert.ok(allowedTokens.includes('mcp__agent-orchestrator__list_run_notifications'));
      for (const token of allowedTokens) {
        assert.ok(!token.startsWith('Bash'), `--allowed-tools must not contain a Bash entry, got ${token}`);
      }
      assert.equal(built.spawnArgs[built.spawnArgs.indexOf('--permission-mode') + 1], 'dontAsk');
      assert.notEqual(built.spawnEnv.HOME, process.env.HOME);
      assert.equal(built.spawnEnv.HOME, join(stateDir, 'home'));
      assert.equal(built.spawnEnv.CLAUDE_CONFIG_DIR, join(stateDir, 'home', '.claude'));
      assert.equal(built.spawnEnv.NO_COLOR, undefined);
      assert.notEqual(built.spawnEnv.HOME, join(built.envelopeDir, 'home'));
      const promptText = built.systemPrompt;
      assert.match(promptText, /mcp__agent-orchestrator__wait_for_any_run/);
      assert.match(promptText, /mcp__agent-orchestrator__list_run_notifications/);
      assert.match(promptText, /Bash is not available in this envelope/);
      assert.match(promptText, /For each active run, use exactly one active wait mechanism at a time/);
      assert.match(promptText, /mcp__agent-orchestrator__get_run_progress first/);
      assert.doesNotMatch(promptText, /pinned monitor/i);
      assert.doesNotMatch(promptText, /run_in_background/);
    } finally {
      await built.cleanup();
    }
    assert.equal((await stat(stateDir)).isDirectory(), true);
  });

  it('Bash is excluded across the entire supervisor envelope', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'agent-claude-no-bash-'));
    const skillsPath = join(cwd, '.agents', 'skills');
    await mkdir(join(skillsPath, 'orchestrate-foo'), { recursive: true });
    await writeFile(join(skillsPath, 'orchestrate-foo', 'SKILL.md'), '---\nname: orchestrate-foo\n---\nbody');
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
      const toolsValue = built.spawnArgs[built.spawnArgs.indexOf('--tools') + 1] ?? '';
      const allowedValue = built.spawnArgs[built.spawnArgs.indexOf('--allowed-tools') + 1] ?? '';
      assert.ok(!toolsValue.includes('Bash'), `--tools must not include Bash, got ${toolsValue}`);
      assert.ok(!allowedValue.includes('Bash'), `--allowed-tools must not include Bash, got ${allowedValue}`);
      const settings = JSON.parse(built.settingsContent);
      for (const entry of settings.permissions.allow) {
        assert.ok(!String(entry).startsWith('Bash'), `settings.permissions.allow must not include Bash, got ${entry}`);
      }
      const bashLines = built.systemPrompt.split('\n').filter((line) => /\bBash\b/.test(line));
      // The only acceptable mention of Bash is the explicit "not available" line.
      assert.equal(bashLines.length, 1, `system prompt must mention Bash exactly once, got: ${bashLines.join('\\n')}`);
      assert.match(bashLines[0]!, /not available in this envelope/);
      assert.doesNotMatch(built.systemPrompt, /Bash run_in_background/);
      assert.doesNotMatch(built.systemPrompt, /pinned monitor/i);
    } finally {
      await built.cleanup();
    }
  });
});
