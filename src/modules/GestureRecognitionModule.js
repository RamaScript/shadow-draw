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
 *   Uses geometric heuristics with hysteresis thresholds.
 *   Hysteresis prevents flickering by requiring a larger change to
 *   exit a gesture state than to enter it.
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
   * @param {number} [opts.pinchThreshold=0.07]     - Max normalized dist for pinch entry (thumb ↔ index)
   * @param {number} [opts.pinchReleaseThreshold=0.10] - Threshold to release pinch (higher = hysteresis)
   * @param {number} [opts.fistThreshold=0.10]      - Max normalized dist for fist detection
   * @param {number} [opts.openThreshold=0.25]      - Min normalized spread for open hand
   * @param {number} [opts.debounceMs=80]           - Min ms before accepting a gesture change
   * @param {number} [opts.fistDebounceMs=500]      - Extra debounce for fist (avoid accidental clears)
   * @param {number} [opts.consecutiveFrames=2]     - Frames needed to confirm a gesture change
   */
  constructor(opts = {}) {
    // Tunable thresholds
    this._pinchThreshold = opts.pinchThreshold ?? 0.07;
    this._pinchReleaseThreshold = opts.pinchReleaseThreshold ?? 0.10;
    this._fistThreshold = opts.fistThreshold ?? 0.1;
    this._openThreshold = opts.openThreshold ?? 0.25;
    this._debounceMs = opts.debounceMs ?? 80;
    this._fistDebounceMs = opts.fistDebounceMs ?? 500;
    this._consecutiveFrames = opts.consecutiveFrames ?? 2;

    this._currentGesture = Gesture.UNKNOWN;
    this._lastChangeTime = 0;
    this._consecutiveCount = 0;

    /** Callback when gesture changes: (newGesture, prevGesture) => void */
    this.onGestureChange = null;
  }

  /* ─────────────────────────────
     PUBLIC API
     ───────────────────────────── */

  /**
   * Process a new set of landmarks and return the current gesture.
   * Internally uses hysteresis and debouncing to prevent flickering.
   *
   * @param {Array<{x:number,y:number,z:number}>} landmarks - 21 MediaPipe landmarks (normalized)
   * @returns {string} Gesture constant
   */
  classify(landmarks) {
    if (!landmarks || landmarks.length < 21) {
      return this._transition(Gesture.UNKNOWN);
    }

    const raw = this._detectRawWithHysteresis(landmarks);
    return this._transition(raw);
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
   * Core detection with hysteresis.
   * Uses different thresholds for entering vs. maintaining a gesture state,
   * which prevents flickering when the user's hand is near a boundary.
   */
  _detectRawWithHysteresis(lm) {
    if (this._isFist(lm)) return Gesture.FIST;

    const thumbIndexDist = landmarkDistance(lm[LM.THUMB_TIP], lm[LM.INDEX_TIP]);

    if (this._currentGesture === Gesture.PINCH) {
      if (thumbIndexDist < this._pinchReleaseThreshold) return Gesture.PINCH;
    } else {
      if (thumbIndexDist < this._pinchThreshold) return Gesture.PINCH;
    }

    if (this._isOpenHand(lm)) return Gesture.OPEN;

    return Gesture.UNKNOWN;
  }

  /**
   * Fist detection: checks that each fingertip is below its MCP joint.
   *
   * @param {Array} lm
   * @returns {boolean}
   */
  _isFist(lm) {
    const fingers = [
      [LM.INDEX_TIP, LM.INDEX_MCP],
      [LM.MIDDLE_TIP, LM.MIDDLE_MCP],
      [LM.RING_TIP, LM.RING_MCP],
      [LM.PINKY_TIP, LM.PINKY_MCP],
    ];

    let curledCount = 0;
    for (const [tipIdx, mcpIdx] of fingers) {
      if (lm[tipIdx].y > lm[mcpIdx].y) {
        curledCount++;
      }
    }

    const thumbCurled =
      landmarkDistance(lm[LM.THUMB_TIP], lm[LM.INDEX_MCP]) <
      this._fistThreshold;

    return curledCount >= 3 && thumbCurled;
  }

  /**
   * Open hand detection: checks that fingers are extended.
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

    const handScale = landmarkDistance(lm[LM.WRIST], lm[LM.MIDDLE_MCP]);
    const extThreshold = handScale * 0.5;

    let extendedCount = 0;
    for (const [tipIdx, mcpIdx] of fingers) {
      const ext = lm[mcpIdx].y - lm[tipIdx].y;
      if (ext > extThreshold * 0.3) extendedCount++;
    }

    return extendedCount >= 3;
  }

  /**
   * Apply hysteresis, consecutive frame confirmation, and debounce.
   * Only accepts a gesture change after enough consecutive frames
   * confirm the new gesture, and enough time has passed since the last change.
   *
   * @param {string} detected
   * @returns {string} confirmed gesture
   */
  _transition(detected) {
    if (detected === this._currentGesture) {
      this._consecutiveCount = 0;
      return this._currentGesture;
    }

    this._consecutiveCount++;

    if (this._consecutiveCount < this._consecutiveFrames) {
      return this._currentGesture;
    }

    const now = Date.now();
    const debounce =
      detected === Gesture.FIST ? this._fistDebounceMs : this._debounceMs;

    if (now - this._lastChangeTime < debounce) {
      this._consecutiveCount = 0;
      return this._currentGesture;
    }

    const prev = this._currentGesture;
    this._currentGesture = detected;
    this._lastChangeTime = now;
    this._consecutiveCount = 0;

    this.onGestureChange?.(detected, prev);
    return detected;
  }
}