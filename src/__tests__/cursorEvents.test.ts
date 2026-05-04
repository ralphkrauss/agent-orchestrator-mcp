import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseCursorEvent } from '../backend/cursor/cursorEvents.js';

describe('cursor SDK event mapping', () => {
  it('maps system messages to a lifecycle event and exposes the agent id as a session id', () => {
    const parsed = parseCursorEvent({ type: 'system', agent_id: 'bc-123', run_id: 'run-1' });
    assert.equal(parsed.sessionId, 'bc-123');
    assert.equal(parsed.events.length, 1);
    assert.equal(parsed.events[0]?.type, 'lifecycle');
  });

  it('maps assistant messages with text and tool_use blocks into assistant_message and tool_use events', () => {
    const parsed = parseCursorEvent({
      type: 'assistant',
      agent_id: 'bc-123',
      run_id: 'run-1',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'hello' },
          { type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: 'src/foo.ts' } },
          { type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'pnpm test' } },
        ],
      },
    });
    const types = parsed.events.map((event) => event.type);
    assert.equal(types.filter((type) => type === 'assistant_message').length, 1);
    const assistantEvent = parsed.events.find((event) => event.type === 'assistant_message');
    assert.ok(assistantEvent);
    const payload = assistantEvent.payload as { text?: unknown; raw?: unknown };
    assert.equal(payload.text, 'hello');
    assert.ok(payload.raw && typeof payload.raw === 'object');
    assert.ok(types.filter((type) => type === 'tool_use').length === 2);
    assert.deepStrictEqual(parsed.filesChanged, ['src/foo.ts']);
    assert.deepStrictEqual(parsed.commandsRun, ['pnpm test']);
  });

  it('emits a single assistant_message with the raw record when no text is present', () => {
    const parsed = parseCursorEvent({
      type: 'assistant',
      agent_id: 'bc-123',
      run_id: 'run-1',
      message: { role: 'assistant', content: [] },
    });
    const assistantEvents = parsed.events.filter((event) => event.type === 'assistant_message');
    assert.equal(assistantEvents.length, 1);
    const payload = assistantEvents[0]?.payload as Record<string, unknown>;
    assert.equal(payload.type, 'assistant');
    assert.equal(payload.agent_id, 'bc-123');
  });

  it('extracts file paths from tool_call args for write/edit-shaped tools', () => {
    const parsed = parseCursorEvent({
      type: 'tool_call',
      agent_id: 'bc-123',
      run_id: 'run-1',
      call_id: 'c1',
      name: 'Write',
      status: 'completed',
      args: { path: 'docs/notes.md' },
    });
    assert.deepStrictEqual(parsed.filesChanged, ['docs/notes.md']);
    const types = parsed.events.map((event) => event.type);
    assert.ok(types.includes('tool_use'));
    assert.ok(types.includes('tool_result'));
  });

  it('extracts shell commands from tool_call args for bash-shaped tools', () => {
    const parsed = parseCursorEvent({
      type: 'tool_call',
      agent_id: 'bc-123',
      run_id: 'run-1',
      call_id: 'c2',
      name: 'shell',
      status: 'running',
      args: { command: 'echo hello' },
    });
    assert.deepStrictEqual(parsed.commandsRun, ['echo hello']);
  });

  it('records ERROR status messages as errors and lifecycle events', () => {
    const parsed = parseCursorEvent({
      type: 'status',
      status: 'ERROR',
      message: 'rate limit exceeded',
    });
    assert.equal(parsed.events[0]?.type, 'lifecycle');
    assert.equal(parsed.errors[0]?.message, 'rate limit exceeded');
    assert.equal(parsed.errors[0]?.category, 'rate_limit');
  });

  it('treats unknown message types as lifecycle events', () => {
    const parsed = parseCursorEvent({ type: 'novel-message-type', extra: 'data' });
    assert.equal(parsed.events[0]?.type, 'lifecycle');
    assert.equal(parsed.errors.length, 0);
    assert.equal(parsed.resultEvent, undefined);
  });

  it('maps thinking and task messages to lifecycle without leaking thinking text into assistant events', () => {
    const thinking = parseCursorEvent({ type: 'thinking', text: 'inner monologue' });
    assert.equal(thinking.events[0]?.type, 'lifecycle');
    const task = parseCursorEvent({ type: 'task', status: 'started', text: 'plan' });
    assert.equal(task.events[0]?.type, 'lifecycle');
  });
});
