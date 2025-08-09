import type { SelectPlan, SelectWaypointStoppageTime } from "~/utils/db/schema";
import type { ElevationPoint } from "~/utils/elevationProfile";
import { calculateGradeAtDistance } from "~/utils/elevationProfile";
import { paceAdjustment } from "~/utils/paceAdjustment";
import type { WaypointSegment } from "~/utils/waypointSegments";

export interface GradeAdjustedTimeCalculationOptions {
  plan: SelectPlan;
  waypoints: Array<{ id: string; distance: number; order: number }>;
  waypointStoppageTimes: SelectWaypointStoppageTime[];
  elevationProfile: ElevationPoint[];
  waypointSegments: WaypointSegment[];
  getDefaultStoppageTime: () => number;
  // Optional smoothing overrides
  gradeWindowMeters?: number;
  sampleStepMeters?: number;
}

/**
 * Grade adjustment factor based on the 4th-degree polynomial model
 * This matches the research-based approach for running pace adjustments
 * Positive grade = uphill (slower), Negative grade = downhill (faster)
 * @param grade Grade as percentage (e.g., 5 for 5% uphill, -3 for 3% downhill)
 * @returns Pace adjustment factor (1.0 = no change, >1.0 = slower, <1.0 = faster)
 */
function calculateGradeAdjustmentFactor(grade: number): number {
  // Clamp grade to reasonable bounds (percentage)
  const clampedGrade = Math.max(-50, Math.min(50, grade));
  // Use shared piecewise polynomial-based adjustment
  const factor = paceAdjustment(clampedGrade);
  // Ensure factor stays within reasonable bounds
  return Math.max(0.5, Math.min(3.0, factor));
}

/**
 * Calculate the average grade for a segment between two waypoints
 * @param fromDistance Start distance in meters
 * @param toDistance End distance in meters
 * @param elevationProfile Elevation profile data
 * @returns Average grade as percentage
 */
function calculateSegmentAverageGrade(
  fromDistance: number,
  toDistance: number,
  elevationProfile: ElevationPoint[],
): number {
  if (elevationProfile.length < 2 || fromDistance >= toDistance) {
    return 0;
  }

  // Find elevation points within the segment
  const segmentPoints = elevationProfile.filter(
    (point) => point.distance >= fromDistance && point.distance <= toDistance,
  );

  if (segmentPoints.length < 2) {
    // Fall back to simple grade calculation using interpolated endpoints
    const startElevation = interpolateElevationAtDistance(
      fromDistance,
      elevationProfile,
    );
    const endElevation = interpolateElevationAtDistance(
      toDistance,
      elevationProfile,
    );

    if (startElevation === null || endElevation === null) {
      return 0;
    }

    const rise = endElevation - startElevation;
    const run = toDistance - fromDistance;

    return run > 0 ? (rise / run) * 100 : 0;
  }

  // Calculate weighted average grade across the segment
  let totalWeightedGrade = 0;
  let totalDistance = 0;

  for (let i = 0; i < segmentPoints.length - 1; i++) {
    const currentPoint = segmentPoints[i];
    const nextPoint = segmentPoints[i + 1];

    if (!currentPoint || !nextPoint) continue;

    const subSegmentDistance = nextPoint.distance - currentPoint.distance;
    const rise = nextPoint.elevation - currentPoint.elevation;
    const grade =
      subSegmentDistance > 0 ? (rise / subSegmentDistance) * 100 : 0;

    totalWeightedGrade += grade * subSegmentDistance;
    totalDistance += subSegmentDistance;
  }

  return totalDistance > 0 ? totalWeightedGrade / totalDistance : 0;
}

/**
 * Interpolate elevation at a specific distance
 */
function interpolateElevationAtDistance(
  targetDistance: number,
  elevationProfile: ElevationPoint[],
): number | null {
  if (elevationProfile.length === 0) return null;

  // Find the two points that bracket our target distance
  for (let i = 0; i < elevationProfile.length - 1; i++) {
    const currentPoint = elevationProfile[i];
    const nextPoint = elevationProfile[i + 1];

    if (!currentPoint || !nextPoint) continue;

    if (
      targetDistance >= currentPoint.distance &&
      targetDistance <= nextPoint.distance
    ) {
      // Interpolate elevation
      const ratio =
        (targetDistance - currentPoint.distance) /
        (nextPoint.distance - currentPoint.distance);
      return (
        currentPoint.elevation +
        ratio * (nextPoint.elevation - currentPoint.elevation)
      );
    }
  }

  // If outside range, return nearest point
  if (elevationProfile[0] && targetDistance <= elevationProfile[0].distance) {
    return elevationProfile[0].elevation;
  }

  const lastPoint = elevationProfile[elevationProfile.length - 1];
  return lastPoint ? lastPoint.elevation : null;
}

