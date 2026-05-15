/**
 * ChunkSystem — owns the chunk lifecycle around the player.
 *
 * Three concentric scopes:
 *
 *   bufferedChunks (5x5 by default, configurable via `generationRadius`)
 *     Deterministic generation cache. Every chunk inside this window is
 *     pre-generated so it exists before it can enter the rendered area.
 *     Chunks leaving the window are evicted.
 *
 *   activeKeys (3x3, configurable via `activeRadius`)
 *     Gameplay/simulation scope. Discovery slots, scenic anchors and
 *     "nearest slot" queries draw from this tighter ring so authored
 *     beats stay tied to the player's immediate surroundings.
 *
 *   visibleKeys (5x5 by default, configurable via `renderRadius`)
 *     The set of buffered chunks actually submitted to the WASM
 *     triangle/grass buffers each time the visible set changes. By keeping
 *     this <= generationRadius we guarantee that new chunks appear at the
 *     buffered-edge distance (~40m) instead of popping into existence at
 *     the gameplay-edge distance (~24m) — they have already been generated
 *     for at least one chunk crossing before they could ever be drawn.
 *
 * `_rebuildVisible()` is only called when the visible *set membership*
 * changes (i.e. on a chunk boundary crossing). Camera direction has no
 * effect on the WASM upload, so turning around quickly never causes pop-in
 * or rebuild spikes.
 *
 * Generation itself is delegated to `chunk-generator.js` and is fully
 * deterministic for a given (worldSeed, cx, cz).
 */

import { generateChunk, buildNeighborhoodContext } from './chunk-generator.js';
import {
  CHUNK_SIZE, ACTIVE_RADIUS, GENERATION_RADIUS, RENDER_RADIUS,
  worldToChunk, chunkKey, activeChunkCoords, chunkCoordsByDistance,
} from './chunk-coords.js';
import { DEFAULT_WORLD_SEED } from './seed.js';
import { groundY, groundYFast, setContext, clearContext } from './terrain.js';
import { uploadTriangles, uploadGrassInstances, LAYOUT } from '../wasm-bridge.js';

// Ground-patch tiling step (must match chunk-generator.js).
const GROUND_STEP = 3.2;

// Static-scene tri budget for the WASM triangle input buffer. With 5x5
// chunks at ~4k tris each the raw sum exceeds MAX_TRIS, so the visible-set
// selector drops the farthest chunks first to keep the upload bounded.
const STATIC_TRI_BUDGET = LAYOUT.MAX_TRIS;

export class ChunkSystem {
  constructor(worldSeed = DEFAULT_WORLD_SEED, chunkSize = CHUNK_SIZE) {
    this.worldSeed = worldSeed;
    this.chunkSize = chunkSize;
    this.activeRadius = ACTIVE_RADIUS;
    this.generationRadius = GENERATION_RADIUS;
    this.renderRadius = RENDER_RADIUS;

    /** key → chunk record (everything inside the buffered window). */
    this.bufferedChunks = new Map();
    /** Subset of `bufferedChunks` keys used for gameplay/simulation. */
    this.activeKeys = new Set();
    /** Subset of `bufferedChunks` keys actually submitted to WASM. */
    this.visibleKeys = new Set();

    this.currentCx = null;
    this.currentCz = null;
    this.totalTriCount = 0;
    this.debugEnabled = false;

    // Last hop direction in chunk units — drives prioritized warmup so the
    // chunks the player is walking *into* are generated first when the
    // buffer shifts.
    this._lastHopDx = 0;
    this._lastHopDz = 0;

    // Number of chunks inside the render window that were dropped because the
    // running tri budget exceeded MAX_TRIS. Surfaced via getDebugInfo so it's
    // obvious when the render window asks for more than the WASM buffer can
    // hold.
    this._chunksDroppedByBudget = 0;
    this._submittedTriCount = 0;

    // Merged data, kept on the system so per-frame queries are cheap.
    this.visibleBeats = [];        // scenic beats across the *visible* set
    this.visiblePathNodes = [];    // path nodes across the *visible* set
    this.activeAnchors = [];       // anchors across the *active* 3x3
    this.activeSlots = [];         // discovery slots across the *active* 3x3
  }

  /** Coord of the chunk containing this world position. */
  coordFor(x, z) {
    return worldToChunk(x, z, this.chunkSize);
  }

