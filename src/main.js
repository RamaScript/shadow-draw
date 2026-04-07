/**
 * main.js — AirDraw Entry Point
 * ─────────────────────────────────────────────────────────────────────
 * Application orchestrator using a clean MVC-inspired architecture.
 *
 * Data flow:
 *   Camera → MediaPipe Hands → GestureRecognition → DrawingEngine
 *                                                 ↘ UILayer (display)
 *
 * Module responsibilities:
 *   CameraModule         → Hardware access, stream lifecycle
 *   HandTrackingModule   → MediaPipe Hands wrapping, landmark output
 *   GestureRecognition   → Landmark → Gesture classification
 *   SmoothingFilters     → Coordinate noise reduction
 *   DrawingEngine        → Canvas rendering, stroke management
 *   UILayer              → DOM events, display feedback
 *   MetricsLogger        → Session analytics, FPS, confidence
 * ─────────────────────────────────────────────────────────────────────
 */

import { CameraModule }            from './modules/CameraModule.js';
import { HandTrackingModule }      from './modules/HandTrackingModule.js';
import { GestureRecognitionModule, Gesture } from './modules/GestureRecognitionModule.js';
import { DrawingEngine }           from './modules/DrawingEngine.js';
import { UILayer }                 from './modules/UILayer.js';
import { MetricsLogger }           from './utils/MetricsLogger.js';
import { createFilter, FilterTypes } from './utils/SmoothingFilters.js';
import { formatTime }              from './utils/MathUtils.js';

/* ══════════════════════════════════════════════════════════
   AirDrawApp — Top-level application controller
   ══════════════════════════════════════════════════════════ */
class AirDrawApp {
  constructor() {
    // DOM references
    this._videoEl  = document.getElementById('webcam-video');
    this._canvasEl = document.getElementById('drawing-canvas');
    this._app      = document.getElementById('app');
    this._splash   = document.getElementById('splash-screen');

    // Module instances
    this._camera    = new CameraModule(this._videoEl);
    this._tracking  = new HandTrackingModule({ modelComplexity: 1 });
    this._gesture   = new GestureRecognitionModule();
    this._drawing   = new DrawingEngine(this._canvasEl);
    this._ui        = new UILayer();
    this._metrics   = new MetricsLogger();

    // Active smoothing filter (swappable at runtime)
    this._filter    = createFilter(FilterTypes.MOVING_AVG);
    this._smoothType = FilterTypes.MOVING_AVG;

    // Application state
    this._prevGesture     = Gesture.UNKNOWN;
    this._handVisible     = false;
    this._metricsInterval = null;

    // Frame timing
    this._lastFrameTime = 0;
    this._rafId         = null;
  }

  /* ─────────────────────────────
     BOOT SEQUENCE
     ───────────────────────────── */

  /** Initialize the entire system. Called from splash screen. */
  async boot() {
    // Show app, hide splash
    this._splash.style.display  = 'none';
    this._app.classList.remove('hidden');

    // Set up UI callbacks before anything else
    this._wireUICallbacks();
    this._ui.init();

    // Loading stage 1: Camera
    this._ui.setLoadingText('Requesting camera access…');
    this._ui.setLoadingProgress(10);

    await this._startCamera();

    // Loading stage 2: MediaPipe
    this._ui.setLoadingText('Loading MediaPipe Hands model…');
    this._ui.setLoadingProgress(35);

    await this._startTracking();

    // Loading stage 3: Canvas
    this._ui.setLoadingText('Initializing drawing engine…');
    this._ui.setLoadingProgress(80);
    this._drawing.resize();

    // Loading stage 4: Done
    this._ui.setLoadingProgress(100);
    this._ui.setLoadingText('System ready!');

    setTimeout(() => {
      this._ui.hideLoading();
      this._startMetricsLoop();
      this._ui.toast('System ready — raise your hand to begin!', 'success', 3000);
    }, 400);

    // Resize canvas on window resize
    window.addEventListener('resize', () => {
      this._drawing.resize();
    });
  }

  /* ─────────────────────────────
     CAMERA SETUP
     ───────────────────────────── */

  async _startCamera() {
    return new Promise((resolve) => {
      this._camera.onReady = resolve;
      this._camera.onError = (msg, err) => {
        console.error('[Camera]', err);
        this._ui.hideLoading();
        this._ui.showCameraError(msg, () => window.location.reload());
      };
      this._camera.start();
    });
  }

  /* ─────────────────────────────
     HAND TRACKING SETUP
     ───────────────────────────── */

  async _startTracking() {
    return new Promise(async (resolve) => {
      this._tracking.onReady = () => {
        console.log('[HandTracking] Model ready');
        resolve();
      };

      this._tracking.onError = (err) => {
        console.error('[HandTracking] Error:', err);
        this._ui.hideLoading();
        this._ui.showCameraError(
          'Failed to initialize MediaPipe Hands. Check your internet connection.',
          () => window.location.reload()
        );
      };

      // Wire up the results callback
      this._tracking.onResults = (result) => this._onHandResults(result);

      await this._tracking.init(this._videoEl);
    });
  }

  /* ─────────────────────────────
     HAND RESULTS HANDLER
     Called every frame by MediaPipe
     ───────────────────────────── */