/**
 * Converts pace from seconds per km/mile to seconds per meter
 */
function getPacePerMeter(pace: number, paceUnit: string): number {
  if (paceUnit === "min_per_km") {
    return pace / 1000; // seconds per meter
  } else if (paceUnit === "min_per_mi") {
    return pace / 1609.344; // seconds per meter (1 mile = 1609.344 meters)
  }
  return pace / 1000; // default to km
}

/**
 * Gets the stoppage time for a specific waypoint
 */
function getWaypointStoppageTime(
  waypointId: string,
  waypointStoppageTimes: SelectWaypointStoppageTime[],
  defaultStoppageTime: number,
  waypoints: Array<{ id: string; order: number }>,
): number {
  const customStoppage = waypointStoppageTimes.find(
    (st) => st.waypointId === waypointId,
  );

  if (customStoppage) {
    return customStoppage.stoppageTime;
  }

  // Don't apply default stoppage time to start and finish waypoints
  const waypoint = waypoints.find((w) => w.id === waypointId);
  if (!waypoint) return 0;

  // Start waypoint (order 0) gets no default stoppage time
  if (waypoint.order === 0) return 0;

  // Finish waypoint (highest order) gets no default stoppage time
  const maxOrder = Math.max(...waypoints.map((w) => w.order));
  if (waypoint.order === maxOrder && waypoint.order > 0) return 0;

  // Only intermediate waypoints get default stoppage time
  return defaultStoppageTime;
}

/**
 * Calculate grade-adjusted elapsed time to reach a specific waypoint
 * This implements the first phase of the optimization algorithm by incorporating
 * grade effects into segment-by-segment pace calculations
 */
export function calculateGradeAdjustedElapsedTime(
  targetWaypointId: string,
  options: GradeAdjustedTimeCalculationOptions,
): number {
  const {
    plan,
    waypoints,
    waypointStoppageTimes,
    elevationProfile,
    waypointSegments,
    getDefaultStoppageTime,
  } = options;

  if (!plan.pace || elevationProfile.length === 0) {
    // Fall back to simple calculation if no pace or elevation data
    return 0;
  }

  const basePacePerMeter = getPacePerMeter(plan.pace, plan.paceUnit);
  const defaultStoppageTime = getDefaultStoppageTime();

  // Find the target waypoint
  const targetIndex = waypoints.findIndex((w) => w.id === targetWaypointId);
  if (targetIndex === -1) {
    return 0;
  }

  let totalTravelTime = 0;
  let totalStoppageTime = 0;

  // Calculate cumulative time segment by segment up to the target waypoint
  for (let i = 0; i <= targetIndex; i++) {
    const waypoint = waypoints[i];
    if (!waypoint) continue;

    // Add stoppage time for this waypoint
    const stoppageTime = getWaypointStoppageTime(
      waypoint.id,
      waypointStoppageTimes,
      defaultStoppageTime,
      waypoints,
    );
    totalStoppageTime += stoppageTime;

    // Calculate travel time for the segment leading to this waypoint
    if (i > 0) {
      const prevWaypoint = waypoints[i - 1];
      if (!prevWaypoint) continue;

      // Find the corresponding segment
      const segment = waypointSegments.find(
        (seg) =>
          seg.fromWaypoint === prevWaypoint.id &&
          seg.toWaypoint === waypoint.id,
      );

      if (segment) {
        // Calculate average grade for this segment
        const averageGrade = calculateSegmentAverageGrade(
          prevWaypoint.distance,
          waypoint.distance,
          elevationProfile,
        );

        // Apply grade adjustment to pace
        const gradeAdjustmentFactor =
          calculateGradeAdjustmentFactor(averageGrade);
        const adjustedPacePerMeter = basePacePerMeter * gradeAdjustmentFactor;

        // Calculate travel time for this segment
        const segmentTravelTime = segment.distance * adjustedPacePerMeter;
        totalTravelTime += segmentTravelTime;
      } else {
        // Fall back to simple distance calculation if segment not found
        const segmentDistance = waypoint.distance - prevWaypoint.distance;
        totalTravelTime += segmentDistance * basePacePerMeter;
      }
    }
  }

  return Math.round(totalTravelTime + totalStoppageTime);
}

/**
 * Calculate grade-adjusted elapsed times for all waypoints
 */