  /**
   * Update the chunk windows for the player's position. Call once per frame
   * with the player's world (x, z). Returns true if any of the three windows
   * changed (and therefore the WASM buffers may have been re-uploaded).
   *
   * Cheap when the player has not crossed a chunk boundary — only does the
   * coord-equality compare and returns.
   */
  update(playerX, playerZ) {
    const { cx, cz } = this.coordFor(playerX, playerZ);
    if (cx === this.currentCx && cz === this.currentCz) return false;

    if (this.currentCx !== null) {
      this._lastHopDx = cx - this.currentCx;
      this._lastHopDz = cz - this.currentCz;
    }
    this.currentCx = cx;
    this.currentCz = cz;

    const bufferChanged = this._refreshBuffer(cx, cz);
    const activeChanged = this._refreshActiveScope(cx, cz);
    const visibleChanged = this._refreshVisibleScope(cx, cz);

    if (visibleChanged) this._rebuildVisible();
    return bufferChanged || activeChanged || visibleChanged;
  }

  /** Force a full reload (used after a seed change). */
  reset(newSeed) {
    if (newSeed !== undefined) this.worldSeed = newSeed;
    this.bufferedChunks.clear();
    this.activeKeys.clear();
    this.visibleKeys.clear();
    this.currentCx = null;
    this.currentCz = null;
    this._lastHopDx = 0;
    this._lastHopDz = 0;
    this.visibleBeats = [];
    this.visiblePathNodes = [];
    this.activeAnchors = [];
    this.activeSlots = [];
    this.totalTriCount = 0;
  }

  /**
   * Update the buffered window: evict chunks that left the (2R+1)^2 region,
   * generate any that are new. Generation order is nearest-first with a bias
   * in the player's last hop direction so chunks ahead of the player become
   * ready before chunks behind.
   */
  _refreshBuffer(cx, cz) {
    const needed = chunkCoordsByDistance(
      cx, cz, this.generationRadius, this._lastHopDx, this._lastHopDz
    );
    const neededKeys = new Set(needed.map(c => chunkKey(c.cx, c.cz)));
    let changed = false;

    for (const key of [...this.bufferedChunks.keys()]) {
      if (!neededKeys.has(key)) {
        this.bufferedChunks.delete(key);
        changed = true;
      }
    }
    for (const { cx: ncx, cz: ncz } of needed) {
      const key = chunkKey(ncx, ncz);
      if (!this.bufferedChunks.has(key)) {
        const chunk = generateChunk(this.worldSeed, ncx, ncz, this.chunkSize);
        this.bufferedChunks.set(key, chunk);
        changed = true;
      }
    }
    return changed;
  }

  /** Recompute the active 3x3 set + cached anchor/slot lists. */
  _refreshActiveScope(cx, cz) {
    const prev = this.activeKeys;
    const next = new Set();
    const coords = activeChunkCoords(cx, cz, this.activeRadius);
    for (const c of coords) next.add(chunkKey(c.cx, c.cz));

    let changed = next.size !== prev.size;
    if (!changed) for (const k of next) if (!prev.has(k)) { changed = true; break; }
    if (!changed) return false;

    this.activeKeys = next;
    const anchors = [];
    const slots = [];
    for (const key of next) {
      const chunk = this.bufferedChunks.get(key);
      if (!chunk) continue;
      for (let i = 0; i < chunk.anchors.length; i++) anchors.push(chunk.anchors[i]);
      for (let i = 0; i < chunk.slots.length; i++) slots.push(chunk.slots[i]);
    }
    this.activeAnchors = anchors;
    this.activeSlots = slots;
    return true;
  }

