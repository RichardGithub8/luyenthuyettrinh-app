import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLANS, PLAN_RANK, FREE_GOALS, priceOf, TEAM_MAX_MEMBERS } from '../src/config/plans.ts';

test('prices follow the owner pricing sheet (2026-11-18)', () => {
  assert.equal(priceOf('pass', 'once'), 59_000);
  assert.equal(priceOf('premium', 'monthly'), 79_000);
  assert.equal(priceOf('premium', 'semiannual'), 399_000);
  assert.equal(priceOf('team', 'monthly'), 690_000);
  assert.equal(priceOf('team', 'semiannual'), 3_490_000);
});

test('invalid product/cycle pairs have no price', () => {
  assert.equal(priceOf('pass', 'monthly'), null);
  assert.equal(priceOf('premium', 'once'), null);
  assert.equal(priceOf('team', 'yearly'), null);
});

test('plan limits per tier', () => {
  assert.deepEqual([PLANS.free.analysesPerPeriod, PLANS.free.maxAnalyzeSec, PLANS.free.video, PLANS.free.upload], [3, 300, false, false]);
  assert.deepEqual([PLANS.pass.analysesPerPeriod, PLANS.pass.maxAnalyzeSec, PLANS.pass.video, PLANS.pass.allGoals, PLANS.pass.history], [15, 1200, true, true, false]);
  assert.deepEqual([PLANS.premium.analysesPerPeriod, PLANS.premium.history, PLANS.premium.liveCoaching], [60, true, true]);
  assert.deepEqual(PLANS.team, PLANS.premium);
  assert.deepEqual([...FREE_GOALS], ['presentation', 'reporting']);
  assert.equal(TEAM_MAX_MEMBERS, 5);
});

test('plan ranks block buying a lower plan', () => {
  assert.ok(PLAN_RANK.team > PLAN_RANK.premium && PLAN_RANK.premium > PLAN_RANK.pass && PLAN_RANK.pass > PLAN_RANK.free);
});
