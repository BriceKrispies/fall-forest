/**
 * Procedural chunk content generator.
 *
 * Pure function: (worldSeed, coord, chunkDepth) → chunk data.
 * Uses existing props.js mesh generators — same visual language as the
 * hand-authored scene, but placed by seeded RNG.
 */

import { createRNG, hashCoord } from './seed.js';
import { generatePathNodes, groundY } from './path-gen.js';
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
const SLOPE_COLORS = [SLOPE_BASE, SLOPE_MID, SLOPE_UPPER, SLOPE_RIDGE];

function makeWallSection(x0, z0, x1, z1, outDirX, outDirZ) {
  const tris = [];
  const dx = x1 - x0, dz = z1 - z0;
  const wallLen = Math.sqrt(dx * dx + dz * dz);
  const segLen = 2;
  const segments = Math.max(1, Math.round(wallLen / segLen));
  const strips = 3;
  const slopeDepth = 4;
  const ridgeHeight = 4;

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
      tris.push([a, c, b, col]);
      tris.push([a, d, c, col]);
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

  // ── Valley walls (east/west sides for this chunk's Z range) ──
  tris.push(...makeWallSection(-12, zMin, -12, zMax, -1, 0));
  tris.push(...makeWallSection(12, zMin, 12, zMax, 1, 0));
  // Slope boulders on walls
  for (let i = 0; i < 4; i++) {
    const bx = rng.pick([-10, -11, 10, 11]);
    const bz = rng.range(zMin + 1, zMax - 1);
    const bs = rng.range(0.5, 0.8);
    tris.push(...makeRock(bx, groundY(bx, bz), bz, bs, rng.range(0, 6.28)));
  }

  // ── Ground patches ──
  for (let gz = zMin; gz < zMax; gz += 3) {
    for (let gx = -12; gx < 12; gx += 3) {
      const expo = sunExposure(gx, gz);
      const isAlt = ((gx | 0) + (gz | 0)) % 2 === 0;
      const c = isAlt
        ? lerpColor(GROUND_GREEN_SHADE, GROUND_GREEN_LIT, expo)
        : lerpColor(GROUND_MOSS_SHADE, GROUND_MOSS_LIT, expo);
      tris.push(...makeGroundPatch(gx, gz, 3.2, 3.2, groundY, c));
    }
  }

  // ── Path surface ──
  for (let i = 0; i < pathNodes.length - 1; i++) {
    const a = pathNodes[i], b = pathNodes[i + 1];
    const steps = 4;
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const px = a[0] + (b[0] - a[0]) * t;
      const pz = a[2] + (b[2] - a[2]) * t;
      const py = groundY(px, pz) + 0.02;
      const expo = sunExposure(px, pz);
      const c = s % 2 === 0
        ? lerpColor(PATH_COLOR_SHADE, PATH_COLOR_LIT, expo)
        : lerpColor(DIRT_COLOR_SHADE, DIRT_COLOR_LIT, expo);
      tris.push(...makeGroundPatch(px, pz, 1.6, 1.0, () => py, c));
    }
  }

  // ── Trees ──
  // Tree instances stored for breathing animation
  const trees = [];

  function placeTree(type, x, z, scale, rot) {
    const gy = groundY(x, z);
    tris.push(...makeTreeShadow(x, gy, z, TREE_HEIGHTS[type], TREE_CANOPY[type], scale));
    const layered = TREE_LAYERED[type](x, gy, z, scale, rot);
    tris.push(...layered.trunk);
    trees.push({
      x, z, type, scale,
      canopyLayers: layered.canopyLayers,
      phase: rng.range(0, 6.28),
      speed: rng.range(0.4, 0.7),
      amplitude: rng.range(0.012, 0.025),
    });
  }

  // Outer ring (dense canopy at corridor edges)
  const outerTreeCount = Math.round(chunkDepth / 2);
  for (let i = 0; i < outerTreeCount; i++) {
    const type = rng.pick(TREE_TYPES);
    const side = rng.next() > 0.5 ? 1 : -1;
    const rawX = side * rng.range(3, 7);
    const z = rng.range(zMin + 0.5, zMax - 0.5);
    const x = pushFromPath(rawX, z, MIN_TREE_DIST, pathNodes);
    placeTree(type, x, z, rng.range(0.8, 1.5), rng.range(0, 6.28));
  }

  // Inner trees (closer to path, smaller)
  const innerTreeCount = Math.round(chunkDepth / 3);
  for (let i = 0; i < innerTreeCount; i++) {
    const type = rng.pick(TREE_TYPES);
    const side = rng.next() > 0.5 ? 1 : -1;
    const rawX = side * rng.range(2, 3.5);
    const z = rng.range(zMin + 0.5, zMax - 0.5);
    const x = pushFromPath(rawX, z, MIN_TREE_DIST, pathNodes);
    placeTree(type, x, z, rng.range(0.6, 0.8), rng.range(0, 6.28));
  }

  // Far-edge trees (big, behind the wall line)
  const farTreeCount = Math.round(chunkDepth / 4);
  for (let i = 0; i < farTreeCount; i++) {
    const type = rng.pick(TREE_TYPES);
    const side = rng.next() > 0.5 ? 1 : -1;
    const x = side * rng.range(7, 8.5);
    const z = rng.range(zMin + 1, zMax - 1);
    placeTree(type, x, z, rng.range(1.3, 1.6), rng.range(0, 6.28));
  }

  // ── Bushes ──
  const bushCount = Math.round(chunkDepth / 1.2);
  for (let i = 0; i < bushCount; i++) {
    const side = rng.next() > 0.5 ? 1 : -1;
    const rawX = side * rng.range(0.8, 3);
    const z = rng.range(zMin + 0.3, zMax - 0.3);
    const x = pushFromPath(rawX, z, MIN_BUSH_DIST, pathNodes);
    const scale = rng.range(0.5, 1.1);
    const rot = rng.range(0, 6.28);
    const gy = groundY(x, z);
    tris.push(...makeBushShadow(x, gy, z, scale));
    tris.push(...makeBush(x, gy, z, scale, rot));
  }

  // ── Rocks ──
  const rockCount = Math.round(chunkDepth / 2.5);
  for (let i = 0; i < rockCount; i++) {
    const x = rng.range(-2.5, 2.5);
    const z = rng.range(zMin + 0.5, zMax - 0.5);
    const scale = rng.range(0.3, 0.8);
    const rot = rng.range(0, 6.28);
    const gy = groundY(x, z);
    tris.push(...makeRockShadow(x, gy, z, scale));
    tris.push(...makeRock(x, gy, z, scale, rot));
  }

  // ── Stumps ──
  const stumpCount = Math.round(chunkDepth / 8);
  for (let i = 0; i < stumpCount; i++) {
    const x = rng.range(-2, 2);
    const z = rng.range(zMin + 1, zMax - 1);
    const scale = rng.range(0.7, 0.9);
    const gy = groundY(x, z);
    tris.push(...makeStumpShadow(x, gy, z, scale));
    tris.push(...makeStump(x, gy, z, scale));
  }

  // ── Logs ──
  const logCount = Math.round(chunkDepth / 10);
  for (let i = 0; i < logCount; i++) {
    const x = rng.range(-2, 2);
    const z = rng.range(zMin + 1, zMax - 1);
    const len = rng.range(1.0, 1.4);
    const scale = rng.range(0.7, 0.8);
    const rot = rng.range(0, 6.28);
    const gy = groundY(x, z);
    tris.push(...makeLogShadow(x, gy, z, len, scale, rot));
    tris.push(...makeLog(x, gy, z, len, scale, rot));
  }

  // ── Flowers ──
  const flowerCount = Math.round(chunkDepth / 1.5);
  for (let i = 0; i < flowerCount; i++) {
    const x = rng.range(-1.5, 1.5);
    const z = rng.range(zMin + 0.5, zMax - 0.5);
    const count = rng.int(3, 8);
    const spread = rng.range(0.3, 0.6);
    const seed = rng.int(0, 1000);
    const gy = groundY(x, z);
    tris.push(...makeFlowerPatch(x, gy, z, count, spread, seed));
  }

  // ── Grass clumps (triangle geometry, not the WASM-animated instances) ──
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

  // ── Grass instances (for WASM-animated blades) ──
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

  // ── Scenic beats: fireplace every ~5 chunks, lamp every ~3 chunks ──
  // Use a separate RNG seeded differently so beat placement is stable
  const beatRNG = createRNG(hashCoord(worldSeed, coord + 99999));
  const beatRoll = beatRNG.next();

  if (coord === 0) {
    // Chunk 0: place fireplace and lamp to match the original scene feel
    const fpx = 4.5, fpz = zMax - 2.5;
    tris.push(...makeFireplace(fpx, groundY(fpx, fpz), fpz));
    scenicBeats.push({ type: 'fireplace', x: fpx, z: fpz });

    const lpx = 1.0, lpz = zMin + chunkDepth * 0.45;
    tris.push(...makeLampPost(lpx, groundY(lpx, lpz), lpz));
    scenicBeats.push({ type: 'lamp', x: lpx, z: lpz });
  } else if (beatRoll < 0.2) {
    // ~20% chance of a fireplace
    const fpx = beatRNG.range(-2, 3);
    const fpz = beatRNG.range(zMin + 3, zMax - 3);
    tris.push(...makeFireplace(fpx, groundY(fpx, fpz), fpz));
    scenicBeats.push({ type: 'fireplace', x: fpx, z: fpz });
  }
  if (coord !== 0 && beatRoll >= 0.2 && beatRoll < 0.55) {
    // ~35% chance of a lamp post
    const lpx = beatRNG.range(-1.5, 2);
    const lpz = beatRNG.range(zMin + 2, zMax - 2);
    tris.push(...makeLampPost(lpx, groundY(lpx, lpz), lpz));
    scenicBeats.push({ type: 'lamp', x: lpx, z: lpz });
  }

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