  /**
   * Recompute the visible/render-submitted set. Returns true if the set
   * changed (so a WASM re-upload is required).
   *
   * Selection rules:
   *   1. Distance filter — chunks within `renderRadius` (chunk-grid) of the
   *      player chunk are candidates. This is intentionally simpler than
   *      per-triangle camera/frustum culling: the WASM pipeline already
   *      does distance/fog culling per triangle, and a chunk-grid filter
   *      keeps the rendered set stable under camera rotation (so turning
   *      around quickly never triggers a rebuild).
   *   2. Budget filter — candidates are added nearest-first; as soon as
   *      adding the next chunk would exceed the static-scene tri budget,
   *      the remaining (farther) candidates are dropped. This stops WASM
   *      from silently truncating the upload at MAX_TRIS and shifts the
   *      cull edge into deeper fog when the render window is larger than
   *      the budget allows.
   */
  _refreshVisibleScope(cx, cz) {
    const prev = this.visibleKeys;
    const r = this.renderRadius;

    // Collect candidates inside the render window, sorted nearest-first by
    // chunk-grid distance. Camera direction is intentionally not part of the
    // sort — the visible set must be stable when the player only rotates.
    const candidates = [];
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const key = chunkKey(cx + dx, cz + dz);
        if (this.bufferedChunks.has(key)) {
          candidates.push({ key, d2: dx * dx + dz * dz });
        }
      }
    }
    candidates.sort((a, b) => a.d2 - b.d2);

    // Admit candidates one *distance ring* at a time. Either every chunk at
    // a given chunk-grid distance fits in the budget or none of them do —
    // that keeps the visible shape rotationally symmetric instead of having
    // one cardinal direction pop in while another stays dark.
    const next = new Set();
    let tris = 0;
    let dropped = 0;
    let i = 0;
    while (i < candidates.length) {
      const ringD2 = candidates[i].d2;
      let ringTris = 0;
      let j = i;
      while (j < candidates.length && candidates[j].d2 === ringD2) {
        ringTris += this.bufferedChunks.get(candidates[j].key).tris.length;
        j++;
      }
      if (tris + ringTris <= STATIC_TRI_BUDGET) {
        for (let k = i; k < j; k++) next.add(candidates[k].key);
        tris += ringTris;
        i = j;
      } else {
        dropped = candidates.length - i;
        break;
      }
    }
    this._chunksDroppedByBudget = dropped;

    let changed = next.size !== prev.size;
    if (!changed) for (const k of next) if (!prev.has(k)) { changed = true; break; }
    if (!changed) return false;

    this.visibleKeys = next;
    return true;
  }

  /** Merge the visible chunks' tris + grass and upload to WASM. */
  _rebuildVisible() {
    // Sort visible keys by distance to the player chunk so near tris are
    // uploaded first. If the upload ever exceeds MAX_TRIS the cap will fall
    // on the farthest chunks (which are deepest in fog).
    const keys = [...this.visibleKeys].sort((a, b) => {
      const [ax, az] = a.split(',');
      const [bx, bz] = b.split(',');
      const da = (+ax - this.currentCx) ** 2 + (+az - this.currentCz) ** 2;
      const db = (+bx - this.currentCx) ** 2 + (+bz - this.currentCz) ** 2;
      return da - db;
    });

    const allTris = [];
    const allGrass = [];
    const allBeats = [];
    const allPathNodes = [];

    for (const key of keys) {
      const chunk = this.bufferedChunks.get(key);
      if (!chunk) continue;
      for (let i = 0; i < chunk.tris.length; i++) allTris.push(chunk.tris[i]);
      for (let i = 0; i < chunk.grassInstances.length; i++) allGrass.push(chunk.grassInstances[i]);
      for (let i = 0; i < chunk.scenicBeats.length; i++) allBeats.push(chunk.scenicBeats[i]);
      for (let i = 0; i < chunk.pathNodes.length; i++) allPathNodes.push(chunk.pathNodes[i]);
    }

    this.totalTriCount = uploadTriangles(allTris);
    this._submittedTriCount = this.totalTriCount;
    uploadGrassInstances(allGrass);
    this.visibleBeats = allBeats;
    this.visiblePathNodes = allPathNodes;
  }

  /**
   * Adjust window sizes at runtime. Forces a re-evaluation of all three
   * scopes from the current player chunk. Buffer is clamped to be at least
   * as large as the render radius — otherwise visible chunks could escape
   * the generation buffer and pop in on first sight.
   */
  setWindowSizes({ generationRadius, renderRadius, activeRadius } = {}) {
    if (typeof generationRadius === 'number') this.generationRadius = Math.max(0, generationRadius | 0);
    if (typeof renderRadius === 'number') this.renderRadius = Math.max(0, renderRadius | 0);
    if (typeof activeRadius === 'number') this.activeRadius = Math.max(0, activeRadius | 0);
    if (this.generationRadius < this.renderRadius) this.generationRadius = this.renderRadius;

    if (this.currentCx !== null && this.currentCz !== null) {
      const cx = this.currentCx, cz = this.currentCz;
      this.currentCx = null;
      this.currentCz = null;
      // Force the boundary-cross path to run.
      this.update(cx * this.chunkSize, cz * this.chunkSize);
    }
  }

  // ── Per-frame visual queries (visible scope) ──

  getFireplaces() {
    return this.visibleBeats
      .filter(b => b.type === 'fireplace')
      .map(b => [b.x, groundYFast(b.x, b.z), b.z]);
  }

  getLamps() {
    return this.visibleBeats
      .filter(b => b.type === 'lamp')
      .map(b => [b.x, groundYFast(b.x, b.z), b.z]);
  }

  /** Trees near a fireplace, packaged as shadow casters (visible scope). */
  getFireShadowCasters(fireplacePos) {
    const TREE_HEIGHTS = { A: 3.6, B: 4.4, C: 4.0 };
    const TREE_CANOPY = { A: 1.4, B: 1.6, C: 1.0 };
    const fpx = fireplacePos[0], fpz = fireplacePos[2];
    const casters = [];
    for (const key of this.visibleKeys) {
      const chunk = this.bufferedChunks.get(key);
      if (!chunk) continue;
      for (const tree of chunk.trees) {
        const dx = tree.x - fpx, dz = tree.z - fpz;
        if (dx * dx + dz * dz > 100) continue; // 10m radius
        const gy = groundYFast(tree.x, tree.z);
        casters.push({
          x: tree.x, z: tree.z, gy,
          height: TREE_HEIGHTS[tree.type] * tree.scale,
          radius: TREE_CANOPY[tree.type] * tree.scale,
        });
      }
    }
    return casters;
  }

  /**
   * Build dynamic breathing canopy tris around the camera (visible scope).
   * Trees beyond `radius` from the camera are skipped (their canopy already
   * uses the static set in the chunk's tri list).
   */
  getBreathingTris(time, camX, camZ, radius = 35) {
    const r2 = radius * radius;
    const out = [];
    for (const key of this.visibleKeys) {
      const chunk = this.bufferedChunks.get(key);
      if (!chunk) continue;
      for (const tree of chunk.trees) {
        const dx = tree.x - camX, dz = tree.z - camZ;
        if (dx * dx + dz * dz > r2) continue;
        const breath = Math.sin(time * tree.speed + tree.phase);
        const amp = tree.amplitude;
        for (const layer of tree.canopyLayers) {
          const dy = breath * amp * layer.weight;
          const layerTris = layer.tris;
          for (let i = 0; i < layerTris.length; i++) {
            const [a, b, c, col] = layerTris[i];
            out.push([
              [a[0], a[1] + dy, a[2]],
              [b[0], b[1] + dy, b[2]],
              [c[0], c[1] + dy, c[2]],
              col,
            ]);
          }
        }
      }
    }
    return out;
  }

  // ── Anchor / slot queries (active 3x3 scope) ──

  /** Flat array of all anchors across the active 3x3 set. */
  getAllAnchors() {
    return this.activeAnchors;
  }

  /** Flat array of all discovery slots across the active 3x3 set. */
  getAllSlots() {
    return this.activeSlots;
  }

  /**
   * Find the single slot closest to (x, z) in the active set.
   * 2D distance (ground plane); slot Y is informational.
   *
   * @returns {{slot, distance}|null}
   */
  findNearestSlot(x, z) {
    let bestSlot = null;
    let bestD2 = Infinity;
    const slots = this.activeSlots;
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      const dx = s.x - x, dz = s.z - z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) {
        bestD2 = d2;
        bestSlot = s;
      }
    }
    return bestSlot ? { slot: bestSlot, distance: Math.sqrt(bestD2) } : null;
  }

  /** Top-N nearest slots by 2D distance. */
  findNearestSlots(x, z, n = 3) {
    const slots = this.activeSlots;
    const ranked = new Array(slots.length);
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      const dx = s.x - x, dz = s.z - z;
      ranked[i] = { slot: s, distance: Math.sqrt(dx * dx + dz * dz) };
    }
    ranked.sort((a, b) => a.distance - b.distance);
    return ranked.slice(0, n);
  }

  /**
   * Verify that the ground mesh is continuous across every shared boundary
   * between adjacent buffered chunks. Runs across the full buffered set, so
   * the seam check now also covers chunks that are not currently rendered.
   *
   * For each adjacent pair we sample groundY along the boundary segment using
   * each side's neighborhood context. Because path/feature influence radii
   * (<=2.5m) are bounded and we include the full 3x3 neighborhood when
   * building either side's context, the symmetric difference between the two
   * contexts can never reach a boundary sample — so heights must match.
   *
   * Returns { ok, checked, maxDiff, mismatches: [...] }.
   */
  verifySeams(epsilon = 1e-5) {
    const issues = [];
    let maxDiff = 0;
    let checked = 0;

    const ctxCache = new Map();
    const getCtx = (cx, cz) => {
      const key = chunkKey(cx, cz);
      if (!ctxCache.has(key)) {
        ctxCache.set(key, buildNeighborhoodContext(this.worldSeed, cx, cz, this.chunkSize));
      }
      return ctxCache.get(key);
    };

    const sampleAlong = (axis, fixed, lo, hi, ctxA, ctxB, label) => {
      const step = GROUND_STEP / 3;
      for (let t = lo; t <= hi + 1e-6; t += step) {
        const x = axis === 'x' ? fixed : t;
        const z = axis === 'x' ? t : fixed;
        setContext(ctxA.pathNodes, ctxA.features);
        const yA = groundY(x, z);
        setContext(ctxB.pathNodes, ctxB.features);
        const yB = groundY(x, z);
        clearContext();
        const d = Math.abs(yA - yB);
        if (d > maxDiff) maxDiff = d;
        checked++;
        if (d > epsilon && issues.length < 8) {
          issues.push({
            boundary: label,
            x: +x.toFixed(3), z: +z.toFixed(3),
            yA: +yA.toFixed(5), yB: +yB.toFixed(5),
            diff: +d.toFixed(5),
          });
        }
      }
    };

    const half = this.chunkSize * 0.5;
    for (const chunk of this.bufferedChunks.values()) {
      const { cx, cz } = chunk;
      const xMin = cx * this.chunkSize - half;
      const zMin = cz * this.chunkSize - half;

      if (this.bufferedChunks.has(chunkKey(cx + 1, cz))) {
        const xBoundary = xMin + this.chunkSize;
        sampleAlong('x', xBoundary, zMin, zMin + this.chunkSize,
                    getCtx(cx, cz), getCtx(cx + 1, cz),
                    `cx ${cx}|${cx + 1} @ cz ${cz}`);
      }
      if (this.bufferedChunks.has(chunkKey(cx, cz + 1))) {
        const zBoundary = zMin + this.chunkSize;
        sampleAlong('z', zBoundary, xMin, xMin + this.chunkSize,
                    getCtx(cx, cz), getCtx(cx, cz + 1),
                    `cz ${cz}|${cz + 1} @ cx ${cx}`);
      }
    }

    return { ok: issues.length === 0, checked, maxDiff, mismatches: issues };
  }

  /** Compact debug record — fed to the debug overlay and /chunks. */
  getDebugInfo() {
    const chunks = [...this.bufferedChunks.values()]
      .sort((a, b) => (a.cz - b.cz) || (a.cx - b.cx))
      .map(c => {
        const key = chunkKey(c.cx, c.cz);
        const inA = this.activeKeys.has(key);
        const inV = this.visibleKeys.has(key);
        const tag = (inV ? 'V' : '·') + (inA ? 'A' : '·');
        return `${tag} [${c.cx},${c.cz}] tris:${c.triCount} a:${c.anchors.length} s:${c.slots.length}`;
      });
    return {
      seed: this.worldSeed.toString(16),
      currentCx: this.currentCx,
      currentCz: this.currentCz,
      chunkSize: this.chunkSize,
      activeRadius: this.activeRadius,
      generationRadius: this.generationRadius,
      renderRadius: this.renderRadius,
      bufferedCount: this.bufferedChunks.size,
      activeCount: this.activeKeys.size,
      visibleCount: this.visibleKeys.size,
      droppedByBudget: this._chunksDroppedByBudget,
      triBudget: STATIC_TRI_BUDGET,
      totalTris: this.totalTriCount,
      totalAnchors: this.activeAnchors.length,
      totalSlots: this.activeSlots.length,
      chunks,
    };
  }
}
