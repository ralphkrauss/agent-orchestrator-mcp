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
import { buildMonitorBashCommand, resolveMonitorPin } from '../claude/monitorPin.js';
import { validateClaudePassthroughArgs } from '../claude/passthrough.js';
import { curateOrchestrateSkills, listOrchestrationSkills, mirrorClaudeProjectSkills } from '../claude/skills.js';
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

  it('built-in tool surface includes read-only inspection, the pinned Bash monitor, Skill, and MCP tools', () => {
    const monitorPin = resolveMonitorPin({ AGENT_ORCHESTRATOR_BIN: '/opt/agent-orchestrator' });
    const allow = buildClaudeAllowedToolsList({
      monitorBashAllowlistPattern: monitorPin.bash_allowlist_pattern,
    });
    assert.deepStrictEqual([...CLAUDE_SUPERVISOR_BUILTIN_TOOLS], ['Read', 'Glob', 'Grep', 'Bash', 'Skill']);
    assert.ok(allow.includes('Read'));
    assert.ok(allow.includes('Glob'));
    assert.ok(allow.includes('Grep'));
    assert.ok(allow.includes(`Bash(${process.execPath} /opt/agent-orchestrator monitor *)`));
    // Positive Bash inspection allowlist: pwd and git status are the only
    // non-monitor commands the supervisor is permitted to run. Other
    // read-only commands such as `git log`, `cat`, `ls`, etc. are deliberately
    // not allowlisted, so the deny list does not have to enumerate every
    // possible bypass.
    assert.ok(allow.includes('Bash(pwd)'));
    assert.ok(allow.includes('Bash(git status)'));
    assert.ok(allow.includes('Bash(git status *)'));
    assert.equal(allow.includes('Bash(git log *)'), false);
    assert.equal(allow.includes('Bash(cat *)'), false);
    assert.equal(allow.includes('Bash(ls *)'), false);
    assert.ok(allow.includes('Skill'));
    assert.ok(allow.includes(`mcp__${CLAUDE_MCP_SERVER_NAME}__start_run`));
  });

  it('claudeOrchestratorMcpToolDenyList denies MCP blocking wait tools because Bash monitor is the wake path', () => {
    assert.deepStrictEqual(claudeOrchestratorMcpToolDenyList(), [
      `mcp__${CLAUDE_MCP_SERVER_NAME}__wait_for_any_run`,
      `mcp__${CLAUDE_MCP_SERVER_NAME}__wait_for_run`,
    ]);
    const allow = claudeOrchestratorMcpToolAllowList();
    assert.ok(allow.includes(`mcp__${CLAUDE_MCP_SERVER_NAME}__list_run_notifications`));
    assert.ok(!allow.includes(`mcp__${CLAUDE_MCP_SERVER_NAME}__wait_for_any_run`));
    assert.ok(!allow.includes(`mcp__${CLAUDE_MCP_SERVER_NAME}__wait_for_run`));
  });

  it('builds settings that allow read-only inspection, the pinned monitor, Skill, and safe MCP tools while denying editing surfaces', () => {
    const monitorPin = resolveMonitorPin({ AGENT_ORCHESTRATOR_BIN: '/opt/agent-orchestrator' });
    const settings = buildClaudeSupervisorSettings({
      monitorBashAllowlistPattern: monitorPin.bash_allowlist_pattern,
    });
    assert.deepStrictEqual(
      [...settings.permissions.allow].sort(),
      [
        'Read',
        'Glob',
        'Grep',
        `Bash(${process.execPath} /opt/agent-orchestrator monitor *)`,
        'Bash(pwd)',
        'Bash(git status)',
        'Bash(git status *)',
        'Skill',
        ...claudeOrchestratorMcpToolAllowList(),
      ].sort(),
    );
    assert.equal(settings.permissions.defaultMode, 'dontAsk');
    for (const denied of ['Edit', 'Write', 'WebFetch', 'WebSearch', 'Task', 'NotebookEdit', 'TodoWrite']) {
      assert.ok(settings.permissions.deny.includes(denied), `${denied} must be denied`);
    }
    for (const denied of ['Bash(*;*)', 'Bash(*&*)', 'Bash(*|*)', 'Bash(*>*)', 'Bash(*<*)', 'Bash(*$*)', 'Bash(*`*)']) {
      assert.ok(settings.permissions.deny.includes(denied), `${denied} must be denied`);
    }
    assert.ok(settings.permissions.deny.includes('Bash(*&*)'), 'Bash(*&*) must block && command chaining');
    for (const denied of ['Bash(touch *)', 'Bash(rm *)', 'Bash(mv *)', 'Bash(cp *)', 'Bash(git add *)', 'Bash(git commit *)', 'Bash(git push *)']) {
      assert.ok(settings.permissions.deny.includes(denied), `${denied} must be denied`);
    }
    // Script interpreters and inline-script flags are denied so write/exec
    // escape hatches such as `node -e ...` or `python -c ...` cannot run even
    // if the model picks a binary that was not enumerated by name.
    for (const denied of [
      'Bash(node *)', 'Bash(*/node *)',
      'Bash(python *)', 'Bash(python3 *)', 'Bash(*/python *)', 'Bash(*/python3 *)',
      'Bash(perl *)', 'Bash(ruby *)', 'Bash(php *)',
      'Bash(bash *)', 'Bash(sh *)', 'Bash(zsh *)',
      'Bash(*/bash *)', 'Bash(*/sh *)',
      'Bash(eval *)', 'Bash(exec *)', 'Bash(env *)', 'Bash(xargs *)', 'Bash(sudo *)',
      'Bash(*-e *)', 'Bash(*-c *)', 'Bash(*--eval*)', 'Bash(*--exec*)',
    ]) {
      assert.ok(settings.permissions.deny.includes(denied), `${denied} must be denied`);
    }
    // Package managers and network/file-transfer tools are denied so the
    // supervisor cannot install code or exfiltrate via curl/wget/ssh/etc.
    for (const denied of [
      'Bash(npm *)', 'Bash(pnpm *)', 'Bash(yarn *)', 'Bash(npx *)',
      'Bash(pip *)', 'Bash(pip3 *)', 'Bash(pipx *)', 'Bash(uv *)', 'Bash(uvx *)',
      'Bash(cargo *)', 'Bash(go *)', 'Bash(brew *)', 'Bash(apt *)', 'Bash(apt-get *)',
      'Bash(curl *)', 'Bash(wget *)', 'Bash(scp *)', 'Bash(rsync *)', 'Bash(ssh *)',
      'Bash(docker *)', 'Bash(kubectl *)',
      'Bash(make *)', 'Bash(just *)',
    ]) {
      assert.ok(settings.permissions.deny.includes(denied), `${denied} must be denied`);
    }
    // Mutating or network-touching git subcommands beyond the originals are
    // also denied so `git rm`, `git fetch`, `git pull`, `git clone`, etc. cannot run.
    for (const denied of [
      'Bash(git rm *)', 'Bash(git mv *)', 'Bash(git fetch *)', 'Bash(git pull *)',
      'Bash(git clone *)', 'Bash(git init)', 'Bash(git init *)',
      'Bash(git worktree *)', 'Bash(git remote *)', 'Bash(git submodule *)',
      'Bash(git ls-remote *)', 'Bash(git update-index *)', 'Bash(git update-ref *)',
      'Bash(git filter-branch *)', 'Bash(git revert *)',
    ]) {
      assert.ok(settings.permissions.deny.includes(denied), `${denied} must be denied`);
    }
    // Bypass-resistance: git global options that smuggle a mutating subcommand
    // past first-token deny entries (`git -C dir add file`,
    // `git --git-dir=.git add file`), and shell command-dispatch builtins
    // (`command touch x`, `builtin touch x`) are explicitly denied.
    for (const denied of [
      'Bash(git -C *)', 'Bash(git -c *)',
      'Bash(git --git-dir*)', 'Bash(git --work-tree*)',
      'Bash(git --no-pager *)', 'Bash(git --exec-path*)',
      'Bash(command *)', 'Bash(*/command *)', 'Bash(builtin *)',
      'Bash(*\\*)',
    ]) {
      assert.ok(settings.permissions.deny.includes(denied), `${denied} must be denied`);
    }
    assert.equal(settings.permissions.deny.includes('Bash'), false, 'bare Bash deny would shadow the pinned monitor allow rule');
    assert.equal(settings.permissions.deny.includes('Skill'), false);
    assert.equal(settings.permissions.deny.includes('Read'), false);
    assert.equal(settings.permissions.deny.includes('Glob'), false);
    assert.equal(settings.permissions.deny.includes('Grep'), false);
    assert.ok(settings.permissions.deny.includes(`mcp__${CLAUDE_MCP_SERVER_NAME}__wait_for_any_run`));
    assert.ok(settings.permissions.deny.includes(`mcp__${CLAUDE_MCP_SERVER_NAME}__wait_for_run`));
    assert.equal(settings.enableAllProjectMcpServers, false);
    const json = stringifyClaudeSupervisorSettings(settings);
    JSON.parse(json);
  });

  it('builds monitor commands only for daemon-generated id shapes', () => {
    const monitorPin = resolveMonitorPin({ AGENT_ORCHESTRATOR_BIN: '/opt/agent-orchestrator' });
    assert.equal(
      buildMonitorBashCommand(monitorPin, '01KQRTVEP1Y0ANFYCSXZJ2FHPZ'),
      `${process.execPath} /opt/agent-orchestrator monitor 01KQRTVEP1Y0ANFYCSXZJ2FHPZ --json-line`,
    );
    assert.throws(() => buildMonitorBashCommand(monitorPin, '01KQRTVEP1Y0ANFYCSXZJ2FHPZ;touch /tmp/x'));
    assert.throws(() => buildMonitorBashCommand(monitorPin, '01KQRTVEP1Y0ANFYCSXZJ2FHPZ', true, 'bad;cursor'));
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
      // --bare changes Claude memory, plugin, auth/keychain, and discovery
      // behavior owned by the harness envelope.
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
    const result = await curateOrchestrateSkills({
      sourceSkillRoot: sourceRoot,
      ephemeralSkillRoot: ephemeral,
    });
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

  it('mirrors normal workspace skills into the redirected user skill root and skips symlinks', async () => {
    const sourceRoot = await mkdtemp(join(tmpdir(), 'agent-claude-project-skills-'));
    await mkdir(join(sourceRoot, 'orchestrate-good', 'references'), { recursive: true });
    await writeFile(join(sourceRoot, 'orchestrate-good', 'SKILL.md'), '---\nname: orchestrate-good\n---\n');
    await writeFile(join(sourceRoot, 'orchestrate-good', 'references', 'notes.md'), 'details');
    await mkdir(join(sourceRoot, 'review'), { recursive: true });
    await writeFile(join(sourceRoot, 'review', 'SKILL.md'), '---\nname: review\n---\n');
    await mkdir(join(sourceRoot, 'bad'), { recursive: true });
    const sensitiveFile = join(sourceRoot, '..', 'sensitive.txt');
    await writeFile(sensitiveFile, 'do-not-copy');
    await symlink(sensitiveFile, join(sourceRoot, 'bad', 'SKILL.md'));

    const targetRoot = await mkdtemp(join(tmpdir(), 'agent-claude-user-skills-'));
    const result = await mirrorClaudeProjectSkills({ sourceSkillRoot: sourceRoot, targetSkillRoot: targetRoot });

    assert.deepStrictEqual(result.skillNames, ['orchestrate-good', 'review']);
    assert.match(await readFile(join(targetRoot, 'orchestrate-good', 'SKILL.md'), 'utf8'), /orchestrate-good/);
    assert.equal(await readFile(join(targetRoot, 'orchestrate-good', 'references', 'notes.md'), 'utf8'), 'details');
    assert.match(await readFile(join(targetRoot, 'review', 'SKILL.md'), 'utf8'), /review/);
    await assert.rejects(() => readFile(join(targetRoot, 'bad', 'SKILL.md'), 'utf8'));
  });
});

