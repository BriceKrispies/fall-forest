/**
 * CollectionState — localStorage-backed persistence of which discovery
 * instances the player has collected (and which they have seen).
 *
 * Storage layout
 * --------------
 * Key: "fall-forest:collection-state:v1"
 * Value (JSON):
 *   {
 *     [seedHex]: {
 *       collected: [ids...],
 *       seen: [ids...],
 *     }
 *   }
 *
 * The state is partitioned by world seed so loading a new seed never
 * mixes collected ids from a different world.
 *
 * Ids are deterministic strings of the form
 *   "<discoveryId>@<cx>,<cz>#<slotIndex>"
 * produced by ChunkContext.collectibleId(...).
 */

const STORAGE_KEY = 'fall-forest:collection-state:v1';

function readStorage() {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch {
    return {};
  }
}

function writeStorage(data) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Quota or privacy-mode: collection state is best-effort.
  }
}

function seedKey(worldSeed) {
  return (worldSeed >>> 0).toString(16);
}

export class CollectionState {
  constructor(worldSeed) {
    this.worldSeed = worldSeed >>> 0;
    this._reload();
  }

  _reload() {
    const all = readStorage();
    const bucket = all[seedKey(this.worldSeed)] || { collected: [], seen: [] };
    this._collected = new Set(bucket.collected || []);
    this._seen = new Set(bucket.seen || []);
  }

  _persist() {
    const all = readStorage();
    all[seedKey(this.worldSeed)] = {
      collected: [...this._collected],
      seen: [...this._seen],
    };
    writeStorage(all);
  }

  /** Switch to a different world seed without losing per-seed buckets. */
  setWorldSeed(newSeed) {
    if ((newSeed >>> 0) === this.worldSeed) return;
    this.worldSeed = newSeed >>> 0;
    this._reload();
  }

  isCollected(id) { return this._collected.has(id); }
  isSeen(id)      { return this._seen.has(id); }

  markCollected(id) {
    if (this._collected.has(id)) return false;
    this._collected.add(id);
    this._seen.add(id);
    this._persist();
    return true;
  }

  /**
   * Record that an instance has been generated near the player. This is
   * in-memory only; persistence happens on the next `markCollected`. That
   * keeps the chunk-generation pass cheap (no localStorage writes per
   * chunk) while still preserving the seen set across the session.
   */
  markSeen(id) {
    if (this._seen.has(id)) return false;
    this._seen.add(id);
    return true;
  }

  getSnapshot() {
    return {
      worldSeed: this.worldSeed,
      collected: [...this._collected],
      seen: [...this._seen],
    };
  }

  reset() {
    this._collected.clear();
    this._seen.clear();
    this._persist();
  }
}
