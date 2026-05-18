/**
 * DiscoveryRegistry — central catalog of discovery definitions.
 *
 * A discovery definition is plain data + two pure functions:
 *
 *   {
 *     id: string                      // unique, stable
 *     rarity: 'common'|'uncommon'|'rare'
 *     cooldownMeters: number          // min distance between repeats of this id
 *     tags: string[]                  // shared cooldown buckets (e.g. 'collectible')
 *     tagCooldownMeters?: { [tag]: number }   // optional per-tag overrides
 *     minDistanceFromStart?: number   // hard gate; defaults to 0
 *     canSpawn(ctx): boolean          // additional placement gating
 *     place(ctx): InstanceInfo[]      // mutates ctx, returns instance records
 *   }
 *
 * Returned instance records look like:
 *
 *   {
 *     instanceId: string              // unique within world (collectibleId)
 *     definitionId: string            // id of the discovery
 *     x: number, z: number,
 *     collectible: boolean,
 *     tags: string[],
 *     label: string                   // human-readable, for the proximity hint
 *   }
 *
 * The chunk generator does not know which discoveries exist — it just
 * asks the registry for everything it could try and lets the ledger /
 * canSpawn() do the filtering.
 */

export class DiscoveryRegistry {
  constructor() {
    this.byId = new Map();
    this.byRarity = { common: [], uncommon: [], rare: [] };
  }

  register(definition) {
    if (!definition || !definition.id) {
      throw new Error('discovery definition missing id');
    }
    if (this.byId.has(definition.id)) {
      throw new Error(`discovery already registered: ${definition.id}`);
    }
    const def = {
      rarity: 'common',
      cooldownMeters: 0,
      tags: [],
      minDistanceFromStart: 0,
      canSpawn: () => true,
      place: () => [],
      ...definition,
    };
    this.byId.set(def.id, def);
    const bucket = this.byRarity[def.rarity];
    if (!bucket) throw new Error(`unknown rarity: ${def.rarity}`);
    bucket.push(def);
    return def;
  }

  get(id) { return this.byId.get(id); }
  all()   { return [...this.byId.values()]; }

  /** Definitions matching the given rarities, sorted by id for determinism. */
  candidatesForRarities(allowed) {
    const out = [];
    for (const rarity of Object.keys(this.byRarity)) {
      if (!allowed[rarity]) continue;
      for (const def of this.byRarity[rarity]) out.push(def);
    }
    out.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    return out;
  }
}
