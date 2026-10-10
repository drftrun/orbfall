/**
 * The run's rules, tested in Node: a script that holds no engine object is a set of functions over
 * a record, so a test calls them without a page.
 */
import { describe, expect, it } from 'vitest';
import { loadModule } from 'driftscript';
import type { RunRules } from './rules';
import * as runScript from './run.drs';

const rules = loadModule(runScript as Record<string, unknown>).exports as unknown as RunRules;
const STEP = 1 / 60;

describe('a run', () => {
  it('LASTS SIXTY SECONDS, then is over with the clock stopped at zero', () => {
    const run = rules.createRun();
    rules.start(run);
    for (let step = 0; step < 59 * 60; step += 1) rules.tick(run, STEP);
    expect(run.phase.tag).toBe('Playing');
    for (let step = 0; step < 2 * 60; step += 1) rules.tick(run, STEP);
    expect(run.phase.tag).toBe('Over');
    expect(run.remaining).toBe(0);
  });

  it('scores a crystal, takes three for a fall, and never goes below zero', () => {
    const run = rules.createRun();
    rules.start(run);
    for (let i = 0; i < 4; i += 1) rules.collect(run);
    expect(run.score).toBe(4);
    rules.fall(run);
    expect(run.score).toBe(1);
    rules.fall(run);
    expect(run.score).toBe(0);
    expect(run.falls).toBe(2);
  });

  it('counts nothing after the clock runs out', () => {
    const run = rules.createRun();
    rules.start(run);
    rules.collect(run);
    rules.tick(run, 61);
    rules.collect(run);
    rules.fall(run);
    expect(run.score).toBe(1);
  });

  it('keeps the best score across runs, and only a higher score replaces it', () => {
    const run = rules.createRun();
    rules.restoreBest(run, 5);
    rules.start(run);
    for (let i = 0; i < 3; i += 1) rules.collect(run);
    rules.tick(run, 61);
    expect(run.best).toBe(5);
    expect(run.newBest).toBe(false);

    rules.start(run);
    expect(run.best).toBe(5);
    for (let i = 0; i < 7; i += 1) rules.collect(run);
    rules.tick(run, 61);
    expect(run.best).toBe(7);
    expect(run.newBest).toBe(true);
  });

  it('reaches a crystal within 1.3 metres and not beyond', () => {
    expect(rules.reaches(0.9, 0, 0.9)).toBe(true);
    expect(rules.reaches(1, 0, 1)).toBe(false);
  });
});

describe('the boulders', () => {
  it('start at two and grow to six as the clock runs down, never fewer', () => {
    expect(rules.boulders(0)).toBe(2);
    expect(rules.boulders(59)).toBe(6);
    let last = 0;
    for (let t = 0; t <= 60; t += 0.5) {
      const n = rules.boulders(t);
      expect(n).toBeGreaterThanOrEqual(last);
      last = n;
    }
  });

  it('push harder and roll faster later in the run', () => {
    expect(rules.boulderPush(50)).toBeGreaterThan(rules.boulderPush(0));
    expect(rules.boulderTopSpeed(50)).toBeGreaterThan(rules.boulderTopSpeed(0));
  });
});
