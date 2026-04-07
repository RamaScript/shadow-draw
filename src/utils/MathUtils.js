/**
 * MathUtils.js — AirDraw
 * ─────────────────────────────────────────────────────────────────────
 * Pure math utilities for interpolation, distance calculations, and
 * geometric helpers used throughout the drawing and gesture modules.
 * ─────────────────────────────────────────────────────────────────────
 */

/**
 * Linear interpolation between two values.
 * @param {number} a - Start value
 * @param {number} b - End value
 * @param {number} t - Factor [0, 1]
 * @returns {number}
 */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Linear interpolation between two 2D points.
 * @param {{x:number,y:number}} p1
 * @param {{x:number,y:number}} p2
 * @param {number} t - Factor [0, 1]
 * @returns {{x:number, y:number}}
 */
export function lerpPoint(p1, p2, t) {
  return { x: lerp(p1.x, p2.x, t), y: lerp(p1.y, p2.y, t) };
}

/**
 * Euclidean distance between two 2D points.
 * @param {{x:number,y:number}} p1
 * @param {{x:number,y:number}} p2
 * @returns {number}
 */
export function distance(p1, p2) {
  const dx = p1.x - p2.x;
  const dy = p1.y - p2.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Euclidean distance between two MediaPipe landmarks.
 * @param {{x:number,y:number,z:number}} a
 * @param {{x:number,y:number,z:number}} b
 * @returns {number}
 */
export function landmarkDistance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Clamp a value between min and max.
 */
export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Map a value from one range to another.
 */
export function mapRange(value, inMin, inMax, outMin, outMax) {
  return outMin + ((value - inMin) / (inMax - inMin)) * (outMax - outMin);
}

/**
 * Compute a midpoint between two points.
 */
export function midPoint(p1, p2) {
  return { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
}

/**
 * Compute the angle (radians) of a vector from p1 to p2.
 */
export function angle(p1, p2) {
  return Math.atan2(p2.y - p1.y, p2.x - p1.x);
}

/**
 * Normalize a 2D vector.
 */
export function normalize(v) {
  const len = Math.sqrt(v.x * v.x + v.y * v.y);
  if (len === 0) return { x: 0, y: 0 };
  return { x: v.x / len, y: v.y / len };
}

/**
 * Compute velocity magnitude between two points given elapsed time.
 * @param {{x:number,y:number}} prev
 * @param {{x:number,y:number}} curr
 * @param {number} dt - Delta time in ms
 * @returns {number} pixels per millisecond
 */
export function velocity(prev, curr, dt) {
  if (dt === 0) return 0;
  return distance(prev, curr) / dt;
}

/**
 * Format milliseconds as M:SS string.
 * @param {number} ms
 * @returns {string}
 */
export function formatTime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
