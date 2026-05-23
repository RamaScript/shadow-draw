/**
 * main.js — ShadowDraw Entry Point
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

import { CameraModule } from "./modules/CameraModule.js";
import { HandTrackingModule } from "./modules/HandTrackingModule.js";
import {
  GestureRecognitionModule,
  Gesture,
} from "./modules/GestureRecognitionModule.js";
import { DrawingEngine } from "./modules/DrawingEngine.js";
import { UILayer } from "./modules/UILayer.js";
import { MetricsLogger } from "./utils/MetricsLogger.js";
import { createFilter, FilterTypes } from "./utils/SmoothingFilters.js";
import { formatTime } from "./utils/MathUtils.js";

/* ══════════════════════════════════════════════════════════
   ShadowDrawApp — Top-level application controller
   ══════════════════════════════════════════════════════════ */
class ShadowDrawApp {
  constructor() {
    // DOM references with validation
    this._videoEl = document.getElementById("webcam-video");
    this._canvasEl = document.getElementById("drawing-canvas");
    this._app = document.getElementById("app");
    this._splash = document.getElementById("splash-screen");

    if (!this._videoEl || !this._canvasEl || !this._app || !this._splash) {
      throw new Error("Required DOM elements not found. Ensure index.html has all elements with correct IDs.");
    }

    // Module instances
    this._camera = new CameraModule(this._videoEl);
    this._tracking = new HandTrackingModule({ modelComplexity: 1 });
    this._gesture = new GestureRecognitionModule();
    this._drawing = new DrawingEngine(this._canvasEl);
    this._ui = new UILayer();
    this._metrics = new MetricsLogger();

    // Active smoothing filter (swappable at runtime)
    this._filter = createFilter(FilterTypes.MOVING_AVG);
    this._smoothType = FilterTypes.MOVING_AVG;

    // Application state
    this._prevGesture = Gesture.UNKNOWN;
    this._handVisible = false;
    this._metricsInterval = null;
    this._fpsWarned = false;

    // Frame timing
    this._lastFrameTime = 0;
    this._rafId = null;

    // Resize observer for responsive canvas
    this._resizeObserver = null;

    // Cleanup on page unload
    this._boundDestroy = this.destroy.bind(this);
    window.addEventListener("beforeunload", this._boundDestroy);
  }

  /* ─────────────────────────────
     BOOT SEQUENCE
     ───────────────────────────── */

  /** Initialize the entire system. Called from splash screen. */
  async boot() {
    try {
      // Show app, hide splash
      this._splash.style.display = "none";
      this._app.classList.remove("hidden");

      // Set up UI callbacks before anything else
      this._wireUICallbacks();
      this._ui.init();
      this._bindKeyboard();

      // Loading stage 1: Camera
      this._ui.setLoadingText("Requesting camera access…");
      this._ui.setLoadingProgress(10);

      await this._startCamera();

      // Loading stage 2: MediaPipe
      this._ui.setLoadingText("Loading MediaPipe Hands model…");
      this._ui.setLoadingProgress(35);

      await this._startTracking();

      // Loading stage 3: Canvas
      this._ui.setLoadingText("Initializing drawing engine…");
      this._ui.setLoadingProgress(80);
      this._drawing.resize();

      // Loading stage 4: Done
      this._ui.setLoadingProgress(100);
      this._ui.setLoadingText("System ready!");

      setTimeout(() => {
        this._ui.hideLoading();
        this._startMetricsLoop();
        this._ui.toast(
          "System ready — raise your hand to begin!",
          "success",
          3000,
        );
      }, 400);

      // ResizeObserver for responsive canvas
      this._resizeObserver = new ResizeObserver(() => {
        this._drawing.resize();
      });
      this._resizeObserver.observe(this._canvasEl);
    } catch (err) {
      // Ensure cleanup on any error during boot
      await this._cleanupOnError();
      console.error("[ShadowDraw] Boot failed:", err);
      this._ui.hideLoading();
      if (err.message && err.message.includes("DOM elements")) {
        // Only reload for missing DOM elements — these are fatal
        this._ui.showCameraError(
          `System initialization failed: ${err.message}`,
          () => window.location.reload(),
        );
      } else {
        this._ui.showCameraError(
          `System initialization failed: ${err.message}. Try again or reload.`,
          () => {
            this._recover();
          },
        );
      }
    }
  }

  /* ─────────────────────────────
     CAMERA SETUP
     ───────────────────────────── */

   async _startCamera() {
     return new Promise((resolve, reject) => {
       this._camera.onReady = resolve;
       this._camera.onError = (msg, err) => {
         console.error("[Camera]", err);
         this._ui.hideLoading();
         this._ui.showCameraError(msg, () => {
           this._recover();
         });
         reject(new Error(msg));
       };
       this._camera.start();
     });
   }

  /* ─────────────────────────────
     HAND TRACKING SETUP
     ───────────────────────────── */

  async _startTracking() {
    return new Promise(async (resolve, reject) => {
      this._tracking.onReady = () => {
        console.log("[HandTracking] Model ready");
        resolve();
      };

      this._tracking.onError = (err) => {
        console.error("[HandTracking] Error:", err);
        this._ui.hideLoading();
        this._ui.showCameraError(
          "Failed to initialize MediaPipe Hands. Check your internet connection.",
          () => {
            this._recover();
          },
        );
        reject(new Error("Failed to initialize MediaPipe Hands. Check your internet connection."));
      };

      // Wire up the results callback
      this._tracking.onResults = (result) => this._onHandResults(result);

      await this._tracking.init(this._videoEl);
    });
  }

