/**
 * UILayer.js — ShadowDraw
 * ─────────────────────────────────────────────────────────────────────
 * Manages all DOM interactions:
 *   - Toolbar controls (color, brush, smoothing, dynamic width)
 *   - Action buttons (undo, redo, clear, save)
 *   - Gesture badge, FPS counter, confidence display
 *   - Metrics panel live updates
 *   - Draw cursor overlay
 *   - Loading & error states
 *   - Toast notifications
 *   - Keyboard shortcuts
 * ─────────────────────────────────────────────────────────────────────
 */

import { formatTime } from "../utils/MathUtils.js";
import { Gesture } from "./GestureRecognitionModule.js";

export class UILayer {
  constructor() {
    // ── Header ──
    this.$gestureBadge = document.getElementById("gesture-badge");
    this.$gestureLabel = document.getElementById("gesture-label");
    this.$fpsValue = document.getElementById("fps-value");
    this.$confValue = document.getElementById("confidence-value");

    // ── Toolbar ──
    this.$swatches = document.querySelectorAll(".swatch");
    this.$customColor = document.getElementById("custom-color");
    this.$brushSize = document.getElementById("brush-size");
    this.$brushLabel = document.getElementById("brush-size-label");
    this.$smoothBtns = document.querySelectorAll(".tag-btn[data-smooth]");
    this.$dynamicToggle = document.getElementById("toggle-dynamic");
    this.$undoBtn = document.getElementById("undo-btn");
    this.$redoBtn = document.getElementById("redo-btn");
    this.$clearBtn = document.getElementById("clear-btn");
    this.$saveBtn = document.getElementById("save-btn");

    // ── Canvas & Cursor ──
    this.$cursor = document.getElementById("draw-cursor");

    // ── Metrics ──
    this.$mStrokes = document.getElementById("m-strokes");
    this.$mPoints = document.getElementById("m-points");
    this.$mGestures = document.getElementById("m-gestures");
    this.$mConfidence = document.getElementById("m-confidence");
    this.$mSmooth = document.getElementById("m-smooth");
    this.$mTime = document.getElementById("m-time");

    // ── Overlays ──
    this.$loadingOverlay = document.getElementById("loading-overlay");
    this.$loadingText = document.getElementById("loading-text");
    this.$loadingBar = document.getElementById("loading-bar");
    this.$cameraError = document.getElementById("camera-error");
    this.$errorMessage = document.getElementById("error-message");

    // ── Active state ──
    this._activeColor = "#00E5FF";
    this._activeSmooth = "movingAvg";
    this._dynamicOn = true;

    /** Callbacks wired by main.js */
    this.onColorChange = null; // (color) => void
    this.onBrushChange = null; // (size) => void
    this.onSmoothChange = null; // (type) => void
    this.onDynamicToggle = null; // (bool) => void
    this.onUndo = null;
    this.onRedo = null;
    this.onClear = null;
    this.onSave = null;
  }

  /* ─────────────────────────────
     INIT
     ───────────────────────────── */

  /** Bind all event listeners. Call once after construction. */
  init() {
    this._bindColorSwatches();
    this._bindBrushSlider();
    this._bindSmoothToggles();
    this._bindDynamicToggle();
    this._bindActionButtons();
  }

  /* ─────────────────────────────
     LOADING STATE
     ───────────────────────────── */

  setLoadingText(text) {
    if (this.$loadingText) this.$loadingText.textContent = text;
  }

  setLoadingProgress(pct) {
    if (this.$loadingBar) this.$loadingBar.style.width = `${pct}%`;
  }

  hideLoading() {
    if (this.$loadingOverlay) {
      this.$loadingOverlay.style.opacity = "0";
      this.$loadingOverlay.style.transition = "opacity 0.5s";
      setTimeout(() => this.$loadingOverlay.classList.add("hidden"), 500);
    }
  }

  /* ─────────────────────────────
     ERROR STATE
     ───────────────────────────── */

  showCameraError(message, onRetry) {
    if (this.$cameraError) this.$cameraError.classList.remove("hidden");
    if (this.$errorMessage) this.$errorMessage.textContent = message;
    const retryBtn = document.getElementById("retry-btn");
    if (retryBtn) {
      if (onRetry) {
        retryBtn.onclick = () => {
          this.hideCameraError();
          onRetry();
        };
        retryBtn.textContent = "Retry";
        retryBtn.classList.remove("hidden");
      } else {
        retryBtn.onclick = () => window.location.reload();
        retryBtn.textContent = "Reload Page";
        retryBtn.classList.remove("hidden");
      }
    }
  }

  hideCameraError() {
    if (this.$cameraError) this.$cameraError.classList.add("hidden");
  }

  /* ─────────────────────────────
     GESTURE DISPLAY
     ───────────────────────────── */

