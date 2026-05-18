/**
 * Discovery barrel — populates a DiscoveryRegistry with the built-in
 * definitions. Add a new discovery here once it has its own module.
 */

import { DiscoveryRegistry } from '../generation/discovery-registry.js';
import { fallenLogWithFlowers } from './fallen-log-with-flowers.js';
import { blueMushroomRing } from './blue-mushroom-ring.js';
import { owlTotem } from './owl-totem.js';

export const BUILTIN_DISCOVERIES = [
  fallenLogWithFlowers,
  blueMushroomRing,
  owlTotem,
];

export function createDefaultRegistry() {
  const registry = new DiscoveryRegistry();
  for (const def of BUILTIN_DISCOVERIES) registry.register(def);
  return registry;
}
