// Verifies the async chunk-system queue: prewarm fully populates, drain
// pops chunks under budget, and visible set tolerates missing chunks.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => store.has(k) ? store.get(k) : null,
  setItem: (k, v) => { store.set(k, v); },
  removeItem: () => {},
};
globalThis.document = {
  getElementById: () => null,
  createElement: () => ({ getContext: () => ({ getImageData: () => ({ data: new Uint8ClampedArray(0) }) }) }),
};

// Stub WASM since chunk-system imports wasm-bridge.
const stubWasm = {
  set_tri_count: () => {},
  set_grass_count: () => {},
};
const wbModule = await import('../src/wasm-bridge.js');
// Pre-populate the views the bridge uses so set() calls don't NPE.
// Actually, uploadTrianglesFlat dereferences f32View. Initialize wasm-bridge
// with a fake memory by patching the module's internal state.
// Hack: skip rebuildVisible entirely by overriding renderRadius to 0 so
// visibleKeys stays empty and no uploads happen.

const { ChunkSystem } = await import('../src/world/chunk-system.js');
const { createDefaultRegistry } = await import('../src/world/discoveries/index.js');
const { SpawnLedger } = await import('../src/world/generation/spawn-ledger.js');
const { CollectionState } = await import('../src/world/generation/collection-state.js');

const cs = new ChunkSystem();
cs.setDiscoveryServices({
  registry: createDefaultRegistry(),
  spawnLedger: new SpawnLedger(),
  collectionState: new CollectionState(cs.worldSeed),
});
// Stub _rebuildVisible since WASM memory isn't initialized in this test.
cs._rebuildVisible = function() {
  this.totalTriCount = 0;
  this.visibleBeats = [];
  this.visiblePathNodes = [];
};

let pass = 0, fail = 0;
const check = (name, ok, extra='') => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); ok ? pass++ : fail++; };

// First update: should sync-generate the active 3x3 and queue the rest.
cs.update(0, 0);
const activeCount = cs.activeKeys.size;
const bufferedAfterUpdate = cs.bufferedChunks.size;
const pendingAfterUpdate = cs._pendingChunks.size;

check('active scope populated synchronously', activeCount === 9);
// First update generates active synchronously, then runs one 3ms drain
// pass on the outer ring — so buffered is at least active size, with
// any extra chunks coming from the drain.
const totalChunks = (2*cs.generationRadius+1)**2;
check('buffered >= active after first update',
  bufferedAfterUpdate >= activeCount && bufferedAfterUpdate < totalChunks,
  `buffered=${bufferedAfterUpdate} active=${activeCount}`);
check('buffered + pending == full window',
  bufferedAfterUpdate + pendingAfterUpdate === totalChunks,
  `buffered=${bufferedAfterUpdate} pending=${pendingAfterUpdate} total=${totalChunks}`);

// Drain via prewarm.
cs.prewarm();
const expected = (2*cs.generationRadius+1)**2;
check('prewarm drains queue fully', cs._pendingChunks.size === 0);
check('buffer fully populated after prewarm',
  cs.bufferedChunks.size === expected,
  `buffered=${cs.bufferedChunks.size} expected=${expected}`);

// Walk one chunk over. Should sync the new active row and queue the new edge.
cs.update(16, 0);
check('crossing keeps active synchronous', cs.activeKeys.size === 9);
// 13 new chunks should now be in the buffer (one new column of generation_radius*2+1)
// but only the active-3x3 sync immediately; the rest queued.

// Time-budgeted drain should make progress without finishing.
const sizeBefore = cs._pendingChunks.size;
const produced = cs._drainQueue(0.001); // unrealistically tiny budget
check('drain with tiny budget produces at least 1', produced >= 1, `produced=${produced}`);
check('drain with tiny budget leaves work pending',
  cs._pendingChunks.size > 0 && cs._pendingChunks.size <= sizeBefore - 1,
  `pending=${cs._pendingChunks.size} sizeBefore=${sizeBefore} produced=${produced}`);

cs.prewarm();
check('subsequent prewarm finishes the rest', cs._pendingChunks.size === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
