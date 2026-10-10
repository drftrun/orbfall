/**
 * The shape of `run.drs` as TypeScript sees it, so the page and the tests read the rules through
 * one description. A variant reaches the page as its tag: `run.phase.tag` is `'Playing'` or `'Over'`.
 */
export interface Run {
  remaining: number;
  score: number;
  best: number;
  crystals: number;
  falls: number;
  newBest: boolean;
  phase: { tag: 'Playing' | 'Over' };
}

export interface RunRules {
  createRun(): Run;
  start(run: Run): void;
  restoreBest(run: Run, best: number): void;
  elapsed(run: Run): number;
  reaches(dx: number, dy: number, dz: number): boolean;
  collect(run: Run): void;
  fall(run: Run): void;
  boulders(elapsed: number): number;
  boulderPush(elapsed: number): number;
  boulderTopSpeed(elapsed: number): number;
  tick(run: Run, dt: number): void;
}
