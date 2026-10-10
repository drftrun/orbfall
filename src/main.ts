/**
 * Orbfall: pilot a hovering orb across a floating island at dusk, gather glowing crystals, and keep
 * clear of the boulders rolling at you, for sixty seconds.
 *
 * The page owns the picture, the physics, input and sound. The run's decisions — the clock, what a
 * crystal is worth, what a fall costs, the best score and how hard the boulders get — live in
 * `run.drs` and are tested in `run.test.ts`.
 */
import { AudioGraph, noiseBuffer, toneBuffer } from '@driftengine/audio';
import {
  ActionMap,
  BODY_DYNAMIC,
  BODY_STATIC,
  Camera,
  DEFAULT_TEXT_STYLE,
  InputSource,
  MeshBuilder,
  PhysicsWorld,
  SceneNode,
  TAU,
  TouchControls,
  computeLightMatrix,
  createEnvironment,
  createRenderer,
  cylinderShape,
  damp,
  defaultStore,
  lerp,
  mulberry32,
  sphereShape,
  startLoop,
} from '@driftengine/core';
import type { ShadowCasters, SkyColors, TextStyle, Vec3 } from '@driftengine/core';
import { bindModule } from '@driftengine/script';
import { loadModule, patchModule } from 'driftscript';
import type { RunRules } from './rules';
import * as runScript from './run.drs';

// #region tuning
/** The island's radius, in metres. Past it there is nothing but air. */
const ISLAND = 11;
const ORB_RADIUS = 0.5;
/** How far above its body the orb is drawn, so it reads as hovering rather than rolling. */
const HOVER = 0.38;
/** Fastest the orb is steered to, metres a second, and how hard it may accelerate getting there. */
const ORB_SPEED = 8;
const ORB_RESPONSE = 5;
const ORB_MAX_ACCEL = 16;
/** Seconds of no control after a boulder hits, so a hit can carry the orb over the edge. */
const STUN_SECONDS = 0.5;
const BOULDER_RADIUS = 1;
const MAX_BOULDERS = 6;
/** Seconds a boulder rolls on one heading before it aims at the orb again. */
const AIM_SECONDS = 2.2;
const CRYSTALS = 5;
const FALL_DEPTH = -7;
const SEED = 1987;
const BEST_KEY = 'orbfall.best';
// #endregion

// #region renderer
const canvas = document.querySelector<HTMLCanvasElement>('#stage');
if (canvas === null) throw new Error('the page must carry <canvas id="stage">');

const { renderer, backend } = await createRenderer(canvas, {
  maxDevicePixelRatio: 1.75,
  directionalShadows: true,
  screenEffects: true,
  hdrScene: true,
  bloom: 0.55,
  bloomThreshold: 1,
});

const readout = document.querySelector('#backend');
if (readout !== null) readout.textContent = backend;

renderer.resize();
addEventListener('resize', () => renderer.resize());
// #endregion

// #region dusk
function unit(x: number, y: number, z: number): Vec3 {
  const length = Math.hypot(x, y, z);
  return [x / length, y / length, z / length];
}

/** A low sun off to the left, so the light is long and warm and the sky behind it burns. */
const SUN: Vec3 = unit(-1, 0.45, -0.7);

const ENV = createEnvironment({
  directionalDir: SUN,
  directionalColor: [1.5, 0.84, 0.52],
  ambient: [0.3, 0.27, 0.44],
  ambientGround: [0.16, 0.1, 0.12],
  // Emissive is multiplied by this: at 0 the crystals and the orb would not glow at all.
  nightFactor: 1,
  emissiveGain: 1.8,
  fogColor: [0.66, 0.4, 0.42],
  fogDensity: 0.006,
  fogHeightFalloff: 0.03,
  fogBaseY: -20,
});

const sky: SkyColors = {
  top: [0.09, 0.1, 0.3],
  horizon: [1, 0.5, 0.3],
  deep: [0.14, 0.09, 0.22],
  sunDir: SUN,
  sunColor: [2.4, 1.3, 0.6],
  sunAngularRadius: 0.035,
  moonDir: unit(0.6, 0.45, -0.6),
  moonColor: [0.9, 0.92, 1],
  moonAngularRadius: 0.025,
  moonPhase: 0.45,
  nightFactor: 0.3,
  cloudOffsetX: 0,
  cloudOffsetZ: 0,
};
// #endregion

