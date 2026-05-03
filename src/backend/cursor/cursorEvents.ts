import type { ParsedBackendEvent } from '../WorkerBackend.js';
import {
  classifyBackendError,
  commandFromToolInput,
  emptyParsedEvent,
  errorFromEvent,
  extractText,
  getRecord,
  getString,
  pathFromToolInput,
} from '../common.js';
import type { CursorSdkMessage } from './sdk.js';

const CURSOR_BACKEND = 'cursor' as const;

export function parseCursorEvent(message: CursorSdkMessage): ParsedBackendEvent {
  const rec = getRecord(message);
  if (!rec) return emptyParsedEvent();
  const type = getString(rec.type);
  const parsed = emptyParsedEvent();
  if (!type) {
    parsed.events.push({ type: 'lifecycle', payload: rec });
    return parsed;
  }

  const sessionId = getString(rec.agent_id) ?? getString(rec.agentId);
  if (sessionId) parsed.sessionId = sessionId;

  switch (type) {
    case 'system':
    case 'status':
    case 'task':
    case 'request':
    case 'thinking':
    case 'user':
      parsed.events.push({ type: 'lifecycle', payload: rec });
      handleStatus(rec, parsed);
      return parsed;
    case 'assistant':
      handleAssistant(rec, parsed);
      return parsed;
    case 'tool_call':
      handleToolCall(rec, parsed);
      return parsed;
    case 'error':
      parsed.events.push({ type: 'error', payload: rec });
      {
        const error = errorFromEvent(rec, CURSOR_BACKEND);
        if (error) parsed.errors.push(error);
      }
      return parsed;
    default:
      parsed.events.push({ type: 'lifecycle', payload: rec });
      return parsed;
  }
}

function handleStatus(rec: Record<string, unknown>, parsed: ParsedBackendEvent): void {
  if (getString(rec.type) !== 'status') return;
  const status = getString(rec.status);
  if (status === 'ERROR') {
    const message = getString(rec.message) ?? 'cursor run reported error status';
    parsed.errors.push(classifyBackendError({
      backend: CURSOR_BACKEND,
      source: 'backend_event',
      message,
      context: { status },
    }));
  }
}

function handleAssistant(rec: Record<string, unknown>, parsed: ParsedBackendEvent): void {
  const message = getRecord(rec.message);
  const content = message?.content;
  const text = extractText(message?.content) ?? extractText(rec.content) ?? getString(rec.text);
  parsed.events.push({
    type: 'assistant_message',
    payload: text ? { text, raw: rec } : rec,
  });
  if (Array.isArray(content)) {
    for (const item of content) {
      const block = getRecord(item);
      if (!block) continue;
      if (getString(block.type) === 'tool_use') {
        parsed.events.push({ type: 'tool_use', payload: block });
        const name = (getString(block.name) ?? '').toLowerCase();
        const input = block.input;
        if (name === 'bash' || name === 'shell') {
          parsed.commandsRun.push(...commandFromToolInput(input));
        }
        if (name === 'edit' || name === 'write' || name === 'create' || name === 'patch') {
          parsed.filesChanged.push(...pathFromToolInput(input));
        }
      }
    }
  }
}

function handleToolCall(rec: Record<string, unknown>, parsed: ParsedBackendEvent): void {
  parsed.events.push({ type: 'tool_use', payload: rec });
  const name = (getString(rec.name) ?? '').toLowerCase();
  const args = rec.args;
  if (name === 'bash' || name === 'shell') {
    parsed.commandsRun.push(...commandFromToolInput(args));
  }
  if (name === 'edit' || name === 'write' || name === 'create' || name === 'patch') {
    parsed.filesChanged.push(...pathFromToolInput(args));
  }
  const status = getString(rec.status);
  if (status === 'completed') {
    parsed.events.push({ type: 'tool_result', payload: rec });
  } else if (status === 'error') {
    const error = errorFromEvent(rec, CURSOR_BACKEND);
    if (error) parsed.errors.push(error);
  }
}
