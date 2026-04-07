/**
 * SmoothingFilters.js — ShadowDraw
 * ─────────────────────────────────────────────────────────────────────
 * Implements multiple smoothing strategies for hand tracking coordinates.
 * Research comparison: Moving Average vs. Kalman Filter vs. Raw input.
 *
 * Design: Each filter class exposes a uniform `.filter(point)` interface
 * so they are trivially swappable in the drawing pipeline.
 * ─────────────────────────────────────────────────────────────────────
 */

/* ═══════════════════════════════════════════════════════════
   1. MOVING AVERAGE FILTER
   Simple window-based position averaging. Easy to tune, low
   overhead. Introduces slight lag proportional to window size.
   ═══════════════════════════════════════════════════════════ */
export class MovingAverageFilter {
  /**
   * @param {number} windowSize - Number of samples to average (default 5)
   */
  constructor(windowSize = 5) {
    this.windowSize = windowSize;
    this.bufferX = [];
    this.bufferY = [];
  }

  /**
   * Apply the moving average to a new point.
   * @param {{x:number, y:number}} point
   * @returns {{x:number, y:number}} smoothed point
   */
  filter(point) {
    this.bufferX.push(point.x);
    this.bufferY.push(point.y);

    if (this.bufferX.length > this.windowSize) {
      this.bufferX.shift();
      this.bufferY.shift();
    }

    const avgX = this.bufferX.reduce((s, v) => s + v, 0) / this.bufferX.length;
    const avgY = this.bufferY.reduce((s, v) => s + v, 0) / this.bufferY.length;

    return { x: avgX, y: avgY };
  }

  /** Reset the filter state (e.g., on gesture change). */
  reset() {
    this.bufferX = [];
    this.bufferY = [];
  }

  setWindowSize(size) {
    this.windowSize = size;
    this.reset();
  }
}

/* ═══════════════════════════════════════════════════════════
   2. 1D KALMAN FILTER — applied independently per axis
   Optimally estimates the true position by balancing between
   prediction (process model) and measurement. Lower noise,
   faster response than moving average for similar lag.

   State vector: [position]
   Process model: x_k = x_{k-1} + noise_process
   Measurement:   z_k = x_k + noise_measurement
   ═══════════════════════════════════════════════════════════ */
class KalmanFilter1D {
  /**
   * @param {number} R - Measurement noise covariance (higher = trust model more)
   * @param {number} Q - Process noise covariance (higher = faster adaptation)
   */
  constructor(R = 0.008, Q = 0.1) {
    this.R = R; // measurement noise
    this.Q = Q; // process noise
    this.P = 1; // estimate error covariance
    this.x = null; // state estimate (null = uninitialized)
  }

  filter(measurement) {
    // Initialize on first measurement
    if (this.x === null) {
      this.x = measurement;
      return measurement;
    }

    // Prediction step
    this.P = this.P + this.Q;

    // Update (Kalman Gain)
    const K = this.P / (this.P + this.R);

    // State estimate update
    this.x = this.x + K * (measurement - this.x);

    // Error covariance update
    this.P = (1 - K) * this.P;

    return this.x;
  }

  reset() {
    this.x = null;
    this.P = 1;
  }
}

/* 2D Kalman Filter (applies 1D independently per axis) */
export class KalmanFilter2D {
  /**
   * @param {number} R - Measurement noise (default 0.008)
   * @param {number} Q - Process noise (default 0.1)
   */
  constructor(R = 0.008, Q = 0.1) {
    this.kx = new KalmanFilter1D(R, Q);
    this.ky = new KalmanFilter1D(R, Q);
    this.R = R;
    this.Q = Q;
  }

  /**
   * Apply 2D Kalman filter to a point.
   * @param {{x:number, y:number}} point
   * @returns {{x:number, y:number}} filtered point
   */
  filter(point) {
    return {
      x: this.kx.filter(point.x),
      y: this.ky.filter(point.y),
    };
  }

  reset() {
    this.kx.reset();
    this.ky.reset();
  }

  /** Tune noise parameters at runtime */
  tune(R, Q) {
    this.kx.R = R;
    this.kx.Q = Q;
    this.ky.R = R;
    this.ky.Q = Q;
  }
}

/* ═══════════════════════════════════════════════════════════
   3. NO-OP (PASSTHROUGH) FILTER
   Returns raw coordinates — baseline for comparison studies.
   ═══════════════════════════════════════════════════════════ */
export class NoOpFilter {
  filter(point) {
    return { ...point };
  }
  reset() {}
}

/* ═══════════════════════════════════════════════════════════
   FILTER FACTORY
   Returns the correct filter given a strategy name.
   ═══════════════════════════════════════════════════════════ */
export const FilterTypes = {
  MOVING_AVG: "movingAvg",
  KALMAN: "kalman",
  NONE: "none",
};

/**
 * Create a filter instance by strategy name.
 * @param {string} type - One of FilterTypes values
 * @returns {MovingAverageFilter|KalmanFilter2D|NoOpFilter}
 */
export function createFilter(type) {
  switch (type) {
    case FilterTypes.KALMAN:
      return new KalmanFilter2D();
    case FilterTypes.NONE:
      return new NoOpFilter();
    case FilterTypes.MOVING_AVG:
    default:
      return new MovingAverageFilter(6);
  }
}
