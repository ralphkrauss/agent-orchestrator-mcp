import { orchestratorError, type OrchestratorError } from './contract.js';
import { resolveWorkerProfilesFile } from './workerRouting.js';

/**
 * When the MCP frontend is launched by a harness that pins the only writable
 * profiles manifest path (Claude supervisor harness), enforce that
 * upsert_worker_profile cannot write to any other path. This prevents the
 * supervisor from using upsert_worker_profile as a generic file-write
 * primitive against arbitrary locations.
 */
export function enforceWritableProfilesPolicy(
  toolName: string,
  args: unknown,
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): OrchestratorError | null {
  if (toolName !== 'upsert_worker_profile') return null;
  const pinned = env.AGENT_ORCHESTRATOR_WRITABLE_PROFILES_FILE;
  if (!pinned) return null;
  const input = (args ?? {}) as { profiles_file?: unknown; cwd?: unknown };
  const requestedFile = typeof input.profiles_file === 'string' ? input.profiles_file : undefined;
  const requestedCwd = typeof input.cwd === 'string' ? input.cwd : undefined;
  const resolvedRequested = resolveWorkerProfilesFile(requestedFile, requestedCwd ?? cwd, env);
  const resolvedPinned = resolveWorkerProfilesFile(pinned, cwd, env);
  if (resolvedRequested !== resolvedPinned) {
    return orchestratorError(
      'INVALID_INPUT',
      `upsert_worker_profile is restricted to the harness-pinned profiles manifest (${resolvedPinned}); refusing to write ${resolvedRequested}`,
      { profiles_file: resolvedRequested, allowed_profiles_file: resolvedPinned },
    );
  }
  return null;
}