export function calculateAllGradeAdjustedElapsedTimes(
  options: GradeAdjustedTimeCalculationOptions,
): Record<string, number> {
  const {
    plan,
    waypoints,
    waypointSegments = [],
    elevationProfile = [],
    waypointStoppageTimes,
    getDefaultStoppageTime,
  } = options;

  const result: Record<string, number> = {};

  // Fallback to existing per-waypoint calculation if data is insufficient
  if (
    !plan?.pace ||
    !waypoints?.length ||
    !waypointSegments?.length ||
    !elevationProfile?.length
  ) {
    waypoints.forEach((waypoint) => {
      result[waypoint.id] = calculateGradeAdjustedElapsedTime(
        waypoint.id,
        options,
      );
    });
    return result;
  }

  const basePacePerMeter = getPacePerMeter(plan.pace, plan.paceUnit);

  // Compute normalization scale S = totalDistance / Σ(Li × Fi)
  const totalDistance = waypointSegments.reduce(
    (acc, seg) => acc + seg.distance,
    0,
  );

  // Integral method for equivalent factors with smoothing
  // If sampleStepMeters is 0, treat as default (50)
  const sampleStep =
    options.sampleStepMeters === 0
      ? 50
      : Math.max(1, options.sampleStepMeters ?? 50); // meters
  // If gradeWindowMeters is 0, use 0 for raw grade calculation
  const gradeWindow = options.gradeWindowMeters ?? 100; // meters
  const segmentFactorMap = new Map<string, number>(); // key: "from->to" => meanFactor
  let equivalentDistanceSum = 0;
  for (const seg of waypointSegments) {
    const fromWp = waypoints.find((w) => w.id === seg.fromWaypoint);
    const toWp = waypoints.find((w) => w.id === seg.toWaypoint);
    if (!fromWp || !toWp) continue;

    const start = Math.min(fromWp.distance, toWp.distance);
    const end = Math.max(fromWp.distance, toWp.distance);

    let weightedFactorSum = 0;
    let pos = start;
    while (pos < end) {
      const next = Math.min(pos + sampleStep, end);
      const mid = (pos + next) / 2;
      const grade = calculateGradeAtDistance(
        elevationProfile,
        mid,
        gradeWindow,
      );
      const factor = calculateGradeAdjustmentFactor(grade);
      const dL = next - pos;
      weightedFactorSum += factor * dL;
      pos = next;
    }

    const meanFactor =
      seg.distance > 0 ? weightedFactorSum / seg.distance : 1.0;
    segmentFactorMap.set(`${seg.fromWaypoint}->${seg.toWaypoint}`, meanFactor);
    // Sum of f(g)*ΔL equals Li * Fi (equivalent distance contribution)
    equivalentDistanceSum += weightedFactorSum;
  }

  const normalizationScale =
    equivalentDistanceSum > 0 ? totalDistance / equivalentDistanceSum : 1.0;

  const defaultStoppageTime = getDefaultStoppageTime();
  let cumulativeElapsed = 0;

  // Ensure correct sequence
  const sorted = [...waypoints].sort((a, b) => a.order - b.order);

  for (let i = 0; i < sorted.length; i++) {
    const wp = sorted[i];
    if (!wp) continue;

    // Add stoppage time at this waypoint (start/finish handled inside helper)
    cumulativeElapsed += getWaypointStoppageTime(
      wp.id,
      waypointStoppageTimes,
      defaultStoppageTime,
      waypoints,
    );

    // Add travel time for the segment leading to this waypoint
    if (i > 0) {
      const prev = sorted[i - 1];
      if (!prev) continue;
      const seg = waypointSegments.find(
        (s) => s.fromWaypoint === prev.id && s.toWaypoint === wp.id,
      );

      if (seg) {
        const key = `${prev.id}->${wp.id}`;
        const meanFactor = segmentFactorMap.get(key) ?? 1.0;
        const adjustedPacePerMeter =
          basePacePerMeter * meanFactor * normalizationScale;
        cumulativeElapsed += seg.distance * adjustedPacePerMeter;
      } else {
        // Fallback: simple distance if segment missing
        const dist = Math.max(0, wp.distance - prev.distance);
        cumulativeElapsed += dist * basePacePerMeter * normalizationScale;
      }
    }

    result[wp.id] = Math.round(cumulativeElapsed);
  }

  return result;
}

/**
 * Calculate the grade adjustment factor for a specific segment
 * Useful for UI display and understanding pace adjustments
 */
