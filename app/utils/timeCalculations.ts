import type { SelectPlan, SelectWaypointStoppageTime } from "~/utils/db/schema";
import type { ElevationPoint } from "~/utils/elevationProfile";
import type { WaypointSegment } from "~/utils/waypointSegments";
import {
  calculateGradeAdjustedElapsedTime,
  calculateAllGradeAdjustedElapsedTimes,
  type GradeAdjustedTimeCalculationOptions,
} from "~/utils/gradeAdjustedTimeCalculations";

export interface TimeCalculationOptions {
  plan: SelectPlan;
  waypoints: Array<{ id: string; distance: number; order: number }>;
  waypointStoppageTimes: SelectWaypointStoppageTime[];
  getDefaultStoppageTime: () => number;
  // Optional parameters for grade-adjusted calculations
  elevationProfile?: ElevationPoint[];
  waypointSegments?: WaypointSegment[];
  useGradeAdjustment?: boolean;
  gradeWindowMeters?: number;
  sampleStepMeters?: number;
  maintainTargetAverage?: boolean;
}

/**
 * Formats time in seconds to HH:MM:SS format
 */
export function formatElapsedTime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
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
 * Calculates the elapsed time to reach a specific waypoint
 */
export function calculateElapsedTimeToWaypoint(
  targetWaypointId: string,
  options: TimeCalculationOptions,
): number {
  const {
    plan,
    waypoints,
    waypointStoppageTimes,
    getDefaultStoppageTime,
    elevationProfile,
    waypointSegments,
    useGradeAdjustment,
  } = options;

  if (!plan.pace) {
    return 0;
  }

  // Use grade-adjusted pipeline when data is available (apply grade only if enabled)
  if (elevationProfile && waypointSegments) {
    const gradeAdjustedOptions: GradeAdjustedTimeCalculationOptions = {
      plan,
      waypoints,
      waypointStoppageTimes,
      elevationProfile,
      waypointSegments,
      getDefaultStoppageTime,
      gradeWindowMeters: options.gradeWindowMeters,
      sampleStepMeters: options.sampleStepMeters,
      useGradeAdjustment: useGradeAdjustment !== false,
      maintainTargetAverage: options.maintainTargetAverage,
    };
    return calculateGradeAdjustedElapsedTime(
      targetWaypointId,
      gradeAdjustedOptions,
    );
  }

  // Fall back to simple calculation
  const pacePerMeter = getPacePerMeter(plan.pace, plan.paceUnit);
  const defaultStoppageTime = getDefaultStoppageTime();

  // Find the target waypoint index
  const targetIndex = waypoints.findIndex((w) => w.id === targetWaypointId);
  if (targetIndex === -1) {
    return 0;
  }

  const targetWaypoint = waypoints[targetIndex];
  if (!targetWaypoint) {
    return 0;
  }

  // Calculate travel time based on distance and pace
  const travelTime = targetWaypoint.distance * pacePerMeter;

  // Calculate total stoppage time for all waypoints up to and including the target
  let totalStoppageTime = 0;
  for (let i = 0; i <= targetIndex; i++) {
    const waypoint = waypoints[i];
    if (waypoint) {
      const stoppageTime = getWaypointStoppageTime(
        waypoint.id,
        waypointStoppageTimes,
        defaultStoppageTime,
        waypoints,
      );
      totalStoppageTime += stoppageTime;
    }
  }

  return Math.round(travelTime + totalStoppageTime);
}

/**
 * Calculates elapsed times for all waypoints
 */
export function calculateAllElapsedTimes(
  options: TimeCalculationOptions,
): Record<string, number> {
  const { waypoints, elevationProfile, waypointSegments } = options;

  // Use grade-adjusted pipeline when data is available (apply grade only if enabled)
  if (elevationProfile && waypointSegments) {
    const gradeAdjustedOptions: GradeAdjustedTimeCalculationOptions = {
      plan: options.plan,
      waypoints: options.waypoints,
      waypointStoppageTimes: options.waypointStoppageTimes,
      elevationProfile,
      waypointSegments,
      getDefaultStoppageTime: options.getDefaultStoppageTime,
      gradeWindowMeters: options.gradeWindowMeters,
      sampleStepMeters: options.sampleStepMeters,
      useGradeAdjustment: options.useGradeAdjustment !== false,
      maintainTargetAverage: options.maintainTargetAverage,
    };
    return calculateAllGradeAdjustedElapsedTimes(gradeAdjustedOptions);
  }

  // Fall back to simple calculation
  const result: Record<string, number> = {};

  waypoints.forEach((waypoint) => {
    result[waypoint.id] = calculateElapsedTimeToWaypoint(waypoint.id, options);
  });

  return result;
}

/**
 * Gets the delay (stoppage time) for a specific waypoint
 */
export function getWaypointDelay(
  waypointId: string,
  waypointStoppageTimes: SelectWaypointStoppageTime[],
  defaultStoppageTime: number,
  waypoints: Array<{ id: string; order: number }>,
): number {
  return getWaypointStoppageTime(
    waypointId,
    waypointStoppageTimes,
    defaultStoppageTime,
    waypoints,
  );
}

/**
 * Formats delay time in a human-readable format
 */
export function formatDelayTime(seconds: number): string {
  if (seconds === 0) {
    return "No delay";
  }

  if (seconds < 60) {
    return `${seconds}s`;
  }

  if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (remainingSeconds === 0) {
      return `${minutes}m`;
    }
    return `${minutes}m ${remainingSeconds}s`;
  }

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;

  let result = `${hours}h`;
  if (minutes > 0) {
    result += ` ${minutes}m`;
  }
  if (remainingSeconds > 0) {
    result += ` ${remainingSeconds}s`;
  }

  return result;
}
