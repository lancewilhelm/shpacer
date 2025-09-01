import type { ElevationPoint } from "./elevationProfile";

/**
 * Calculates pace adjustment factor based on terrain gradient.
 *
 * This function uses a piecewise equation to convert grade (gradient) to a pace factor.
 * The equation consists of:
 * - Linear segments for extreme gradients (< -32.25% and > 32.1%)
 * - A 4th-degree polynomial for moderate gradients (-32.25% to 32.1%)
 *
 * @param gradient The gradient as a percentage (e.g., 10 for 10% grade)
 * @returns The pace adjustment factor (multiplier for base pace)
 */
export function paceAdjustment(gradient: number): number {
  // Constrained 4th-degree polynomial coefficients
  const a4 = -4.3144778100289634e-7;
  const a3 = -2.930257313334705e-6;
  const a2 = 0.0018738529522439088;
  const a1 = 0.03076354335605815;
  const a0 = 1.0; // Fixed intercept

  // Transition points
  const leftEnd = -32.25;
  const rightEnd = 32.1;

  // Precomputed tangents for continuity
  const slopeLeft = -0.041356411457441594;
  const interceptLeft = 0.25463237016735074;

  const slopeRight = 0.08492425850523927;
  const interceptRight = 0.6372687773774661;

  if (gradient < leftEnd) {
    return slopeLeft * gradient + interceptLeft;
  } else if (gradient > rightEnd) {
    return slopeRight * gradient + interceptRight;
  } else {
    return (
      a4 * Math.pow(gradient, 4) +
      a3 * Math.pow(gradient, 3) +
      a2 * Math.pow(gradient, 2) +
      a1 * gradient +
      a0
    );
  }
}

/**
 * Adjusts a base pace by applying the gradient-based pace factor.
 *
 * @param basePace The base pace in seconds (per km or mile, depending on units)
 * @param gradient The gradient as a percentage
 * @returns The adjusted pace in the same units as the base pace
 */
export function adjustPaceForGrade(basePace: number, gradient: number): number {
  const adjustmentFactor = paceAdjustment(gradient);
  return basePace * adjustmentFactor;
}

/**
 * Compute a linear pacing strategy factor along the course.
 * totalPercent is the total change from start to finish (e.g., 10 => 0.95 to 1.05).
 * The mean factor across the course integrates to 1.0.
 *
 * @param t normalized position along course in [0, 1]
 * @param totalPercent total percent change from start to finish (positive => start faster, end slower)
 */
function linearPacingFactor(t: number, totalPercent: number): number {
  // Clamp to reasonable bounds [-50%, 50%]
  const P = Math.max(-50, Math.min(50, totalPercent)) / 100;
  // Factor varies linearly from (1 - P/2) at start to (1 + P/2) at end
  return 1 + (t - 0.5) * (2 * (P / 2)); // simplifies to 1 + (t - 0.5) * P
}

/**
 * Calculates the actual paces needed at each point along a course to achieve a target average pace.
 * This function takes a target average pace (what you want your overall time to average to) and
 * calculates what pace you need to run at each point considering the grade adjustments and optional pacing strategy.
 *
 * If maintainTargetAverage is true, paces are normalized so that the overall average equals
 * targetAveragePace after accounting for grade and pacing strategy factors. If false, no normalization is applied
 * and paces reflect raw effects from the base targetAveragePace.
 *
 * @param elevationPoints Array of elevation points with distance, elevation, and coordinate data
 * @param targetAveragePace The desired average pace in seconds per km/mile (grade-adjusted)
 * @param windowDistance Window size in meters for grade smoothing (default: 100m)
 * @param paceSmoothingDistance Window size in meters for smoothing paces (default: 200m)
 * @param maintainTargetAverage Whether to normalize paces to maintain the target average (default: true)
 * @param pacingStrategy Pacing strategy to apply: 'flat' (default) or 'linear'
 * @param pacingLinearPercent Total percent change start->end for linear strategy (e.g., 10 => 0.95..1.05)
 * @returns Array of actual paces needed at each point to achieve the target average
 */
