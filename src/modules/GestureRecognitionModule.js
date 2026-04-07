/**
 * GestureRecognitionModule.js — ShadowDraw
 * ─────────────────────────────────────────────────────────────────────
 * Classifies hand landmarks into discrete gestures:
 *   - PINCH:    thumb + index finger close together → draw mode
 *   - OPEN:     all fingers extended → stop drawing
 *   - FIST:     all fingers curled → clear canvas trigger
 *   - UNKNOWN:  transitional / indeterminate state
 *
 * Architecture:
 *   Uses geometric heuristics (distance ratios, finger extension tests).
 *   Debounce prevents jitter between gesture transitions.
 *   All thresholds are tunable at runtime for research comparison.
 * ─────────────────────────────────────────────────────────────────────
 */

import { landmarkDistance } from "../utils/MathUtils.js";
import { HandTrackingModule } from "./HandTrackingModule.js";

const LM = HandTrackingModule.LM;

/* ── Gesture Constants ── */
export const Gesture = {
  PINCH: "pinch",
  OPEN: "open",
  FIST: "fist",
  UNKNOWN: "unknown",
};

export class GestureRecognitionModule {
  /**
   * @param {object} [opts]
   * @param {number} [opts.pinchThreshold=0.07]    - Max normalized dist for pinch (thumb ↔ index)
   * @param {number} [opts.fistThreshold=0.10]     - Max normalized dist for all fingers curled
   * @param {number} [opts.openThreshold=0.25]     - Min normalized spread for open hand
   * @param {number} [opts.debounceMs=80]          - Min ms before accepting a gesture change
   * @param {number} [opts.fistDebounceMs=500]     - Extra debounce for fist (avoid accidental clears)
   */
  constructor(opts = {}) {
    // Tunable thresholds
    this._pinchThreshold = opts.pinchThreshold ?? 0.07;
    this._fistThreshold = opts.fistThreshold ?? 0.1;
    this._openThreshold = opts.openThreshold ?? 0.25;
    this._debounceMs = opts.debounceMs ?? 80;
    this._fistDebounceMs = opts.fistDebounceMs ?? 500;

    this._currentGesture = Gesture.UNKNOWN;
    this._lastChangeTime = 0;
    this._fistTriggerTime = 0;

    /** Callback when gesture changes: (newGesture, prevGesture) => void */
    this.onGestureChange = null;
  }

  /* ─────────────────────────────
     PUBLIC API
     ───────────────────────────── */

  /**
   * Process a new set of landmarks and return the current gesture.
   * Internally debounces transitions to prevent flickering.
   *
   * @param {Array<{x:number,y:number,z:number}>} landmarks - 21 MediaPipe landmarks (normalized)
   * @returns {string} Gesture constant
   */
  classify(landmarks) {
    if (!landmarks || landmarks.length < 21) {
      return this._transition(Gesture.UNKNOWN);
    }

    const raw = this._detectRaw(landmarks);
    return this._transition(raw, landmarks);
  }

  /** Current active gesture. */
  get current() {
    return this._currentGesture;
  }

  /** Update pinch threshold at runtime (research tuning). */
  setPinchThreshold(v) {
    this._pinchThreshold = v;
  }
  setFistThreshold(v) {
    this._fistThreshold = v;
  }
  setOpenThreshold(v) {
    this._openThreshold = v;
  }

  /* ─────────────────────────────
     DETECTION LOGIC
     ───────────────────────────── */

  /**
   * Core detection — returns raw gesture without debounce.
   * Priority: FIST > PINCH > OPEN > UNKNOWN
   *
   * @param {Array} lm - 21 normalized landmarks
   * @returns {string}
   */
  _detectRaw(lm) {
    // ── Fist: all four fingers curled ──────────────────────────────
    // Strategy: each fingertip must be BELOW its MCP (base) in Y axis
    // and the overall hand "compactness" is low.
    if (this._isFist(lm)) return Gesture.FIST;

    // ── Pinch: thumb tip close to index tip ───────────────────────
    const thumbIndexDist = landmarkDistance(lm[LM.THUMB_TIP], lm[LM.INDEX_TIP]);
    if (thumbIndexDist < this._pinchThreshold) return Gesture.PINCH;

    // ── Open: all fingers extended ─────────────────────────────────
    if (this._isOpenHand(lm)) return Gesture.OPEN;

    return Gesture.UNKNOWN;
  }

  /**
   * Fist detection: checks that each fingertip is below its MCP joint.
   * Uses a relative Y-position comparison (Y increases downward in image space).
   *
   * @param {Array} lm
   * @returns {boolean}
   */
  _isFist(lm) {
    // Finger pairs: [tip, pip] — tip should be "above" pip (lower Y value)
    // when finger is extended; when curled, tip Y > pip Y.
    const fingers = [
      [LM.INDEX_TIP, LM.INDEX_MCP],
      [LM.MIDDLE_TIP, LM.MIDDLE_MCP],
      [LM.RING_TIP, LM.RING_MCP],
      [LM.PINKY_TIP, LM.PINKY_MCP],
    ];

    let curledCount = 0;
    for (const [tipIdx, mcpIdx] of fingers) {
      // In image coordinates: tip.y > mcp.y means finger is curled
      if (lm[tipIdx].y > lm[mcpIdx].y) {
        curledCount++;
      }
    }

    // Also check thumb is curled inward (thumb tip close to index MCP)
    const thumbCurled =
      landmarkDistance(lm[LM.THUMB_TIP], lm[LM.INDEX_MCP]) <
      this._fistThreshold;

    return curledCount >= 3 && thumbCurled;
  }

  /**
   * Open hand detection: checks that ALL four fingers are extended.
   * Finger is extended if its tip is notably higher than its MCP.
   *
   * @param {Array} lm
   * @returns {boolean}
   */
  _isOpenHand(lm) {
    const fingers = [
      [LM.INDEX_TIP, LM.INDEX_MCP],
      [LM.MIDDLE_TIP, LM.MIDDLE_MCP],
      [LM.RING_TIP, LM.RING_MCP],
      [LM.PINKY_TIP, LM.PINKY_MCP],
    ];

    // Compute hand scale: wrist to middle MCP distance (normalizes thresholds)
    const handScale = landmarkDistance(lm[LM.WRIST], lm[LM.MIDDLE_MCP]);
    const extThreshold = handScale * 0.5;

    let extendedCount = 0;
    for (const [tipIdx, mcpIdx] of fingers) {
      const ext = lm[mcpIdx].y - lm[tipIdx].y; // positive if tip is above MCP
      if (ext > extThreshold * 0.3) extendedCount++;
    }

    return extendedCount >= 3;
  }

  /**
   * Apply debounce: only accept a gesture change after enough time has passed.
   * Fist gets extra debounce to prevent accidental canvas clears.
   *
   * @param {string} detected
   * @returns {string} confirmed gesture
   */
  _transition(detected) {
    if (detected === this._currentGesture) return this._currentGesture;

    const now = Date.now();
    const debounce =
      detected === Gesture.FIST ? this._fistDebounceMs : this._debounceMs;

    if (now - this._lastChangeTime < debounce) {
      return this._currentGesture; // hold current during debounce
    }

    const prev = this._currentGesture;
    this._currentGesture = detected;
    this._lastChangeTime = now;

    this.onGestureChange?.(detected, prev);
    return detected;
  }
}
