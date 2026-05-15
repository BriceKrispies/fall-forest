/**
 * Deterministic per-chunk procedural generator (2D).
 *
 * Pure function: (worldSeed, cx, cz, size) → chunk content. Same (seed, cx, cz)
 * always yields the same data. All randomness flows through a chunk-local
 * seeded RNG; no Math.random() inside.
 *
 * Visual language matches the existing storybook forest — chunky props,
 * dense placement, layered tree rings around the path. The path itself
 * lives in the cx=0 column; other chunks are open forest.
 */

import { chunkBounds, chunkRNG, hashChunkCoord } from './chunk-coords.js';
import { createRNG } from './seed.js';
import { generatePathNodes } from './path-gen.js';
import { groundY, setContext, clearContext, groundColor } from './terrain.js';
import {
  makeBush, makeFlowerPatch, makeGrassClump,
  makeRock, makeStump, makeLog, makeGroundPatch,
  makeTreeShadow, makeRockShadow, makeStumpShadow, makeLogShadow, makeBushShadow,
  makeFireplace, makeLampPost,
  makeTreeALayered, makeTreeBLayered, makeTreeCLayered,
} from '../props.js';

// ── Ground & path colors ──
const GROUND_GREEN_LIT = [0.26, 0.37, 0.17];
const GROUND_GREEN_SHADE = [0.17, 0.26, 0.11];
const GROUND_MOSS_LIT = [0.24, 0.33, 0.15];
const GROUND_MOSS_SHADE = [0.15, 0.22, 0.09];
const PATH_COLOR_LIT = [0.6, 0.44, 0.28];
const PATH_COLOR_SHADE = [0.42, 0.32, 0.2];
const DIRT_COLOR_LIT = [0.52, 0.4, 0.26];
const DIRT_COLOR_SHADE = [0.36, 0.28, 0.18];

const TREE_TYPES = ['A', 'B', 'C'];
const TREE_HEIGHTS = { A: 3.6, B: 4.4, C: 4.0 };
const TREE_CANOPY = { A: 1.4, B: 1.6, C: 1.0 };
const TREE_LAYERED = { A: makeTreeALayered, B: makeTreeBLayered, C: makeTreeCLayered };

const MIN_TREE_DIST = 2.0;
const MIN_BUSH_DIST = 1.2;

/** cx of the column that carries the path. */
const PATH_COLUMN_CX = 0;

// ── Helpers ──

function sunExposure(x, z) {
  const v = Math.sin(z * 0.28 + x * 0.15) * 0.5 + Math.sin(z * 0.13 - x * 0.22) * 0.3 + 0.5;
  return Math.max(0, Math.min(1, v));
}

function lerpColor(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function nearestPathDist(px, pz, pathNodes) {
  let best = 1e9;
  let bestDx = 0;
  for (let i = 0; i < pathNodes.length - 1; i++) {
    const ax = pathNodes[i][0], az = pathNodes[i][2];
    const bx = pathNodes[i + 1][0], bz = pathNodes[i + 1][2];
    const dx = bx - ax, dz = bz - az;
    const len2 = dx * dx + dz * dz;
    if (len2 < 0.001) continue;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2));
    const cx = ax + t * dx, cz = az + t * dz;
    const ex = px - cx, ez = pz - cz;
    const d = Math.sqrt(ex * ex + ez * ez);
    if (d < best) { best = d; bestDx = ex; }
  }
  return { dist: best, dx: bestDx };
}

function pushFromPath(x, z, minDist, pathNodes) {
  if (!pathNodes || pathNodes.length < 2) return x;
  const { dist, dx } = nearestPathDist(x, z, pathNodes);
  if (dist >= minDist) return x;
  const sign = dx >= 0 ? 1 : -1;
  return x + sign * (minDist - dist);
}

// ── Phase 1: feature planning ──
// Determines positions of all props. Run before terrain context is set so
// the feature list can be handed to the terrain layer for ground deformation.

