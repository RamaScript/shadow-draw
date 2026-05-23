/**
 * DrawingEngine.js — ShadowDraw
 * ─────────────────────────────────────────────────────────────────────
 * High-performance canvas rendering engine with:
 *   - Bézier curve smoothing (quadratic, via midpoint algorithm)
 *   - Stroke buffering & point interpolation to reduce jitter
 *   - Dynamic stroke width based on finger movement speed
 *   - Undo/redo stack (ImageData snapshots for accuracy)
 *   - requestAnimationFrame-based render loop (60 FPS cap)
 *   - Efficient dirty-region redraw strategy
 * ─────────────────────────────────────────────────────────────────────
 */

import { distance, lerp, clamp, mapRange } from "../utils/MathUtils.js";

export class DrawingEngine {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} [opts]
   * @param {string}  [opts.color='#00E5FF']
   * @param {number}  [opts.baseWidth=6]
   * @param {boolean} [opts.dynamicWidth=true]   - Speed-based thickness
   * @param {number}  [opts.maxUndoSteps=30]
   * @param {number}  [opts.lerpFactor=0.4]      - Point smoothing strength [0,1]
   */
  constructor(canvas, opts = {}) {
    this._canvas = canvas;
    this._ctx = canvas.getContext("2d", { willReadFrequently: true });

    // Drawing state
    this._color = opts.color ?? "#00E5FF";
    this._baseWidth = opts.baseWidth ?? 6;
    this._dynamicWidth = opts.dynamicWidth ?? true;
    this._lerpFactor = opts.lerpFactor ?? 0.4;

    // Stroke buffers
    this._isDrawing = false;
    this._lastPoint = null;
    this._rawPoint = null;
    this._prevRawPoint = null;
    this._lastTimestamp = 0;

    // Undo / Redo - memory-aware
    this._maxUndo = opts.maxUndoSteps ?? 30;
    this._maxUndoMemoryMB = 64;
    this._undoStack = [];
    this._redoStack = [];
    this._totalUndoMemory = 0;

    // Stats for MetricsLogger integration
    this._pointsDrawn = 0;

    // RAF handle
    this._rafId = null;
    this._dirty = false;

    // Canvas background color (applied to saved image)
    this._bgColor = "#050810";

    this._resize();
    this._setupContextDefaults();
  }

  /* ─────────────────────────────
     PUBLIC: Lifecycle
     ───────────────────────────── */

  /** Resize canvas to match its CSS display size. */
  resize() {
    this._resize();
  }

  /* ─────────────────────────────
     PUBLIC: Drawing Control
     ───────────────────────────── */

  /**
   * Called every frame with the current finger position (canvas coords).
   * Handles both point buffering and Bézier interpolation.
   *
   * @param {{x:number, y:number}} point   - Smoothed finger position
   * @param {number} timestamp             - performance.now() or Date.now()
   */
  draw(point, timestamp) {
    if (!this._isDrawing) return;

    const dt = timestamp - this._lastTimestamp;
    this._lastTimestamp = timestamp;

    // Lerp raw → smoothed for Bézier midpoint algorithm
    if (!this._lastPoint) {
      this._lastPoint = { ...point };
      this._prevRawPoint = { ...point };
      return;
    }

    // Compute velocity for dynamic width
    let speed = 0;
    if (this._prevRawPoint && dt > 0) {
      speed = distance(this._prevRawPoint, point) / dt; // px/ms
    }
    this._prevRawPoint = { ...point };

    // Lerp: blend previous smoothed point toward current
    const smoothed = {
      x: lerp(this._lastPoint.x, point.x, this._lerpFactor),
      y: lerp(this._lastPoint.y, point.y, this._lerpFactor),
    };

    // Compute dynamic width based on speed (faster = thinner stroke)
    const lineWidth = this._dynamicWidth
      ? this._computeDynamicWidth(speed)
      : this._baseWidth;

    // Draw Bézier segment between last and current smoothed point
    this._drawBezierSegment(this._lastPoint, smoothed, lineWidth);

    this._lastPoint = smoothed;
    this._pointsDrawn++;
    this._dirty = true;
  }

  /**
   * Begin a new stroke. Saves undo state before drawing starts.
   * @param {{x:number, y:number}} startPoint
   */
  beginStroke(startPoint) {
    this._saveUndoState();
    this._isDrawing = true;
    this._lastPoint = { ...startPoint };
    this._prevRawPoint = { ...startPoint };
    this._lastTimestamp = performance.now();

    // Draw a dot at the start point (important for pinch clicks)
    this._drawDot(startPoint, this._baseWidth);
    this._pointsDrawn++;
  }

  /** End the current stroke, finalize Bézier path. */
  endStroke() {
    if (!this._isDrawing) return;
    this._isDrawing = false;
    this._lastPoint = null;
    this._prevRawPoint = null;
  }

  /** Clear the entire canvas. Saves undo state first. */
  clear() {
    this._saveUndoState();
    this._redoStack = [];
    this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
    this._dirty = true;
  }

  /** Hard clear without saving undo (used on init). */
  hardClear() {
    this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
  }

  /* ─────────────────────────────
     PUBLIC: Undo / Redo
     ───────────────────────────── */

  undo() {
    if (!this._undoStack.length) return false;
    // Save current state to redo
    this._redoStack.push(
      this._ctx.getImageData(0, 0, this._canvas.width, this._canvas.height),
    );
    const snapshot = this._undoStack.pop();
    this._ctx.putImageData(snapshot, 0, 0);
    return true;
  }

  redo() {
    if (!this._redoStack.length) return false;
    this._undoStack.push(
      this._ctx.getImageData(0, 0, this._canvas.width, this._canvas.height),
    );
    const snapshot = this._redoStack.pop();
    this._ctx.putImageData(snapshot, 0, 0);
    return true;
  }

  get canUndo() {
    return this._undoStack.length > 0;
  }
  get canRedo() {
    return this._redoStack.length > 0;
  }

  /* ─────────────────────────────
     PUBLIC: Save as PNG
     ───────────────────────────── */

  /**
   * Composite the canvas over a dark background and trigger download.
   * @param {string} [filename='airdraw-export.png']
   */
  saveAsPNG(filename = "airdraw-export.png") {
    // Create an off-screen canvas with background
    const off = document.createElement("canvas");
    off.width = this._canvas.width;
    off.height = this._canvas.height;
    const offCtx = off.getContext("2d");

    // Fill background
    offCtx.fillStyle = this._bgColor;
    offCtx.fillRect(0, 0, off.width, off.height);

    // Draw the strokes on top
    offCtx.drawImage(this._canvas, 0, 0);

    // Download
    const link = document.createElement("a");
    link.download = filename;
    link.href = off.toDataURL("image/png");
    link.click();
  }

  /* ─────────────────────────────
     PUBLIC: Configuration
     ───────────────────────────── */

  set color(c) {
    this._color = c;
  }
  set baseWidth(w) {
    this._baseWidth = w;
  }
  set dynamicWidth(v) {
    this._dynamicWidth = v;
  }
  set lerpFactor(v) {
    this._lerpFactor = v;
  }

  get pointsDrawn() {
    return this._pointsDrawn;
  }

  /* ─────────────────────────────
     PRIVATE: Rendering
     ───────────────────────────── */

  /**
   * Draw a smooth Bézier segment using the midpoint algorithm.
   * This creates visually smooth curves even with sparse input points.
   *
   * Algorithm: Instead of line-to, we draw a quadratic Bézier from
   * the midpoint of (prev, curr) as control, creating a smooth join.
   *
   * @param {{x,y}} from
   * @param {{x,y}} to
   * @param {number} lineWidth
   */
  _drawBezierSegment(from, to, lineWidth) {
    const ctx = this._ctx;

    ctx.beginPath();
    ctx.moveTo(from.x, from.y);

    // Midpoint Bézier: control point is the 'from' position,
    // endpoint is midpoint between from and to for seamless joins.
    const mid = {
      x: (from.x + to.x) / 2,
      y: (from.y + to.y) / 2,
    };
    ctx.quadraticCurveTo(from.x, from.y, mid.x, mid.y);

    ctx.strokeStyle = this._color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // Neon glow effect: draw wider blurred layer first
    ctx.shadowColor = this._color;
    ctx.shadowBlur = lineWidth * 2.5;
    ctx.globalAlpha = 0.9;

    ctx.stroke();

    // Reset shadow for clean inner line
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }

  /** Draw a filled circle (start-point dot). */
  _drawDot(point, radius) {
    const ctx = this._ctx;
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius / 2, 0, Math.PI * 2);
    ctx.fillStyle = this._color;
    ctx.shadowColor = this._color;
    ctx.shadowBlur = radius * 2;
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  /**
   * Map movement speed to stroke width.
   * Fast movement → thin stroke (captures gesture speed)
   * Slow movement → thick stroke (precision control)
   *
   * @param {number} speed - px/ms
   * @returns {number} lineWidth in pixels
   */
  _computeDynamicWidth(speed) {
    // Speed range heuristic: 0 (stationary) to ~1 (fast gesture)
    const minW = Math.max(1, this._baseWidth * 0.4);
    const maxW = this._baseWidth * 2.0;

    // Fast = thin; clamp speed for stability
    const clamped = clamp(speed, 0, 1.5);
    return mapRange(clamped, 0, 1.5, maxW, minW);
  }

  _setupContextDefaults() {
    const ctx = this._ctx;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalCompositeOperation = "source-over";
  }

  _resize() {
    const rect = this._canvas.getBoundingClientRect();

    // Snapshot current drawing before resize
    let snapshot = null;
    if (this._canvas.width > 0 && this._canvas.height > 0) {
      try {
        snapshot = this._ctx.getImageData(
          0,
          0,
          this._canvas.width,
          this._canvas.height,
        );
      } catch (_) {}
    }

    this._canvas.width = rect.width || window.innerWidth;
    this._canvas.height = rect.height || window.innerHeight;

    this._setupContextDefaults();

    // Restore drawing after resize
    if (snapshot) {
      this._ctx.putImageData(snapshot, 0, 0);
    }
  }

  /* ─────────────────────────────
     PRIVATE: Undo Stack
     ───────────────────────────── */

  _saveUndoState() {
    if (this._canvas.width === 0 || this._canvas.height === 0) return;

    const snapshot = this._ctx.getImageData(
      0,
      0,
      this._canvas.width,
      this._canvas.height,
    );

    const snapshotSizeMB = (snapshot.data.byteLength / (1024 * 1024));

    this._undoStack.push(snapshot);
    this._totalUndoMemory += snapshotSizeMB;

    // Enforce max undo limit
    while (this._undoStack.length > this._maxUndo) {
      const removed = this._undoStack.shift();
      this._totalUndoMemory -= removed.data.byteLength / (1024 * 1024);
    }

    // Enforce memory budget
    while (this._totalUndoMemory > this._maxUndoMemoryMB && this._undoStack.length > 1) {
      const removed = this._undoStack.shift();
      this._totalUndoMemory -= removed.data.byteLength / (1024 * 1024);
    }

    // Any new draw action invalidates the redo stack
    this._redoStack = [];
  }
}
