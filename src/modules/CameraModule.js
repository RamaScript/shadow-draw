/**
 * CameraModule.js — ShadowDraw
 * ─────────────────────────────────────────────────────────────────────
 * Manages webcam access via WebRTC getUserMedia.
 * Responsible for: stream acquisition, video element binding,
 * resolution targeting, error classification, and teardown.
 * ─────────────────────────────────────────────────────────────────────
 */

export class CameraModule {
  /**
   * @param {HTMLVideoElement} videoEl - The video element to stream into
   * @param {object} [opts]
   * @param {number} [opts.width=1280]  - Ideal capture width
   * @param {number} [opts.height=720]  - Ideal capture height
   * @param {number} [opts.frameRate=30] - Ideal frame rate
   */
  constructor(videoEl, opts = {}) {
    this._video = videoEl;
    this._stream = null;
    this._isRunning = false;

    this._constraints = {
      video: {
        width: { ideal: opts.width ?? 1280 },
        height: { ideal: opts.height ?? 720 },
        frameRate: { ideal: opts.frameRate ?? 30 },
        facingMode: "user", // front camera on mobile
      },
      audio: false,
    };

    /** Callbacks */
    this.onError = null;
    this.onReady = null;
  }

  /* ─────────────────────────────
     PUBLIC API
     ───────────────────────────── */

  /**
   * Request camera permission and start the video stream.
   * @returns {Promise<void>}
   */
  async start() {
    if (this._isRunning) return;

    try {
      this._stream = await navigator.mediaDevices.getUserMedia(
        this._constraints,
      );

      this._video.srcObject = this._stream;

      await new Promise((resolve, reject) => {
        this._video.onloadedmetadata = resolve;
        this._video.onerror = reject;
      });

      await this._video.play();

      this._isRunning = true;
      this.onReady?.();
    } catch (err) {
      const msg = this._classifyError(err);
      this.onError?.(msg, err);
    }
  }

  /**
   * Stop the camera stream and release hardware resources.
   */
  stop() {
    if (!this._isRunning) return;
    this._stream?.getTracks().forEach((track) => track.stop());
    this._video.srcObject = null;
    this._stream = null;
    this._isRunning = false;
  }

  get videoElement() {
    return this._video;
  }
  get isRunning() {
    return this._isRunning;
  }

  /**
   * Returns actual video dimensions once stream is active.
   * @returns {{width:number, height:number}}
   */
  get dimensions() {
    return {
      width: this._video.videoWidth,
      height: this._video.videoHeight,
    };
  }

  /* ─────────────────────────────
     PRIVATE
     ───────────────────────────── */

  /**
   * Classify a getUserMedia error into a human-readable message.
   * @param {Error} err
   * @returns {string}
   */
  _classifyError(err) {
    switch (err.name) {
      case "NotAllowedError":
      case "PermissionDeniedError":
        return "Camera access was denied. Please allow camera permission in your browser settings and reload.";
      case "NotFoundError":
      case "DevicesNotFoundError":
        return "No camera device found. Please connect a webcam and try again.";
      case "NotReadableError":
      case "TrackStartError":
        return "Camera is already in use by another application. Close it and reload.";
      case "OverconstrainedError":
        return "Camera does not meet the required constraints. Trying with relaxed settings.";
      case "NotSupportedError":
        return "Camera access is not supported in this browser. Try Chrome or Firefox.";
      default:
        return `Camera error: ${err.message}`;
    }
  }
}