  _onHandResults(result) {
    const now = performance.now();
    this._metrics.tickFrame();

    // Extract landmarks (null if no hand)
    const landmarks = HandTrackingModule.extractLandmarks(result);
    const confidence = HandTrackingModule.getConfidence(result);

    if (confidence !== null) this._metrics.logConfidence(confidence);
    this._ui.updateFPS(this._metrics.fps);
    this._ui.updateConfidence(confidence);

    if (!landmarks) {
      // No hand visible — end any active stroke
      this._handVisible = false;
      if (this._prevGesture === Gesture.PINCH) {
        this._drawing.endStroke();
      }
      this._ui.updateGesture(Gesture.UNKNOWN);
      this._ui.hideCursor();
      this._filter.reset();
      return;
    }

    this._handVisible = true;

    // ── Convert landmark 8 (index tip) to canvas coordinates ──
    const canvas = this._canvasEl;
    const rawPoint = HandTrackingModule.toCanvasCoords(
      landmarks[HandTrackingModule.LM.INDEX_TIP],
      canvas.width,
      canvas.height,
    );

    // ── Apply smoothing filter ──
    const smoothedPoint = this._filter.filter(rawPoint);

    // ── Classify gesture ──
    const gesture = this._gesture.classify(landmarks);
    this._metrics.logGesture(gesture);
    this._ui.updateGesture(gesture);

    // ── Handle gesture transitions ──
    this._handleGestureTransition(gesture, smoothedPoint, now);

    // ── Update draw cursor position ──
    this._ui.updateCursor(smoothedPoint, gesture === Gesture.PINCH);

    this._prevGesture = gesture;
  }

  /* ─────────────────────────────
     GESTURE STATE MACHINE
     ───────────────────────────── */

  _handleGestureTransition(gesture, point, timestamp) {
    const prev = this._prevGesture;

    switch (gesture) {
      case Gesture.PINCH:
        if (prev !== Gesture.PINCH) {
          // Transition INTO pinch: start new stroke
          this._drawing.beginStroke(point);
          this._metrics.incrementStrokes();
        } else {
          // Continue drawing
          this._drawing.draw(point, timestamp);
          this._metrics.incrementPoints();
        }
        break;

      case Gesture.OPEN:
        if (prev === Gesture.PINCH) {
          // Transition from drawing to idle: end stroke
          this._drawing.endStroke();
        }
        break;

      case Gesture.FIST:
        if (prev !== Gesture.FIST) {
          // Fist trigger: clear canvas
          this._triggerClear();
        }
        break;

      case Gesture.UNKNOWN:
        if (prev === Gesture.PINCH) {
          this._drawing.endStroke();
        }
        break;
    }

    // Update undo/redo button states
    this._ui.setUndoEnabled(this._drawing.canUndo);
    this._ui.setRedoEnabled(this._drawing.canRedo);
  }

  _triggerClear() {
    this._drawing.clear();
    this._filter.reset();
    this._ui.toast('Canvas cleared', 'info', 1500);
    this._ui.setUndoEnabled(this._drawing.canUndo);
  }

  /* ─────────────────────────────
     UI CALLBACKS
     ───────────────────────────── */

  _wireUICallbacks() {
    this._ui.onColorChange = (color) => {
      this._drawing.color = color;
    };

    this._ui.onBrushChange = (size) => {
      this._drawing.baseWidth = size;
    };

    this._ui.onSmoothChange = (type) => {
      this._smoothType = type;
      this._filter = createFilter(type);
      this._ui.toast(`Smoothing: ${type}`, 'info', 1500);
    };

    this._ui.onDynamicToggle = (enabled) => {
      this._drawing.dynamicWidth = enabled;
      this._ui.toast(
        enabled ? 'Dynamic stroke ON' : 'Dynamic stroke OFF',
        'info', 1500
      );
    };

    this._ui.onUndo = () => {
      if (this._drawing.undo()) {
        this._ui.toast('Undo', 'info', 1000);
        this._ui.setUndoEnabled(this._drawing.canUndo);
        this._ui.setRedoEnabled(this._drawing.canRedo);
      }
    };

    this._ui.onRedo = () => {
      if (this._drawing.redo()) {
        this._ui.toast('Redo', 'info', 1000);
        this._ui.setUndoEnabled(this._drawing.canUndo);
        this._ui.setRedoEnabled(this._drawing.canRedo);
      }
    };

    this._ui.onClear = () => {
      this._triggerClear();
    };

    this._ui.onSave = () => {
      const filename = `airdraw-${Date.now()}.png`;
      this._drawing.saveAsPNG(filename);
      this._ui.toast('Saved as PNG!', 'success', 2000);
    };
  }

  /* ─────────────────────────────
     METRICS LOOP
     Updates the metrics panel every second
     ───────────────────────────── */

  _startMetricsLoop() {
    this._metricsInterval = setInterval(() => {
      this._ui.updateMetrics({
        strokes:     this._metrics.strokeCount,
        points:      this._metrics.totalPoints,
        gestures:    this._metrics.gestureChanges,
        confidence:  this._metrics.avgConfidence ?? '--',
        smooth:      this._smoothType,
        sessionTime: formatTime(this._metrics.sessionDurationMs),
      });
    }, 1000);
  }
}

/* ══════════════════════════════════════════════════════════
   BOOT: Wire splash screen → app launch
   ══════════════════════════════════════════════════════════ */

const app = new AirDrawApp();

document.getElementById('launch-btn')?.addEventListener('click', () => {
  app.boot().catch(err => {
    console.error('[AirDraw] Boot failed:', err);
  });
});
