import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createWorkerCapabilityCatalog,
  parseWorkerProfileManifest,
  validateWorkerProfiles,
} from '../opencode/capabilities.js';
import type { BackendStatusReport } from '../contract.js';

describe('OpenCode worker capability profiles', () => {
  it('validates provider-agnostic profiles', () => {
    const manifest = parseWorkerProfileManifest({
      profiles: {
        implementer: {
          backend: 'codex',
          model: 'gpt-5.5',
          reasoning_effort: 'high',
          service_tier: 'fast',
        },
        reviewer: {
          backend: 'claude',
          model: 'claude-opus-4-7',
          reasoning_effort: 'xhigh',
        },
      },
    });
    assert.equal(manifest.ok, true);

    const result = validateWorkerProfiles(
      manifest.ok ? manifest.value : assert.fail('manifest parse failed'),
      createWorkerCapabilityCatalog(),
    );

    assert.equal(result.ok, true);
    assert.equal(result.ok && result.value.profiles.implementer?.backend, 'codex');
    assert.equal(result.ok && result.value.profiles.reviewer?.reasoning_effort, 'xhigh');
  });

  it('rejects unavailable backends before launch', () => {
    const manifest = parseWorkerProfileManifest({
      profiles: {
        implementer: {
          backend: 'codex',
          model: 'gpt-5.5',
          reasoning_effort: 'high',
        },
      },
    });
    assert.equal(manifest.ok, true);

    const result = validateWorkerProfiles(
      manifest.ok ? manifest.value : assert.fail('manifest parse failed'),
      createWorkerCapabilityCatalog(statusReport(['missing', 'available'])),
    );

    assert.equal(result.ok, false);
    assert.ok(!result.ok && result.errors.some((error) => error.includes('profile implementer uses unavailable backend codex')));
  });

  it('rejects backend-specific unsupported settings without making model calls', () => {
    const manifest = parseWorkerProfileManifest({
      profiles: {
        badClaude: {
          backend: 'claude',
          model: 'sonnet',
          reasoning_effort: 'xhigh',
          service_tier: 'fast',
        },
        badCodex: {
          backend: 'codex',
          model: 'openai/gpt-5.5',
          variant: 'experimental',
          reasoning_effort: 'max',
        },
      },
    });
    assert.equal(manifest.ok, true);

    const result = validateWorkerProfiles(
      manifest.ok ? manifest.value : assert.fail('manifest parse failed'),
      createWorkerCapabilityCatalog(),
    );

    assert.equal(result.ok, false);
    assert.ok(!result.ok && result.errors.some((error) => error.includes('unsupported reasoning_effort max')));
    assert.ok(!result.ok && result.errors.some((error) => error.includes('unsupported variant experimental')));
    assert.ok(!result.ok && result.errors.some((error) => error.includes('unsupported service_tier fast')));
    assert.ok(!result.ok && result.errors.some((error) => error.includes('provider-prefixed model openai/gpt-5.5')));
    assert.ok(!result.ok && result.errors.some((error) => error.includes('direct model id')));
  });

  it('rejects Claude effort profiles for unsupported direct model ids', () => {
    const manifest = parseWorkerProfileManifest({
      profiles: {
        reviewer: {
          backend: 'claude',
          model: 'claude-sonnet-4-5',
          reasoning_effort: 'high',
        },
        providerPrefixed: {
          backend: 'claude',
          model: 'anthropic/claude-opus-4-7',
          reasoning_effort: 'xhigh',
        },
        padded: {
          backend: 'claude',
          model: 'foo-claude-opus-4-7-bar',
          reasoning_effort: 'xhigh',
        },
        unknownEffort: {
          backend: 'claude',
          model: 'claude-opus-4-7',
          reasoning_effort: 'ultra',
        },
      },
    });
    assert.equal(manifest.ok, true);

    const result = validateWorkerProfiles(
      manifest.ok ? manifest.value : assert.fail('manifest parse failed'),
      createWorkerCapabilityCatalog(),
    );

    assert.equal(result.ok, false);
    assert.ok(!result.ok && result.errors.some((error) => error.includes('Claude effort levels are documented')));
    assert.ok(!result.ok && result.errors.some((error) => error.includes('profile providerPrefixed: Claude xhigh effort requires claude-opus-4-7')));
    assert.ok(!result.ok && result.errors.some((error) => error.includes('profile padded: Claude xhigh effort requires claude-opus-4-7')));
    assert.ok(!result.ok && result.errors.some((error) => error.includes('profile unknownEffort: Claude reasoning_effort must be one of low, medium, high, xhigh, or max')));
  });

  it('accepts cursor profiles that pass model only and rejects unsupported settings', () => {
    const manifest = parseWorkerProfileManifest({
      profiles: {
        cursorOk: {
          backend: 'cursor',
          model: 'composer-2',
        },
        cursorBadEffort: {
          backend: 'cursor',
          model: 'composer-2',
          reasoning_effort: 'high',
        },
        cursorMissingModel: {
          backend: 'cursor',
        },
      },
    });
    assert.equal(manifest.ok, true);

    const result = validateWorkerProfiles(
      manifest.ok ? manifest.value : assert.fail('manifest parse failed'),
      createWorkerCapabilityCatalog(),
    );

    assert.equal(result.ok, false);
    assert.ok(!result.ok && result.errors.some((error) => error.includes('cursorBadEffort uses unsupported reasoning_effort high')));
    assert.ok(!result.ok && result.errors.some((error) => error.includes('cursorMissingModel requires an explicit model')));
  });

  it('reports cursor capability metadata in the catalog', () => {
    const catalog = createWorkerCapabilityCatalog();
    const cursor = catalog.backends.find((backend) => backend.backend === 'cursor');
    assert.ok(cursor, 'cursor capability is missing from catalog');
    assert.equal(cursor.requires_model, true);
    assert.deepStrictEqual(cursor.settings.reasoning_efforts, []);
    assert.deepStrictEqual(cursor.settings.service_tiers, []);
    assert.equal(cursor.supports_start, true);
    assert.equal(cursor.supports_resume, true);
  });

  it('accepts Claude Opus 4.7 one-million-token direct ids for xhigh effort', () => {
    const manifest = parseWorkerProfileManifest({
      profiles: {
        reviewer: {
          backend: 'claude',
          model: 'claude-opus-4-7[1m]',
          reasoning_effort: 'xhigh',
        },
      },
    });
    assert.equal(manifest.ok, true);

    const result = validateWorkerProfiles(
      manifest.ok ? manifest.value : assert.fail('manifest parse failed'),
      createWorkerCapabilityCatalog(),
    );

    assert.equal(result.ok, true);
    assert.equal(result.ok && result.value.profiles.reviewer?.model, 'claude-opus-4-7[1m]');
  });
});

function statusReport(statuses: [string, string]): BackendStatusReport {
  return {
    frontend_version: 'test',
    daemon_version: null,
    version_match: false,
    daemon_pid: null,
    platform: process.platform,
    node_version: process.version,
    posix_supported: true,
    run_store: { path: '/tmp/test', accessible: true },
    backends: [
      diagnostic('codex', statuses[0]),
      diagnostic('claude', statuses[1]),
    ],
  } as BackendStatusReport;
}

function diagnostic(name: 'codex' | 'claude', status: string): BackendStatusReport['backends'][number] {
  return {
    name,
    binary: name,
    status: status as BackendStatusReport['backends'][number]['status'],
    path: null,
    version: null,
    auth: { status: 'unknown' },
    checks: [],
    hints: [],
  };
}