export function calculateActualPacesForTarget(
  elevationPoints: ElevationPoint[],
  targetAveragePace: number,
  windowDistance: number = 100,
  paceSmoothingDistance: number = 200,
  maintainTargetAverage: boolean = true,
  pacingStrategy: "flat" | "linear" = "flat",
  pacingLinearPercent: number = 0,
): Array<{ distance: number; actualPace: number; grade: number }> {
  const n = elevationPoints.length;
  if (n < 2) return [];

  const dist = elevationPoints.map((p) => p.distance);
  const elev = elevationPoints.map((p) => p.elevation);

  // Compute grade per point using O(N) windowed interpolation
  const grades: number[] = new Array(n).fill(0);

  if (windowDistance === 0) {
    // Adjacent-segment grade for window = 0
    for (let i = 0; i < n - 1; i++) {
      const rise = elev[i + 1]! - elev[i]!;
      const run = dist[i + 1]! - dist[i]!;
      grades[i] =
        run !== 0 ? Math.max(-100, Math.min(100, (rise / run) * 100)) : 0;
    }
    grades[n - 1] = grades[n - 2] ?? 0;
  } else {
    const halfW = windowDistance / 2;

    // Indices of segments for start and end window boundaries
    let sIdx = 0;
    let eIdx = 0;

    for (let i = 0; i < n; i++) {
      const center = dist[i]!;
      let startD = center - halfW;
      let endD = center + halfW;

      // Clamp to data range
      if (startD < dist[0]!) startD = dist[0]!;
      if (endD > dist[n - 1]!) endD = dist[n - 1]!;

      // Advance to segments containing the boundaries
      while (sIdx + 1 < n && dist[sIdx + 1]! < startD) sIdx++;
      while (eIdx + 1 < n && dist[eIdx + 1]! < endD) eIdx++;

      // Interpolate elevation at startD
      let elevStart = elev[sIdx]!;
      if (sIdx + 1 < n && dist[sIdx + 1]! > dist[sIdx]!) {
        const t = (startD - dist[sIdx]!) / (dist[sIdx + 1]! - dist[sIdx]!);
        elevStart = elev[sIdx]! + t * (elev[sIdx + 1]! - elev[sIdx]!);
      }

      // Interpolate elevation at endD
      let elevEnd = elev[eIdx]!;
      if (eIdx + 1 < n && dist[eIdx + 1]! > dist[eIdx]!) {
        const t = (endD - dist[eIdx]!) / (dist[eIdx + 1]! - dist[eIdx]!);
        elevEnd = elev[eIdx]! + t * (elev[eIdx + 1]! - elev[eIdx]!);
      }

      const run = endD - startD;
      const rise = elevEnd - elevStart;
      grades[i] =
        run !== 0 ? Math.max(-100, Math.min(100, (rise / run) * 100)) : 0;
    }
  }

  // Convert grade -> adjustment factor
  const gradeFactors = grades.map((g) => paceAdjustment(g));

  // Pacing strategy factor (per point)
  const startDist = dist[0] ?? 0;
  const endDist = dist[n - 1] ?? startDist;
  const totalDist = Math.max(0, endDist - startDist);
  const pacingFactors: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    if (pacingStrategy === "linear" && totalDist > 0) {
      const t = Math.max(0, Math.min(1, (dist[i]! - startDist) / totalDist));
      pacingFactors[i] = linearPacingFactor(t, pacingLinearPercent);
    } else {
      pacingFactors[i] = 1.0; // flat (no change)
    }
  }

  // Combine factors
  const combinedFactors: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    combinedFactors[i] = gradeFactors[i]! * pacingFactors[i]!;
  }

  // Normalize to maintain target average pace using trapezoidal integration
  let totalDistance = 0;
  let equivalentDistanceSum = 0;
  for (let i = 1; i < n; i++) {
    const dL = dist[i]! - dist[i - 1]!;
    if (dL <= 0) continue;
    totalDistance += dL;

    const f0 = combinedFactors[i - 1]!;
    const f1 = combinedFactors[i]!;
    equivalentDistanceSum += 0.5 * (f0 + f1) * dL;
  }
  const normalizationScale =
    maintainTargetAverage && equivalentDistanceSum > 0
      ? totalDistance / equivalentDistanceSum
      : 1.0;

  // Raw grade + strategy adjusted paces
  const rawActualPaces: number[] = combinedFactors.map(
    (f) => targetAveragePace * f * normalizationScale,
  );

  // Smooth paces using O(N) sliding window in distance-space
  const smoothedActualPaces: number[] = new Array(n);
  const halfP = Math.max(0, paceSmoothingDistance / 2);

  if (halfP === 0) {
    for (let i = 0; i < n; i++) smoothedActualPaces[i] = rawActualPaces[i]!;
  } else {
    let left = 0;
    let right = -1;
    let sum = 0;
    let count = 0;

    for (let i = 0; i < n; i++) {
      const center = dist[i]!;

      while (right + 1 < n && dist[right + 1]! <= center + halfP) {
        right++;
        sum += rawActualPaces[right]!;
        count++;
      }
      while (left < n && dist[left]! < center - halfP) {
        sum -= rawActualPaces[left]!;
        count--;
        left++;
      }

      smoothedActualPaces[i] = count > 0 ? sum / count : rawActualPaces[i]!;
    }
  }

  // Build result
  const result: Array<{ distance: number; actualPace: number; grade: number }> =
    new Array(n);
  for (let i = 0; i < n; i++) {
    result[i] = {
      distance: dist[i]!,
      actualPace: smoothedActualPaces[i]!,
      grade: grades[i]!,
    };
  }

  return result;
}
