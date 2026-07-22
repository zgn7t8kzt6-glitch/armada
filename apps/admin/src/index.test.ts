import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN_AREAS } from './index.js';

test('admin areas are unique and include governance essentials', () => {
  assert.equal(new Set(ADMIN_AREAS).size, ADMIN_AREAS.length);
  assert.ok(ADMIN_AREAS.includes('Feature Flags'));
  assert.ok(ADMIN_AREAS.includes('Audit Events'));
});
