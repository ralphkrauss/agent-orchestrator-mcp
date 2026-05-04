import { RunNotificationPushPayloadSchema, RunNotificationSchema } from './contract.js';

export function parseNotificationPollIntervalMs(envValue: string | undefined): number {
  if (envValue === undefined) return 500;
  const trimmed = envValue.trim();
  if (trimmed.length === 0) return 500;
  if (!/^-?\d+$/.test(trimmed)) return 500;
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(parsed) || parsed < 50) return 500;
  return parsed;
}

export interface NotificationPushTickDeps {
  request: (method: 'list_run_notifications', params: Record<string, unknown>, timeoutMs: number) => Promise<{
    ok: boolean;
    notifications?: unknown[];
  } & Record<string, unknown>>;
  notify: (params: unknown) => Promise<void>;
}

export function createNotificationPushTick(deps: NotificationPushTickDeps): () => Promise<void> {
  let lastSeen: string | undefined;
  let running = false;
  return async () => {
    if (running) return;
    running = true;
    try {
      const result = await deps.request(
        'list_run_notifications',
        lastSeen ? { since_notification_id: lastSeen, limit: 50 } : { limit: 50 },
        1_500,
      );
      if (!result.ok || !Array.isArray(result.notifications)) return;
      for (const raw of result.notifications) {
        const parsed = RunNotificationSchema.safeParse(raw);
        if (!parsed.success) continue;
        const record = parsed.data;
        if (lastSeen === undefined || record.notification_id > lastSeen) lastSeen = record.notification_id;
        const payload = RunNotificationPushPayloadSchema.parse({
          run_id: record.run_id,
          notification_id: record.notification_id,
          kind: record.kind,
          status: record.status,
        });
        try {
          await deps.notify(payload);
        } catch {
          // Push is advisory; durable journal remains authoritative.
        }
      }
    } catch {
      // Tolerate transient IPC errors; durable journal remains authoritative.
    } finally {
      running = false;
    }
  };
}