// #region island
const world = new PhysicsWorld({ substeps: 4 });
const random = mulberry32(SEED);

const GRASS: Vec3 = [0.3, 0.47, 0.22];
const SOIL: Vec3 = [0.36, 0.25, 0.2];
const ROCK: Vec3 = [0.34, 0.27, 0.3];

const island = new MeshBuilder();
island.addCylinder([0, -0.5, 0], ISLAND, 0.5, 'y', GRASS, 0, 72);
island.addCylinder([0, -1.15, 0], ISLAND - 0.2, 0.2, 'y', SOIL, 0, 72);
// Straight down: a tube's rings lie across its path, so a path that leans tilts the widest ring up
// through the grass.
island.addTube(
  [0, -1.3, 0, 0, -3.2, 0, 0, -5.8, 0, 0, -8.4, 0, 0, -11, 0],
  [ISLAND - 0.5, ISLAND - 2.2, 7.5, 3.5, 0.4],
  ROCK,
  0,
  28,
);
// Tufts of grass and small flowers: too small to roll over, and only in the picture.
const FLOWERS: Vec3[] = [
  [1, 0.85, 0.4],
  [0.95, 0.5, 0.7],
  [0.85, 0.85, 1],
];
for (let i = 0; i < 140; i += 1) {
  const r = Math.sqrt(random()) * (ISLAND - 0.4);
  const a = random() * TAU;
  const x = Math.cos(a) * r;
  const z = Math.sin(a) * r;
  if (i % 3 === 0) {
    island.addBox([x, 0.05, z], [0.05, 0.05, 0.05], FLOWERS[i % FLOWERS.length], 0.2);
  } else {
    const shade = 0.75 + random() * 0.35;
    island.addBox([x, 0.1, z], [0.04, 0.1, 0.04], [0.34 * shade, 0.56 * shade, 0.24 * shade]);
  }
}
world.addBody({
  type: BODY_STATIC,
  shape: cylinderShape(ISLAND, 0.5),
  x: 0,
  y: -0.5,
  z: 0,
  friction: 0.7,
});
const islandMesh = renderer.createMesh(island.build());

/** Other islands, far off in the haze, so the one under the orb is floating among them. */
const distant = new MeshBuilder();
for (let i = 0; i < 7; i += 1) {
  const a = (i / 7) * TAU + random() * 0.5;
  const d = 38 + random() * 20;
  const r = 2.5 + random() * 3.5;
  const x = Math.cos(a) * d;
  const y = -12 + random() * 7;
  const z = Math.sin(a) * d;
  distant.addCylinder([x, y - 0.4, z], r, 0.4, 'y', GRASS, 0, 24);
  distant.addTube([x, y - 0.8, z, x, y - 0.8 - r * 0.9, z, x, y - 0.8 - r * 1.8, z], [r * 0.95, r * 0.55, 0.2], ROCK, 0, 16);
}
const distantMesh = renderer.createMesh(distant.build());
// #endregion

// #region orb
const orb = world.addBody({
  type: BODY_DYNAMIC,
  shape: sphereShape(ORB_RADIUS),
  x: 0,
  y: ORB_RADIUS,
  z: 4,
  friction: 0.5,
  restitution: 0.1,
});
const orbMesh = renderer.createMesh(
  new MeshBuilder()
    .addSphere([0, 0, 0], ORB_RADIUS * 0.8, [0.45, 0.85, 1], 0.8, 28, 18)
    .addCylinder([0, 0, 0], ORB_RADIUS * 1.3, 0.03, 'y', [0.22, 0.5, 0.75], 0.35, 36)
    .build(),
);
// #endregion