export function getSegmentGradeAdjustment(
  fromWaypointId: string,
  toWaypointId: string,
  options: GradeAdjustedTimeCalculationOptions,
): {
  averageGrade: number;
  adjustmentFactor: number;
  adjustedPace: number; // in same units as plan.pace
  paceAdjustment: number; // difference from base pace
} {
  const { plan, waypoints, elevationProfile, waypointSegments } = options;

  const fromWaypoint = waypoints.find((w) => w.id === fromWaypointId);
  const toWaypoint = waypoints.find((w) => w.id === toWaypointId);

  if (!fromWaypoint || !toWaypoint || !plan.pace) {
    return {
      averageGrade: 0,
      adjustmentFactor: 1.0,
      adjustedPace: plan.pace || 0,
      paceAdjustment: 0,
    };
  }

  const averageGrade = calculateSegmentAverageGrade(
    fromWaypoint.distance,
    toWaypoint.distance,
    elevationProfile,
  );

  // Use integral mean factor for this specific segment to respect nonlinearity
  // If sampleStepMeters is 0, treat as default (50)
  const sampleStep =
    options.sampleStepMeters === 0
      ? 50
      : Math.max(1, options.sampleStepMeters ?? 50); // meters
  // If gradeWindowMeters is 0, use 0 for raw grade calculation
  const gradeWindow = options.gradeWindowMeters ?? 100; // meters
  const segStart = Math.min(fromWaypoint.distance, toWaypoint.distance);
  const segEnd = Math.max(fromWaypoint.distance, toWaypoint.distance);
  let weightedFactorSumSeg = 0;
  let posSeg = segStart;
  while (posSeg < segEnd) {
    const next = Math.min(posSeg + sampleStep, segEnd);
    const mid = (posSeg + next) / 2;
    const g = calculateGradeAtDistance(elevationProfile, mid, gradeWindow);
    const f = calculateGradeAdjustmentFactor(g);
    weightedFactorSumSeg += f * (next - posSeg);
    posSeg = next;
  }
  const adjustmentFactor =
    segEnd - segStart > 0 ? weightedFactorSumSeg / (segEnd - segStart) : 1.0;

  // Compute normalization scale S = totalDistance / Σ(Li × Fi)
  const totalDistance = waypointSegments.reduce(
    (acc: number, seg: WaypointSegment) => acc + seg.distance,
    0,
  );
  let equivalentDistanceSum = 0;
  for (const seg of waypointSegments) {
    const segFrom = waypoints.find((w) => w.id === seg.fromWaypoint);
    const segTo = waypoints.find((w) => w.id === seg.toWaypoint);
    if (!segFrom || !segTo) continue;

    const segStartAll = Math.min(segFrom.distance, segTo.distance);
    const segEndAll = Math.max(segFrom.distance, segTo.distance);

    // Integrate f(grade) over this segment with smoothing window
    let weightedFactorSum = 0;
    let p = segStartAll;
    while (p < segEndAll) {
      const n = Math.min(p + sampleStep, segEndAll);
      const m = (p + n) / 2;
      const g = calculateGradeAtDistance(elevationProfile, m, gradeWindow);
      const f = calculateGradeAdjustmentFactor(g);
      weightedFactorSum += f * (n - p);
      p = n;
    }

    // Contribution to Σ f(g)*ΔL (equivalent distance)
    equivalentDistanceSum += weightedFactorSum;
  }
  const normalizationScale =
    equivalentDistanceSum > 0 ? totalDistance / equivalentDistanceSum : 1.0;

  // Normalized adjusted pace for this segment
  const adjustedPace = plan.pace * adjustmentFactor * normalizationScale;
  const paceAdjustment = adjustedPace - plan.pace;

  return {
    averageGrade,
    adjustmentFactor,
    adjustedPace,
    paceAdjustment,
  };
}

/**
 * Calculate what the overall finish time would be with grade adjustments
 * while maintaining the target average pace for flat equivalent effort
 */
