import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NAVIGATION } from './index.js';

test('navigation matches blueprint §20 order', () => {
  assert.equal(NAVIGATION[0], 'Home');
  assert.equal(NAVIGATION[1], 'My Work');
  assert.equal(NAVIGATION.length, 12);
  assert.equal(new Set(NAVIGATION).size, NAVIGATION.length);
});
