/**
 * X32/M32/WING faders are transmitted as a float in the 0.0–1.0 range,
 * not as dB directly. The console's taper is piecewise, roughly:
 *   1.00        = +10 dB (top of scale)
 *   0.75        =   0 dB (unity)
 *   0.50        = -30 dB
 *   0.00        = -oo  (off)
 *
 * This is an approximation of Behringer's published taper and is
 * accurate to roughly +/-0.5dB in the -30..+10 range, which is fine
 * for mix-level automation but NOT for scene-file-exact recall.
 * For exact recall, always prefer loading a verified scene/snapshot
 * file over reconstructing values from dB math.
 */
export function dbToFloat(db: number): number {
  if (db >= 10) return 1.0;
  if (db >= 0) return 0.75 + (db / 10) * 0.25;
  if (db >= -30) return 0.5 + ((db + 30) / 30) * 0.25;
  if (db >= -90) return Math.max(0, ((db + 90) / 60) * 0.5);
  return 0.0;
}

export function floatToDb(f: number): number {
  if (f >= 1.0) return 10;
  if (f >= 0.75) return ((f - 0.75) / 0.25) * 10;
  if (f >= 0.5) return ((f - 0.5) / 0.25) * 30 - 30;
  if (f > 0) return (f / 0.5) * 60 - 90;
  return -90; // treated as -infinity
}