describe('Claude harness config builder', () => {
  it('builds a system prompt that uses pinned Bash monitors as the primary wake path and embeds curated workflows', () => {
    const monitorPin = resolveMonitorPin({ AGENT_ORCHESTRATOR_BIN: '/opt/agent-orchestrator' });
    const catalog = createWorkerCapabilityCatalog(null);
    const config = buildClaudeHarnessConfig({
      targetCwd: '/tmp/work',
      manifestPath: '/tmp/work/profiles.json',
      ephemeralSkillRoot: '/tmp/skills',
      orchestrationSkillNames: ['orchestrate-create-plan', 'orchestrate-implement-plan'],
      orchestrationSkills: [
        { name: 'orchestrate-create-plan', content: '# plan workflow\nUse the planning loop.' },
        { name: 'orchestrate-implement-plan', content: '# implementation workflow\nUse the implementation loop.' },
      ],
      runtimeSkillRoot: '/tmp/home/.claude/skills',
      runtimeSkillNames: ['orchestrate-create-plan', 'review'],
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
    assert.match(config.systemPrompt, /Bash is restricted by an explicit allowlist/);
    assert.match(config.systemPrompt, /Bash\(pwd\), Bash\(git status\), and Bash\(git status \*\)/);
    assert.match(config.systemPrompt, /will be denied/);
    assert.match(config.systemPrompt, /Do not attempt to run other shell commands/);
    assert.match(config.systemPrompt, /\/opt\/agent-orchestrator monitor <run_id> --json-line/);
    assert.match(config.systemPrompt, /Bash run_in_background: true/);
    assert.match(config.systemPrompt, /Claude slash commands are enabled/);
    assert.match(config.systemPrompt, /Skill tool is available/);
    assert.match(config.systemPrompt, /Embedded orchestration workflow instructions/);
    assert.match(config.systemPrompt, /# plan workflow/);
    assert.match(config.systemPrompt, /upsert_worker_profile/);
    assert.match(config.systemPrompt, /mcp__agent-orchestrator__list_run_notifications/);
    assert.match(config.systemPrompt, /For each active run, use exactly one active wait mechanism at a time/);
    assert.match(config.systemPrompt, /Progress and status checks/);
    assert.match(config.systemPrompt, /mcp__agent-orchestrator__get_run_progress first/);
    assert.match(config.systemPrompt, /Do not inspect Claude Code internal files under \.claude\/projects or tool-results/);
    assert.match(config.systemPrompt, /Do not call wait_for_any_run or wait_for_run in the Claude supervisor/);
    assert.match(config.systemPrompt, /Cross-turn reconciliation/);
    assert.doesNotMatch(config.systemPrompt, /^- mcp__agent-orchestrator__wait_for_any_run$/m);
    assert.doesNotMatch(config.systemPrompt, /^- mcp__agent-orchestrator__wait_for_run$/m);
    assert.deepStrictEqual(Object.keys(config.mcpConfig.mcpServers), [CLAUDE_MCP_SERVER_NAME]);
    // The MCP server entry pins the writable profiles manifest path so the
    // MCP frontend can refuse upsert_worker_profile calls that target other
    // paths.
    assert.deepStrictEqual(
      config.mcpConfig.mcpServers[CLAUDE_MCP_SERVER_NAME]?.env,
      { AGENT_ORCHESTRATOR_WRITABLE_PROFILES_FILE: '/tmp/work/profiles.json' },
    );
    const mcpJson = stringifyClaudeMcpConfig(config.mcpConfig);
    const parsedMcp = JSON.parse(mcpJson);
    assert.equal(
      parsedMcp.mcpServers['agent-orchestrator'].env.AGENT_ORCHESTRATOR_WRITABLE_PROFILES_FILE,
      '/tmp/work/profiles.json',
    );
  });
});

describe('Claude launcher envelope', () => {
  it('builds a restricted workspace launch: --strict-mcp-config + read-only tools + pinned Bash monitor, no --add-dir, no dangerous permissions', async () => {
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
      assert.equal(built.launchCwd, cwd);
      assert.equal(settings.enableAllProjectMcpServers, false);
      assert.ok(Array.isArray(settings.permissions.allow));
      assert.equal(settings.permissions.defaultMode, 'dontAsk');
      assert.ok(settings.permissions.allow.includes(`Bash(${process.execPath} /opt/agent-orchestrator monitor *)`));
      assert.ok(settings.permissions.allow.includes('Skill'));
      assert.ok(settings.permissions.allow.includes('Read'));
      assert.ok(settings.permissions.allow.includes('Glob'));
      assert.ok(settings.permissions.allow.includes('Grep'));
      assert.equal(settings.permissions.deny.includes('Bash'), false);
      assert.equal(settings.permissions.deny.includes('Skill'), false);
      assert.equal(settings.permissions.deny.includes('Read'), false);
      assert.equal(settings.permissions.deny.includes('Glob'), false);
      assert.equal(settings.permissions.deny.includes('Grep'), false);
      assert.equal(settings.permissions.deny.includes('Edit'), true);
      assert.equal(settings.permissions.deny.includes('Write'), true);
      assert.ok(settings.permissions.deny.includes('Bash(*;*)'));
      assert.ok(settings.permissions.deny.includes('Bash(*&*)'));
      const mcp = JSON.parse(built.mcpConfigContent);
      assert.deepStrictEqual(Object.keys(mcp.mcpServers), [CLAUDE_MCP_SERVER_NAME]);
      assert.equal(
        mcp.mcpServers[CLAUDE_MCP_SERVER_NAME].env.AGENT_ORCHESTRATOR_WRITABLE_PROFILES_FILE,
        profilesPath,
        'Claude MCP entry must pin the writable profiles manifest path so the supervisor cannot use upsert_worker_profile to write arbitrary files',
      );
      assert.ok(built.spawnArgs.includes('--strict-mcp-config'), 'spawn args must include --strict-mcp-config');
      assert.ok(!built.spawnArgs.includes('--dangerously-skip-permissions'));
      assert.ok(!built.spawnArgs.includes('--disable-slash-commands'));
      assert.ok(!built.spawnArgs.includes('--add-dir'));
      assert.ok(built.spawnArgs.includes('--tools'));
      const toolsValue = built.spawnArgs[built.spawnArgs.indexOf('--tools') + 1] ?? '';
      assert.equal(toolsValue, 'Read,Glob,Grep,Bash,Skill');
      assert.ok(built.spawnArgs.includes('--allowed-tools'));
      const allowedTools = built.spawnArgs[built.spawnArgs.indexOf('--allowed-tools') + 1] ?? '';
      const allowedTokens = allowedTools.split(',');
      assert.ok(allowedTokens.includes('Read'));
      assert.ok(allowedTokens.includes('Glob'));
      assert.ok(allowedTokens.includes('Grep'));
      assert.ok(allowedTokens.includes(`Bash(${process.execPath} /opt/agent-orchestrator monitor *)`));
      assert.ok(allowedTokens.includes('Skill'));
      assert.ok(allowedTokens.includes('mcp__agent-orchestrator__start_run'));
      assert.ok(allowedTokens.includes('mcp__agent-orchestrator__upsert_worker_profile'));
      assert.ok(allowedTokens.includes('mcp__agent-orchestrator__list_run_notifications'));
      assert.ok(!allowedTokens.includes('mcp__agent-orchestrator__wait_for_any_run'));
      assert.ok(!allowedTokens.includes('mcp__agent-orchestrator__wait_for_run'));
      assert.ok(built.spawnArgs.includes('--permission-mode'));
      assert.equal(built.spawnArgs[built.spawnArgs.indexOf('--permission-mode') + 1], 'dontAsk');
      assert.equal(built.stateDir, stateDir);
      assert.equal(built.spawnEnv.HOME, join(stateDir, 'home'));
      assert.equal(built.spawnEnv.XDG_CONFIG_HOME, join(stateDir, 'home', '.config'));
      assert.equal(built.spawnEnv.CLAUDE_CONFIG_DIR, join(stateDir, 'home', '.claude'));
      assert.equal(built.userSkillsRoot, join(stateDir, 'home', '.claude', 'skills'));
      assert.deepStrictEqual(built.userSkillNames, []);
      assert.deepStrictEqual(
        JSON.parse(await readFile(join(stateDir, 'home', '.claude', 'settings.json'), 'utf8')),
        settings,
      );
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
        env: { AGENT_ORCHESTRATOR_BIN: '/opt/agent-orchestrator' },
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
      builtinTools: ['Read', 'Glob', 'Grep', 'Bash', 'Skill'],
      allowedTools: ['Read', 'Glob', 'Grep', 'Bash(/x/agent-orchestrator monitor *)', 'Skill', 'mcp__agent-orchestrator__start_run'],
      passthrough: ['--print', '--output-format', 'json'],
    });
    assert.ok(args.includes('--strict-mcp-config'));
    assert.ok(args.includes('--mcp-config'));
    assert.ok(args.includes('--settings'));
    assert.ok(args.includes('--setting-sources'));
    assert.equal(args[args.indexOf('--setting-sources') + 1], 'user');
    assert.ok(!args.includes('--disable-slash-commands'));
    assert.ok(args.includes('--append-system-prompt-file'));
    assert.ok(args.includes('--tools'));
    assert.equal(args[args.indexOf('--tools') + 1], 'Read,Glob,Grep,Bash,Skill');
    assert.ok(args.includes('--allowed-tools'));
    const allowedValue = args[args.indexOf('--allowed-tools') + 1] ?? '';
    assert.deepStrictEqual(
      allowedValue.split(','),
      ['Read', 'Glob', 'Grep', 'Bash(/x/agent-orchestrator monitor *)', 'Skill', 'mcp__agent-orchestrator__start_run'],
      '--allowed-tools must be comma-joined and round-trip the input list exactly',
    );
    assert.ok(args.includes('--permission-mode'));
    assert.equal(args[args.indexOf('--permission-mode') + 1], 'dontAsk');
    assert.ok(!args.includes('--dangerously-skip-permissions'));
    assert.ok(!args.includes('--add-dir'));
    assert.deepStrictEqual(args.slice(-3), ['--print', '--output-format', 'json'], 'passthrough args appended last');
  });
});

describe('Claude launcher leak-proof tests', () => {
  it('uses the target workspace for normal skills while restricting MCP/settings and embedded orchestrate instructions', async () => {
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

    const parsed = parseClaudeLauncherArgs(
      ['--cwd', cwd, '--skills', skillsPath, '--state-dir', stateDir],
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
      const mcp = JSON.parse(built.mcpConfigContent);
      assert.deepStrictEqual(Object.keys(mcp.mcpServers), [CLAUDE_MCP_SERVER_NAME]);
      assert.ok(!('evil' in mcp.mcpServers));
      const settings = JSON.parse(built.settingsContent);
      assert.equal(settings.enableAllProjectMcpServers, false);
      assert.ok(built.spawnArgs.includes('--setting-sources'));
      assert.equal(built.spawnArgs[built.spawnArgs.indexOf('--setting-sources') + 1], 'user');
      assert.equal(built.launchCwd, cwd);
      const curated = await readFile(join(built.skillsRoot, 'orchestrate-good', 'SKILL.md'), 'utf8');
      assert.match(curated, /orchestrate-good/);
      await assert.rejects(() => readFile(join(built.skillsRoot, 'evil-skill', 'SKILL.md'), 'utf8'));
      await assert.rejects(() => readFile(join(built.skillsRoot, 'review', 'SKILL.md'), 'utf8'));
      assert.match(await readFile(join(cwd, '.claude', 'skills', 'evil-skill', 'SKILL.md'), 'utf8'), /name: evil/);
      assert.equal(built.userSkillsRoot, join(stateDir, 'home', '.claude', 'skills'));
      assert.deepStrictEqual(built.userSkillNames, ['evil-skill']);
      assert.match(await readFile(join(built.userSkillsRoot, 'evil-skill', 'SKILL.md'), 'utf8'), /name: evil/);
      const envelopeClaude = join(built.envelopeDir, '.claude');
      const entries = (await readFile(join(envelopeClaude, 'skills', 'orchestrate-good', 'SKILL.md'), 'utf8'));
      assert.match(entries, /orchestrate-good/);
      const targetClaude = join(cwd, '.claude');
      assert.match(await readFile(join(targetClaude, 'commands', 'evil.md'), 'utf8'), /evil/);
      assert.match(await readFile(join(targetClaude, 'agents', 'evil-agent.md'), 'utf8'), /evil/);
      assert.match(await readFile(join(targetClaude, 'hooks', 'evil.sh'), 'utf8'), /#!\/bin\/sh/);
      assert.match(await readFile(join(targetClaude, 'settings.json'), 'utf8'), /permissions/);
      await assert.rejects(() => readFile(join(built.envelopeDir, '.mcp.json'), 'utf8'));
      assert.ok(!built.spawnArgs.includes('--add-dir'));
      assert.ok(!built.spawnArgs.includes('--disable-slash-commands'));
      assert.equal(built.spawnArgs[built.spawnArgs.indexOf('--tools') + 1], 'Read,Glob,Grep,Bash,Skill');
      assert.ok(built.spawnArgs.includes('--allowed-tools'));
      const allowedValue = built.spawnArgs[built.spawnArgs.indexOf('--allowed-tools') + 1] ?? '';
      const allowedTokens = allowedValue.split(',');
      assert.ok(allowedTokens.includes(`Bash(${process.execPath} /opt/agent-orchestrator monitor *)`));
      assert.ok(allowedTokens.includes('Skill'));
      assert.ok(allowedTokens.includes('Read'));
      assert.ok(allowedTokens.includes('Glob'));
      assert.ok(allowedTokens.includes('Grep'));
      assert.ok(!allowedTokens.includes('mcp__agent-orchestrator__wait_for_any_run'));
      assert.ok(allowedTokens.includes('mcp__agent-orchestrator__list_run_notifications'));
      assert.ok(allowedTokens.includes('mcp__agent-orchestrator__upsert_worker_profile'));
      assert.equal(built.spawnArgs[built.spawnArgs.indexOf('--permission-mode') + 1], 'dontAsk');
      assert.notEqual(built.spawnEnv.HOME, process.env.HOME);
      assert.equal(built.spawnEnv.HOME, join(stateDir, 'home'));
      assert.equal(built.spawnEnv.CLAUDE_CONFIG_DIR, join(stateDir, 'home', '.claude'));
      assert.deepStrictEqual(
        JSON.parse(await readFile(join(stateDir, 'home', '.claude', 'settings.json'), 'utf8')),
        settings,
      );
      assert.equal(built.spawnEnv.NO_COLOR, undefined);
      assert.notEqual(built.spawnEnv.HOME, join(built.envelopeDir, 'home'));
      const promptText = built.systemPrompt;
      assert.match(promptText, /Bash is restricted by an explicit allowlist/);
      assert.match(promptText, /Do not attempt to run other shell commands/);
      assert.match(promptText, /Bash run_in_background: true/);
      assert.match(promptText, /Claude slash commands are enabled/);
      assert.match(promptText, /Skill tool is available/);
      assert.match(promptText, /Embedded orchestration workflow instructions/);
      assert.match(promptText, /orchestrate-good/);
      assert.doesNotMatch(promptText, /^- mcp__agent-orchestrator__wait_for_any_run$/m);
      assert.match(promptText, /mcp__agent-orchestrator__list_run_notifications/);
      assert.match(promptText, /For each active run, use exactly one active wait mechanism at a time/);
      assert.match(promptText, /mcp__agent-orchestrator__get_run_progress first/);
    } finally {
      await built.cleanup();
    }
    assert.equal((await stat(stateDir)).isDirectory(), true);
  });

  it('Bash allows read-only inspection and the pinned monitor while write-shaped shell commands are denied', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'agent-claude-no-bash-'));
    const skillsPath = join(cwd, '.agents', 'skills');
    await mkdir(join(skillsPath, 'orchestrate-foo'), { recursive: true });
    await writeFile(join(skillsPath, 'orchestrate-foo', 'SKILL.md'), '---\nname: orchestrate-foo\n---\nbody');
    const stateDir = join(cwd, 'claude-state');
    const parsed = parseClaudeLauncherArgs(
      ['--cwd', cwd, '--skills', skillsPath, '--state-dir', stateDir],
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
      const toolsValue = built.spawnArgs[built.spawnArgs.indexOf('--tools') + 1] ?? '';
      const allowedValue = built.spawnArgs[built.spawnArgs.indexOf('--allowed-tools') + 1] ?? '';
      assert.equal(toolsValue, 'Read,Glob,Grep,Bash,Skill');
      assert.ok(allowedValue.includes(`Bash(${process.execPath} /opt/agent-orchestrator monitor *)`));
      assert.ok(allowedValue.split(',').includes('Read'));
      assert.ok(allowedValue.split(',').includes('Glob'));
      assert.ok(allowedValue.split(',').includes('Grep'));
      assert.ok(allowedValue.split(',').includes('Skill'));
      const settings = JSON.parse(built.settingsContent);
      // The Bash allow rules are exactly: pinned monitor, pwd, git status,
      // git status *. Any other Bash command (including read-only commands
      // such as `git log`, `cat`, `ls`, plus the bypasses such as
      // `git -C . add` or `command touch /tmp/x`) is not in the allow list,
      // so it is denied by the deny-by-default permission mode.
      const bashAllow = settings.permissions.allow.filter((entry: string) => entry.startsWith('Bash')).sort();
      assert.deepStrictEqual(
        bashAllow,
        [
          `Bash(${process.execPath} /opt/agent-orchestrator monitor *)`,
          'Bash(git status)',
          'Bash(git status *)',
          'Bash(pwd)',
        ].sort(),
      );
      assert.deepStrictEqual(settings.permissions.allow.filter((entry: string) => entry.startsWith('Skill')), ['Skill']);
      assert.ok(settings.permissions.allow.includes('Read'));
      assert.ok(settings.permissions.allow.includes('Glob'));
      assert.ok(settings.permissions.allow.includes('Grep'));
      assert.equal(settings.permissions.deny.includes('Bash'), false);
      assert.equal(settings.permissions.deny.includes('Skill'), false);
      assert.equal(settings.permissions.deny.includes('Read'), false);
      assert.equal(settings.permissions.deny.includes('Glob'), false);
      assert.equal(settings.permissions.deny.includes('Grep'), false);
      assert.equal(settings.permissions.deny.includes('Edit'), true);
      assert.equal(settings.permissions.deny.includes('Write'), true);
      assert.ok(settings.permissions.deny.includes('Bash(*;*)'));
      assert.ok(settings.permissions.deny.includes('Bash(*&*)'), 'Bash(*&*) must block && command chaining');
      assert.ok(settings.permissions.deny.includes('Bash(*$*)'));
      assert.ok(settings.permissions.deny.includes('Bash(touch *)'));
      assert.ok(settings.permissions.deny.includes('Bash(rm *)'));
      assert.ok(settings.permissions.deny.includes('Bash(git add *)'));
      assert.ok(settings.permissions.deny.includes('Bash(git push *)'));
      const bashLines = built.systemPrompt.split('\n').filter((line) => /\bBash\b/.test(line));
      assert.ok(bashLines.some((line) => /restricted by an explicit allowlist/.test(line)));
      assert.match(built.systemPrompt, /Bash run_in_background: true/);
      assert.match(built.systemPrompt, /Do not call wait_for_any_run or wait_for_run in the Claude supervisor/);
    } finally {
      await built.cleanup();
    }
  });
});
