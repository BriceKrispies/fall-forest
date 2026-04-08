/**
 * Procedural chunk content generator.
 *
 * Pure function: (worldSeed, coord, chunkDepth) → chunk data.
 * Uses existing props.js mesh generators — same visual language as the
 * hand-authored scene, but placed by seeded RNG.
 */

import { createRNG, hashCoord } from './seed.js';
import { generatePathNodes } from './path-gen.js';
import { groundY, setContext, clearContext, groundColor, getZone } from './terrain.js';
import {
  makeTreeA, makeTreeB, makeTreeC, makeBush, makeFlowerPatch,
  makeGrassClump, makeRock, makeStump, makeLog, makeGroundPatch,
  makeTreeShadow, makeRockShadow, makeStumpShadow, makeLogShadow, makeBushShadow,
  makeFireplace, makeLampPost,
  makeTreeALayered, makeTreeBLayered, makeTreeCLayered,
} from '../props.js';

// ── Ground colors (from scene.js) ──
const GROUND_GREEN_LIT = [0.26, 0.37, 0.17];
const GROUND_GREEN_SHADE = [0.17, 0.26, 0.11];
const GROUND_MOSS_LIT = [0.24, 0.33, 0.15];
const GROUND_MOSS_SHADE = [0.15, 0.22, 0.09];
const PATH_COLOR_LIT = [0.6, 0.44, 0.28];
const PATH_COLOR_SHADE = [0.42, 0.32, 0.2];
const DIRT_COLOR_LIT = [0.52, 0.4, 0.26];
const DIRT_COLOR_SHADE = [0.36, 0.28, 0.18];

// ── Valley wall generation (chunk-local) ──
const SLOPE_BASE = [0.28, 0.34, 0.18];
const SLOPE_MID = [0.42, 0.36, 0.24];
const SLOPE_UPPER = [0.48, 0.44, 0.38];
const SLOPE_RIDGE = [0.38, 0.36, 0.33];
const SLOPE_TOP = [0.32, 0.30, 0.28];
const SLOPE_COLORS = [SLOPE_BASE, SLOPE_MID, SLOPE_UPPER, SLOPE_RIDGE, SLOPE_TOP];

function makeWallSection(x0, z0, x1, z1, outDirX, outDirZ, flipWinding = false) {
  const tris = [];
  const dx = x1 - x0, dz = z1 - z0;
  const wallLen = Math.sqrt(dx * dx + dz * dz);
  const segLen = 2;
  const segments = Math.max(1, Math.round(wallLen / segLen));
  const strips = 4;
  const slopeDepth = 5;
  const ridgeHeight = 10;

  const verts = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const wx = x0 + dx * t;
    const wz = z0 + dz * t;
    const col = [];
    for (let s = 0; s <= strips; s++) {
      const f = s / strips;
      const px = wx + outDirX * slopeDepth * f;
      const pz = wz + outDirZ * slopeDepth * f;
      const baseY = groundY(wx, wz);
      const noise = Math.sin(wx * 1.7 + wz * 0.9) * 0.4 * f +
                    Math.cos(wx * 0.8 - wz * 1.3) * 0.2 * f;
      const py = baseY + ridgeHeight * f * f + noise;
      col.push([px, py, pz]);
    }
    verts.push(col);
  }

  for (let i = 0; i < segments; i++) {
    for (let s = 0; s < strips; s++) {
      const a = verts[i][s];
      const b = verts[i + 1][s];
      const c = verts[i + 1][s + 1];
      const d = verts[i][s + 1];
      const baseColor = SLOPE_COLORS[s];
      const variation = Math.sin(i * 3 + s * 7) * 0.02;
      const variation2 = Math.cos(i * 5 + s * 3) * 0.02;
      const col = [baseColor[0] + variation, baseColor[1] + variation2, baseColor[2]];
      if (flipWinding) {
        tris.push([a, b, c, col]);
        tris.push([a, c, d, col]);
      } else {
        tris.push([a, c, b, col]);
        tris.push([a, d, c, col]);
      }
    }
  }
  return tris;
}

// ── Placement helpers ──
const MIN_TREE_DIST = 2.0;
const MIN_BUSH_DIST = 1.2;

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
  const { dist, dx } = nearestPathDist(x, z, pathNodes);
  if (dist >= minDist) return x;
  const sign = dx >= 0 ? 1 : -1;
  return x + sign * (minDist - dist);
}

