import {
  makeTreeA, makeTreeB, makeTreeC, makeBush, makeFlowerPatch,
  makeGrassClump, makeRock, makeStump, makeLog, makeGroundPatch,
  makeTreeShadow, makeRockShadow, makeStumpShadow, makeLogShadow, makeBushShadow,
  makeFireplace, makeValleyWalls
} from './props.js';

const PATH_COLOR_LIT = [0.6, 0.44, 0.28];
const PATH_COLOR_SHADE = [0.42, 0.32, 0.2];
const DIRT_COLOR_LIT = [0.52, 0.4, 0.26];
const DIRT_COLOR_SHADE = [0.36, 0.28, 0.18];
const GROUND_GREEN_LIT = [0.26, 0.37, 0.17];
const GROUND_GREEN_SHADE = [0.17, 0.26, 0.11];
const GROUND_MOSS_LIT = [0.24, 0.33, 0.15];
const GROUND_MOSS_SHADE = [0.15, 0.22, 0.09];

export const PATH_NODES = [
  [0, 0, 0],
  [0.5, 0, 3],
  [1.5, 0, 6],
  [3, 0.1, 9],
  [4, 0.15, 12],
  [3.5, 0.1, 15],
  [2, 0.05, 18],
  [0.5, 0, 21],
  [-1, 0.05, 24],
  [-2, 0.15, 27],
  [-1.5, 0.2, 30],
  [0, 0.15, 33],
  [1.5, 0.1, 36],
  [2.5, 0.05, 39],
  [2, 0, 42],
];

function groundY(x, z) {
  return Math.sin(x * 0.3) * 0.08 + Math.cos(z * 0.25) * 0.06 +
    Math.sin(x * 0.7 + z * 0.5) * 0.04;
}

function sunExposure(x, z) {
  const v = Math.sin(z * 0.28 + x * 0.15) * 0.5 + Math.sin(z * 0.13 - x * 0.22) * 0.3 + 0.5;
  return Math.max(0, Math.min(1, v));
}

function lerpColor(a, b, t) {
  return [a[0] + (b[0]-a[0])*t, a[1] + (b[1]-a[1])*t, a[2] + (b[2]-a[2])*t];
}

const MIN_TREE_DIST = 2.0;
const MIN_BUSH_DIST = 1.2;

function nearestPathDist(px, pz) {
  let best = 1e9;
  let bestDx = 0;
  for (let i = 0; i < PATH_NODES.length - 1; i++) {
    const ax = PATH_NODES[i][0], az = PATH_NODES[i][2];
    const bx = PATH_NODES[i+1][0], bz = PATH_NODES[i+1][2];
    const dx = bx - ax, dz = bz - az;
    const len2 = dx * dx + dz * dz;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2));
    const cx = ax + t * dx, cz = az + t * dz;
    const ex = px - cx, ez = pz - cz;
    const d = Math.sqrt(ex * ex + ez * ez);
    if (d < best) { best = d; bestDx = ex; }
  }
  return { dist: best, dx: bestDx };
}

function pushFromPath(x, z, minDist) {
  const { dist, dx } = nearestPathDist(x, z);
  if (dist >= minDist) return x;
  const sign = dx >= 0 ? 1 : -1;
  return x + sign * (minDist - dist);
}

