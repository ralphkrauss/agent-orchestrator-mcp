// Thin shim around the optional `@cursor/sdk` dependency.
//
// Production code never imports `@cursor/sdk` statically. Instead the runtime
// resolves it lazily through `defaultCursorSdkAdapter()` so the daemon keeps
// running for Codex/Claude users when the SDK is absent. Tests inject a fake
// adapter via `CursorSdkRuntime` to avoid touching the real SDK or the
// network.

import { createRequire } from 'node:module';
import type { Backend } from '../../contract.js';

export const CURSOR_SDK_PACKAGE = '@cursor/sdk' as const;
export const CURSOR_BACKEND_NAME: Backend = 'cursor';

export type CursorRunStatus = 'running' | 'finished' | 'error' | 'cancelled';

export interface CursorTextBlock {
  type: 'text';
  text: string;
}

export interface CursorToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}

export interface CursorAssistantContent {
  role?: 'assistant';
  content: Array<CursorTextBlock | CursorToolUseBlock>;
}

export interface CursorSystemMessage {
  type: 'system';
  agent_id?: string;
  run_id?: string;
  model?: { id?: string };
}

export interface CursorAssistantMessage {
  type: 'assistant';
  agent_id?: string;
  run_id?: string;
  message: CursorAssistantContent;
}

export interface CursorToolUseMessage {
  type: 'tool_call';
  agent_id?: string;
  run_id?: string;
  call_id?: string;
  name?: string;
  status?: 'running' | 'completed' | 'error';
  args?: unknown;
  result?: unknown;
}

export interface CursorThinkingMessage {
  type: 'thinking';
  text?: string;
  thinking_duration_ms?: number;
}

export interface CursorStatusMessage {
  type: 'status';
  status?: 'CREATING' | 'RUNNING' | 'FINISHED' | 'ERROR' | 'CANCELLED' | 'EXPIRED';
  message?: string;
}

export interface CursorTaskMessage {
  type: 'task';
  status?: string;
  text?: string;
}

export interface CursorRequestMessage {
  type: 'request';
  request_id?: string;
}

export interface CursorUserMessage {
  type: 'user';
  message?: { role?: 'user'; content?: CursorTextBlock[] };
}

export type CursorSdkMessage =
  | CursorSystemMessage
  | CursorAssistantMessage
  | CursorToolUseMessage
  | CursorThinkingMessage
  | CursorStatusMessage
  | CursorTaskMessage
  | CursorRequestMessage
  | CursorUserMessage
  | { type: string; [key: string]: unknown };

export interface CursorRunResult {
  id?: string;
  status: CursorRunStatus;
  result?: string;
  durationMs?: number;
}

export interface CursorRun {
  readonly id: string;
  readonly agentId: string;
  readonly status: CursorRunStatus;
  readonly result?: string;
  stream(): AsyncGenerator<CursorSdkMessage, void> | AsyncIterable<CursorSdkMessage>;
  wait(): Promise<CursorRunResult>;
  cancel(): Promise<void>;
}

export interface CursorAgentSendOptions {
  model?: { id: string; params?: { id: string; value: string }[] };
}

export interface CursorAgent {
  readonly agentId: string;
  send(message: string, options?: CursorAgentSendOptions): Promise<CursorRun>;
  close?(): void;
  [Symbol.asyncDispose]?: () => Promise<void>;
}

export interface CursorAgentCreateOptions {
  apiKey?: string;
  model?: { id: string; params?: { id: string; value: string }[] };
  local?: { cwd?: string };
  agentId?: string;
  name?: string;
}

export interface CursorAgentResumeOptions {
  apiKey?: string;
  model?: { id: string; params?: { id: string; value: string }[] };
  local?: { cwd?: string };
}

export interface CursorAgentApi {
  create(options: CursorAgentCreateOptions): Promise<CursorAgent>;
  resume(agentId: string, options?: CursorAgentResumeOptions): Promise<CursorAgent>;
}

export interface CursorSdkAdapter {
  /** Probe whether the SDK is importable. Cheap and idempotent. */
  available(): Promise<{ ok: true; modulePath: string | null } | { ok: false; reason: string }>;
  /** Resolve the live SDK Agent API. Throws if `available()` returns `ok: false`. */
  loadAgentApi(): Promise<CursorAgentApi>;
}

interface CachedAdapterState {
  available?: Awaited<ReturnType<CursorSdkAdapter['available']>>;
  agentApi?: CursorAgentApi;
}

export function defaultCursorSdkAdapter(): CursorSdkAdapter {
  const state: CachedAdapterState = {};

  const importSdk = async (): Promise<{ ok: true; module: Record<string, unknown>; path: string | null } | { ok: false; reason: string }> => {
    try {
      const mod = (await import(/* @vite-ignore */ CURSOR_SDK_PACKAGE)) as Record<string, unknown>;
      const path = resolveModulePath();
      return { ok: true, module: mod, path };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }
  };

  return {
    async available() {
      if (state.available) return state.available;
      const result = await importSdk();
      state.available = result.ok
        ? { ok: true, modulePath: result.path }
        : { ok: false, reason: result.reason };
      if (result.ok) state.agentApi = extractAgentApi(result.module);
      return state.available;
    },
    async loadAgentApi() {
      if (state.agentApi) return state.agentApi;
      const result = await importSdk();
      if (!result.ok) {
        throw new Error(`@cursor/sdk is not installed: ${result.reason}`);
      }
      state.available = { ok: true, modulePath: result.path };
      const api = extractAgentApi(result.module);
      state.agentApi = api;
      return api;
    },
  };
}

function extractAgentApi(mod: Record<string, unknown>): CursorAgentApi {
  const candidate = mod.Agent as
    | { create?: unknown; resume?: unknown }
    | undefined;
  if (!candidate || typeof candidate.create !== 'function' || typeof candidate.resume !== 'function') {
    throw new Error('@cursor/sdk did not export the Agent factory expected by this version of agent-orchestrator');
  }
  return candidate as unknown as CursorAgentApi;
}

function resolveModulePath(): string | null {
  try {
    const requireFromHere = createRequire(import.meta.url);
    return requireFromHere.resolve(CURSOR_SDK_PACKAGE);
  } catch {
    return null;
  }
}
