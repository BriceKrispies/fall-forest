const store = new Map();
globalThis.localStorage = {
  getItem: (k) => store.has(k) ? store.get(k) : null,
  setItem: (k, v) => { store.set(k, v); },
  removeItem: (k) => { store.delete(k); },
};

const { CollectionState } = await import('../src/world/generation/collection-state.js');
const { SpawnLedger } = await import('../src/world/generation/spawn-ledger.js');
const { rarityEligible } = await import('../src/world/generation/rarity-budget.js');
const { DiscoveryRegistry } = await import('../src/world/generation/discovery-registry.js');
const { createRNG } = await import('../src/world/seed.js');

let pass = 0, fail = 0;
const check = (name, ok) => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}`); ok ? pass++ : fail++; };

const cs = new CollectionState(0xFA11F0E5);
cs.markCollected('foo@0,0#0');
const cs2 = new CollectionState(0xFA11F0E5);
check('persistence', cs2.isCollected('foo@0,0#0'));

const cs3 = new CollectionState(0x12345678);
check('seed isolation', !cs3.isCollected('foo@0,0#0'));

cs3.markCollected('zzz@1,1#0');
const cs4 = new CollectionState(0xFA11F0E5);
check('original seed still has its mark', cs4.isCollected('foo@0,0#0'));
check('original seed unaffected by other seed', !cs4.isCollected('zzz@1,1#0'));

const led = new SpawnLedger();
const def = {
  id: 'thing', rarity: 'uncommon', cooldownMeters: 80,
  tags: ['collectible'], tagCooldownMeters: { collectible: 60 },
};
led.recordSpawn(def, 100);
check('id cooldown blocks <80m later', !led.canSpawnDiscovery(def, 130));
check('id cooldown releases >=80m later', led.canSpawnDiscovery(def, 200));

const def2 = {
  id: 'other', rarity: 'uncommon', cooldownMeters: 10,
  tags: ['collectible'], tagCooldownMeters: { collectible: 60 },
};
check('tag cooldown blocks other discovery <60m', !led.canSpawnDiscovery(def2, 130));
check('tag cooldown releases other discovery >=60m', led.canSpawnDiscovery(def2, 180));

const r1 = createRNG(1234);
const r2 = createRNG(1234);
const a = rarityEligible(led, 'rare', 50, r1);
const b = rarityEligible(led, 'rare', 50, r2);
check('rarity gate deterministic for same seed', a === b);

const reg = new DiscoveryRegistry();
reg.register({ id: 'b', rarity: 'rare', cooldownMeters: 200 });
reg.register({ id: 'a', rarity: 'common', cooldownMeters: 5 });
const cands = reg.candidatesForRarities({ common: true, uncommon: false, rare: true });
check('registry filter sorted by id', cands.map(c => c.id).join(',') === 'a,b');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