function planChunk(worldSeed, cx, cz, size, pathNodes) {
  const rng = chunkRNG(worldSeed, cx, cz);
  const { xMin, xMax, zMin, zMax } = chunkBounds(cx, cz, size);
  const hasPath = pathNodes && pathNodes.length >= 2;

  const features = [];
  const treePlacements = [];
  const bushPlacements = [];
  const rockPlacements = [];
  const stumpPlacements = [];
  const logPlacements = [];
  const flowerPlacements = [];

  function planTree(type, x, z, scale, rot) {
    treePlacements.push({ type, x, z, scale, rot });
    features.push({ x, z, type: 'tree' });
  }

  // Trees — denser in 3 layered rings near the path on the path column,
  // uniform but still dense elsewhere.
  const area = size * size;
  const treeCount = Math.round(area / 22);   // ≈12 for 16x16
  const bushCount = Math.round(area / 25);   // ≈10
  const rockCount = Math.round(area / 50);   // ≈5
  const stumpCount = Math.round(area / 120); // ≈2
  const logCount = Math.round(area / 220);   // ≈1
  const flowerCount = Math.round(area / 26); // ≈10

  if (hasPath) {
    // Layered rings: outer wall, middle, inner — matches existing visual rhythm.
    const outer = Math.round(treeCount * 0.45);
    const inner = Math.round(treeCount * 0.30);
    const far = treeCount - outer - inner;

    for (let i = 0; i < outer; i++) {
      const type = rng.pick(TREE_TYPES);
      const side = rng.next() > 0.5 ? 1 : -1;
      const rawX = side * rng.range(3, 6.5);
      const z = rng.range(zMin + 0.5, zMax - 0.5);
      const x = pushFromPath(rawX, z, MIN_TREE_DIST, pathNodes);
      planTree(type, x, z, rng.range(0.8, 1.4), rng.range(0, 6.28));
    }
    for (let i = 0; i < inner; i++) {
      const type = rng.pick(TREE_TYPES);
      const side = rng.next() > 0.5 ? 1 : -1;
      const rawX = side * rng.range(2, 3.5);
      const z = rng.range(zMin + 0.5, zMax - 0.5);
      const x = pushFromPath(rawX, z, MIN_TREE_DIST, pathNodes);
      planTree(type, x, z, rng.range(0.6, 0.85), rng.range(0, 6.28));
    }
    for (let i = 0; i < far; i++) {
      const type = rng.pick(TREE_TYPES);
      const side = rng.next() > 0.5 ? 1 : -1;
      const x = side * rng.range(6.5, 7.8);
      const z = rng.range(zMin + 1, zMax - 1);
      planTree(type, x, z, rng.range(1.2, 1.6), rng.range(0, 6.28));
    }
  } else {
    // Open chunk — uniform but slightly clustered placement.
    for (let i = 0; i < treeCount; i++) {
      const type = rng.pick(TREE_TYPES);
      const x = rng.range(xMin + 0.5, xMax - 0.5);
      const z = rng.range(zMin + 0.5, zMax - 0.5);
      const scale = rng.range(0.7, 1.5);
      planTree(type, x, z, scale, rng.range(0, 6.28));
    }
  }

  // Bushes — hug path on path column, uniform elsewhere.
  for (let i = 0; i < bushCount; i++) {
    let x, z;
    if (hasPath) {
      const side = rng.next() > 0.5 ? 1 : -1;
      const rawX = side * rng.range(0.8, 3);
      z = rng.range(zMin + 0.3, zMax - 0.3);
      x = pushFromPath(rawX, z, MIN_BUSH_DIST, pathNodes);
    } else {
      x = rng.range(xMin + 0.3, xMax - 0.3);
      z = rng.range(zMin + 0.3, zMax - 0.3);
    }
    bushPlacements.push({ x, z, scale: rng.range(0.5, 1.1), rot: rng.range(0, 6.28) });
  }

  // Rocks, stumps, logs — small props, scattered across the chunk.
  for (let i = 0; i < rockCount; i++) {
    const x = rng.range(xMin + 0.5, xMax - 0.5);
    const z = rng.range(zMin + 0.5, zMax - 0.5);
    const scale = rng.range(0.3, 0.8);
    rockPlacements.push({ x, z, scale, rot: rng.range(0, 6.28) });
    features.push({ x, z, type: 'rock' });
  }
  for (let i = 0; i < stumpCount; i++) {
    const x = rng.range(xMin + 1, xMax - 1);
    const z = rng.range(zMin + 1, zMax - 1);
    const scale = rng.range(0.7, 0.9);
    stumpPlacements.push({ x, z, scale });
    features.push({ x, z, type: 'stump' });
  }
  for (let i = 0; i < logCount; i++) {
    const x = rng.range(xMin + 1, xMax - 1);
    const z = rng.range(zMin + 1, zMax - 1);
    logPlacements.push({
      x, z,
      len: rng.range(1.0, 1.4),
      scale: rng.range(0.7, 0.8),
      rot: rng.range(0, 6.28),
    });
    features.push({ x, z, type: 'log' });
  }

  // Flowers — small patches, near path on the path column.
  for (let i = 0; i < flowerCount; i++) {
    let x, z;
    if (hasPath) {
      x = rng.range(-2.0, 2.0);
      z = rng.range(zMin + 0.5, zMax - 0.5);
    } else {
      x = rng.range(xMin + 0.5, xMax - 0.5);
      z = rng.range(zMin + 0.5, zMax - 0.5);
    }
    flowerPlacements.push({
      x, z,
      count: rng.int(3, 8),
      spread: rng.range(0.3, 0.6),
      seed: rng.int(0, 1000),
    });
  }

  // Scenic beats (fireplace / lamp) — sparse, deterministic per chunk.
  const scenicBeats = [];
  const beatRNG = createRNG(hashChunkCoord(worldSeed ^ 0x5EA5C0DE, cx, cz));
  const beatRoll = beatRNG.next();

  if (cx === 0 && cz === 0) {
    // Spawn chunk anchor: a hearth near the player's start point.
    const fpx = 3.5, fpz = -2.5;
    scenicBeats.push({ type: 'fireplace', x: fpx, z: fpz });
    features.push({ x: fpx, z: fpz, type: 'fireplace' });
    const lpx = -1.0, lpz = 4.5;
    scenicBeats.push({ type: 'lamp', x: lpx, z: lpz });
  } else if (beatRoll < 0.12) {
    const fpx = beatRNG.range(xMin + 2.5, xMax - 2.5);
    const fpz = beatRNG.range(zMin + 2.5, zMax - 2.5);
    scenicBeats.push({ type: 'fireplace', x: fpx, z: fpz });
    features.push({ x: fpx, z: fpz, type: 'fireplace' });
  } else if (beatRoll < 0.25) {
    const lpx = beatRNG.range(xMin + 1.5, xMax - 1.5);
    const lpz = beatRNG.range(zMin + 1.5, zMax - 1.5);
    scenicBeats.push({ type: 'lamp', x: lpx, z: lpz });
  }

  return {
    features,
    treePlacements,
    bushPlacements,
    rockPlacements,
    stumpPlacements,
    logPlacements,
    flowerPlacements,
    scenicBeats,
  };
}