  /**
   * Update the gesture badge in the header.
   * @param {string} gesture - Gesture constant
   */
  updateGesture(gesture) {
    if (!this.$gestureBadge || !this.$gestureLabel) return;

    const labels = {
      [Gesture.PINCH]: "✦ Drawing",
      [Gesture.OPEN]: "◯ Idle",
      [Gesture.FIST]: "✕ Clear",
      [Gesture.UNKNOWN]: "◌ No Hand",
    };

    const classes = {
      [Gesture.PINCH]: "drawing",
      [Gesture.OPEN]: "idle",
      [Gesture.FIST]: "clear",
      [Gesture.UNKNOWN]: "",
    };

    // Remove all modifier classes
    this.$gestureBadge.classList.remove("drawing", "idle", "clear");
    const cls = classes[gesture];
    if (cls) this.$gestureBadge.classList.add(cls);

    this.$gestureLabel.textContent = labels[gesture] ?? "◌ Unknown";
  }

  /* ─────────────────────────────
     STATS
     ───────────────────────────── */

  updateFPS(fps) {
    if (this.$fpsValue) this.$fpsValue.textContent = fps;
  }

  updateConfidence(score) {
    if (this.$confValue) {
      this.$confValue.textContent =
        score !== null ? `${(score * 100).toFixed(0)}%` : "--";
    }
  }

  /* ─────────────────────────────
     CURSOR
     ───────────────────────────── */

  /**
   * Move the draw cursor to a canvas position.
   * @param {{x:number, y:number}} point
   * @param {boolean} isDrawing
   */
  updateCursor(point, isDrawing) {
    if (!this.$cursor) return;
    this.$cursor.classList.remove("hidden");
    this.$cursor.style.left = `${point.x}px`;
    this.$cursor.style.top = `${point.y}px`;

    if (isDrawing) {
      this.$cursor.classList.add("drawing");
    } else {
      this.$cursor.classList.remove("drawing");
    }
  }

  hideCursor() {
    this.$cursor?.classList.add("hidden");
  }

  /* ─────────────────────────────
     METRICS PANEL
     ───────────────────────────── */

  /**
   * Update all metrics panel values.
   * @param {object} metrics
   */
  updateMetrics(metrics) {
    if (this.$mStrokes) this.$mStrokes.textContent = metrics.strokes ?? "--";
    if (this.$mPoints) this.$mPoints.textContent = metrics.points ?? "--";
    if (this.$mGestures) this.$mGestures.textContent = metrics.gestures ?? "--";
    if (this.$mConfidence)
      this.$mConfidence.textContent = metrics.confidence ?? "--";
    if (this.$mSmooth) this.$mSmooth.textContent = metrics.smooth ?? "--";
    if (this.$mTime) this.$mTime.textContent = metrics.sessionTime ?? "0:00";
  }

  /* ─────────────────────────────
     UNDO / REDO BUTTON STATE
     ───────────────────────────── */

  setUndoEnabled(v) {
    this.$undoBtn?.toggleAttribute("disabled", !v);
  }
  setRedoEnabled(v) {
    this.$redoBtn?.toggleAttribute("disabled", !v);
  }

  /* ─────────────────────────────
     TOAST NOTIFICATIONS
     ───────────────────────────── */

  /**
   * Show a short toast message.
   * @param {string} message
   * @param {'info'|'success'|'error'} [type='info']
   * @param {number} [duration=2000]
   */
  toast(message, type = "info", duration = 2000) {
    // Remove any existing toast
    document.querySelectorAll(".toast").forEach((t) => t.remove());

    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.textContent = message;
    document.body.appendChild(el);

    requestAnimationFrame(() => {
      el.classList.add("show");
      setTimeout(() => {
        el.classList.remove("show");
        setTimeout(() => el.remove(), 400);
      }, duration);
    });
  }

  /* ─────────────────────────────
     PRIVATE: Event Binding
     ───────────────────────────── */

  _bindColorSwatches() {
    this.$swatches.forEach((swatch) => {
      swatch.addEventListener("click", () => {
        this.$swatches.forEach((s) => s.classList.remove("active"));
        swatch.classList.add("active");
        this._activeColor = swatch.dataset.color;
        this.onColorChange?.(this._activeColor);
      });
    });

    this.$customColor?.addEventListener("input", (e) => {
      this.$swatches.forEach((s) => s.classList.remove("active"));
      this._activeColor = e.target.value;
      this.onColorChange?.(this._activeColor);
    });
  }

  _bindBrushSlider() {
    this.$brushSize?.addEventListener("input", (e) => {
      const val = parseInt(e.target.value, 10);
      if (this.$brushLabel) this.$brushLabel.textContent = `${val}px`;
      this.onBrushChange?.(val);
    });
  }

  _bindSmoothToggles() {
    this.$smoothBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        this.$smoothBtns.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        this._activeSmooth = btn.dataset.smooth;
        this.onSmoothChange?.(this._activeSmooth);
      });
    });
  }

  _bindDynamicToggle() {
    this.$dynamicToggle?.addEventListener("click", () => {
      this._dynamicOn = !this._dynamicOn;
      this.$dynamicToggle.classList.toggle("active", this._dynamicOn);
      this.onDynamicToggle?.(this._dynamicOn);
    });
  }

  _bindActionButtons() {
    this.$undoBtn?.addEventListener("click", () => this.onUndo?.());
    this.$redoBtn?.addEventListener("click", () => this.onRedo?.());
    this.$clearBtn?.addEventListener("click", () => this.onClear?.());
    this.$saveBtn?.addEventListener("click", () => this.onSave?.());
  }

  }