export function buildScene() {
  const tris = [];

  tris.push(...makeValleyWalls(groundY));

  for (let gz = -4; gz < 46; gz += 3) {
    for (let gx = -12; gx < 12; gx += 3) {
      const expo = sunExposure(gx, gz);
      const isAlt = (gx + gz) % 2 === 0;
      const c = isAlt
        ? lerpColor(GROUND_GREEN_SHADE, GROUND_GREEN_LIT, expo)
        : lerpColor(GROUND_MOSS_SHADE, GROUND_MOSS_LIT, expo);
      tris.push(...makeGroundPatch(gx, gz, 3.2, 3.2, groundY, c));
    }
  }

  for (let i = 0; i < PATH_NODES.length - 1; i++) {
    const a = PATH_NODES[i], b = PATH_NODES[i+1];
    const steps = 4;
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const px = a[0] + (b[0]-a[0]) * t;
      const pz = a[2] + (b[2]-a[2]) * t;
      const py = groundY(px, pz) + 0.02;
      const expo = sunExposure(px, pz);
      const c = s % 2 === 0
        ? lerpColor(PATH_COLOR_SHADE, PATH_COLOR_LIT, expo)
        : lerpColor(DIRT_COLOR_SHADE, DIRT_COLOR_LIT, expo);
      tris.push(...makeGroundPatch(px, pz, 1.6, 1.0, (x,z) => py, c));
    }
  }

  const trees = [
    ['A', -3, 0, 2, 1.1, 0.3], ['B', 4, 0, 1, 1.3, 1.2], ['A', -4, 0, 5, 0.9, 2.1],
    ['C', 5, 0, 4, 1.0, 0.7], ['B', -5, 0, 7, 1.4, 1.8], ['A', 6, 0, 8, 1.2, 0.5],
    ['A', -3.5, 0, 10, 1.0, 3.1], ['C', 5.5, 0, 11, 1.1, 1.5], ['B', -6, 0, 13, 1.3, 0.9],
    ['A', 3, 0, 14, 0.8, 2.4], ['B', -4, 0, 16, 1.2, 0.2], ['C', 5, 0, 17, 1.0, 1.1],
    ['A', -5.5, 0, 19, 1.4, 3.5], ['B', 4.5, 0, 20, 1.1, 0.8], ['A', -3, 0, 22, 1.0, 1.9],
    ['C', 3.5, 0, 23, 1.3, 2.7], ['B', -6, 0, 25, 1.5, 0.4], ['A', 5, 0, 26, 1.2, 1.6],
    ['C', -4.5, 0, 28, 0.9, 3.3], ['B', 4, 0, 29, 1.1, 0.1], ['A', -3.5, 0, 31, 1.3, 2.0],
    ['A', 5.5, 0, 32, 1.0, 1.3], ['C', -5, 0, 34, 1.2, 0.6], ['B', 3.5, 0, 35, 1.4, 2.8],
    ['A', -4, 0, 37, 1.1, 3.7], ['C', 6, 0, 38, 0.9, 1.0], ['B', -5.5, 0, 40, 1.3, 0.3],
    ['A', 4, 0, 41, 1.0, 2.5], ['B', -3, 0, 43, 1.2, 1.7],

    ['A', -2.5, 0, 3.5, 0.7, 4.1], ['C', 3, 0, 6.5, 0.8, 3.4],
    ['B', -2, 0, 9.5, 0.75, 5.2], ['A', 2.5, 0, 12.5, 0.65, 2.9],
    ['C', -2.8, 0, 15.5, 0.7, 4.7], ['B', 2.2, 0, 18.5, 0.8, 1.4],
    ['A', -2, 0, 21.5, 0.6, 3.8], ['C', 2.8, 0, 24.5, 0.7, 5.5],
    ['B', -2.3, 0, 27.5, 0.75, 0.6], ['A', 2.5, 0, 30.5, 0.65, 4.3],
    ['C', -2.7, 0, 33.5, 0.7, 2.1], ['B', 3, 0, 36.5, 0.8, 5.8],

    ['B', -7, 0, 3, 1.5, 0.8], ['A', 7, 0, 6, 1.6, 2.2], ['C', -7.5, 0, 10, 1.4, 1.3],
    ['B', 7.5, 0, 14, 1.5, 3.6], ['A', -8, 0, 18, 1.6, 0.7], ['C', 8, 0, 22, 1.3, 2.9],
    ['B', -7, 0, 26, 1.5, 4.1], ['A', 7, 0, 30, 1.6, 1.5], ['C', -7.5, 0, 34, 1.4, 3.2],
    ['B', 7.5, 0, 38, 1.5, 0.4], ['A', -8, 0, 42, 1.6, 2.6],
  ];

  const treeHeights = { A: 3.6, B: 4.4, C: 4.0 };
  const treeCanopy = { A: 1.4, B: 1.6, C: 1.0 };

  const placedTrees = trees.map(([type, x, y, z, s, r]) => [type, pushFromPath(x, z, MIN_TREE_DIST), y, z, s, r]);

  for (const [type, x, y, z, s, r] of placedTrees) {
    const gy = groundY(x, z);
    tris.push(...makeTreeShadow(x, gy, z, treeHeights[type], treeCanopy[type], s));
  }

  const rawBushes = [
    [-1.5, 3, 0.8, 1.0], [2.5, 5, 0.9, 2.3], [-2, 8, 1.0, 0.5],
    [1.8, 10, 0.7, 3.1], [-1, 12, 0.9, 1.8], [3, 15, 0.8, 0.7],
    [-2.5, 17, 1.1, 2.9], [1.5, 19, 0.7, 4.2], [-1.8, 22, 0.9, 1.1],
    [2, 24, 1.0, 3.5], [-1.2, 26, 0.8, 0.3], [2.8, 28, 0.9, 2.0],
    [-2, 30, 1.0, 4.8], [1.3, 32, 0.7, 1.4], [-1.5, 35, 0.9, 3.3],
    [2.5, 37, 0.8, 0.9], [-2.2, 39, 1.0, 2.6], [1.8, 41, 0.9, 5.1],
    [0.8, 2, 0.5, 6.1], [-0.8, 7, 0.6, 5.3], [1.2, 14, 0.5, 4.6],
    [-0.6, 20, 0.55, 3.9], [0.9, 27, 0.5, 5.7], [-1.0, 33, 0.6, 4.0],
    [0.7, 40, 0.55, 6.5],
  ];
  const bushes = rawBushes.map(([x, z, s, r]) => [pushFromPath(x, z, MIN_BUSH_DIST), z, s, r]);

  for (const [x, z, s, r] of bushes) {
    const gy = groundY(x, z);
    tris.push(...makeBushShadow(x, gy, z, s));
  }

  const rocks = [
    [1.5, 4, 0.6, 0.3], [-1.8, 7, 0.7, 1.5], [2.2, 11, 0.5, 2.8],
    [-1.3, 15, 0.8, 0.9], [1.0, 19, 0.6, 3.7], [-2.0, 23, 0.7, 1.2],
    [1.8, 27, 0.5, 4.5], [-1.5, 31, 0.6, 2.1], [2.0, 35, 0.8, 0.6],
    [-1.2, 39, 0.5, 3.3], [0.5, 6, 0.35, 5.1], [-0.4, 13, 0.3, 4.4],
    [0.7, 25, 0.4, 5.8], [-0.6, 37, 0.35, 4.9],
  ];
  for (const [x, z, s, r] of rocks) {
    const gy = groundY(x, z);
    tris.push(...makeRockShadow(x, gy, z, s));
  }

  const stumps = [
    [1.8, 6, 0.8], [-1.5, 13, 0.7], [2.0, 21, 0.9],
    [-1.8, 28, 0.8], [1.3, 36, 0.7], [-1.0, 42, 0.9],
  ];
  for (const [x, z, s] of stumps) {
    const gy = groundY(x, z);
    tris.push(...makeStumpShadow(x, gy, z, s));
  }

  const logs = [
    [1.5, 9, 1.0, 0.7, 0.4], [-1.2, 18, 1.3, 0.8, 1.2],
    [1.8, 25, 1.1, 0.7, 2.5], [-1.5, 33, 1.4, 0.8, 0.8],
    [0.8, 40, 1.0, 0.7, 1.9],
  ];
  for (const [x, z, len, s, r] of logs) {
    const gy = groundY(x, z);
    tris.push(...makeLogShadow(x, gy, z, len, s, r));
  }

  for (const [type, x, y, z, s, r] of placedTrees) {
    const gy = groundY(x, z);
    if (type === 'A') tris.push(...makeTreeA(x, gy, z, s, r));
    else if (type === 'B') tris.push(...makeTreeB(x, gy, z, s, r));
    else tris.push(...makeTreeC(x, gy, z, s, r));
  }

  for (const [x, z, s, r] of bushes) {
    const gy = groundY(x, z);
    tris.push(...makeBush(x, gy, z, s, r));
  }

  const flowers = [
    [0.3, 2, 6, 0.5, 1], [-0.5, 5, 4, 0.4, 17], [1.2, 8, 5, 0.6, 33],
    [-0.3, 11, 7, 0.5, 49], [0.8, 14, 5, 0.5, 65], [-1.0, 17, 6, 0.4, 81],
    [0.5, 20, 4, 0.5, 97], [-0.7, 23, 8, 0.6, 113], [1.0, 26, 5, 0.4, 129],
    [-0.2, 29, 6, 0.5, 145], [0.6, 32, 7, 0.5, 161], [-0.8, 35, 4, 0.4, 177],
    [0.4, 38, 5, 0.5, 193], [-0.5, 41, 6, 0.6, 209],
    [1.8, 4, 4, 0.3, 225], [-1.5, 9, 3, 0.3, 241], [2.0, 16, 5, 0.4, 257],
    [-1.8, 21, 4, 0.3, 273], [1.5, 28, 3, 0.3, 289], [-1.3, 34, 5, 0.4, 305],
  ];
  for (const [x, z, count, spread, seed] of flowers) {
    const gy = groundY(x, z);
    tris.push(...makeFlowerPatch(x, gy, z, count, spread, seed));
  }

  const grasses = [];
  for (let z = -2; z < 44; z += 1.2) {
    for (let x = -6; x < 6; x += 1.5) {
      const seed = x * 100 + z * 7;
      const ox = Math.sin(seed) * 0.4;
      const oz = Math.cos(seed * 1.3) * 0.3;
      grasses.push([x + ox, z + oz, 4 + Math.floor(Math.abs(Math.sin(seed*2))*3), 0.3, seed]);
    }
  }
  for (const [x, z, count, spread, seed] of grasses) {
    const gy = groundY(x, z);
    tris.push(...makeGrassClump(x, gy, z, count, spread, seed));
  }

  for (const [x, z, s, r] of rocks) {
    const gy = groundY(x, z);
    tris.push(...makeRock(x, gy, z, s, r));
  }

  for (const [x, z, s] of stumps) {
    const gy = groundY(x, z);
    tris.push(...makeStump(x, gy, z, s));
  }

  for (const [x, z, len, s, r] of logs) {
    const gy = groundY(x, z);
    tris.push(...makeLog(x, gy, z, len, s, r));
  }

  const fpx = 4.5, fpz = 43.5;
  tris.push(...makeFireplace(fpx, groundY(fpx, fpz), fpz));

  return tris;
}

export const FIREPLACE_POS = [4.5, 0, 43.5];