// ── Phase 2: geometry build ──

function buildChunkTris(worldSeed, cx, cz, size, pathNodes, plan) {
  const { xMin, xMax, zMin, zMax } = chunkBounds(cx, cz, size);
  const tris = [];

  // Ground patches — 3.2m tiles, zone-aware coloring.
  // Snap to a global 3.2m grid so adjacent chunks tile seamlessly.
  const STEP = 3.2;
  const gxStart = Math.ceil(xMin / STEP) * STEP;
  const gzStart = Math.ceil(zMin / STEP) * STEP;
  for (let gz = gzStart; gz < zMax; gz += STEP) {
    for (let gx = gxStart; gx < xMax; gx += STEP) {
      const expo = sunExposure(gx, gz);
      const isAlt = ((gx | 0) + (gz | 0)) % 2 === 0;
      const baseC = isAlt
        ? lerpColor(GROUND_GREEN_SHADE, GROUND_GREEN_LIT, expo)
        : lerpColor(GROUND_MOSS_SHADE, GROUND_MOSS_LIT, expo);
      const c = groundColor(gx, gz, baseC);
      tris.push(...makeGroundPatch(gx, gz, STEP, STEP, groundY, c));
    }
  }

  // Path surface — only when this chunk owns the path.
  if (pathNodes && pathNodes.length >= 2) {
    const pathYFunc = (x, z) => groundY(x, z) + 0.02;
    for (let i = 0; i < pathNodes.length - 1; i++) {
      const a = pathNodes[i], b = pathNodes[i + 1];
      const steps = 4;
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        const px = a[0] + (b[0] - a[0]) * t;
        const pz = a[2] + (b[2] - a[2]) * t;
        const expo = sunExposure(px, pz);
        const c = s % 2 === 0
          ? lerpColor(PATH_COLOR_SHADE, PATH_COLOR_LIT, expo)
          : lerpColor(DIRT_COLOR_SHADE, DIRT_COLOR_LIT, expo);
        tris.push(...makeGroundPatch(px, pz, 1.6, 1.0, pathYFunc, c));
      }
    }
  }

  // Trees — terrain-aware base height.
  const trees = [];
  const treeAnimRNG = chunkRNG(worldSeed, cx, cz, 0x77777777);
  for (const tp of plan.treePlacements) {
    const gy = groundY(tp.x, tp.z);
    tris.push(...makeTreeShadow(tp.x, gy, tp.z, TREE_HEIGHTS[tp.type], TREE_CANOPY[tp.type], tp.scale));
    const layered = TREE_LAYERED[tp.type](tp.x, gy, tp.z, tp.scale, tp.rot);
    tris.push(...layered.trunk);
    trees.push({
      x: tp.x, z: tp.z, type: tp.type, scale: tp.scale,
      canopyLayers: layered.canopyLayers,
      phase: treeAnimRNG.range(0, 6.28),
      speed: treeAnimRNG.range(0.4, 0.7),
      amplitude: treeAnimRNG.range(0.012, 0.025),
    });
  }

  for (const bp of plan.bushPlacements) {
    const gy = groundY(bp.x, bp.z);
    tris.push(...makeBushShadow(bp.x, gy, bp.z, bp.scale));
    tris.push(...makeBush(bp.x, gy, bp.z, bp.scale, bp.rot));
  }

  for (const rp of plan.rockPlacements) {
    const gy = groundY(rp.x, rp.z);
    tris.push(...makeRockShadow(rp.x, gy, rp.z, rp.scale));
    tris.push(...makeRock(rp.x, gy, rp.z, rp.scale, rp.rot));
  }

  for (const sp of plan.stumpPlacements) {
    const gy = groundY(sp.x, sp.z);
    tris.push(...makeStumpShadow(sp.x, gy, sp.z, sp.scale));
    tris.push(...makeStump(sp.x, gy, sp.z, sp.scale));
  }

  for (const lp of plan.logPlacements) {
    const gy = groundY(lp.x, lp.z);
    tris.push(...makeLogShadow(lp.x, gy, lp.z, lp.len, lp.scale, lp.rot));
    tris.push(...makeLog(lp.x, gy, lp.z, lp.len, lp.scale, lp.rot));
  }

  for (const fp of plan.flowerPlacements) {
    const gy = groundY(fp.x, fp.z);
    tris.push(...makeFlowerPatch(fp.x, gy, fp.z, fp.count, fp.spread, fp.seed));
  }

  // Static grass clumps — dense ground cover across the full chunk.
  for (let z = zMin; z < zMax; z += 1.2) {
    for (let x = xMin; x < xMax; x += 1.5) {
      const seed = x * 100 + z * 7;
      const ox = Math.sin(seed) * 0.4;
      const oz = Math.cos(seed * 1.3) * 0.3;
      const gx = x + ox, gz = z + oz;
      const count = 4 + Math.floor(Math.abs(Math.sin(seed * 2)) * 3);
      const gy = groundY(gx, gz);
      tris.push(...makeGrassClump(gx, gy, gz, count, 0.3, seed));
    }
  }

  // Scenic beat geometry (fireplace structure, lamp post).
  for (const beat of plan.scenicBeats) {
    const gy = groundY(beat.x, beat.z);
    if (beat.type === 'fireplace') tris.push(...makeFireplace(beat.x, gy, beat.z));
    else if (beat.type === 'lamp') tris.push(...makeLampPost(beat.x, gy, beat.z));
  }

  return { tris, trees };
}