function sunExposure(x, z) {
  const v = Math.sin(z * 0.28 + x * 0.15) * 0.5 + Math.sin(z * 0.13 - x * 0.22) * 0.3 + 0.5;
  return Math.max(0, Math.min(1, v));
}

function lerpColor(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

const TREE_TYPES = ['A', 'B', 'C'];
const TREE_HEIGHTS = { A: 3.6, B: 4.4, C: 4.0 };
const TREE_CANOPY = { A: 1.4, B: 1.6, C: 1.0 };
const TREE_MAKERS = { A: makeTreeA, B: makeTreeB, C: makeTreeC };
const TREE_LAYERED = { A: makeTreeALayered, B: makeTreeBLayered, C: makeTreeCLayered };

/**
 * Generate all content for a single chunk.
 *
 * @returns {{ tris: Array, grassInstances: Array, pathNodes: Array, scenicBeats: Array }}
 */
export function generateChunk(worldSeed, coord, chunkDepth) {
  const chunkSeed = hashCoord(worldSeed, coord);
  const rng = createRNG(chunkSeed);
  const pathNodes = generatePathNodes(worldSeed, coord, chunkDepth);

  const zMin = coord * chunkDepth;
  const zMax = zMin + chunkDepth;
  const tris = [];
  const scenicBeats = [];

  // ── Phase 1: Determine feature positions (before terrain context) ──
  // We need to know where features go so the terrain can deform around them.
  // Consume RNG in the same order as before to keep determinism.

  const features = []; // { x, z, type } for terrain influence

  // Slope boulders (wall-side, not tracked as features)
  const wallBoulders = [];
  for (let i = 0; i < 4; i++) {
    const bx = rng.pick([-10, -11, 10, 11]);
    const bz = rng.range(zMin + 1, zMax - 1);
    const bs = rng.range(0.5, 0.8);
    const brot = rng.range(0, 6.28);
    wallBoulders.push({ x: bx, z: bz, scale: bs, rot: brot });
  }

  // Tree positions
  const treePlacements = [];

  function planTree(type, x, z, scale, rot) {
    treePlacements.push({ type, x, z, scale, rot });
    features.push({ x, z, type: 'tree' });
  }

  // Outer ring
  const outerTreeCount = Math.round(chunkDepth / 2);
  for (let i = 0; i < outerTreeCount; i++) {
    const type = rng.pick(TREE_TYPES);
    const side = rng.next() > 0.5 ? 1 : -1;
    const rawX = side * rng.range(3, 7);
    const z = rng.range(zMin + 0.5, zMax - 0.5);
    const x = pushFromPath(rawX, z, MIN_TREE_DIST, pathNodes);
    planTree(type, x, z, rng.range(0.8, 1.5), rng.range(0, 6.28));
  }

  // Inner trees
  const innerTreeCount = Math.round(chunkDepth / 3);
  for (let i = 0; i < innerTreeCount; i++) {
    const type = rng.pick(TREE_TYPES);
    const side = rng.next() > 0.5 ? 1 : -1;
    const rawX = side * rng.range(2, 3.5);
    const z = rng.range(zMin + 0.5, zMax - 0.5);
    const x = pushFromPath(rawX, z, MIN_TREE_DIST, pathNodes);
    planTree(type, x, z, rng.range(0.6, 0.8), rng.range(0, 6.28));
  }

  // Far-edge trees
  const farTreeCount = Math.round(chunkDepth / 4);
  for (let i = 0; i < farTreeCount; i++) {
    const type = rng.pick(TREE_TYPES);
    const side = rng.next() > 0.5 ? 1 : -1;
    const x = side * rng.range(7, 8.5);
    const z = rng.range(zMin + 1, zMax - 1);
    planTree(type, x, z, rng.range(1.3, 1.6), rng.range(0, 6.28));
  }

  // Bush positions (not tracked as features — too small)
  const bushPlacements = [];
  const bushCount = Math.round(chunkDepth / 1.2);
  for (let i = 0; i < bushCount; i++) {
    const side = rng.next() > 0.5 ? 1 : -1;
    const rawX = side * rng.range(0.8, 3);
    const z = rng.range(zMin + 0.3, zMax - 0.3);
    const x = pushFromPath(rawX, z, MIN_BUSH_DIST, pathNodes);
    const scale = rng.range(0.5, 1.1);
    const rot = rng.range(0, 6.28);
    bushPlacements.push({ x, z, scale, rot });
  }

  // Rock positions
  const rockPlacements = [];
  const rockCount = Math.round(chunkDepth / 2.5);
  for (let i = 0; i < rockCount; i++) {
    const x = rng.range(-2.5, 2.5);
    const z = rng.range(zMin + 0.5, zMax - 0.5);
    const scale = rng.range(0.3, 0.8);
    const rot = rng.range(0, 6.28);
    rockPlacements.push({ x, z, scale, rot });
    features.push({ x, z, type: 'rock' });
  }

  // Stump positions
  const stumpPlacements = [];
  const stumpCount = Math.round(chunkDepth / 8);
  for (let i = 0; i < stumpCount; i++) {
    const x = rng.range(-2, 2);
    const z = rng.range(zMin + 1, zMax - 1);
    const scale = rng.range(0.7, 0.9);
    stumpPlacements.push({ x, z, scale });
    features.push({ x, z, type: 'stump' });
  }

  // Log positions
  const logPlacements = [];
  const logCount = Math.round(chunkDepth / 10);
  for (let i = 0; i < logCount; i++) {
    const x = rng.range(-2, 2);
    const z = rng.range(zMin + 1, zMax - 1);
    const len = rng.range(1.0, 1.4);
    const scale = rng.range(0.7, 0.8);
    const rot = rng.range(0, 6.28);
    logPlacements.push({ x, z, len, scale, rot });
    features.push({ x, z, type: 'log' });
  }

  // Flower positions (consume RNG in same order)
  const flowerPlacements = [];
  const flowerCount = Math.round(chunkDepth / 1.5);
  for (let i = 0; i < flowerCount; i++) {
    const x = rng.range(-1.5, 1.5);
    const z = rng.range(zMin + 0.5, zMax - 0.5);
    const count = rng.int(3, 8);
    const spread = rng.range(0.3, 0.6);
    const seed = rng.int(0, 1000);
    flowerPlacements.push({ x, z, count, spread, seed });
  }

  // Scenic beats — determine positions
  const beatRNG = createRNG(hashCoord(worldSeed, coord + 99999));
  const beatRoll = beatRNG.next();

  if (coord === 0) {
    const fpx = 4.5, fpz = zMax - 2.5;
    scenicBeats.push({ type: 'fireplace', x: fpx, z: fpz });
    features.push({ x: fpx, z: fpz, type: 'fireplace' });
    const lpx = 1.0, lpz = zMin + chunkDepth * 0.45;
    scenicBeats.push({ type: 'lamp', x: lpx, z: lpz });
  } else if (beatRoll < 0.2) {
    const fpx = beatRNG.range(-2, 3);
    const fpz = beatRNG.range(zMin + 3, zMax - 3);
    scenicBeats.push({ type: 'fireplace', x: fpx, z: fpz });
    features.push({ x: fpx, z: fpz, type: 'fireplace' });
  }
  if (coord !== 0 && beatRoll >= 0.2 && beatRoll < 0.55) {
    const lpx = beatRNG.range(-1.5, 2);
    const lpz = beatRNG.range(zMin + 2, zMax - 2);
    scenicBeats.push({ type: 'lamp', x: lpx, z: lpz });
  }

  // ── Phase 2: Set terrain context and generate all geometry ──
  setContext(pathNodes, features);

  // Valley walls (left wall needs flipped winding so normals face inward)
  tris.push(...makeWallSection(-12, zMin, -12, zMax, -1, 0, true));
  tris.push(...makeWallSection(12, zMin, 12, zMax, 1, 0, false));
  for (const wb of wallBoulders) {
    tris.push(...makeRock(wb.x, groundY(wb.x, wb.z), wb.z, wb.scale, wb.rot));
  }

  // Ground patches — zone-aware coloring with per-cell color sampling
  for (let gz = zMin; gz < zMax; gz += 3) {
    for (let gx = -12; gx < 12; gx += 3) {
      const expo = sunExposure(gx, gz);
      const isAlt = ((gx | 0) + (gz | 0)) % 2 === 0;
      const baseC = isAlt
        ? lerpColor(GROUND_GREEN_SHADE, GROUND_GREEN_LIT, expo)
        : lerpColor(GROUND_MOSS_SHADE, GROUND_MOSS_LIT, expo);
      // Sample color at patch center — groundColor applies zone tint + height shift
      const c = groundColor(gx, gz, baseC);
      tris.push(...makeGroundPatch(gx, gz, 3.2, 3.2, groundY, c));
    }
  }

  // Path surface — follows terrain height (includes path carving)
  // Slight +0.02 offset keeps path visually above ground z-fighting
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

  // Trees (using pre-planned positions, terrain-aware height)
  const trees = [];
  // Need a separate RNG for tree animation params (phase/speed/amp)
  // since the main rng was consumed during planning
  const treeAnimRNG = createRNG(hashCoord(worldSeed, coord + 77777));

  for (const tp of treePlacements) {
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

  // Bushes
  for (const bp of bushPlacements) {
    const gy = groundY(bp.x, bp.z);
    tris.push(...makeBushShadow(bp.x, gy, bp.z, bp.scale));
    tris.push(...makeBush(bp.x, gy, bp.z, bp.scale, bp.rot));
  }

  // Rocks
  for (const rp of rockPlacements) {
    const gy = groundY(rp.x, rp.z);
    tris.push(...makeRockShadow(rp.x, gy, rp.z, rp.scale));
    tris.push(...makeRock(rp.x, gy, rp.z, rp.scale, rp.rot));
  }

  // Stumps
  for (const sp of stumpPlacements) {
    const gy = groundY(sp.x, sp.z);
    tris.push(...makeStumpShadow(sp.x, gy, sp.z, sp.scale));
    tris.push(...makeStump(sp.x, gy, sp.z, sp.scale));
  }

  // Logs
  for (const lp of logPlacements) {
    const gy = groundY(lp.x, lp.z);
    tris.push(...makeLogShadow(lp.x, gy, lp.z, lp.len, lp.scale, lp.rot));
    tris.push(...makeLog(lp.x, gy, lp.z, lp.len, lp.scale, lp.rot));
  }

  // Flowers
  for (const fp of flowerPlacements) {
    const gy = groundY(fp.x, fp.z);
    tris.push(...makeFlowerPatch(fp.x, gy, fp.z, fp.count, fp.spread, fp.seed));
  }

  // Grass clumps (static triangle geometry)
  for (let z = zMin; z < zMax; z += 1.2) {
    for (let x = -6; x < 6; x += 1.5) {
      const seed = x * 100 + z * 7;
      const ox = Math.sin(seed) * 0.4;
      const oz = Math.cos(seed * 1.3) * 0.3;
      const gx = x + ox, gz = z + oz;
      const count = 4 + Math.floor(Math.abs(Math.sin(seed * 2)) * 3);
      const gy = groundY(gx, gz);
      tris.push(...makeGrassClump(gx, gy, gz, count, 0.3, seed));
    }
  }

  // Grass instances (WASM-animated blades)
  const grassInstances = [];
  for (let z = zMin; z < zMax; z += 0.8) {
    for (let x = -6; x < 6; x += 0.9) {
      const seed = x * 100 + z * 7;
      const ox = Math.sin(seed) * 0.3;
      const oz = Math.cos(seed * 1.3) * 0.2;
      const gx = x + ox, gz = z + oz;
      const gy = groundY(gx, gz);
      const h = 0.12 + 0.08 * Math.sin(seed + 1.3);
      const colorSeed = Math.abs(Math.sin(seed * 2.7));
      grassInstances.push([gx, gy, gz, h, colorSeed, 0]);
    }
  }

  // Scenic beat geometry
  for (const beat of scenicBeats) {
    const gy = groundY(beat.x, beat.z);
    if (beat.type === 'fireplace') {
      tris.push(...makeFireplace(beat.x, gy, beat.z));
    } else if (beat.type === 'lamp') {
      tris.push(...makeLampPost(beat.x, gy, beat.z));
    }
  }

  // ── Clean up terrain context ──
  clearContext();

  return {
    coord,
    zMin,
    zMax,
    tris,
    trees,
    grassInstances,
    pathNodes,
    scenicBeats,
    triCount: tris.length,
  };
}
