import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createNotificationPushTick,
  parseNotificationPollIntervalMs,
} from '../notificationPushPoller.js';

interface RawNotification {
  notification_id: string;
  seq: number;
  run_id: string;
  kind: 'terminal' | 'fatal_error';
  status: string;
  terminal_reason?: string | null;
  latest_error?: unknown;
  created_at: string;
  acked_at?: string | null;
}

function makeNotification(overrides: Partial<RawNotification> & Pick<RawNotification, 'notification_id' | 'seq'>): RawNotification {
  return {
    run_id: 'run-1',
    kind: 'terminal',
    status: 'completed',
    terminal_reason: null,
    latest_error: null,
    created_at: new Date().toISOString(),
    acked_at: null,
    ...overrides,
  };
}

describe('parseNotificationPollIntervalMs', () => {
  const cases: Array<[string | undefined, number, string]> = [
    [undefined, 500, 'undefined falls back'],
    ['', 500, 'empty string falls back'],
    ['abc', 500, 'non-integer falls back'],
    ['-1', 500, 'negative falls back'],
    ['-100', 500, 'large negative falls back'],
    ['0', 500, 'zero is below the floor'],
    ['49', 500, 'sub-50 floor enforced'],
    ['50', 50, 'minimum honored'],
    ['500', 500, 'default value parsed'],
    ['1000', 1000, 'larger interval honored'],
  ];

  for (const [input, expected, description] of cases) {
    it(`${description} (${input ?? 'undefined'} -> ${expected})`, () => {
      assert.equal(parseNotificationPollIntervalMs(input), expected);
    });
  }
});

describe('createNotificationPushTick', () => {
  it('advances the cursor between batches', async () => {
    const requests: Array<Record<string, unknown>> = [];
    const batches: RawNotification[][] = [
      [
        makeNotification({ notification_id: '00000000000000000001-A', seq: 1 }),
        makeNotification({ notification_id: '00000000000000000002-B', seq: 2 }),
      ],
      [
        makeNotification({ notification_id: '00000000000000000003-C', seq: 3 }),
      ],
    ];
    const tick = createNotificationPushTick({
      request: async (_method, params) => {
        requests.push(params);
        const next = batches.shift() ?? [];
        return { ok: true, notifications: next };
      },
      notify: async () => undefined,
    });

    await tick();
    await tick();

    assert.equal(requests.length, 2);
    assert.equal(requests[0]!.since_notification_id, undefined);
    assert.equal(requests[1]!.since_notification_id, '00000000000000000002-B');
  });

  it('suppresses overlapping ticks while a request is in flight', async () => {
    let requestCount = 0;
    let resolveFirst!: () => void;
    const inFlight = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    const tick = createNotificationPushTick({
      request: async () => {
        requestCount += 1;
        if (requestCount === 1) {
          await inFlight;
        }
        return { ok: true, notifications: [] };
      },
      notify: async () => undefined,
    });

    const first = tick();
    // Second call must return without making a new request because the first is in flight.
    await tick();
    assert.equal(requestCount, 1, 'second tick must not call request while the first is in flight');
    resolveFirst();
    await first;
  });

  it('tolerates notify failures and continues to advance the cursor', async () => {
    const notifyAttempts: unknown[] = [];
    let notifyCalls = 0;
    const tick = createNotificationPushTick({
      request: async () => ({
        ok: true,
        notifications: [
          makeNotification({ notification_id: '00000000000000000001-A', seq: 1 }),
          makeNotification({ notification_id: '00000000000000000002-B', seq: 2 }),
        ],
      }),
      notify: async (payload) => {
        notifyCalls += 1;
        notifyAttempts.push(payload);
        if (notifyCalls === 1) throw new Error('push failed');
      },
    });

    await tick();
    assert.equal(notifyAttempts.length, 2, 'both notifications attempted even when the first throws');
  });

  it('tolerates IPC failures without throwing or advancing the cursor', async () => {
    let attempt = 0;
    const seenSinceIds: Array<string | undefined> = [];
    const tick = createNotificationPushTick({
      request: async (_method, params) => {
        attempt += 1;
        seenSinceIds.push(params.since_notification_id as string | undefined);
        if (attempt === 1) throw new Error('boom');
        return { ok: true, notifications: [] };
      },
      notify: async () => undefined,
    });

    await tick();
    await tick();
    assert.equal(attempt, 2);
    assert.equal(seenSinceIds[0], undefined);
    assert.equal(seenSinceIds[1], undefined, 'cursor must not advance after an IPC failure');
  });
});