// ── Grass instances (WASM-animated blades) ──

function buildGrassInstances(cx, cz, size) {
  const { xMin, xMax, zMin, zMax } = chunkBounds(cx, cz, size);
  const out = [];
  for (let z = zMin; z < zMax; z += 1.2) {
    for (let x = xMin; x < xMax; x += 1.2) {
      const seed = x * 100 + z * 7;
      const ox = Math.sin(seed) * 0.3;
      const oz = Math.cos(seed * 1.3) * 0.2;
      const gx = x + ox, gz = z + oz;
      const gy = groundY(gx, gz);
      const h = 0.12 + 0.08 * Math.sin(seed + 1.3);
      const colorSeed = Math.abs(Math.sin(seed * 2.7));
      out.push([gx, gy, gz, h, colorSeed, 0]);
    }
  }
  return out;
}

// ── Public entry ──

/**
 * Generate one chunk's full content.
 *
 * @param {number} worldSeed
 * @param {number} cx
 * @param {number} cz
 * @param {number} size  Chunk edge length in meters.
 * @returns Chunk record (immutable until the chunk is unloaded).
 */
export function generateChunk(worldSeed, cx, cz, size) {
  const bounds = chunkBounds(cx, cz, size);

  // Path lives only in the cx=0 column. Other chunks have no path.
  const pathNodes = cx === PATH_COLUMN_CX
    ? generatePathNodes(worldSeed, cz, size)
    : [];

  const plan = planChunk(worldSeed, cx, cz, size, pathNodes);

  // Hand path + features to the terrain layer so groundY() applies the
  // path carve and feature mounds while we build geometry.
  setContext(pathNodes, plan.features);
  const { tris, trees } = buildChunkTris(worldSeed, cx, cz, size, pathNodes, plan);
  clearContext();

  // Grass instances don't need terrain context — they only use groundY's
  // macro+zone layers indirectly via groundY here (path/feature ctx is off).
  const grassInstances = buildGrassInstances(cx, cz, size);

  return {
    cx, cz,
    bounds,
    pathNodes,
    tris,
    trees,
    grassInstances,
    scenicBeats: plan.scenicBeats,
    triCount: tris.length,
  };
}
