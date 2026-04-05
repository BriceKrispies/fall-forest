const wabt = require('wabt');
const fs = require('fs');
const path = require('path');

async function build() {
  const w = await wabt();
  const watFiles = fs.readdirSync('wasm').filter(f => f.endsWith('.wat'));
  for (const file of watFiles) {
    const src = fs.readFileSync(path.join('wasm', file), 'utf8');
    const name = path.basename(file, '.wat');
    const mod = w.parseWat(file, src);
    const { buffer } = mod.toBinary({ write_debug_names: false });
    const outPath = path.join('wasm', name + '.wasm');
    fs.writeFileSync(outPath, buffer);
    console.log(`${file} -> ${outPath} (${buffer.byteLength} bytes)`);
    mod.destroy();
  }
}

build().catch(e => { console.error(e); process.exit(1); });
