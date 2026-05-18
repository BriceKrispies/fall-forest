/**
 * SpawnLedger — runtime distance-pacing for discovery placement.
 *
 * Tracks the world-space distance at which each discovery id and each
 * cooldown tag last spawned. A candidate discovery is blocked unless
 * every relevant cooldown has elapsed.
 *
 * "Distance" is supplied by the caller (the chunk generator passes the
 * chunk's center distance from origin). The ledger is stateful and per-
 * session; collection state and the underlying seed are owned elsewhere.
 *
 * The ledger is *not* part of the chunk content cache. Reloading a chunk
 * never replays its prior recordSpawn calls — that's the intended
 * behavior, since the ledger paces *new* generation, not history.
 */

export class SpawnLedger {
  constructor() {
    /** discoveryId → distance of last spawn (meters from origin). */
    this.lastSpawnDistanceById = new Map();
    /** tag → distance of last spawn. */
    this.lastSpawnDistanceByTag = new Map();
    /** rarity ("common"|"uncommon"|"rare") → distance of last spawn. */
    this.lastSpawnDistanceByRarity = new Map();
    /** ordered history (most recent last) for debug. */
    this.history = [];
    this.maxHistory = 32;
  }

  reset() {
    this.lastSpawnDistanceById.clear();
    this.lastSpawnDistanceByTag.clear();
    this.lastSpawnDistanceByRarity.clear();
    this.history.length = 0;
  }

  /**
   * Returns true if the discovery is clear to spawn at `distance`.
   * Blocked when:
   *   • its own id cooldown has not yet elapsed, OR
   *   • any of its cooldown tags is still cooling down.
   *
   * Per-tag cooldowns default to the discovery's own cooldownMeters
   * unless the definition supplies `tagCooldownMeters[tag]`.
   */
  canSpawnDiscovery(discovery, distance) {
    const idLast = this.lastSpawnDistanceById.get(discovery.id);
    if (idLast !== undefined && distance - idLast < (discovery.cooldownMeters ?? 0)) {
      return false;
    }
    const tags = discovery.tags || [];
    const tagCD = discovery.tagCooldownMeters || {};
    for (let i = 0; i < tags.length; i++) {
      const tag = tags[i];
      const tLast = this.lastSpawnDistanceByTag.get(tag);
      if (tLast === undefined) continue;
      const cd = tagCD[tag] ?? discovery.cooldownMeters ?? 0;
      if (distance - tLast < cd) return false;
    }
    return true;
  }

  /** Records that a discovery spawned at `distance`. Updates all cooldown maps. */
  recordSpawn(discovery, distance) {
    this.lastSpawnDistanceById.set(discovery.id, distance);
    const tags = discovery.tags || [];
    for (let i = 0; i < tags.length; i++) {
      this.lastSpawnDistanceByTag.set(tags[i], distance);
    }
    if (discovery.rarity) {
      this.lastSpawnDistanceByRarity.set(discovery.rarity, distance);
    }
    this.history.push({ id: discovery.id, rarity: discovery.rarity, tags, distance });
    if (this.history.length > this.maxHistory) this.history.shift();
  }

  /** Distance at which `rarity` last spawned, or -Infinity if never. */
  lastDistanceForRarity(rarity) {
    return this.lastSpawnDistanceByRarity.get(rarity) ?? -Infinity;
  }

  getSnapshot() {
    return {
      byId: Object.fromEntries(this.lastSpawnDistanceById),
      byTag: Object.fromEntries(this.lastSpawnDistanceByTag),
      byRarity: Object.fromEntries(this.lastSpawnDistanceByRarity),
      history: this.history.slice(),
    };
  }
}
