/**
 * Horror entity generator — procedural segment graph builder.
 *
 * Generates horror entity structures from a seed and configuration parameters.
 * Writes entity headers and segments directly into WASM memory via wasm-bridge.
 *
 * Segment types:
 *   0 = core       — central body mass
 *   1 = tendril    — writhing appendage chain
 *   2 = eye        — watching organ
 *   3 = tooth      — fang/tusk in ring formations
 *   4 = sucker     — suction cup along tendrils
 *   5 = ring       — orbiting halo/ring element
 *   6 = spine      — protruding nub/spike
 */

import {
  writeHorrorEntity, writeHorrorSegment, clearHorrorBuffers,
  LAYOUT,
} from './wasm-bridge.js';

export const SEG_CORE    = 0;
export const SEG_TENDRIL = 1;
export const SEG_EYE     = 2;
export const SEG_TOOTH   = 3;
export const SEG_SUCKER  = 4;
export const SEG_RING    = 5;
export const SEG_SPINE   = 6;

// ── Seeded RNG (matches seed.js pattern) ──

function mulberry32(seed) {
  let s = seed | 0;
  return function () {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createRNG(seed) {
  const next = mulberry32(seed);
  return {
    next,
    range(lo, hi) { return lo + next() * (hi - lo); },
    int(lo, hi) { return Math.floor(lo + next() * (hi - lo)); },
    chance(p) { return next() < p; },
    pick(arr) { return arr[Math.floor(next() * arr.length)]; },
  };
}

// ── Generator ──

/**
 * Generate a single horror entity's segment graph.
 *
 * @param {object} params
 * @param {number} params.seed           - deterministic seed
 * @param {number} params.entityId       - entity index (0–7)
 * @param {number} params.x, y, z        - root world position
 * @param {number} params.scale          - overall scale
 * @param {number} params.complexity     - 0–1, controls segment count/branching
 * @param {number} params.branchDepth    - max recursive tendril depth
 * @param {number} params.eyeDensity     - 0–1, chance of eye placement
 * @param {number} params.toothDensity   - 0–1, chance of tooth rings
 * @param {number} params.suckerDensity  - 0–1, chance of sucker placement
 * @param {number} params.ringCount      - number of orbit rings
 * @param {number} params.segBudget      - max segments for this entity
 * @returns {{ segStart: number, segCount: number }}
 */
export function generateHorror(params, segOffset) {
  const {
    seed, entityId,
    x, y, z,
    scale = 1,
    complexity = 0.5,
    branchDepth = 2,
    eyeDensity = 0.3,
    toothDensity = 0.2,
    suckerDensity = 0.2,
    ringCount = 1,
    segBudget = 60,
  } = params;

  const rng = createRNG(seed);
  const segs = [];
  const segStart = segOffset;

  function addSeg(type, px, py, pz, size, parentIdx, phaseOffset) {
    if (segs.length >= segBudget) return -1;
    if (segOffset + segs.length >= LAYOUT.MAX_HORROR_SEG) return -1;
    const idx = segs.length;
    segs.push({
      type,
      x: px, y: py, z: pz,
      size: size * scale,
      parentIdx: parentIdx >= 0 ? segStart + parentIdx : -1,
      entityId,
      phase: phaseOffset + rng.range(0, 6.28),
    });
    return idx;
  }

  // ── Core body ──
  const coreSize = rng.range(0.15, 0.25) * scale;
  const coreCount = 1 + Math.floor(complexity * 3);

  for (let c = 0; c < coreCount; c++) {
    const cx = x + rng.range(-0.08, 0.08) * scale;
    const cy = y + c * 0.22 * scale + rng.range(-0.03, 0.03) * scale;
    const cz = z + rng.range(-0.08, 0.08) * scale;
    addSeg(SEG_CORE, cx, cy, cz, coreSize * (1 - c * 0.12), c > 0 ? 0 : -1, c * 0.5);
  }

  // ── Tendrils ──
  const tendrilCount = 2 + Math.floor(complexity * 5);

  function growTendril(parentLocalIdx, baseX, baseY, baseZ, dir, depth, maxSegs) {
    if (depth > branchDepth || segs.length >= segBudget) return;
    const length = rng.int(3, Math.min(maxSegs, 4 + Math.floor(complexity * 4)));
    const segSize = rng.range(0.06, 0.12) * scale * (1 / (1 + depth * 0.3));
    let prevIdx = parentLocalIdx;
    let px = baseX, py = baseY, pz = baseZ;

    for (let s = 0; s < length; s++) {
      const t = s / length;
      const taper = 1 - t * 0.6;
      px += dir[0] * 0.15 * scale + rng.range(-0.04, 0.04) * scale;
      py += dir[1] * 0.15 * scale + rng.range(-0.04, 0.04) * scale;
      pz += dir[2] * 0.15 * scale + rng.range(-0.04, 0.04) * scale;

      const idx = addSeg(SEG_TENDRIL, px, py, pz, segSize * taper, prevIdx, s * 0.7 + depth);
      if (idx < 0) return;
      prevIdx = idx;

      // Suckers along tendrils
      if (suckerDensity > 0 && s > 0 && s < length - 1 && rng.chance(suckerDensity * 0.5)) {
        const sx = px + rng.range(-0.03, 0.03) * scale;
        const sy = py + rng.range(-0.02, 0.02) * scale;
        const sz = pz + rng.range(-0.03, 0.03) * scale;
        addSeg(SEG_SUCKER, sx, sy, sz, segSize * 0.6, prevIdx, s);
      }

      // Branch at mid-point
      if (depth < branchDepth && s === Math.floor(length / 2) && rng.chance(complexity * 0.4)) {
        const branchDir = [
          dir[0] + rng.range(-0.8, 0.8),
          dir[1] + rng.range(-0.4, 0.4),
          dir[2] + rng.range(-0.8, 0.8),
        ];
        growTendril(prevIdx, px, py, pz, branchDir, depth + 1, Math.floor(maxSegs * 0.6));
      }
    }

    // Eye at tendril tip
    if (eyeDensity > 0 && rng.chance(eyeDensity)) {
      addSeg(SEG_EYE, px, py, pz, segSize * 0.8, prevIdx, 0);
    }
  }

  for (let t = 0; t < tendrilCount; t++) {
    const angle = (t / tendrilCount) * Math.PI * 2 + rng.range(-0.3, 0.3);
    const elev = rng.range(-0.2, 0.7); // bias upward
    const dir = [
      Math.cos(angle) * (1 - Math.abs(elev) * 0.5),
      elev,
      Math.sin(angle) * (1 - Math.abs(elev) * 0.5),
    ];
    growTendril(0, x, y, z, dir, 0, segBudget - segs.length);
  }

  // ── Orbit rings ──
  for (let r = 0; r < ringCount && segs.length < segBudget; r++) {
    const ringRadius = rng.range(0.2, 0.4) * scale;
    const ringY = y + rng.range(-0.1, 0.2) * scale;
    const ringSegs = 4 + Math.floor(complexity * 4);
    const ringPhaseBase = rng.range(0, 6.28);

    for (let s = 0; s < ringSegs; s++) {
      const a = (s / ringSegs) * Math.PI * 2;
      const rx = x + Math.cos(a) * ringRadius;
      const rz = z + Math.sin(a) * ringRadius;
      const idx = addSeg(SEG_RING, rx, ringY, rz, 0.04 * scale, 0, ringPhaseBase + a);
      if (idx < 0) break;

      // Eyes on ring nodes
      if (eyeDensity > 0 && rng.chance(eyeDensity * 0.6)) {
        addSeg(SEG_EYE, rx, ringY + 0.03 * scale, rz, 0.05 * scale, idx, a);
      }
    }
  }

  // ── Tooth rings (around core) ──
  if (toothDensity > 0 && rng.chance(toothDensity)) {
    const toothCount = 4 + Math.floor(complexity * 6);
    const toothRadius = rng.range(0.1, 0.18) * scale;
    const toothY = y + rng.range(-0.08, 0.08) * scale;
    for (let t = 0; t < toothCount && segs.length < segBudget; t++) {
      const a = (t / toothCount) * Math.PI * 2;
      const tx = x + Math.cos(a) * toothRadius;
      const tz = z + Math.sin(a) * toothRadius;
      addSeg(SEG_TOOTH, tx, toothY, tz, 0.03 * scale, 0, a * 2);
    }
  }

  // ── Spines / protrusions ──
  const spineCount = Math.floor(complexity * 4);
  for (let s = 0; s < spineCount && segs.length < segBudget; s++) {
    const a = rng.range(0, Math.PI * 2);
    const elev = rng.range(-0.3, 0.5);
    const dist = rng.range(0.08, 0.2) * scale;
    addSeg(SEG_SPINE,
      x + Math.cos(a) * dist,
      y + elev * dist,
      z + Math.sin(a) * dist,
      rng.range(0.03, 0.07) * scale,
      0, a);
  }

  // ── Write segments to WASM ──
  for (let i = 0; i < segs.length; i++) {
    writeHorrorSegment(segStart + i, segs[i]);
  }

  return { segStart, segCount: segs.length };
}

/**
 * Generate and populate all horror entities for the current frame.
 *
 * @param {object} params - resolved horror parameters from world mode
 * @param {Array} positions - [{x, y, z, seed}] spawn positions
 * @param {object} wasm - wasm exports (for set_horror_ent_count)
 */
export function generateAllHorrors(params, positions, wasm) {
  clearHorrorBuffers();

  const count = Math.min(positions.length, LAYOUT.MAX_HORROR_ENT);
  let segOffset = 0;

  for (let i = 0; i < count; i++) {
    const pos = positions[i];
    const result = generateHorror({
      seed: pos.seed,
      entityId: i,
      x: pos.x, y: pos.y, z: pos.z,
      scale: params.horrorScale || 1,
      complexity: params.horrorComplexity || 0.5,
      branchDepth: params.horrorBranchDepth || 2,
      eyeDensity: params.horrorEyeDensity || 0.3,
      toothDensity: params.horrorToothDensity || 0.2,
      suckerDensity: params.horrorSuckerDensity || 0.2,
      ringCount: params.horrorRingCount || 1,
      segBudget: params.horrorSegmentBudget || 60,
    }, segOffset);

    writeHorrorEntity(i, {
      x: pos.x, y: pos.y, z: pos.z,
      life: 30,
      seed: pos.seed,
      segStart: result.segStart,
      segCount: result.segCount,
      agitation: params.horrorAgitation || 0.5,
      pulsePhase: (pos.seed % 1000) / 1000 * 6.28,
      active: true,
      scale: params.horrorScale || 1,
    });

    segOffset += result.segCount;
  }

  wasm.set_horror_ent_count(count);
  return count;
}
