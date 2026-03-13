import type { SelectPlan, SelectWaypointStoppageTime } from '~/utils/db/schema';
import type { ElevationPoint } from '~/utils/elevationProfile';
import {
  calculateAllElapsedTimes,
  getWaypointDelay,
} from '~/utils/timeCalculations';
import { getSegmentPacingInfo } from '~/utils/gradeAdjustedTimeCalculations';
import {
  calculateWaypointSegments,
  getSegmentAfterWaypoint,
} from '~/utils/waypointSegments';

export interface PlanExportWaypoint {
  id: string;
  name: string;
  distance: number;
  elevation: number | null;
  tags: string[];
  order: number;
}

export interface PlanWaypointExportRow {
  waypointId: string;
  waypointName: string;
  distanceFromStartMeters: number;
  waypointElevationMeters: number | null;
  elapsedTimeSeconds: number | null;
  delaySeconds: number | null;
  distanceToNextMeters: number | null;
  timeToNextSeconds: number | null;
  elevationGainToNextMeters: number | null;
  elevationLossToNextMeters: number | null;
  segmentAdjustedPace: number | null;
  segmentAverageGrade: number | null;
  tagIds: string[];
}

interface BuildPlanWaypointExportRowsOptions {
  plan: SelectPlan | null;
  waypoints: PlanExportWaypoint[];
  waypointStoppageTimes: SelectWaypointStoppageTime[];
  getDefaultStoppageTime: () => number;
  elevationProfile?: ElevationPoint[];
  useGradeAdjustment?: boolean;
  gradeWindowMeters?: number;
  sampleStepMeters?: number;
  maintainTargetAverage?: boolean;
}

export function buildPlanWaypointExportRows(
  options: BuildPlanWaypointExportRowsOptions,
): PlanWaypointExportRow[] {
  const sortedWaypoints = [...options.waypoints].sort((a, b) => a.order - b.order);
  const segments = calculateWaypointSegments(
    sortedWaypoints,
    options.elevationProfile,
  );

  const elapsedTimes =
    options.plan?.pace && sortedWaypoints.length
      ? calculateAllElapsedTimes({
          plan: options.plan,
          waypoints: sortedWaypoints,
          waypointStoppageTimes: options.waypointStoppageTimes,
          getDefaultStoppageTime: options.getDefaultStoppageTime,
          elevationProfile: options.elevationProfile,
          waypointSegments: segments,
          useGradeAdjustment: options.useGradeAdjustment,
          gradeWindowMeters: options.gradeWindowMeters,
          sampleStepMeters: options.sampleStepMeters,
          maintainTargetAverage: options.maintainTargetAverage,
        })
      : {};

  return sortedWaypoints.map((waypoint, index) => {
    const nextWaypoint = sortedWaypoints[index + 1] || null;
    const nextSegment = getSegmentAfterWaypoint(waypoint.id, segments);
    const elapsedTime = elapsedTimes[waypoint.id];
    const delaySeconds = getWaypointDelay(
      waypoint.id,
      options.waypointStoppageTimes,
      options.getDefaultStoppageTime(),
      sortedWaypoints,
    );

    const segmentPacingInfo =
      nextWaypoint && options.plan && options.elevationProfile?.length
        ? getSegmentPacingInfo(waypoint.id, nextWaypoint.id, {
            plan: options.plan,
            waypoints: sortedWaypoints,
            waypointStoppageTimes: options.waypointStoppageTimes,
            elevationProfile: options.elevationProfile,
            waypointSegments: segments,
            useGradeAdjustment: options.useGradeAdjustment,
            getDefaultStoppageTime: options.getDefaultStoppageTime,
            gradeWindowMeters: options.gradeWindowMeters,
            sampleStepMeters: options.sampleStepMeters,
            maintainTargetAverage: options.maintainTargetAverage,
          })
        : null;

    let timeToNextSeconds: number | null = null;
    if (nextWaypoint) {
      const currentElapsed = elapsedTimes[waypoint.id];
      const nextElapsed = elapsedTimes[nextWaypoint.id];
      if (typeof currentElapsed === 'number' && typeof nextElapsed === 'number') {
        timeToNextSeconds =
          nextElapsed -
          currentElapsed -
          getWaypointDelay(
            nextWaypoint.id,
            options.waypointStoppageTimes,
            options.getDefaultStoppageTime(),
            sortedWaypoints,
          );
      }
    }

    return {
      waypointId: waypoint.id,
      waypointName: waypoint.name,
      distanceFromStartMeters: waypoint.distance,
      waypointElevationMeters: waypoint.elevation,
      elapsedTimeSeconds: typeof elapsedTime === 'number' ? elapsedTime : null,
      delaySeconds: delaySeconds > 0 ? delaySeconds : null,
      distanceToNextMeters: nextSegment?.distance ?? null,
      timeToNextSeconds:
        typeof timeToNextSeconds === 'number' && timeToNextSeconds > 0
          ? Math.round(timeToNextSeconds)
          : null,
      elevationGainToNextMeters: nextSegment?.elevationGain ?? null,
      elevationLossToNextMeters: nextSegment?.elevationLoss ?? null,
      segmentAdjustedPace: segmentPacingInfo?.adjustedPace ?? null,
      segmentAverageGrade: segmentPacingInfo?.averageGrade ?? null,
      tagIds: waypoint.tags,
    };
  });
}
