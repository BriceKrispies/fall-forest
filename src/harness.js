/**
 * Headless test harness — programmatic control of the render pipeline.
 * Tightly coupled to the live renderer: uses the same renderStep(),
 * same pixel buffer, same WASM pipeline. It cannot lie.
 *
 * Usage: type /harness in the game console, then call window.__harness.*
 */

export function initHarness(game) {
  const { camera, renderer, chunkSystem, input, renderStep, RENDER_W, RENDER_H } = game;

  /**
   * Sample a pixel at (x, y) from the current frame buffer.
   * Returns [r, g, b, a].
   */
  function samplePixel(x, y) {
    const i = (y * RENDER_W + x) * 4;
    const px = renderer.pixels;
    return [px[i], px[i + 1], px[i + 2], px[i + 3]];
  }

  /**
   * Sample a vertical column of pixels at screen x.
   * Returns array of { y, r, g, b } from top to bottom (step pixels apart).
   */
  function sampleColumn(x, step = 1) {
    const px = renderer.pixels;
    const result = [];
    for (let y = 0; y < RENDER_H; y += step) {
      const i = (y * RENDER_W + x) * 4;
      result.push({ y, r: px[i], g: px[i + 1], b: px[i + 2] });
    }
    return result;
  }

  /**
   * Render one frame at the given camera pitch, return diagnostics.
   * Camera position is not changed — only pitch (and optionally yaw).
   */
  function renderAtPitch(pitch, yaw) {
    camera.pitch = pitch;
    if (yaw !== undefined) camera.yaw = yaw;
    return renderStep(0, false);
  }

  /**
   * Sweep pitch from `lo` to `hi` in `steps` increments.
   * At each step, renders a frame and samples the center column.
   * Returns an array of { pitch, visCount, column } where column
   * is the center-column pixel samples.
   *
   * This is the primary tool for diagnosing the sky-snap bug:
   * look for a pitch value where the column colors change abruptly.
   */
  function pitchSweep(lo = -1.2, hi = 1.2, steps = 48) {
    const results = [];
    const midX = RENDER_W >> 1;
    const savedPitch = camera.pitch;
    const savedYaw = camera.yaw;

    for (let i = 0; i <= steps; i++) {
      const pitch = lo + (hi - lo) * (i / steps);
      const diag = renderAtPitch(pitch);
      const column = sampleColumn(midX, 10); // every 10th pixel
      results.push({
        pitch: +pitch.toFixed(4),
        visCount: diag.visCount,
        top: samplePixel(midX, 2),
        mid: samplePixel(midX, RENDER_H >> 1),
        bot: samplePixel(midX, RENDER_H - 3),
      });
    }

    // Restore camera
    camera.pitch = savedPitch;
    camera.yaw = savedYaw;
    return results;
  }

  /**
   * Find the exact pitch where a color discontinuity occurs.
   * Does a coarse sweep then binary-searches the biggest jump.
   * Returns { pitchBefore, pitchAfter, colorBefore, colorAfter, delta }.
   */
  function findSnap(lo = -1.2, hi = 1.2) {
    const midX = RENDER_W >> 1;
    const sampleY = 5; // near top of screen
    const savedPitch = camera.pitch;
    const savedYaw = camera.yaw;

    // Coarse sweep
    const N = 60;
    const samples = [];
    for (let i = 0; i <= N; i++) {
      const pitch = lo + (hi - lo) * (i / N);
      renderAtPitch(pitch);
      const c = samplePixel(midX, sampleY);
      samples.push({ pitch, c });
    }

    // Find biggest color jump
    let maxDelta = 0, maxIdx = 0;
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1].c, b = samples[i].c;
      const d = Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
      if (d > maxDelta) { maxDelta = d; maxIdx = i; }
    }

    if (maxDelta < 10) {
      camera.pitch = savedPitch;
      camera.yaw = savedYaw;
      return { found: false, maxDelta };
    }

    // Binary search between samples[maxIdx-1] and samples[maxIdx]
    let pLo = samples[maxIdx - 1].pitch;
    let pHi = samples[maxIdx].pitch;
    let cLo = samples[maxIdx - 1].c;
    let cHi = samples[maxIdx].c;

    for (let iter = 0; iter < 20; iter++) {
      const pMid = (pLo + pHi) / 2;
      renderAtPitch(pMid);
      const cMid = samplePixel(midX, sampleY);
      const dLo = Math.abs(cMid[0] - cLo[0]) + Math.abs(cMid[1] - cLo[1]) + Math.abs(cMid[2] - cLo[2]);
      const dHi = Math.abs(cMid[0] - cHi[0]) + Math.abs(cMid[1] - cHi[1]) + Math.abs(cMid[2] - cHi[2]);
      if (dHi > dLo) {
        pLo = pMid;
        cLo = cMid;
      } else {
        pHi = pMid;
        cHi = cMid;
      }
    }

    camera.pitch = savedPitch;
    camera.yaw = savedYaw;

    return {
      found: true,
      pitchBefore: +pLo.toFixed(6),
      pitchAfter: +pHi.toFixed(6),
      colorBefore: cLo.slice(0, 3),
      colorAfter: cHi.slice(0, 3),
      delta: maxDelta,
    };
  }

  /**
   * Dump a full-frame pixel snapshot as a flat array.
   * Useful for diffing two frames rendered at different pitches.
   */
  function snapshot() {
    return new Uint8ClampedArray(renderer.pixels);
  }

  /**
   * Compare two snapshots, return count of pixels that differ
   * by more than `threshold` in any channel.
   */
  function diffSnapshots(a, b, threshold = 5) {
    let count = 0;
    for (let i = 0; i < a.length; i += 4) {
      if (Math.abs(a[i] - b[i]) > threshold ||
          Math.abs(a[i + 1] - b[i + 1]) > threshold ||
          Math.abs(a[i + 2] - b[i + 2]) > threshold) {
        count++;
      }
    }
    return count;
  }

  /**
   * Sample depth buffer at (x, y). Returns Infinity-ish if no geometry.
   */
  function sampleDepth(x, y) {
    return renderer.depth[y * RENDER_W + x];
  }

  /**
   * Deep diagnosis of the snap point.
   * Renders at pitches just before/after the snap and reports
   * depth, color, and what changed.
   */
  function diagnoseSnap() {
    const snap = findSnap();
    if (!snap.found) return { found: false };

    const midX = RENDER_W >> 1;
    const sampleY = 5;

    // Render at "before" pitch
    renderAtPitch(snap.pitchBefore - 0.001);
    const beforeDepth = sampleDepth(midX, sampleY);
    const beforeColor = samplePixel(midX, sampleY);
    // Sample depths across top row
    const beforeTopDepths = [];
    for (let x = 0; x < RENDER_W; x += 20) {
      beforeTopDepths.push({ x, depth: sampleDepth(x, sampleY) });
    }

    // Render at "after" pitch
    renderAtPitch(snap.pitchAfter + 0.001);
    const afterDepth = sampleDepth(midX, sampleY);
    const afterColor = samplePixel(midX, sampleY);
    const afterTopDepths = [];
    for (let x = 0; x < RENDER_W; x += 20) {
      afterTopDepths.push({ x, depth: sampleDepth(x, sampleY) });
    }

    // Check: is geometry covering the pixel before but not after (or vice versa)?
    const GEO_THRESHOLD = 1e8;
    const beforeHasGeo = beforeDepth < GEO_THRESHOLD;
    const afterHasGeo = afterDepth < GEO_THRESHOLD;

    // Also sweep depth at center-x across all Y positions at each pitch
    renderAtPitch(snap.pitchBefore - 0.001);
    const beforeYDepths = [];
    for (let y = 0; y < RENDER_H; y += 5) {
      const d = sampleDepth(midX, y);
      beforeYDepths.push({ y, depth: +(d < GEO_THRESHOLD ? d.toFixed(3) : 'sky') });
    }

    renderAtPitch(snap.pitchAfter + 0.001);
    const afterYDepths = [];
    for (let y = 0; y < RENDER_H; y += 5) {
      const d = sampleDepth(midX, y);
      afterYDepths.push({ y, depth: +(d < GEO_THRESHOLD ? d.toFixed(3) : 'sky') });
    }

    return {
      found: true,
      snap,
      beforeColor, afterColor,
      beforeDepth: beforeDepth < GEO_THRESHOLD ? +beforeDepth.toFixed(3) : 'sky',
      afterDepth: afterDepth < GEO_THRESHOLD ? +afterDepth.toFixed(3) : 'sky',
      beforeHasGeo, afterHasGeo,
      diagnosis: beforeHasGeo && !afterHasGeo
        ? 'GEOMETRY POP: triangle covers top pixel before snap, disappears after'
        : !beforeHasGeo && afterHasGeo
        ? 'GEOMETRY POP: triangle appears after snap, covers top pixel'
        : beforeHasGeo && afterHasGeo
        ? 'BOTH HAVE GEOMETRY: different triangles at different depths'
        : 'NO GEOMETRY AT SNAP PIXEL: this is a sky/gradient rendering issue',
      beforeTopDepths,
      afterTopDepths,
      beforeYDepths: beforeYDepths.filter(d => d.depth !== 'sky').slice(0, 10),
      afterYDepths: afterYDepths.filter(d => d.depth !== 'sky').slice(0, 10),
    };
  }

  /**
   * Force the camera to walk forward (optionally sprinting) for `seconds`
   * of wall-clock time, sampling per-frame dt and the player's chunk coord
   * each frame. Reports frame-time statistics and flags the worst hitches.
   *
   * Use this to investigate FPS drops on chunk-boundary crossings: a clean
   * straight-line walk through fresh terrain will hit each boundary in
   * sequence and surface every generation hitch.
   *
   * Returns a Promise that resolves with the report. Restores the input
   * state on completion regardless of how it exits.
   */
  function movementProfile({ seconds = 6, sprint = true, yaw = 0 } = {}) {
    if (!input) {
      return Promise.resolve({ error: 'no input handle in harness' });
    }
    const prev = { forward: input.forward, sprint: input.sprint };
    const samples = []; // { t, dt, chunk: {cx,cz} }
    camera.yaw = yaw;
    input.forward = true;
    input.sprint = sprint;
    let stop = false;
    const startCx = chunkSystem ? chunkSystem.currentCx : null;
    const startCz = chunkSystem ? chunkSystem.currentCz : null;
    const startPos = [camera.x, camera.z];

    return new Promise((resolve) => {
      let last = performance.now();
      const t0 = last;
      function tick(now) {
        const dt = (now - last) / 1000;
        last = now;
        samples.push({
          t: (now - t0) / 1000,
          dt,
          cx: chunkSystem ? chunkSystem.currentCx : null,
          cz: chunkSystem ? chunkSystem.currentCz : null,
        });
        if (stop || (now - t0) / 1000 >= seconds) {
          input.forward = prev.forward;
          input.sprint = prev.sprint;
          resolve(buildReport(samples, startCx, startCz, startPos));
          return;
        }
        requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
  }

  function buildReport(samples, startCx, startCz, startPos) {
    // Drop the first sample (its dt is from before the profile started).
    const s = samples.slice(1);
    const dts = s.map(x => x.dt * 1000); // ms
    dts.sort((a, b) => a - b);
    const sum = dts.reduce((a, b) => a + b, 0);
    const avg = sum / dts.length;
    const p50 = dts[Math.floor(dts.length * 0.5)];
    const p95 = dts[Math.floor(dts.length * 0.95)];
    const p99 = dts[Math.floor(dts.length * 0.99)];
    const max = dts[dts.length - 1];

    // Detect chunk-boundary crossings: where (cx,cz) changes.
    const crossings = [];
    let prev = { cx: startCx, cz: startCz };
    for (let i = 0; i < s.length; i++) {
      const cur = s[i];
      if (cur.cx === null) continue;
      if (cur.cx !== prev.cx || cur.cz !== prev.cz) {
        crossings.push({
          t: +cur.t.toFixed(3),
          dtMs: +(cur.dt * 1000).toFixed(2),
          from: prev,
          to: { cx: cur.cx, cz: cur.cz },
        });
        prev = { cx: cur.cx, cz: cur.cz };
      }
    }

    // Frames whose dt exceeded 2× the median — likely hitches.
    const hitchThreshold = p50 * 2.2;
    const hitches = s
      .map((x, i) => ({ i, t: +x.t.toFixed(3), dtMs: +(x.dt * 1000).toFixed(2), cx: x.cx, cz: x.cz }))
      .filter(x => x.dtMs >= hitchThreshold)
      .slice(0, 20);

    return {
      sampleCount: s.length,
      durationSec: +s[s.length - 1].t.toFixed(2),
      frameTimeMs: {
        avg: +avg.toFixed(2),
        p50: +p50.toFixed(2),
        p95: +p95.toFixed(2),
        p99: +p99.toFixed(2),
        max: +max.toFixed(2),
      },
      startPos,
      endPos: [camera.x, camera.z],
      distanceMoved: +Math.hypot(camera.x - startPos[0], camera.z - startPos[1]).toFixed(2),
      chunkCrossings: crossings,
      hitchThresholdMs: +hitchThreshold.toFixed(2),
      hitches,
    };
  }

  /**
   * Synchronous variant that doesn't drive the rAF loop — it directly
   * times generateChunk-style work via chunkSystem by stepping the
   * camera through fresh coords and forcing buffer refreshes.
   */
  function chunkLoadCost(distance = 64, step = 1.5) {
    if (!chunkSystem) return { error: 'no chunkSystem in harness' };
    const startX = camera.x, startZ = camera.z;
    const samples = [];
    let x = startX, z = startZ;
    for (let d = 0; d < distance; d += step) {
      x += step;
      const t0 = performance.now();
      chunkSystem.update(x, z);
      const t1 = performance.now();
      samples.push({ x, ms: +(t1 - t0).toFixed(2) });
    }
    camera.x = startX; camera.z = startZ;
    chunkSystem.update(startX, startZ);
    const nonzero = samples.filter(s => s.ms > 0.1);
    nonzero.sort((a, b) => b.ms - a.ms);
    return {
      samples: samples.length,
      hitches: nonzero.slice(0, 10),
      totalMs: +samples.reduce((s, x) => s + x.ms, 0).toFixed(2),
    };
  }

  const harness = {
    samplePixel,
    sampleColumn,
    sampleDepth,
    renderAtPitch,
    pitchSweep,
    findSnap,
    diagnoseSnap,
    snapshot,
    diffSnapshots,
    movementProfile,
    chunkLoadCost,
  };

  if (typeof window !== 'undefined') window.__harness = harness;
  return harness;
}
