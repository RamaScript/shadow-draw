/**
 * HandTrackingModule.js — AirDraw
 * ─────────────────────────────────────────────────────────────────────
 * MediaPipe Hands integration layer.
 * Wraps the MediaPipe Hands solution with clean initialization,
 * per-frame detection, landmark extraction, and lifecycle management.
 *
 * MediaPipe Landmark Reference (21 points):
 *   0  = WRIST
 *   4  = THUMB_TIP
 *   8  = INDEX_FINGER_TIP  ← primary draw point
 *   12 = MIDDLE_FINGER_TIP
 *   16 = RING_FINGER_TIP
 *   20 = PINKY_TIP
 *   5,9,13,17 = MCP joints (knuckles)
 * ─────────────────────────────────────────────────────────────────────
 */

export class HandTrackingModule {
  /**
   * @param {object} [opts]
   * @param {number} [opts.maxHands=1]             - Max hands to detect
   * @param {number} [opts.minDetectionConf=0.75]  - Minimum detection confidence
   * @param {number} [opts.minTrackingConf=0.6]    - Minimum tracking confidence
   * @param {string} [opts.modelComplexity=1]       - 0 (lite) or 1 (full)
   */
  constructor(opts = {}) {
    this._opts = {
      maxHands:         opts.maxHands        ?? 1,
      minDetectionConf: opts.minDetectionConf ?? 0.75,
      minTrackingConf:  opts.minTrackingConf  ?? 0.60,
      modelComplexity:  opts.modelComplexity  ?? 1,
    };

    this._hands = null;      // MediaPipe Hands instance
    this._camera = null;     // MediaPipe Camera wrapper
    this._isReady = false;
    this._lastResult = null; // Most recent detection result

    /** Callbacks — set externally */
    this.onResults = null;   // (result) => void
    this.onReady   = null;   // () => void
    this.onError   = null;   // (err) => void
  }

  /* ─────────────────────────────
     PUBLIC API
     ───────────────────────────── */

  /**
   * Initialize MediaPipe Hands and bind to the video stream.
   * @param {HTMLVideoElement} videoEl
   * @returns {Promise<void>}
   */
  async init(videoEl) {
    try {
      // Guard: MediaPipe must be loaded via CDN
      if (typeof Hands === 'undefined') {
        throw new Error('MediaPipe Hands not loaded. Check CDN script tags.');
      }

      this._hands = new Hands({
        locateFile: (file) =>
          `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
      });

      this._hands.setOptions({
        maxNumHands:              this._opts.maxHands,
        minDetectionConfidence:   this._opts.minDetectionConf,
        minTrackingConfidence:    this._opts.minTrackingConf,
        modelComplexity:          this._opts.modelComplexity,
        selfieMode:               true, // mirror landmark coordinates
      });

      // Wire up results callback
      this._hands.onResults((result) => {
        this._lastResult = result;
        this.onResults?.(result);
      });

      // MediaPipe Camera drives the frame loop
      this._camera = new Camera(videoEl, {
        onFrame: async () => {
          if (!this._isReady) return;
          await this._hands.send({ image: videoEl });
        },
        width:  1280,
        height: 720,
      });

      // Initialize the model (downloads model files)
      await this._hands.initialize();
      this._isReady = true;
      this.onReady?.();

      // Start frame capture loop
      await this._camera.start();

    } catch (err) {
      this.onError?.(err);
      console.error('[HandTracking] Init failed:', err);
    }
  }

  /** Stop tracking and release resources. */
  async stop() {
    this._camera?.stop();
    await this._hands?.close();
    this._isReady = false;
  }

  /* ─────────────────────────────
     LANDMARK HELPERS
     ───────────────────────────── */

  /** Landmark index constants for readability */
  static LM = {
    WRIST:              0,
    THUMB_CMC:          1,
    THUMB_MCP:          2,
    THUMB_IP:           3,
    THUMB_TIP:          4,
    INDEX_MCP:          5,
    INDEX_PIP:          6,
    INDEX_DIP:          7,
    INDEX_TIP:          8,
    MIDDLE_MCP:         9,
    MIDDLE_PIP:        10,
    MIDDLE_DIP:        11,
    MIDDLE_TIP:        12,
    RING_MCP:          13,
    RING_PIP:          14,
    RING_DIP:          15,
    RING_TIP:          16,
    PINKY_MCP:         17,
    PINKY_PIP:         18,
    PINKY_DIP:         19,
    PINKY_TIP:         20,
  };

  /**
   * Extract normalized landmark coordinates from a MediaPipe result.
   * Returns null if no hand is detected.
   *
   * @param {object} result - MediaPipe Hands result
   * @returns {Array<{x:number,y:number,z:number}>|null}
   */
  static extractLandmarks(result) {
    if (!result?.multiHandLandmarks?.length) return null;
    return result.multiHandLandmarks[0];
  }

  /**
   * Convert normalized landmark to canvas pixel coordinates.
   * Note: MediaPipe in selfie mode already mirrors X.
   *
   * @param {{x:number,y:number}} lm - Normalized [0,1] landmark
   * @param {number} canvasW
   * @param {number} canvasH
   * @returns {{x:number, y:number}}
   */
  static toCanvasCoords(lm, canvasW, canvasH) {
    return {
      x: lm.x * canvasW,
      y: lm.y * canvasH,
    };
  }

  /**
   * Get detection confidence from result (0–1), or null if no hand.
   * @param {object} result
   * @returns {number|null}
   */
  static getConfidence(result) {
    if (!result?.multiHandedness?.length) return null;
    return result.multiHandedness[0]?.score ?? null;
  }

  get isReady()     { return this._isReady; }
  get lastResult()  { return this._lastResult; }
}
