import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { OrchestratorService } from '../orchestratorService.js';
import { RunStore } from '../runStore.js';

interface RunProgressResponse {
  ok: true;
  progress: {
    event_count: number;
    next_sequence: number;
    has_more: boolean;
    latest_event_sequence: number | null;
    latest_event_at: string | null;
    latest_text: string | null;
    recent_events: Array<{
      seq: number;
      type: string;
      summary: string | null;
      text: string | null;
    }>;
  };
}

describe('get_run_progress', () => {
  it('returns bounded progress summaries without exposing full raw event payloads', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-progress-'));
    const store = new RunStore(root);
    const service = new OrchestratorService(store, new Map());
    const run = await store.createRun({ backend: 'claude', cwd: root, prompt: 'Write a long poem.' });
    await store.appendEvent(run.run_id, { type: 'assistant_message', payload: { text: 'x'.repeat(5000) } });
    await store.appendEvent(run.run_id, { type: 'tool_use', payload: { name: 'Write', input: { file_path: 'poem.txt', content: 'y'.repeat(5000) } } });
    await store.appendEvent(run.run_id, { type: 'tool_result', payload: { message: { content: [{ type: 'tool_result', content: 'z'.repeat(5000) }] } } });
    await store.appendEvent(run.run_id, { type: 'assistant_message', payload: { text: 'Good progress - 766 non-blank lines so far. Continuing with the next chunk.' } });

    const response = await service.getRunProgress({ run_id: run.run_id, limit: 3, max_text_chars: 120 });
    assert.equal(response.ok, true);
    const progress = response as RunProgressResponse;
    assert.equal(progress.progress.event_count, 4);
    assert.equal(progress.progress.has_more, true);
    assert.equal(progress.progress.latest_event_sequence, 4);
    assert.equal(progress.progress.latest_text, 'Good progress - 766 non-blank lines so far. Continuing with the next chunk.');
    assert.deepStrictEqual(progress.progress.recent_events.map((event) => event.seq), [2, 3, 4]);
    assert.equal(progress.progress.recent_events[0]?.summary, 'Write: poem.txt');
    for (const event of progress.progress.recent_events) {
      assert.ok((event.text?.length ?? 0) <= 120);
      assert.ok((event.summary?.length ?? 0) <= 240);
    }
  });

  it('supports cursor-based progress pages for incremental check-ins', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-progress-'));
    const store = new RunStore(root);
    const service = new OrchestratorService(store, new Map());
    const run = await store.createRun({ backend: 'codex', cwd: root, prompt: 'Inspect progress.' });
    await store.appendEvent(run.run_id, { type: 'lifecycle', payload: { status: 'started' } });
    await store.appendEvent(run.run_id, { type: 'assistant_message', payload: { text: 'First update.' } });
    await store.appendEvent(run.run_id, { type: 'assistant_message', payload: { text: 'Second update.' } });
    await store.appendEvent(run.run_id, { type: 'lifecycle', payload: { status: 'running' } });

    const response = await service.getRunProgress({ run_id: run.run_id, after_sequence: 2, limit: 1, max_text_chars: 80 });
    assert.equal(response.ok, true);
    const progress = response as RunProgressResponse;
    assert.deepStrictEqual(progress.progress.recent_events.map((event) => event.seq), [3]);
    assert.equal(progress.progress.next_sequence, 3);
    assert.equal(progress.progress.has_more, true);
    assert.equal(progress.progress.latest_text, 'Second update.');
    assert.equal(progress.progress.latest_event_sequence, 4, 'cursor pages must still expose latest_event_sequence');
    assert.match(progress.progress.latest_event_at ?? '', /\d{4}-\d{2}-\d{2}T/);
  });

  it('returns UNKNOWN_RUN for missing runs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-progress-'));
    const store = new RunStore(root);
    const service = new OrchestratorService(store, new Map());

    const response = await service.getRunProgress({ run_id: 'missing' });
    assert.equal(response.ok, false);
    if (response.ok) return;
    assert.equal(response.error.code, 'UNKNOWN_RUN');
  });
});
