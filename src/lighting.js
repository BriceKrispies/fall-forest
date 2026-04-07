import { v3norm, v3lerp, lerp, clamp, smoothstep } from './math.js';

// Full day/night cycle in seconds (gentle but noticeable)
const CYCLE_DURATION = 180;

// Time-of-day keyframes (0 = midnight, 0.25 = dawn, 0.5 = noon, 0.75 = dusk, 1.0 = midnight)
const SKY_COLORS = [
  { t: 0.00, fog: [0.06, 0.06, 0.12], ambient: 0.12 },  // midnight
  { t: 0.20, fog: [0.08, 0.07, 0.14], ambient: 0.14 },  // pre-dawn
  { t: 0.25, fog: [0.65, 0.45, 0.35], ambient: 0.40 },  // dawn
  { t: 0.30, fog: [0.78, 0.68, 0.55], ambient: 0.70 },  // early morning
  { t: 0.40, fog: [0.82, 0.78, 0.65], ambient: 0.90 },  // morning
  { t: 0.50, fog: [0.82, 0.78, 0.65], ambient: 1.00 },  // noon
  { t: 0.60, fog: [0.82, 0.78, 0.65], ambient: 0.90 },  // afternoon
  { t: 0.70, fog: [0.78, 0.62, 0.45], ambient: 0.70 },  // late afternoon
  { t: 0.75, fog: [0.70, 0.40, 0.30], ambient: 0.40 },  // dusk
  { t: 0.80, fog: [0.25, 0.15, 0.20], ambient: 0.18 },  // twilight
  { t: 0.90, fog: [0.08, 0.07, 0.14], ambient: 0.13 },  // night
  { t: 1.00, fog: [0.06, 0.06, 0.12], ambient: 0.12 },  // midnight
];

// Sun tint at different times of day
const SUN_TINTS = [
  { t: 0.25, color: [1.0, 0.6, 0.3] },   // dawn - orange
  { t: 0.35, color: [1.0, 0.9, 0.7] },   // morning - warm
  { t: 0.50, color: [1.0, 1.0, 0.95] },  // noon - white-ish
  { t: 0.65, color: [1.0, 0.9, 0.7] },   // afternoon - warm
  { t: 0.75, color: [1.0, 0.5, 0.25] },  // dusk - deep orange
];

function sampleKeyframes(keyframes, time, getVal) {
  for (let i = 0; i < keyframes.length - 1; i++) {
    if (time >= keyframes[i].t && time <= keyframes[i + 1].t) {
      const t = (time - keyframes[i].t) / (keyframes[i + 1].t - keyframes[i].t);
      const smooth = t * t * (3 - 2 * t);
      return getVal(keyframes[i], keyframes[i + 1], smooth);
    }
  }
  return getVal(keyframes[0], keyframes[0], 0);
}

export class DayNightCycle {
  constructor() {
    // Start at late morning so user sees daytime first
    this.timeOfDay = 0.42;
    this.sunDir = [0, 1, 0];
    this.fogColor = [0.82, 0.78, 0.65];
    this.ambientLevel = 1.0;
    this.sunTint = [1, 1, 1];
    this.sunVisible = true;
    this.nightness = 0;  // 0 = full day, 1 = full night
  }

  update(dt) {
    this.timeOfDay = (this.timeOfDay + dt / CYCLE_DURATION) % 1.0;

    // Sun arcs across the sky: rises at t=0.25 (east), noon at t=0.5 (top), sets at t=0.75 (west)
    const sunAngle = (this.timeOfDay - 0.25) * Math.PI * 2;
    const sunY = Math.sin(sunAngle * 0.5);  // 0 at horizon, 1 at zenith
    const sunX = Math.cos(sunAngle * 0.5);

    // Sun is only above horizon during day half (0.25 - 0.75)
    this.sunVisible = this.timeOfDay > 0.23 && this.timeOfDay < 0.77;

    if (this.sunVisible) {
      // Map the 0.25-0.75 range to a full semicircle
      const dayProgress = (this.timeOfDay - 0.25) / 0.5;
      const angle = dayProgress * Math.PI;
      const sy = Math.sin(angle);
      const sx = Math.cos(angle);
      this.sunDir = v3norm([sx * 0.6, Math.max(0.05, sy), 0.35]);
    } else {
      // Keep a dim direction for ambient during night
      this.sunDir = v3norm([0, 0.05, 0.35]);
    }

    // Sample fog color and ambient from keyframes
    this.fogColor = sampleKeyframes(SKY_COLORS, this.timeOfDay,
      (a, b, t) => v3lerp(a.fog, b.fog, t));
    this.ambientLevel = sampleKeyframes(SKY_COLORS, this.timeOfDay,
      (a, b, t) => lerp(a.ambient, b.ambient, t));

    // Sun tint
    if (this.sunVisible) {
      this.sunTint = sampleKeyframes(SUN_TINTS, this.timeOfDay,
        (a, b, t) => v3lerp(a.color, b.color, t));
    }

    // Nightness for fire influence
    this.nightness = clamp(1.0 - smoothstep(0.15, 0.35, this.ambientLevel), 0, 1);
  }

  // Returns the direction from a point to a light source projected onto the ground plane.
  // Used for casting shadows from any light source.
  getShadowDir(lightPos, objectPos) {
    const dx = objectPos[0] - lightPos[0];
    const dz = objectPos[2] - lightPos[2];
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len < 0.01) return [0, 0];
    return [dx / len, dz / len];
  }

  // How strongly the fire illuminates a point (0..1)
  getFireInfluence(firePos, objectPos) {
    const dx = objectPos[0] - firePos[0];
    const dz = objectPos[2] - firePos[2];
    const dist = Math.sqrt(dx * dx + dz * dz);
    const range = 6 + this.nightness * 4;
    return clamp(1.0 - dist / range, 0, 1) * this.nightness;
  }

  // Color multiplier for the ambient light — tints everything
  getAmbientTint() {
    const fog = this.fogColor;
    const a = this.ambientLevel;
    // During day, mostly white tint. At night, blue-ish tint.
    const nightBlue = [0.4, 0.45, 0.7];
    const dayWhite = [1.0, 1.0, 0.95];
    return v3lerp(nightBlue, dayWhite, clamp(a * 1.2, 0, 1));
  }
}

// Objects near the fire that should cast fire shadows
// Returns an array of {cx, cz, rx, rz, dirX, dirZ, intensity} for shadow ellipses
export function computeFireShadows(firePos, nearbyObjects, nightness) {
  if (nightness < 0.05) return [];
  const shadows = [];
  const fireX = firePos[0], fireZ = firePos[2];

  for (const obj of nearbyObjects) {
    const dx = obj.x - fireX;
    const dz = obj.z - fireZ;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < 0.3 || dist > 8) continue;

    const ndx = dx / dist;
    const ndz = dz / dist;

    // Shadow extends away from fire
    const shadowLen = obj.height * 0.6 * (1 + nightness * 0.5);
    const shadowCx = obj.x + ndx * shadowLen * 0.5;
    const shadowCz = obj.z + ndz * shadowLen * 0.5;

    const intensity = nightness * clamp(1 - dist / 8, 0, 1) * 0.5;
    if (intensity < 0.02) continue;

    shadows.push({
      cx: shadowCx,
      cz: shadowCz,
      rx: Math.max(obj.radius * 0.5, shadowLen * 0.3),
      rz: obj.radius * 0.4,
      angle: Math.atan2(ndz, ndx),
      intensity,
      gy: obj.gy,
    });
  }
  return shadows;
}
