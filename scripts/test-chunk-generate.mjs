// End-to-end: generate two chunks and verify determinism + discovery
// surfacing. Mocks the browser globals the imported modules touch.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => store.has(k) ? store.get(k) : null,
  setItem: (k, v) => { store.set(k, v); },
  removeItem: (k) => { store.delete(k); },
};

// renderer.js touches DOM via canvas.getContext, but is only imported for
// DEFAULT_SUN_DIR. Stub canvas so the module file loads cleanly.
globalThis.document = {
  getElementById: () => null,
  createElement: () => ({ getContext: () => ({}) }),
};

const { generateChunk } = await import('../src/world/chunk-generator.js');
const { createDefaultRegistry } = await import('../src/world/discoveries/index.js');
const { SpawnLedger } = await import('../src/world/generation/spawn-ledger.js');
const { CollectionState } = await import('../src/world/generation/collection-state.js');

const SEED = 0xFA11F0E5;

function makeSvc() {
  return {
    registry: createDefaultRegistry(),
    spawnLedger: new SpawnLedger(),
    collectionState: new CollectionState(SEED),
  };
}

let pass = 0, fail = 0;
const check = (name, ok, extra='') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
  ok ? pass++ : fail++;
};

// Generate chunks (0,0) through (0,9) twice with fresh ledgers/state.
// Discoveries must be identical across runs because the chunk generator
// is deterministic given (seed, coord, ledger-state, collection-state).
function gen() {
  const svc = makeSvc();
  const out = [];
  for (let cz = 0; cz < 10; cz++) {
    const chunk = generateChunk(SEED, 0, cz, 16, svc);
    out.push({ cz, n: chunk.discoveries.length, ids: chunk.discoveries.map(d => d.instanceId) });
  }
  return out;
}

const runA = gen();
const runB = gen();
const same = JSON.stringify(runA) === JSON.stringify(runB);
check('two cold runs produce identical chunk discovery lists', same);

const total = runA.reduce((s, r) => s + r.n, 0);
check('at least some discoveries placed across 10 chunks', total > 0, `total=${total}`);

// Print histogram
const hist = {};
for (const r of runA) for (const id of r.ids) {
  const def = id.split('@')[0];
  hist[def] = (hist[def] || 0) + 1;
}
console.log('discovery histogram:', JSON.stringify(hist));
console.log('per-chunk counts:', runA.map(r => `${r.cz}:${r.n}`).join(' '));

// Collection persistence: mark something collected, regenerate that chunk,
// and verify the discovery sees the collected flag.
const svc = makeSvc();
// Find a collectible to mark.
let target = null;
for (let cz = 0; cz < 12 && !target; cz++) {
  const chunk = generateChunk(SEED, 0, cz, 16, svc);
  for (const d of chunk.discoveries) {
    if (d.collectible) { target = { cz, id: d.instanceId, def: d.definitionId }; break; }
  }
}
if (!target) {
  check('found a collectible to test', false);
} else {
  svc.collectionState.markCollected(target.id);
  // Regenerate that chunk in a fresh-ledger session to mimic chunk eviction+reload.
  const svc2 = makeSvc();
  // Walk through earlier chunks so the ledger state mirrors the original.
  for (let cz = 0; cz < target.cz; cz++) generateChunk(SEED, 0, cz, 16, svc2);
  const regen = generateChunk(SEED, 0, target.cz, 16, svc2);
  const found = regen.discoveries.find(d => d.instanceId === target.id);
  check('collected instance regenerates as non-collectible',
    found && found.collected === true && found.collectible === false,
    `id=${target.id}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
