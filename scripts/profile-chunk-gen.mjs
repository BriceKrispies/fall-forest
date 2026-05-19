// Measure the synchronous cost of generateChunk(). The doubled
// generation radius means every chunk-boundary crossing forces 13
// fresh chunks to be built in one frame — this script estimates how
// much frame time that costs.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => store.has(k) ? store.get(k) : null,
  setItem: (k, v) => { store.set(k, v); },
  removeItem: () => {},
};
globalThis.document = {
  getElementById: () => null,
  createElement: () => ({ getContext: () => ({}) }),
};

const { generateChunk } = await import('../src/world/chunk-generator.js');
const { createDefaultRegistry } = await import('../src/world/discoveries/index.js');
const { SpawnLedger } = await import('../src/world/generation/spawn-ledger.js');
const { CollectionState } = await import('../src/world/generation/collection-state.js');

const SEED = 0xFA11F0E5;
const SIZE = 16;
const svc = {
  registry: createDefaultRegistry(),
  spawnLedger: new SpawnLedger(),
  collectionState: new CollectionState(SEED),
};

function warm() {
  for (let cz = -3; cz <= 3; cz++) generateChunk(SEED, 0, cz, SIZE, svc);
}
warm();

function timeOne(cx, cz) {
  const t0 = process.hrtime.bigint();
  const chunk = generateChunk(SEED, cx, cz, SIZE, svc);
  const t1 = process.hrtime.bigint();
  return { ms: Number(t1 - t0) / 1e6, tris: chunk.triCount };
}

// Sample a representative spread of coords.
const samples = [];
for (let cx = -6; cx <= 6; cx++) {
  for (let cz = 4; cz <= 8; cz++) {
    samples.push(timeOne(cx, cz));
  }
}

samples.sort((a, b) => a.ms - b.ms);
const sum = samples.reduce((s, x) => s + x.ms, 0);
const avg = sum / samples.length;
const p50 = samples[Math.floor(samples.length * 0.5)].ms;
const p95 = samples[Math.floor(samples.length * 0.95)].ms;
const max = samples[samples.length - 1].ms;
const triAvg = samples.reduce((s, x) => s + x.tris, 0) / samples.length;

console.log(`single generateChunk timings (n=${samples.length}):`);
console.log(`  avg:  ${avg.toFixed(2)} ms`);
console.log(`  p50:  ${p50.toFixed(2)} ms`);
console.log(`  p95:  ${p95.toFixed(2)} ms`);
console.log(`  max:  ${max.toFixed(2)} ms`);
console.log(`  tris/chunk avg: ${triAvg.toFixed(0)}`);

// Project to chunk-boundary cost.
const newChunksPerCrossing = 13; // edge of 13x13 buffer
const projected = avg * newChunksPerCrossing;
const at60fps = 16.67;
console.log(`\nprojected hitch on a chunk-boundary crossing:`);
console.log(`  ${newChunksPerCrossing} chunks × ${avg.toFixed(2)}ms = ${projected.toFixed(1)} ms`);
console.log(`  that's ${(projected / at60fps).toFixed(1)}× a 16.67ms (60fps) budget`);

// Also measure cost of just one full row, since that's what shifts on a
// single-axis boundary cross.
console.log(`\n${samples.length >= 13 ? 'observed' : 'projected'} 13-chunk batch (sum of fastest 13): ` +
  `${samples.slice(0, 13).reduce((s, x) => s + x.ms, 0).toFixed(1)} ms`);
