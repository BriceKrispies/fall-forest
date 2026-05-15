/**
 * ChunkSystem — owns the active 3x3 chunk window centered on the player.
 *
 * Responsibilities:
 *  - Track which chunk the player is in (from world position).
 *  - Load chunks that enter the 3x3 window; evict chunks that leave it.
 *  - Merge the active chunks' triangles + grass instances and upload to WASM.
 *  - Expose active scenic beats (fireplaces, lamps) and trees for the
 *    breathing canopy / glow / shadow helpers in main.js.
 *
 * Generation is delegated to `chunk-generator.js` and is fully deterministic
 * for a given (worldSeed, cx, cz). Same coords always produce the same chunk.
 */

import { generateChunk } from './chunk-generator.js';
import {
  CHUNK_SIZE, ACTIVE_RADIUS,
  worldToChunk, chunkKey, activeChunkCoords,
} from './chunk-coords.js';
import { DEFAULT_WORLD_SEED } from './seed.js';
import { groundYFast } from './terrain.js';
import { uploadTriangles, uploadGrassInstances } from '../wasm-bridge.js';

export class ChunkSystem {
  constructor(worldSeed = DEFAULT_WORLD_SEED, chunkSize = CHUNK_SIZE) {
    this.worldSeed = worldSeed;
    this.chunkSize = chunkSize;
    this.activeRadius = ACTIVE_RADIUS;
    this.active = new Map(); // key → chunk record
    this.currentCx = null;
    this.currentCz = null;
    this.totalTriCount = 0;
    this.debugEnabled = false;

    this.activeBeats = [];      // merged scenicBeats from active chunks
    this.activePathNodes = [];  // merged pathNodes (cx=0 column only)
    this.activeAnchors = [];    // flat anchor list across active chunks
    this.activeSlots = [];      // flat slot list across active chunks
  }

  /** Coord of the chunk containing this world position. */
  coordFor(x, z) {
    return worldToChunk(x, z, this.chunkSize);
  }

  /**
   * Update the active set. Call once per frame with the player's x,z.
   * Returns true if the active set changed (and the merged buffer was rebuilt).
   */
  update(playerX, playerZ) {
    const { cx, cz } = this.coordFor(playerX, playerZ);
    if (cx === this.currentCx && cz === this.currentCz) return false;

    this.currentCx = cx;
    this.currentCz = cz;

    const needed = activeChunkCoords(cx, cz, this.activeRadius);
    const neededKeys = new Set(needed.map(c => chunkKey(c.cx, c.cz)));

    let changed = false;
    for (const key of this.active.keys()) {
      if (!neededKeys.has(key)) {
        this.active.delete(key);
        changed = true;
      }
    }
    for (const { cx: ncx, cz: ncz } of needed) {
      const key = chunkKey(ncx, ncz);
      if (!this.active.has(key)) {
        const chunk = generateChunk(this.worldSeed, ncx, ncz, this.chunkSize);
        this.active.set(key, chunk);
        changed = true;
      }
    }

    if (changed) this._rebuild();
    return changed;
  }

  /** Force a full reload (used after a seed change). */
  reset(newSeed) {
    if (newSeed !== undefined) this.worldSeed = newSeed;
    this.active.clear();
    this.currentCx = null;
    this.currentCz = null;
    this.activeBeats = [];
    this.activePathNodes = [];
    this.activeAnchors = [];
    this.activeSlots = [];
    this.totalTriCount = 0;
  }

  /** Merge all active chunks' tris + grass into the WASM buffers. */
  _rebuild() {
    const chunks = Array.from(this.active.values());
    chunks.sort((a, b) => (a.cz - b.cz) || (a.cx - b.cx));

    const allTris = [];
    const allGrass = [];
    const allBeats = [];
    const allPathNodes = [];
    const allAnchors = [];
    const allSlots = [];

    for (const chunk of chunks) {
      for (let i = 0; i < chunk.tris.length; i++) allTris.push(chunk.tris[i]);
      for (let i = 0; i < chunk.grassInstances.length; i++) allGrass.push(chunk.grassInstances[i]);
      for (let i = 0; i < chunk.scenicBeats.length; i++) allBeats.push(chunk.scenicBeats[i]);
      for (let i = 0; i < chunk.pathNodes.length; i++) allPathNodes.push(chunk.pathNodes[i]);
      for (let i = 0; i < chunk.anchors.length; i++) allAnchors.push(chunk.anchors[i]);
      for (let i = 0; i < chunk.slots.length; i++) allSlots.push(chunk.slots[i]);
    }

    this.totalTriCount = uploadTriangles(allTris);
    uploadGrassInstances(allGrass);
    this.activeBeats = allBeats;
    this.activePathNodes = allPathNodes;
    this.activeAnchors = allAnchors;
    this.activeSlots = allSlots;
  }

  // ── Lookups consumed by main.js per frame ──

  getFireplaces() {
    return this.activeBeats
      .filter(b => b.type === 'fireplace')
      .map(b => [b.x, groundYFast(b.x, b.z), b.z]);
  }

  getLamps() {
    return this.activeBeats
      .filter(b => b.type === 'lamp')
      .map(b => [b.x, groundYFast(b.x, b.z), b.z]);
  }

  /** Trees near a fireplace, packaged as shadow casters. */
  getFireShadowCasters(fireplacePos) {
    const TREE_HEIGHTS = { A: 3.6, B: 4.4, C: 4.0 };
    const TREE_CANOPY = { A: 1.4, B: 1.6, C: 1.0 };
    const fpx = fireplacePos[0], fpz = fireplacePos[2];
    const casters = [];
    for (const chunk of this.active.values()) {
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
   * Build dynamic breathing canopy tris around the camera. Trees beyond
   * `radius` from the camera are skipped (their canopy uses the static set).
   */
  getBreathingTris(time, camX, camZ, radius = 35) {
    const r2 = radius * radius;
    const out = [];
    for (const chunk of this.active.values()) {
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

  // ── Anchor / slot queries ──

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

  /** Compact debug record — fed to the debug overlay. */
  getDebugInfo() {
    const chunks = Array.from(this.active.values())
      .sort((a, b) => (a.cz - b.cz) || (a.cx - b.cx))
      .map(c => `[${c.cx},${c.cz}] tris:${c.triCount} a:${c.anchors.length} s:${c.slots.length}`);
    return {
      seed: this.worldSeed.toString(16),
      currentCx: this.currentCx,
      currentCz: this.currentCz,
      chunkSize: this.chunkSize,
      activeCount: this.active.size,
      totalTris: this.totalTriCount,
      totalAnchors: this.activeAnchors.length,
      totalSlots: this.activeSlots.length,
      chunks,
    };
  }
}