export function calculateGradeAdjustedFinishTime(
  options: GradeAdjustedTimeCalculationOptions,
): {
  originalFinishTime: number;
  gradeAdjustedFinishTime: number;
  timeDifference: number;
  averageGradeAdjustmentFactor: number;
} {
  const { plan, waypoints, elevationProfile: _elevationProfile } = options;

  if (!plan.pace || waypoints.length === 0) {
    return {
      originalFinishTime: 0,
      gradeAdjustedFinishTime: 0,
      timeDifference: 0,
      averageGradeAdjustmentFactor: 1.0,
    };
  }

  const finishWaypoint = waypoints[waypoints.length - 1];
  if (!finishWaypoint) {
    return {
      originalFinishTime: 0,
      gradeAdjustedFinishTime: 0,
      timeDifference: 0,
      averageGradeAdjustmentFactor: 1.0,
    };
  }

  // Calculate original finish time (simple distance/pace)
  const basePacePerMeter = getPacePerMeter(plan.pace, plan.paceUnit);
  const originalFinishTime = finishWaypoint.distance * basePacePerMeter;

  // Calculate grade-adjusted finish time
  const gradeAdjustedTimes = calculateAllGradeAdjustedElapsedTimes(options);
  const gradeAdjustedFinishTime = gradeAdjustedTimes[finishWaypoint.id] || 0;

  // Remove stoppage time from both calculations for fair comparison
  const defaultStoppageTime = options.getDefaultStoppageTime();
  let totalStoppageTime = 0;

  waypoints.forEach((waypoint) => {
    const stoppageTime = getWaypointStoppageTime(
      waypoint.id,
      options.waypointStoppageTimes,
      defaultStoppageTime,
      waypoints,
    );
    totalStoppageTime += stoppageTime;
  });

  const originalTravelTime = originalFinishTime;
  const gradeAdjustedTravelTime = gradeAdjustedFinishTime - totalStoppageTime;

  const timeDifference = gradeAdjustedTravelTime - originalTravelTime;
  const averageGradeAdjustmentFactor =
    originalTravelTime > 0 ? gradeAdjustedTravelTime / originalTravelTime : 1.0;

  return {
    originalFinishTime: originalFinishTime + totalStoppageTime,
    gradeAdjustedFinishTime,
    timeDifference,
    averageGradeAdjustmentFactor,
  };
}

/**
 * Format grade as a human-readable string
 */
export function formatGrade(grade: number): string {
  const absGrade = Math.abs(grade);
  const direction = grade >= 0 ? "uphill" : "downhill";

  if (absGrade < 0.5) {
    return "flat";
  }

  return `${absGrade.toFixed(1)}% ${direction}`;
}

/**
 * Format pace adjustment in a human-readable way
 */
export function formatPaceAdjustment(
  paceAdjustment: number,
  paceUnit: string,
): string {
  const absPaceAdjustment = Math.abs(paceAdjustment);

  if (absPaceAdjustment < 1) {
    return "no adjustment";
  }

  const direction = paceAdjustment > 0 ? "slower" : "faster";
  const minutes = Math.floor(absPaceAdjustment / 60);
  const seconds = Math.round(absPaceAdjustment % 60);

  let timeString = "";
  if (minutes > 0) {
    timeString += `${minutes}:${seconds.toString().padStart(2, "0")}`;
  } else {
    timeString = `${seconds}s`;
  }

  const unitString = paceUnit === "min_per_mi" ? "mile" : "km";

  return `${timeString} ${direction} per ${unitString}`;
}

/**
 * Get comprehensive segment pacing information for display
 */
export function getSegmentPacingInfo(
  fromWaypointId: string,
  toWaypointId: string,
  options: GradeAdjustedTimeCalculationOptions,
): {
  averageGrade: number;
  gradeDescription: string;
  adjustmentFactor: number;
  basePace: number;
  adjustedPace: number;
  paceAdjustmentDescription: string;
  estimatedTimeMinutes: number;
  segmentDistance: number;
} | null {
  const { plan, waypoints, waypointSegments } = options;

  const fromWaypoint = waypoints.find((w) => w.id === fromWaypointId);
  const toWaypoint = waypoints.find((w) => w.id === toWaypointId);

  if (!fromWaypoint || !toWaypoint || !plan.pace) {
    return null;
  }

  // Find the segment
  const segment = waypointSegments.find(
    (seg) =>
      seg.fromWaypoint === fromWaypointId && seg.toWaypoint === toWaypointId,
  );

  if (!segment) {
    return null;
  }

  const gradeInfo = getSegmentGradeAdjustment(
    fromWaypointId,
    toWaypointId,
    options,
  );

  // Calculate estimated time
  const adjustedPacePerMeter = getPacePerMeter(
    gradeInfo.adjustedPace,
    plan.paceUnit,
  );
  const estimatedTimeSeconds = segment.distance * adjustedPacePerMeter;

  return {
    averageGrade: gradeInfo.averageGrade,
    gradeDescription: formatGrade(gradeInfo.averageGrade),
    adjustmentFactor: gradeInfo.adjustmentFactor,
    basePace: plan.pace,
    adjustedPace: gradeInfo.adjustedPace,
    paceAdjustmentDescription: formatPaceAdjustment(
      gradeInfo.paceAdjustment,
      plan.paceUnit,
    ),
    estimatedTimeMinutes: estimatedTimeSeconds / 60,
    segmentDistance: segment.distance,
  };
}