// #region boulders
const boulders: number[] = [];
for (let i = 0; i < MAX_BOULDERS; i += 1) {
  boulders.push(
    world.addBody({
      type: BODY_DYNAMIC,
      shape: sphereShape(BOULDER_RADIUS),
      density: 2.5,
      x: 40 + i * 3,
      y: -80,
      z: 0,
      friction: 0.8,
      restitution: 0.15,
    }),
  );
}
const boulderMesh = renderer.createMesh(
  new MeshBuilder()
    .addBlob(
      [0, 0, 0],
      (u, v) =>
        BOULDER_RADIUS *
        (1 + 0.06 * Math.sin(u * TAU * 3 + v * 5) * Math.sin(v * Math.PI) - 0.04 * Math.cos(v * Math.PI * 4)),
      (u, v) => {
        const t = 0.85 + 0.15 * Math.sin(u * TAU * 5 + v * 9);
        return [0.58 * t, 0.5 * t, 0.45 * t];
      },
      0,
      22,
      16,
    )
    .build(),
);

/** How many boulders are rolling, where each is aimed, and how long until it aims again. */
let rolling = 0;
const aimX = new Float32Array(MAX_BOULDERS);
const aimZ = new Float32Array(MAX_BOULDERS);
const aimIn = new Float32Array(MAX_BOULDERS);
const hitCooldown = new Float32Array(MAX_BOULDERS);

function park(i: number): void {
  const body = boulders[i];
  world.setPosition(body, 40 + i * 3, -80, 0);
  world.setVelocity(body, 0, 0, 0);
}

/** Drop a boulder onto the rim, on the far side from the orb, aimed after it lands. */
function drop(i: number): void {
  const b = world.bodies;
  let a = random() * TAU;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const dx = Math.cos(a) * (ISLAND - 1.6) - b.posX[orb];
    const dz = Math.sin(a) * (ISLAND - 1.6) - b.posZ[orb];
    if (dx * dx + dz * dz > 36) break;
    a = random() * TAU;
  }
  const body = boulders[i];
  world.setPosition(body, Math.cos(a) * (ISLAND - 1.6), 6, Math.sin(a) * (ISLAND - 1.6));
  world.setVelocity(body, 0, 0, 0);
  b.angX[body] = 0;
  b.angY[body] = 0;
  b.angZ[body] = 0;
  aimIn[i] = 0.9 + random() * 0.6;
  aimX[i] = 0;
  aimZ[i] = 0;
  hitCooldown[i] = 0;
}
// #endregion

// #region crystals
const crystalX = new Float32Array(CRYSTALS);
const crystalZ = new Float32Array(CRYSTALS);
const CRYSTAL_Y = 0.95;
const crystalMesh = renderer.createMesh(
  new MeshBuilder().addSphere([0, 0, 0], 0.4, [1, 0.38, 0.84], 0.75, 6, 2).build(),
);

/** Somewhere on the island, clear of the orb and of the other crystals. */
function place(c: number): void {
  const b = world.bodies;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const r = Math.sqrt(random()) * (ISLAND - 2.2);
    const a = random() * TAU;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    crystalX[c] = x;
    crystalZ[c] = z;
    const ox = x - b.posX[orb];
    const oz = z - b.posZ[orb];
    if (ox * ox + oz * oz < 9) continue;
    let clear = true;
    for (let k = 0; k < CRYSTALS; k += 1) {
      if (k === c) continue;
      const kx = x - crystalX[k];
      const kz = z - crystalZ[k];
      if (kx * kx + kz * kz < 4) clear = false;
    }
    if (clear) return;
  }
}
// #endregion

