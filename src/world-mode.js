/**
 * World mode system — authored environment profiles activated by console commands.
 *
 * Each mode is a plain data object listing parameter overrides. Unspecified
 * parameters fall through to whatever DayNightCycle computes naturally.
 * The WorldMode class blends between modes over time, producing a single
 * `resolved` object that all rendering systems read each frame.
 */

import { lerp, clamp, v3lerp } from './math.js';

// ── Mode definitions ──
// Only include parameters the mode overrides. Null/undefined = use cycle default.

const MODES = {
  normal: {
    // Identity mode — overrides nothing, cycle runs naturally
    timeScale: 1,
  },

  hell: {
    fogColor:       [0.35, 0.08, 0.04],
    ambientLevel:   0.45,
    ambientTint:    [1.0, 0.35, 0.15],
    nightness:      0.75,
    sunVisible:     false,
    sunTint:        [1.0, 0.3, 0.1],
    skyTint:        [0.5, 0.06, 0.02],
    creatureColor:  [200, 45, 25],
    creatureShape:  'horned',
    lampColor:      [255, 60, 20],
    timeScale:      0,
  },

  dark: {
    fogColor:       [0.04, 0.04, 0.08],
    ambientLevel:   0.18,
    ambientTint:    [0.35, 0.40, 0.65],
    nightness:      1.0,
    sunVisible:     false,
    skyTint:        [0.02, 0.02, 0.06],
    timeScale:      0,
  },

  day: {
    fogColor:       [0.82, 0.78, 0.65],
    ambientLevel:   1.0,
    ambientTint:    [1.0, 1.0, 0.95],
    nightness:      0,
    sunVisible:     true,
    sunTint:        [1.0, 1.0, 0.95],
    timeScale:      0,
  },

  rain: {
    fogColor:       [0.38, 0.40, 0.44],
    ambientLevel:   0.35,
    ambientTint:    [0.65, 0.68, 0.75],
    nightness:      0,        // no stars/moon — overcast, not nighttime
    sunVisible:     false,
    rainIntensity:  1.0,
    timeScale:      0,
  },
};

// ── WorldMode class ──

export class WorldMode {
  constructor() {
    this.current = 'normal';
    this.blend = 1.0;               // 0 = at snapshot, 1 = fully at target mode
    this.transitionSpeed = 1.8;     // blend units per second (~0.6s full transition)
    this.snapshot = null;            // frozen resolved state at transition start
    this.resolved = {};              // the output every system reads
  }

  /** Activate a named mode. Returns the mode name or null if unknown. */
  activate(name) {
    const key = name.toLowerCase();
    if (!MODES[key]) return null;
    if (key === this.current && this.blend >= 1) return key;

    // Snapshot current resolved state as the transition source
    this.snapshot = Object.assign({}, this.resolved);
    // Deep-copy vec3 arrays so lerping doesn't mutate the snapshot
    for (const k of ['fogColor', 'ambientTint', 'sunDir', 'sunTint']) {
      if (this.snapshot[k]) this.snapshot[k] = this.snapshot[k].slice();
    }

    this.current = key;
    this.blend = 0;
    return key;
  }

  /** Returns the time scale for the active mode (1 = normal cycle, 0 = frozen). */
  get timeScale() {
    const mode = MODES[this.current];
    return mode && mode.timeScale !== undefined ? mode.timeScale : 1;
  }

  /**
   * Advance blend and produce the resolved state for this frame.
   * Call once per frame after DayNightCycle.update().
   *
   * @param {number} dt - frame delta time
   * @param {object} lighting - the DayNightCycle instance (provides defaults)
   */
  resolve(dt, lighting) {
    // Advance blend
    if (this.blend < 1) {
      this.blend = Math.min(1, this.blend + dt * this.transitionSpeed);
    }

    const mode = MODES[this.current] || {};
    const t = this.blend;

    // Target values: mode override ?? lighting default
    const target = {
      fogColor:       mode.fogColor       ?? lighting.fogColor,
      ambientLevel:   mode.ambientLevel   ?? lighting.ambientLevel,
      ambientTint:    mode.ambientTint    ?? lighting.getAmbientTint(),
      sunDir:         mode.sunDir         ?? lighting.sunDir,
      sunTint:        mode.sunTint        ?? lighting.sunTint,
      sunVisible:     mode.sunVisible     ?? lighting.sunVisible,
      nightness:      mode.nightness      ?? lighting.nightness,
      skyTint:        mode.skyTint        ?? null,
      creatureColor:  mode.creatureColor  ?? null,
      creatureShape:  mode.creatureShape  ?? null,
      rainIntensity:  mode.rainIntensity  ?? 0,
      lampColor:      mode.lampColor      ?? null,
    };

    // If fully blended or no snapshot, use target directly
    if (t >= 1 || !this.snapshot) {
      this.resolved = target;
      return;
    }

    // Lerp from snapshot toward target
    const s = this.snapshot;
    this.resolved = {
      fogColor:      v3lerp(s.fogColor      || target.fogColor,      target.fogColor,     t),
      ambientLevel:  lerp(s.ambientLevel     ?? target.ambientLevel,  target.ambientLevel, t),
      ambientTint:   v3lerp(s.ambientTint    || target.ambientTint,   target.ambientTint,  t),
      sunDir:        v3lerp(s.sunDir         || target.sunDir,        target.sunDir,       t),
      sunTint:       v3lerp(s.sunTint        || target.sunTint,       target.sunTint,      t),
      sunVisible:    t > 0.5 ? target.sunVisible : (s.sunVisible ?? target.sunVisible),
      nightness:     lerp(s.nightness        ?? target.nightness,     target.nightness,    t),
      rainIntensity:  lerp(s.rainIntensity  ?? target.rainIntensity, target.rainIntensity, t),
      // Discrete fields — snap immediately
      skyTint:       target.skyTint,
      creatureColor: target.creatureColor,
      creatureShape: target.creatureShape,
      lampColor:     target.lampColor,
    };
  }
}