  /* ─────────────────────────────
     RECOVERY
     Attempt to reinitialize without full page reload
     ───────────────────────────── */

  async _recover() {
    console.log("[ShadowDraw] Attempting recovery...");
    await this._cleanupOnError();
    this._ui.hideCameraError();
    this._ui.toast("Reinitializing system...", "info", 2000);
    // Reinitialize modules
    this._camera = new CameraModule(this._videoEl);
    this._tracking = new HandTrackingModule({ modelComplexity: 1 });
    this._gesture = new GestureRecognitionModule();
    this._prevGesture = Gesture.UNKNOWN;
    this._handVisible = false;
    this._filter = createFilter(FilterTypes.MOVING_AVG);
    this._smoothType = FilterTypes.MOVING_AVG;

    // Reboot
    await this.boot();
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
    this._ui.toast("Canvas cleared", "info", 1500);
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
      this._ui.toast(`Smoothing: ${type}`, "info", 1500);
    };

    this._ui.onDynamicToggle = (enabled) => {
      this._drawing.dynamicWidth = enabled;
      this._ui.toast(
        enabled ? "Dynamic stroke ON" : "Dynamic stroke OFF",
        "info",
        1500,
      );
    };

    this._ui.onUndo = () => {
      if (this._drawing.undo()) {
        this._ui.toast("Undo", "info", 1000);
        this._ui.setUndoEnabled(this._drawing.canUndo);
        this._ui.setRedoEnabled(this._drawing.canRedo);
      }
    };

    this._ui.onRedo = () => {
      if (this._drawing.redo()) {
        this._ui.toast("Redo", "info", 1000);
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
      this._ui.toast("Saved as PNG!", "success", 2000);
    };
  }

  /* ─────────────────────────────
     CENTRALIZED KEYBOARD SHORTCUTS
     ───────────────────────────── */

  _bindKeyboard() {
    document.addEventListener("keydown", (e) => {
      // Ignore when user is typing in an input
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable) return;

      if (e.ctrlKey || e.metaKey) {
        switch (e.key.toLowerCase()) {
          case "z":
            e.preventDefault();
            this._ui.onUndo?.();
            break;
          case "y":
            e.preventDefault();
            this._ui.onRedo?.();
            break;
          case "s":
            e.preventDefault();
            this._ui.onSave?.();
            break;
        }
        return;
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        this._triggerClear();
      }
    });
  }

   /* ─────────────────────────────
      ERROR CLEANUP
      ───────────────────────────── */

/**
     * Cleanup resources when boot encounters an error
     */
   async _cleanupOnError() {
     // Stop camera if running
     if (this._camera?.isRunning) {
       this._camera.stop();
     }
     
     // Stop tracking if initialized
     if (this._tracking?.isReady) {
       try {
         await this._tracking.stop();
       } catch (err) {
         console.warn("[ShadowDraw] Tracking stop error:", err);
       }
     }
     
     // Clear intervals
     if (this._metricsInterval) {
       clearInterval(this._metricsInterval);
       this._metricsInterval = null;
     }
     
     // Cancel animation frame if scheduled
     if (this._rafId) {
       cancelAnimationFrame(this._rafId);
       this._rafId = null;
     }

     // Disconnect ResizeObserver
     if (this._resizeObserver) {
       this._resizeObserver.disconnect();
       this._resizeObserver = null;
     }
   }

   /* ─────────────────────────────
      METRICS LOOP
      Updates the metrics panel every second
      ───────────────────────────── */

  _startMetricsLoop() {
    this._metricsInterval = setInterval(() => {
      this._ui.updateMetrics({
        strokes: this._metrics.strokeCount,
        points: this._metrics.totalPoints,
        gestures: this._metrics.gestureChanges,
        confidence: this._metrics.avgConfidence ?? "--",
        smooth: this._smoothType,
        sessionTime: formatTime(this._metrics.sessionDurationMs),
      });

      // Performance warning if FPS drops below threshold
      if (this._metrics.fps < 15 && this._metrics.fps > 0) {
        if (!this._fpsWarned) {
          this._fpsWarned = true;
          this._ui.toast(
            "Low FPS detected. Try reducing model complexity or closing other apps.",
            "error",
            4000,
          );
        }
      } else {
        this._fpsWarned = false;
      }
    }, 1000);
  }

  /**
   * Destroy the application and release all resources.
   * Called automatically on page unload.
   */
  destroy() {
    this._camera?.stop();

    if (this._tracking?.isReady) {
      this._tracking.stop().catch((err) => {
        console.warn("[ShadowDraw] Tracking stop error:", err);
      });
    }

    if (this._metricsInterval) {
      clearInterval(this._metricsInterval);
      this._metricsInterval = null;
    }

    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }

    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }

    window.removeEventListener("beforeunload", this._boundDestroy);
  }
}

/* ══════════════════════════════════════════════════════════
   BOOT: Wire splash screen → app launch
   ══════════════════════════════════════════════════════════ */

const app = new ShadowDrawApp();

document.getElementById("launch-btn")?.addEventListener("click", () => {
  app.boot().catch((err) => {
    console.error("[ShadowDraw] Boot failed:", err);
  });
});
