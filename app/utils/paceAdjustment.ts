import {
  calculateGradeAtDistance,
  type ElevationPoint,
} from "./elevationProfile";

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
 * Converts a grade-adjusted pace back to the actual pace needed to achieve it on a given gradient.
 * This is the inverse of adjustPaceForGrade.
 *
 * @param gradeAdjustedPace The target grade-adjusted pace in seconds (per km or mile)
 * @param gradient The gradient as a percentage
 * @returns The actual pace needed in the same units as the grade-adjusted pace
 */
export function actualPaceFromGradeAdjusted(
  gradeAdjustedPace: number,
  gradient: number,
): number {
  const adjustmentFactor = paceAdjustment(gradient);
  return gradeAdjustedPace * adjustmentFactor;
}

/**
 * Calculates the target average pace (grade-adjusted) for a course given elevation profile.
 * This function determines what the average pace would be if the course were flat.
 *
 * @param elevationPoints Array of elevation points with distance and elevation data
 * @param actualPaces Array of actual paces at each point
 * @returns The target average pace that would result from the actual paces when grade-adjusted
 */
export function calculateTargetAveragePace(
  elevationPoints: Array<{ distance: number; elevation: number }>,
  actualPaces: number[],
): number {
  if (
    elevationPoints.length < 2 ||
    actualPaces.length !== elevationPoints.length
  ) {
    return 0;
  }

  let totalGradeAdjustedTime = 0;
  let totalDistance = 0;

  for (let i = 1; i < elevationPoints.length; i++) {
    const currentPoint = elevationPoints[i];
    const previousPoint = elevationPoints[i - 1];
    if (!currentPoint || !previousPoint) continue;

    const segmentDistance = currentPoint.distance - previousPoint.distance;
    const elevationChange = currentPoint.elevation - previousPoint.elevation;
    const gradient =
      segmentDistance > 0 ? (elevationChange / segmentDistance) * 100 : 0;

    const actualPace = actualPaces[i - 1];
    if (actualPace === undefined) continue;

    const gradeAdjustedPace = adjustPaceForGrade(actualPace, gradient);

    // Convert pace (per unit) to time for this segment
    const segmentTime = (gradeAdjustedPace * segmentDistance) / 1000; // Assuming pace is per km

    totalGradeAdjustedTime += segmentTime;
    totalDistance += segmentDistance;
  }

  // Return average pace in same units
  return totalDistance > 0
    ? (totalGradeAdjustedTime * 1000) / totalDistance
    : 0;
}

/**
 * Calculates the actual paces needed at each point along a course to achieve a target average pace.
 * This function takes a target average pace (what you want your overall time to average to) and
 * calculates what pace you need to run at each point considering the grade adjustments.
 *
 * @param elevationPoints Array of elevation points with distance, elevation, and coordinate data
 * @param targetAveragePace The desired average pace in seconds per km/mile (grade-adjusted)
 * @param windowDistance Window size in meters for grade smoothing (default: 100m)
 * @returns Array of actual paces needed at each point to achieve the target average
 */
export function calculateActualPacesForTarget(
  elevationPoints: ElevationPoint[],
  targetAveragePace: number,
  windowDistance: number = 100,
  paceSmoothingDistance: number = 200,
): Array<{ distance: number; actualPace: number; grade: number }> {
  if (elevationPoints.length < 2) {
    return [];
  }

  // 1) Compute smoothed grade and per-point adjustment factors
  const distances: number[] = [];
  const grades: number[] = [];
  const factors: number[] = [];

  for (let i = 0; i < elevationPoints.length; i++) {
    const pt = elevationPoints[i];
    if (!pt) continue;

    const g = calculateGradeAtDistance(
      elevationPoints,
      pt.distance,
      windowDistance,
    );
    const f = paceAdjustment(g);

    distances.push(pt.distance);
    grades.push(g);
    factors.push(f);
  }

  if (distances.length < 2) {
    return [];
  }

  // 2) Compute normalization scale using trapezoidal integration of factors over distance
  let totalDistance = 0;
  let equivalentDistanceSum = 0;
  for (let i = 1; i < distances.length; i++) {
    const dL = distances[i] - distances[i - 1];
    if (dL <= 0) continue;
    totalDistance += dL;

    const f0 = factors[i - 1];
    const f1 = factors[i];
    // Trapezoid: ∫ f(x) dx ≈ 0.5 * (f0 + f1) * dL
    equivalentDistanceSum += 0.5 * (f0 + f1) * dL;
  }

  const normalizationScale =
    equivalentDistanceSum > 0 ? totalDistance / equivalentDistanceSum : 1.0;

  // 3) Compute normalized actual pace series (targetAveragePace × factor × scale)
  const rawActualPaces: number[] = factors.map(
    (f) => targetAveragePace * f * normalizationScale,
  );

  // 4) Optional smoothing of the pace series over a distance window
  //    Apply a simple boxcar moving average in distance-space
  const halfWindow = Math.max(0, paceSmoothingDistance / 2);
  const smoothedActualPaces: number[] = [];

  if (halfWindow > 0) {
    for (let i = 0; i < distances.length; i++) {
      const center = distances[i];

      let sum = 0;
      let count = 0;

      // Expand left and right while within window
      // Naive O(N^2) but acceptable for typical chart sizes
      for (let j = 0; j < distances.length; j++) {
        const dj = Math.abs(distances[j] - center);
        if (dj <= halfWindow) {
          sum += rawActualPaces[j];
          count += 1;
        }
      }

      smoothedActualPaces.push(count > 0 ? sum / count : rawActualPaces[i]);
    }
  } else {
    // No smoothing requested
    for (let i = 0; i < rawActualPaces.length; i++) {
      smoothedActualPaces.push(rawActualPaces[i]);
    }
  }

  // 5) Build result
  const result: Array<{ distance: number; actualPace: number; grade: number }> =
    [];

  for (let i = 0; i < distances.length; i++) {
    result.push({
      distance: distances[i],
      actualPace: smoothedActualPaces[i],
      grade: grades[i],
    });
  }

  return result;
}

/**
 * Converts a target average pace to an equivalent flat pace for time calculations.
 * This is used for backward compatibility with existing time calculation systems
 * that expect a single pace value.
 *
 * @param targetAveragePace The target average pace in seconds per km/mile
 * @param elevationPoints Array of elevation points to calculate average grade
 * @returns Equivalent flat pace that would result in similar total times
 */
export function targetAveragePaceToFlatPace(
  targetAveragePace: number,
  elevationPoints: Array<{
    distance: number;
    elevation: number;
  }>,
): number {
  if (elevationPoints.length < 2) {
    return targetAveragePace;
  }

  // Calculate weighted average of pace adjustment factors across the course
  let totalDistance = 0;
  let weightedAdjustmentSum = 0;

  for (let i = 1; i < elevationPoints.length; i++) {
    const currentPoint = elevationPoints[i];
    const previousPoint = elevationPoints[i - 1];
    if (!currentPoint || !previousPoint) continue;

    const segmentDistance = currentPoint.distance - previousPoint.distance;
    const elevationChange = currentPoint.elevation - previousPoint.elevation;
    const gradient =
      segmentDistance > 0 ? (elevationChange / segmentDistance) * 100 : 0;

    const adjustmentFactor = paceAdjustment(gradient);

    weightedAdjustmentSum += adjustmentFactor * segmentDistance;
    totalDistance += segmentDistance;
  }

  const averageAdjustmentFactor =
    totalDistance > 0 ? weightedAdjustmentSum / totalDistance : 1.0;

  // Convert target average pace to equivalent flat pace
  return targetAveragePace * averageAdjustmentFactor;
}
