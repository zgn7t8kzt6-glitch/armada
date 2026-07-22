import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REDACTED, createLogger, newRequestId, sanitizeFields, type LogRecord } from './index.js';

function capture() {
  const records: LogRecord[] = [];
  const lines: string[] = [];
  return {
    records,
    lines,
    sink: (line: string, record: LogRecord) => {
      lines.push(line);
      records.push(record);
    },
  };
}

const fixedNow = () => new Date('2026-01-02T03:04:05.000Z');

test('emits structured JSON with service, level, time, message', () => {
  const cap = capture();
  const log = createLogger({ service: 'api', sink: cap.sink, now: fixedNow });
  log.info('server started', { port: 3000 });
  assert.equal(cap.records.length, 1);
  const parsed = JSON.parse(cap.lines[0] ?? '');
  assert.deepEqual(parsed, {
    level: 'info',
    time: '2026-01-02T03:04:05.000Z',
    service: 'api',
    message: 'server started',
    port: 3000,
  });
});

test('redacts sensitive keys at any depth, including payload/body', () => {
  const cap = capture();
  const log = createLogger({ service: 'worker', level: 'debug', sink: cap.sink, now: fixedNow });
  log.info('ingested record', {
    sourceSystem: 'MOCK_KIPU',
    payload: { anything: 'at all' },
    detail: {
      patientName: 'should never appear',
      dob: '1990-01-01',
      nested: { ssn: '123-45-6789', memberId: 'abc' },
    },
  });
  const line = cap.lines[0] ?? '';
  assert.ok(!line.includes('should never appear'));
  assert.ok(!line.includes('1990-01-01'));
  assert.ok(!line.includes('123-45-6789'));
  const rec = cap.records[0] as unknown as {
    payload: string;
    detail: { patientName: string; dob: string; nested: { ssn: string; memberId: string } };
    sourceSystem: string;
  };
  assert.equal(rec.payload, REDACTED);
  assert.equal(rec.detail.patientName, REDACTED);
  assert.equal(rec.detail.dob, REDACTED);
  assert.equal(rec.detail.nested.ssn, REDACTED);
  assert.equal(rec.detail.nested.memberId, REDACTED);
  assert.equal(rec.sourceSystem, 'MOCK_KIPU');
});

test('redacts credentials-style keys and supports extra deny-list entries', () => {
  const out = sanitizeFields(
    { password: 'x', apiKey: 'y', Authorization_Header: 'z', roomNumber: '12' },
    ['roomnumber'],
  );
  assert.equal(out['password'], REDACTED);
  assert.equal(out['apiKey'], REDACTED);
  assert.equal(out['Authorization_Header'], REDACTED);
  assert.equal(out['roomNumber'], REDACTED);
});

test('level filtering suppresses records below the threshold', () => {
  const cap = capture();
  const log = createLogger({ service: 'api', level: 'warn', sink: cap.sink, now: fixedNow });
  log.debug('nope');
  log.info('nope');
  log.warn('yes');
  log.error('yes');
  assert.deepEqual(
    cap.records.map((r) => r.level),
    ['warn', 'error'],
  );
});

test('child loggers bind sanitized fields onto every record', () => {
  const cap = capture();
  const log = createLogger({ service: 'api', sink: cap.sink, now: fixedNow });
  const child = log.child({ requestId: 'req-1', patientId: 'internal-uuid' });
  child.info('handled');
  const rec = cap.records[0] as unknown as { requestId: string; patientId: string };
  assert.equal(rec.requestId, 'req-1');
  assert.equal(rec.patientId, REDACTED);
});

test('truncates oversized strings and serializes errors safely', () => {
  const cap = capture();
  const log = createLogger({ service: 'api', sink: cap.sink, now: fixedNow });
  log.error('boom', { err: new Error('it broke'), blob: 'a'.repeat(2000) });
  const rec = cap.records[0] as unknown as { err: { name: string; message: string }; blob: string };
  assert.equal(rec.err.name, 'Error');
  assert.equal(rec.err.message, 'it broke');
  assert.ok(rec.blob.length < 600);
  assert.ok(rec.blob.endsWith('…[truncated]'));
});

test('fields cannot overwrite reserved envelope keys', () => {
  const cap = capture();
  const log = createLogger({ service: 'api', sink: cap.sink, now: fixedNow });
  log.info('real message', { message: 'spoofed', service: 'spoofed' });
  assert.equal(cap.records[0]?.message, 'real message');
  assert.equal(cap.records[0]?.service, 'api');
});

test('newRequestId returns a UUID', () => {
  assert.match(newRequestId(), /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});