// #region input
const input = new InputSource(canvas, ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
const actions = new ActionMap(input, {
  move: {
    stick: 'left',
    up: ['KeyW', 'ArrowUp'],
    down: ['KeyS', 'ArrowDown'],
    left: ['KeyA', 'ArrowLeft'],
    right: ['KeyD', 'ArrowRight'],
  },
  /* Restarts at any moment. */
  restart: { keys: ['KeyR'], buttons: ['start'] },
  /* Starts the next run once the clock has run out. */
  again: { keys: ['Space', 'Enter'], buttons: ['faceDown'] },
});
/** A thumb stick on the left of a touch screen; a tap on the right plays again. */
const touch = new TouchControls(input);
const move = { x: 0, y: 0 };
// #endregion

// #region sound
// A browser lets a page make sound only after a gesture, so the graph is made on the first press.
let sound: AudioGraph | null = null;
let soundAsked = false;
async function startSound(): Promise<void> {
  if (soundAsked) return;
  soundAsked = true;
  const graph = await AudioGraph.create({ stemCount: 0 });
  if (graph === null) return;
  graph.registry.register('crystal', { urls: [], synth: (ctx) => toneBuffer(ctx, 0.22, 880, 1760, 3) });
  graph.registry.register('hit', { urls: [], synth: (ctx) => noiseBuffer(ctx, 0.4, 2.5, () => 0.05) });
  graph.registry.register('fall', { urls: [], synth: (ctx) => toneBuffer(ctx, 0.7, 520, 110, 1.4) });
  graph.registry.register('over', { urls: [], synth: (ctx) => toneBuffer(ctx, 0.9, 660, 330, 2) });
  sound = graph;
  await graph.registry.load(graph.context);
}
addEventListener('pointerdown', () => void startSound());
addEventListener('keydown', () => void startSound());

function play(name: string, gain: number): void {
  sound?.play(sound.registry.get(name), gain);
}
// #endregion

// #region rules
const runModule = loadModule(runScript as Record<string, unknown>);
const bound = bindModule(runModule, {});
if (!bound.bound) throw new Error(bound.reason);
/* Read through the module each call, so a rule patched by a save is the rule that runs. */
const rules = runModule.exports as unknown as RunRules;
const run = rules.createRun();

const store = defaultStore();
const savedBest = Number.parseInt(store.read(BEST_KEY) ?? '0', 10);
if (Number.isInteger(savedBest) && savedBest > 0) rules.restoreBest(run, savedBest);

/* Saving `run.drs` replaces its functions and keeps `run` as it was: the clock carries on. */
if (import.meta.hot) {
  import.meta.hot.accept('./run.drs', (next) => {
    if (next !== undefined) patchModule(runModule, next as Record<string, unknown>, { Run: [run] });
  });
}
// #endregion

// #region state
/** Position and rotation of the orb and each boulder, before and after the last step. */
const BODIES = 1 + MAX_BOULDERS;
const before = new Float32Array(BODIES * 7);
const after = new Float32Array(BODIES * 7);
let stun = 0;

function record(out: Float32Array): void {
  const b = world.bodies;
  for (let i = 0; i < BODIES; i += 1) {
    const body = i === 0 ? orb : boulders[i - 1];
    const o = i * 7;
    out[o] = b.posX[body];
    out[o + 1] = b.posY[body];
    out[o + 2] = b.posZ[body];
    out[o + 3] = b.rotX[body];
    out[o + 4] = b.rotY[body];
    out[o + 5] = b.rotZ[body];
    out[o + 6] = b.rotW[body];
  }
}

function newRun(): void {
  rules.start(run);
  world.setPosition(orb, 0, ORB_RADIUS + 0.05, 4);
  world.setVelocity(orb, 0, 0, 0);
  stun = 0;
  rolling = 0;
  for (let i = 0; i < MAX_BOULDERS; i += 1) park(i);
  for (let c = 0; c < CRYSTALS; c += 1) place(c);
  record(before);
  record(after);
}
// #endregion

// #region simulate
function simulate(dt: number): void {
  const restart = actions.consumePress('restart');
  const again = actions.consumePress('again') || touch.consumePrimaryPress();
  const playing = run.phase.tag === 'Playing';
  if (restart || (!playing && again)) {
    newRun();
    return;
  }

  const b = world.bodies;
  const ox = b.posX[orb];
  const oy = b.posY[orb];
  const oz = b.posZ[orb];

  // Steer toward a velocity, not a position: let go and the orb hovers to a stop.
  // Keys and the pad say up is negative; the touch stick says it is positive, so it is flipped here.
  actions.vector('move', move);
  if (touch.moveX !== 0 || touch.moveY !== 0) {
    move.x = touch.moveX;
    move.y = -touch.moveY;
  }
  stun = Math.max(0, stun - dt);
  const onIsland = oy > -0.2 && ox * ox + oz * oz < ISLAND * ISLAND;
  if (playing && onIsland && stun === 0) {
    let ax = (move.x * ORB_SPEED - b.velX[orb]) * ORB_RESPONSE;
    let az = (move.y * ORB_SPEED - b.velZ[orb]) * ORB_RESPONSE;
    const a = Math.hypot(ax, az);
    if (a > ORB_MAX_ACCEL) {
      ax *= ORB_MAX_ACCEL / a;
      az *= ORB_MAX_ACCEL / a;
    }
    const mass = world.bodyMass(orb);
    world.applyForce(orb, ax * mass, 0, az * mass, dt, ox, oy, oz);
  }

  // Boulders: more of them, pushed harder, as the clock runs down.
  const elapsed = rules.elapsed(run);
  if (playing) {
    const wanted = rules.boulders(elapsed);
    while (rolling < wanted) {
      drop(rolling);
      rolling += 1;
    }
  }
  const push = rules.boulderPush(elapsed);
  const topSpeed = rules.boulderTopSpeed(elapsed);
  for (let i = 0; i < MAX_BOULDERS; i += 1) {
    const body = boulders[i];
    if (i >= rolling) {
      park(i);
      continue;
    }
    const bx = b.posX[body];
    const by = b.posY[body];
    const bz = b.posZ[body];
    if (by < -14) {
      drop(i);
      continue;
    }
    hitCooldown[i] = Math.max(0, hitCooldown[i] - dt);
    aimIn[i] -= dt;
    if (aimIn[i] <= 0) {
      const dx = ox - bx;
      const dz = oz - bz;
      const d = Math.hypot(dx, dz);
      if (d > 0.001) {
        aimX[i] = dx / d;
        aimZ[i] = dz / d;
      }
      aimIn[i] = AIM_SECONDS;
    }
    const grounded = by > 0 && by < BOULDER_RADIUS + 0.4 && bx * bx + bz * bz < ISLAND * ISLAND;
    const along = b.velX[body] * aimX[i] + b.velZ[body] * aimZ[i];
    if (grounded && along < topSpeed) {
      const mass = world.bodyMass(body);
      world.applyForce(body, aimX[i] * push * mass, 0, aimZ[i] * push * mass, dt, bx, by, bz);
    }
  }

  record(before);
  world.step(dt);
  record(after);

  const px = b.posX[orb];
  const py = b.posY[orb];
  const pz = b.posZ[orb];

  // A boulder that touches the orb hard enough is a hit: a thud, a shake, and a moment adrift.
  const touching = (ORB_RADIUS + BOULDER_RADIUS + 0.15) ** 2;
  for (let i = 0; i < rolling; i += 1) {
    const body = boulders[i];
    const dx = b.posX[body] - px;
    const dy = b.posY[body] - py;
    const dz = b.posZ[body] - pz;
    if (hitCooldown[i] > 0 || dx * dx + dy * dy + dz * dz > touching) continue;
    const rvx = b.velX[body] - b.velX[orb];
    const rvz = b.velZ[body] - b.velZ[orb];
    const speed = Math.hypot(rvx, rvz);
    if (speed < 1.2) continue;
    hitCooldown[i] = 0.5;
    stun = STUN_SECONDS;
    play('hit', Math.min(1, 0.35 + speed / 10));
    actions.rumble(180, 0.9, 0.5);
  }

  if (playing) {
    for (let c = 0; c < CRYSTALS; c += 1) {
      if (rules.reaches(crystalX[c] - px, CRYSTAL_Y - (py + HOVER), crystalZ[c] - pz)) {
        rules.collect(run);
        play('crystal', 0.5);
        place(c);
      }
    }
  }

  // Over the edge: it costs points, and the orb comes back in the middle.
  if (py < FALL_DEPTH) {
    rules.fall(run);
    play('fall', 0.6);
    world.setPosition(orb, 0, 2.5, 0);
    world.setVelocity(orb, 0, 0, 0);
    stun = 0;
    record(before);
    record(after);
  }

  rules.tick(run, dt);
  if (playing && run.phase.tag === 'Over') {
    store.write(BEST_KEY, String(run.best));
    play('over', 0.6);
  }
}
// #endregion

// #region camera
const camera = new Camera();
camera.fovYDeg = 55;
const eye = { x: 0, y: 10, z: 16 };
const look = { x: 0, y: 0, z: 0 };

/** Ease toward a spot behind and above the orb, leaning toward the middle so the edge stays in view. */
function follow(x: number, y: number, z: number, frameDt: number): void {
  const tx = x * 0.7;
  const tz = z * 0.6;
  const ty = Math.max(y, -2) * 0.5;
  look.x = damp(look.x, tx, 6, frameDt);
  look.y = damp(look.y, ty, 6, frameDt);
  look.z = damp(look.z, tz, 6, frameDt);
  eye.x = damp(eye.x, tx, 4, frameDt);
  eye.y = damp(eye.y, ty + 9.5, 4, frameDt);
  eye.z = damp(eye.z, tz + 12.5, 4, frameDt);
  camera.position[0] = eye.x;
  camera.position[1] = eye.y;
  camera.position[2] = eye.z;
  camera.lookAt(look.x, look.y, look.z);
  camera.updateMatrices(renderer.cssHeight > 0 ? renderer.cssWidth / renderer.cssHeight : 1);
}
// #endregion

// #region transforms
const still = new SceneNode();
still.updateWorld();
const orbNode = new SceneNode();
const boulderNodes: SceneNode[] = [];
for (let i = 0; i < MAX_BOULDERS; i += 1) boulderNodes.push(new SceneNode());
const crystalNodes: SceneNode[] = [];
for (let c = 0; c < CRYSTALS; c += 1) crystalNodes.push(new SceneNode());
let clock = 0;

/** Position by lerp and rotation by normalised lerp, for slot `i` of the recorded bodies. */
function placeBody(node: SceneNode, i: number, alpha: number): void {
  const a = before;
  const b = after;
  const o = i * 7;
  const dot = a[o + 3] * b[o + 3] + a[o + 4] * b[o + 4] + a[o + 5] * b[o + 5] + a[o + 6] * b[o + 6];
  const sign = dot < 0 ? -1 : 1;
  const r = node.rotation;
  for (let k = 0; k < 4; k += 1) r[k] = lerp(a[o + 3 + k] * sign, b[o + 3 + k], alpha);
  const length = Math.hypot(r[0], r[1], r[2], r[3]);
  for (let k = 0; k < 4; k += 1) r[k] /= length;
  node.position[0] = lerp(a[o], b[o], alpha);
  node.position[1] = lerp(a[o + 1], b[o + 1], alpha);
  node.position[2] = lerp(a[o + 2], b[o + 2], alpha);
  node.markMoved();
  node.updateWorld();
}

function placeEverything(alpha: number): void {
  // The orb does not tumble with its body: it hovers upright, bobbing and turning slowly.
  orbNode.setPosition(
    lerp(before[0], after[0], alpha),
    lerp(before[1], after[1], alpha) + HOVER + Math.sin(clock * 3.1) * 0.06,
    lerp(before[2], after[2], alpha),
  );
  orbNode.setRotationAxisAngle(0.15, 1, 0.1, clock * 1.4);
  orbNode.updateWorld();
  for (let i = 0; i < MAX_BOULDERS; i += 1) placeBody(boulderNodes[i], i + 1, alpha);
  for (let c = 0; c < CRYSTALS; c += 1) {
    const node = crystalNodes[c];
    node.setPosition(crystalX[c], CRYSTAL_Y + Math.sin(clock * 2.2 + c * 1.7) * 0.12, crystalZ[c]);
    node.setRotationAxisAngle(0, 1, 0, clock * 1.6 + c);
    node.setScale(0.75, 1.5, 0.75);
    node.updateWorld();
  }
}
// #endregion

// #region casters
/** Everything in the world, said once, so the shadow pass and the colour pass draw the same things. */
const casters: ShadowCasters = (sink) => {
  sink.mesh(islandMesh, still.worldMatrix);
  sink.mesh(orbMesh, orbNode.worldMatrix);
  for (let i = 0; i < rolling; i += 1) sink.mesh(boulderMesh, boulderNodes[i].worldMatrix);
  for (let c = 0; c < CRYSTALS; c += 1) sink.mesh(crystalMesh, crystalNodes[c].worldMatrix);
};

const lightMatrix = new Float32Array(16);
ENV.lightViewProj = lightMatrix;
ENV.shadowStrength = 0.75;
// #endregion

// #region hud
const scoreLine = renderer.createText();
const banner = renderer.createText();
const hint = renderer.createText();
let hudStyle: TextStyle = { ...DEFAULT_TEXT_STYLE, color: [1, 0.96, 0.9], glow: 0.7 };
let warnStyle: TextStyle = { ...DEFAULT_TEXT_STYLE, color: [1, 0.45, 0.35], glow: 0.9 };
let bannerStyle: TextStyle = { ...DEFAULT_TEXT_STYLE, color: [1, 0.85, 0.5], glow: 0.9 };
const shown = { score: -1, seconds: -1, best: -1, phase: '', hinting: false };

function drawHud(): void {
  const seconds = Math.ceil(run.remaining);
  const over = run.phase.tag === 'Over';
  const hinting = over || rules.elapsed(run) < 6;
  if (
    run.score !== shown.score ||
    seconds !== shown.seconds ||
    run.best !== shown.best ||
    run.phase.tag !== shown.phase ||
    hinting !== shown.hinting
  ) {
    shown.score = run.score;
    shown.seconds = seconds;
    shown.best = run.best;
    shown.phase = run.phase.tag;
    shown.hinting = hinting;
    renderer.setText(scoreLine, `SCORE ${run.score}    TIME ${seconds}    BEST ${run.best}`);
    renderer.setText(banner, run.newBest ? `NEW BEST  ${run.score}` : `TIME UP  SCORE ${run.score}`);
    renderer.setText(
      hint,
      over
        ? 'SPACE OR ENTER OR A OR TAP TO PLAY AGAIN'
        : 'GATHER CRYSTALS  DODGE BOULDERS  R RESTARTS',
    );
  }

  const width = renderer.cssWidth;
  const height = renderer.cssHeight;
  const cell = Math.max(2, Math.round(Math.min(width, height) / 220));
  if (cell !== hudStyle.cellSize) {
    hudStyle = { ...hudStyle, cellSize: cell };
    warnStyle = { ...warnStyle, cellSize: cell };
    bannerStyle = { ...bannerStyle, cellSize: cell * 2 };
  }
  const top = Math.round(height * 0.05) + cell * 7;
  renderer.drawText(
    scoreLine,
    width,
    height,
    Math.round(width / 2 - renderer.textWidth(scoreLine, cell) / 2),
    top,
    !over && seconds <= 10 ? warnStyle : hudStyle,
    0,
  );
  if (over) {
    renderer.drawText(
      banner,
      width,
      height,
      Math.round(width / 2 - renderer.textWidth(banner, cell * 2) / 2),
      Math.round(height * 0.42),
      bannerStyle,
      0,
    );
  }
  if (hinting) {
    renderer.drawText(
      hint,
      width,
      height,
      Math.round(width / 2 - renderer.textWidth(hint, cell) / 2),
      over ? Math.round(height * 0.42) + cell * 12 : top + cell * 12,
      hudStyle,
      0,
    );
  }
}
// #endregion

// #region render
function render(alpha: number, frameDt: number): void {
  // Input is sampled here, at the edge of the simulation: a step reads what this left behind.
  touch.tick(performance.now());
  clock += frameDt;
  placeEverything(alpha);
  const at = orbNode.position;
  follow(at[0], at[1], at[2], frameDt);
  sky.cloudOffsetX = clock * 1.4;
  sky.cloudOffsetZ = clock * 0.5;

  ENV.shadowDepthSpan = computeLightMatrix(SUN, 0, 0, 0, 24, renderer.shadowMapSize, lightMatrix);
  renderer.beginShadowPass(lightMatrix, 'static');
  renderer.drawShadowCasters(casters);
  renderer.endShadowPass();

  renderer.beginFrame(sky.horizon);
  renderer.bindMeshPass(camera, ENV);
  renderer.drawMesh(distantMesh, still.worldMatrix);
  renderer.drawSceneCasters(casters);
  renderer.drawSky(camera, sky, ENV);
  drawHud();
  renderer.endFrame();
}
// #endregion

// #region loop
newRun();
startLoop({ simulate, render });
// #endregion
