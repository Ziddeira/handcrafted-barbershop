import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatTime, getOpenStatus, zonedClock } from '../public/js/hours.js';

const TZ = 'America/Los_Angeles';
const daily = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, { open: '09:00', close: '21:00' }]));

test('formatTime renders 12-hour times', () => {
  assert.equal(formatTime('21:00'), '9 PM');
  assert.equal(formatTime('09:30'), '9:30 AM');
  assert.equal(formatTime('12:00'), '12 PM');
  assert.equal(formatTime('00:15'), '12:15 AM');
});

test('zonedClock uses the shop time zone, not UTC', () => {
  // 2026-10-01 18:30 UTC = Thursday 11:30 AM in California (PDT, UTC-7)
  assert.deepEqual(zonedClock(new Date('2026-10-01T18:30:00Z'), TZ), { day: 4, minutes: 11 * 60 + 30 });
  // 2026-10-02 03:30 UTC is still Thursday 8:30 PM in California
  assert.deepEqual(zonedClock(new Date('2026-10-02T03:30:00Z'), TZ), { day: 4, minutes: 20 * 60 + 30 });
});

test('open during business hours', () => {
  const s = getOpenStatus(daily, TZ, new Date('2026-10-01T18:30:00Z'));
  assert.equal(s.isOpen, true);
  assert.equal(s.label, 'Open now · Closes 9 PM');
});

test('closed at closing time, opens tomorrow', () => {
  const s = getOpenStatus(daily, TZ, new Date('2026-10-02T04:00:00Z')); // Thu 9:00 PM PDT
  assert.equal(s.isOpen, false);
  assert.equal(s.label, 'Closed · Opens 9 AM tomorrow');
});

test('closed before opening, opens today', () => {
  const s = getOpenStatus(daily, TZ, new Date('2026-10-01T14:00:00Z')); // Thu 7:00 AM PDT
  assert.equal(s.label, 'Closed · Opens 9 AM today');
});

test('skips closed days', () => {
  const hours = { ...daily, 0: null, 1: null }; // closed Sun + Mon
  const s = getOpenStatus(hours, TZ, new Date('2026-10-04T05:00:00Z')); // Sat 10 PM PDT
  assert.equal(s.label, 'Closed · Opens 9 AM Tuesday');
});
