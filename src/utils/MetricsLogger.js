/**
 * MetricsLogger.js — ShadowDraw
 * ─────────────────────────────────────────────────────────────────────
 * Research-grade session metrics and gesture accuracy logging.
 * Tracks real-time stats and provides a structured export for analysis.
 * ─────────────────────────────────────────────────────────────────────
 */

export class MetricsLogger {
  constructor() {
    this._sessionStart = Date.now();
    this._frameCount = 0;
    this._lastFpsTime = Date.now();
    this._currentFps = 0;

    // Counters
    this._strokeCount = 0;
    this._totalPoints = 0;
    this._gestureChanges = 0;
    this._lastGesture = null;

    // Confidence tracking
    this._confidenceSum = 0;
    this._confidenceSamples = 0;

    // Per-gesture counts
    this._gestureCounts = {
      pinch: 0,
      open: 0,
      fist: 0,
      unknown: 0,
    };

    // FPS history for smoothing
    this._fpsBuffer = [];
    this._fpsBufferSize = 30;
  }

  /* ── Frame & FPS ── */

  /** Called every render frame. Updates FPS counter. */
  tickFrame() {
    this._frameCount++;
    const now = Date.now();
    const elapsed = now - this._lastFpsTime;

    if (elapsed >= 500) {
      const rawFps = (this._frameCount * 1000) / elapsed;
      this._fpsBuffer.push(rawFps);
      if (this._fpsBuffer.length > this._fpsBufferSize) this._fpsBuffer.shift();
      this._currentFps =
        this._fpsBuffer.reduce((a, b) => a + b, 0) / this._fpsBuffer.length;
      this._frameCount = 0;
      this._lastFpsTime = now;
    }
  }

  get fps() {
    return Math.round(this._currentFps);
  }

  /* ── Strokes & Points ── */

  incrementStrokes() {
    this._strokeCount++;
  }
  incrementPoints(n = 1) {
    this._totalPoints += n;
  }

  get strokeCount() {
    return this._strokeCount;
  }
  get totalPoints() {
    return this._totalPoints;
  }

  /* ── Gesture Tracking ── */

  /**
   * Log a detected gesture. Tracks switches and per-gesture counts.
   * @param {string} gesture
   */
  logGesture(gesture) {
    if (gesture !== this._lastGesture) {
      this._gestureChanges++;
      this._lastGesture = gesture;
    }
    if (gesture in this._gestureCounts) {
      this._gestureCounts[gesture]++;
    }
  }

  get gestureChanges() {
    return this._gestureChanges;
  }
  get gestureCounts() {
    return { ...this._gestureCounts };
  }

  /* ── Confidence ── */

  logConfidence(score) {
    this._confidenceSum += score;
    this._confidenceSamples++;
  }

  get avgConfidence() {
    if (this._confidenceSamples === 0) return null;
    return (this._confidenceSum / this._confidenceSamples).toFixed(3);
  }

  /* ── Session Time ── */

  get sessionDurationMs() {
    return Date.now() - this._sessionStart;
  }

  /* ── Export ── */

  /**
   * Returns a structured snapshot of all metrics.
   * Useful for research logging / CSV export.
   * @returns {object}
   */
  snapshot() {
    return {
      timestamp: new Date().toISOString(),
      sessionDurationMs: this.sessionDurationMs,
      fps: this.fps,
      strokeCount: this._strokeCount,
      totalPoints: this._totalPoints,
      gestureChanges: this._gestureChanges,
      gestureCounts: this.gestureCounts,
      avgConfidence: this.avgConfidence,
    };
  }

  /**
   * Export current session as JSON string (for download or logging).
   * @returns {string}
   */
  exportJSON() {
    return JSON.stringify(this.snapshot(), null, 2);
  }

  /** Reset all counters (e.g., on canvas clear) */
  resetSession() {
    this._sessionStart = Date.now();
    this._strokeCount = 0;
    this._totalPoints = 0;
    this._gestureChanges = 0;
    this._lastGesture = null;
    this._confidenceSum = 0;
    this._confidenceSamples = 0;
    this._gestureCounts = { pinch: 0, open: 0, fist: 0, unknown: 0 };
  }
}
