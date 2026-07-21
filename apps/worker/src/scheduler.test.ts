import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLogger, type LogRecord } from '@armada/observability';
import { createScheduler } from './scheduler.js';

function silentLogger(records: LogRecord[] = []) {
  return createLogger({
    service: 'worker-test',
    level: 'debug',
    sink: (_line, record) => records.push(record),
  });
}

test('runs ticks on the interval and stops cleanly', async () => {
  const seen: number[] = [];
  const scheduler = createScheduler({
    logger: silentLogger(),
    intervalMs: 10,
    handler: (tick) => {
      seen.push(tick);
    },
  });
  scheduler.start();
  await new Promise((resolve) => setTimeout(resolve, 60));
  await scheduler.stop();
  const count = seen.length;
  assert.ok(count >= 2, `expected at least 2 ticks, got ${count}`);
  assert.deepEqual(seen.slice(0, 2), [1, 2]);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(seen.length, count, 'no ticks after stop');
});

test('a throwing handler is logged and does not kill the loop', async () => {
  const records: LogRecord[] = [];
  const scheduler = createScheduler({
    logger: silentLogger(records),
    intervalMs: 10,
    handler: (tick) => {
      if (tick === 1) throw new Error('job exploded');
    },
  });
  scheduler.start();
  await new Promise((resolve) => setTimeout(resolve, 45));
  await scheduler.stop();
  assert.ok(scheduler.ticks >= 2, 'loop survived the failure');
  assert.ok(records.some((r) => r.level === 'error' && r.message === 'tick failed'));
});

test('stop waits for an in-flight async tick', async () => {
  let finished = false;
  const scheduler = createScheduler({
    logger: silentLogger(),
    intervalMs: 10,
    handler: async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      finished = true;
    },
  });
  scheduler.start();
  await new Promise((resolve) => setTimeout(resolve, 15));
  await scheduler.stop();
  assert.equal(finished, true);
});
