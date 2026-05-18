/**
 * RarityBudget — distance-paced gates for rarity tiers.
 *
 * Generation should not roll a pure d20 per chunk for "is there a rare
 * thing here?". That produces clumps and droughts. Instead, each rarity
 * tier names a minimum distance interval between consecutive spawns of
 * that tier; the budget reports whether a rarity is "due" at a given
 * world distance, given the spawn ledger's history.
 *
 * The interval is randomized within a band so the cadence is not
 * mechanical. Randomness is drawn from a caller-supplied RNG so the
 * decision stays deterministic from (seed, chunk).
 */

export const RARITY = Object.freeze({
  COMMON: 'common',
  UNCOMMON: 'uncommon',
  RARE: 'rare',
});

/** Distance bands (meters) between consecutive spawns of a given rarity. */
const RARITY_INTERVALS = {
  common:   [15, 30],
  uncommon: [70, 120],
  rare:     [220, 400],
};

/**
 * Returns true if `rarity` is eligible to spawn at `distance` given the
 * spawn ledger's most recent spawn of that rarity. `rng.next()` is used
 * once to pick the threshold inside the rarity's band; pass a chunk-
 * deterministic RNG so adjacent runs of the generator agree.
 */
export function rarityEligible(ledger, rarity, distance, rng) {
  const band = RARITY_INTERVALS[rarity];
  if (!band) return true;
  const last = ledger.lastDistanceForRarity(rarity);
  if (last === -Infinity) return true;
  const threshold = band[0] + rng.next() * (band[1] - band[0]);
  return (distance - last) >= threshold;
}

/** Map of rarity → eligible boolean, evaluated at this distance. */
export function eligibleRarities(ledger, distance, rng) {
  return {
    common:   rarityEligible(ledger, 'common',   distance, rng),
    uncommon: rarityEligible(ledger, 'uncommon', distance, rng),
    rare:     rarityEligible(ledger, 'rare',     distance, rng),
  };
}

export function intervalFor(rarity) {
  return RARITY_INTERVALS[rarity];
}
