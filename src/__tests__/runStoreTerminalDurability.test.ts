import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RunStore } from '../runStore.js';
import { RunMetaSchema } from '../contract.js';

async function createTerminalRunWithoutNotification(root: string, fatal = false): Promise<string> {
  const seedStore = new RunStore(root);
  const meta = await seedStore.createRun({ backend: 'codex', cwd: root });
  // Manually rewrite meta to terminal without going through markTerminal so
  // the notification journal stays empty: this simulates the crash gap where
  // meta.json was persisted but the journal append never happened.
  const finishedAt = new Date().toISOString();
  const next = RunMetaSchema.parse({
    ...meta,
    status: fatal ? 'failed' : 'completed',
    finished_at: finishedAt,
    last_activity_at: finishedAt,
    last_activity_source: 'terminal',
    terminal_reason: fatal ? 'pre_spawn_failed' : 'completed',
    latest_error: fatal
      ? { message: 'crash', category: 'unknown', source: 'pre_spawn', retryable: false, fatal: true }
      : null,
  });
  await writeFile(seedStore.metaPath(meta.run_id), `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  return meta.run_id;
}

describe('RunStore terminal notification durability', () => {
  it('atomic emission: markTerminal appends a terminal notification inside the run lock', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-terminal-durability-'));
    const store = new RunStore(root);
    const run = await store.createRun({ backend: 'codex', cwd: root });
    await store.markTerminal(run.run_id, 'completed');
    const records = await store.listNotifications({ runIds: [run.run_id], includeAcked: true });
    assert.equal(records.length, 1);
    assert.equal(records[0]?.kind, 'terminal');
    assert.equal(records[0]?.status, 'completed');
    // Sentinel must be created so reopen does not re-emit.
    assert.equal((await stat(join(store.runDir(run.run_id), '.terminal_notification'))).isFile(), true);
  });

  it('crash-gap reconciliation backfills a terminal notification for a completed run', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-terminal-durability-'));
    const runId = await createTerminalRunWithoutNotification(root, false);

    // Reopen the store: ensureReady() reconciles.
    const store = new RunStore(root);
    await store.ensureReady();
    const records = await store.listNotifications({ runIds: [runId], kinds: ['terminal'], includeAcked: true });
    assert.equal(records.length, 1);
    assert.equal(records[0]?.status, 'completed');
    assert.equal((await stat(join(store.runDir(runId), '.terminal_notification'))).isFile(), true);
  });

  it('crash-gap reconciliation backfills both terminal and fatal_error for fatal runs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-terminal-durability-'));
    const runId = await createTerminalRunWithoutNotification(root, true);

    const store = new RunStore(root);
    await store.ensureReady();
    const records = await store.listNotifications({ runIds: [runId], includeAcked: true });
    const kinds = records.map((entry) => entry.kind).sort();
    assert.deepStrictEqual(kinds, ['fatal_error', 'terminal']);
    assert.equal((await stat(join(store.runDir(runId), '.terminal_notification'))).isFile(), true);
    assert.equal((await stat(join(store.runDir(runId), '.fatal_notification'))).isFile(), true);
  });

  it('reconciliation is idempotent across multiple ensureReady calls', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-terminal-durability-'));
    const runId = await createTerminalRunWithoutNotification(root, false);

    const first = new RunStore(root);
    await first.ensureReady();

    const second = new RunStore(root);
    await second.ensureReady();

    const records = await second.listNotifications({ runIds: [runId], kinds: ['terminal'], includeAcked: true });
    assert.equal(records.length, 1, 'no duplicate terminal records after a second reconciliation pass');
  });

  it('skips runs that already emitted (sentinel present)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-terminal-durability-'));
    const store = new RunStore(root);
    const run = await store.createRun({ backend: 'codex', cwd: root });
    await store.markTerminal(run.run_id, 'completed');

    const reopened = new RunStore(root);
    await reopened.ensureReady();
    const records = await reopened.listNotifications({ runIds: [run.run_id], includeAcked: true });
    assert.equal(records.length, 1);
  });

  it('skips non-terminal runs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-terminal-durability-'));
    const store = new RunStore(root);
    const run = await store.createRun({ backend: 'codex', cwd: root });
    await store.ensureReady();
    const records = await store.listNotifications({ runIds: [run.run_id], includeAcked: true });
    assert.equal(records.length, 0);
  });

  it('rewrites a missing terminal sentinel from the journal without duplicating the record', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-terminal-durability-'));
    const store = new RunStore(root);
    const run = await store.createRun({ backend: 'codex', cwd: root });
    await store.markTerminal(run.run_id, 'completed');

    // Delete the sentinel to simulate an upgrade from a daemon version that
    // did not write it.
    await rm(join(store.runDir(run.run_id), '.terminal_notification'), { force: true });

    const reopened = new RunStore(root);
    await reopened.ensureReady();
    const records = await reopened.listNotifications({ runIds: [run.run_id], kinds: ['terminal'], includeAcked: true });
    assert.equal(records.length, 1, 'no duplicate terminal record');
    assert.equal((await stat(join(reopened.runDir(run.run_id), '.terminal_notification'))).isFile(), true);
  });

  it('rewrites a missing fatal sentinel from the journal without duplicating the record', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-terminal-durability-'));
    const store = new RunStore(root);
    const run = await store.createRun({ backend: 'codex', cwd: root });
    await store.markTerminal(run.run_id, 'failed', [], undefined, {
      reason: 'pre_spawn_failed',
      latest_error: { message: 'boom', category: 'unknown', source: 'pre_spawn', retryable: false, fatal: true },
    });

    await rm(join(store.runDir(run.run_id), '.fatal_notification'), { force: true });

    const reopened = new RunStore(root);
    await reopened.ensureReady();
    const fatalRecords = await reopened.listNotifications({ runIds: [run.run_id], kinds: ['fatal_error'], includeAcked: true });
    assert.equal(fatalRecords.length, 1, 'no duplicate fatal_error record');
    assert.equal((await stat(join(reopened.runDir(run.run_id), '.fatal_notification'))).isFile(), true);
  });

  it('propagates durable-notification append failures during reconciliation so daemon startup surfaces real I/O faults', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-terminal-durability-'));
    const runId = await createTerminalRunWithoutNotification(root, false);

    // Force the journal append to fail by making the notifications.jsonl path
    // a directory before reconciliation runs. appendFile against a directory
    // rejects with EISDIR; the reconciliation pass must not swallow it.
    const journalPath = join(root, 'notifications.jsonl');
    await mkdir(journalPath, { recursive: true });

    const store = new RunStore(root);
    await assert.rejects(() => store.ensureReady(), /EISDIR|illegal operation/i);

    // Sentinel must not be written when the journal append fails.
    await assert.rejects(() => stat(join(store.runDir(runId), '.terminal_notification')));
  });

  it('skips runs with corrupt or unreadable meta.json without aborting the reconciliation pass', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-terminal-durability-'));
    const seed = new RunStore(root);
    // One healthy terminal-without-notification run that must be backfilled,
    // plus one corrupt run that must not abort the pass.
    const goodRunId = await createTerminalRunWithoutNotification(root, false);
    const badRun = await seed.createRun({ backend: 'codex', cwd: root });
    await writeFile(seed.metaPath(badRun.run_id), 'not-json{', { mode: 0o600 });

    const store = new RunStore(root);
    await store.ensureReady();

    // Healthy run was reconciled.
    const goodRecords = await store.listNotifications({ runIds: [goodRunId], kinds: ['terminal'], includeAcked: true });
    assert.equal(goodRecords.length, 1);
    // Corrupt run produced no journal record.
    const badRecords = await store.listNotifications({ runIds: [badRun.run_id], includeAcked: true });
    assert.equal(badRecords.length, 0);
  });

  it('does not infinite-recurse: ensureReady on two RunStore instances over the same root completes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-terminal-durability-'));
    const runId = await createTerminalRunWithoutNotification(root, false);

    const a = new RunStore(root);
    const b = new RunStore(root);
    // If ensureReady recurses into reconcile -> appendNotification -> ensureReady,
    // these awaits would never resolve. Both must complete.
    await Promise.all([a.ensureReady(), b.ensureReady()]);

    const records = await a.listNotifications({ runIds: [runId], kinds: ['terminal'], includeAcked: true });
    assert.equal(records.length, 1);
  });

});
