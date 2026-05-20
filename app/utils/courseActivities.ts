import type { SelectCourseActivity } from "~/utils/db/schema";

export type CourseActivityFileType = "gpx" | "tcx";
export type CourseActivityProvider = "strava" | "garmin" | "unknown";
export type CourseActivityMatchStatus = "matched" | "partial" | "failed";

export interface ParsedActivityPoint {
  lat: number;
  lng: number;
  elevation: number | null;
  timestamp: string;
}

export interface CourseActivityMatchSample {
  distanceMeters: number;
  elapsedSeconds: number;
  lat: number;
  lng: number;
  elevation: number | null;
  rawLat: number;
  rawLng: number;
  lateralErrorMeters: number;
  accepted: boolean;
  timestamp: string;
}

export interface CourseActivityMatchData {
  samples: CourseActivityMatchSample[];
  totalPoints: number;
  sampledPoints: number;
  acceptedPoints: number;
  coverageRatio: number;
  endProgressRatio: number;
  diagnostics: string[];
}

export interface CourseActivityPlanSummary {
  planId: string;
  planName: string;
  plannedElapsedSeconds: number | null;
  actualElapsedSeconds: number | null;
  deltaSeconds: number | null;
  targetLabel: string | null;
  recordedDistanceMeters: number | null;
  matchedDistanceMeters: number | null;
  matchStatus: CourseActivityMatchStatus;
  matchConfidence: number;
  coverageRatio: number;
  closestFitScore: number | null;
}

export interface CourseActivityWaypointComparison {
  waypointId: string;
  plannedElapsedSeconds: number | null;
  actualElapsedSeconds: number | null;
  deltaSeconds: number | null;
}

export interface CourseActivitySegmentComparison {
  fromWaypointId: string;
  toWaypointId: string;
  plannedSegmentSeconds: number | null;
  actualSegmentSeconds: number | null;
  segmentDeltaSeconds: number | null;
}

export interface CourseActivitySplitComparison {
  index: number;
  startMeters: number;
  endMeters: number;
  plannedElapsedSeconds: number | null;
  actualElapsedSeconds: number | null;
  plannedSplitSeconds: number | null;
  actualSplitSeconds: number | null;
  deltaSeconds: number | null;
  actualPaceSecondsPerUnit: number | null;
}

export interface CourseActivityPlanDetail {
  activityId: string;
  planId: string;
  planName: string;
  matchStatus: CourseActivityMatchStatus;
  matchConfidence: number;
  coverageRatio: number;
  recordedDistanceMeters: number | null;
  matchedDistanceMeters: number | null;
  plannedElapsedSeconds: number | null;
  actualElapsedSeconds: number | null;
  deltaSeconds: number | null;
  targetLabel: string | null;
  waypoints: CourseActivityWaypointComparison[];
  segments: CourseActivitySegmentComparison[];
  splits: CourseActivitySplitComparison[];
}

export interface CourseActivitySummary {
  id: string;
  sourceFileName: string;
  provider: CourseActivityProvider;
  startedAt: Date | null;
  endedAt: Date | null;
  elapsedTimeSeconds: number | null;
  recordedDistanceMeters: number | null;
  matchedDistanceMeters: number | null;
  matchStatus: CourseActivityMatchStatus;
  matchConfidence: number;
  isPrimary: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type CourseActivityDetail = SelectCourseActivity;

export interface CourseActivitiesResponse {
  activities: CourseActivitySummary[];
}

export interface CourseActivityDetailResponse {
  activity: CourseActivityDetail;
}

export function getCourseActivityMatchData(
  activity: Pick<CourseActivityDetail, "matchData">,
): CourseActivityMatchData {
  return activity.matchData as CourseActivityMatchData;
}

export interface CourseActivityElapsedSeries {
  distances: number[];
  elapsedSeconds: number[];
}

const INITIAL_PROGRESS_TOLERANCE_METERS = 500;
const MAX_FORWARD_PROGRESS_SPEED_METERS_PER_SECOND = 8;
const MAX_FORWARD_PROGRESS_BUFFER_METERS = 75;

export function buildCourseActivityElapsedSeries(
  matchData: CourseActivityMatchData,
): CourseActivityElapsedSeries | null {
  if (!matchData.samples.length) {
    return null;
  }

  const distances: number[] = [];
  const elapsedSeconds: number[] = [];

  for (const sample of matchData.samples) {
    if (
      !Number.isFinite(sample.distanceMeters) ||
      !Number.isFinite(sample.elapsedSeconds)
    ) {
      continue;
    }

    const lastDistance = distances[distances.length - 1];
    const lastElapsed = elapsedSeconds[elapsedSeconds.length - 1];
    const elapsedDelta =
      lastElapsed === undefined ? 0 : Math.max(0, sample.elapsedSeconds - lastElapsed);
    const maxForwardProgressMeters =
      lastDistance === undefined
        ? INITIAL_PROGRESS_TOLERANCE_METERS
        : Math.max(
            10,
            elapsedDelta * MAX_FORWARD_PROGRESS_SPEED_METERS_PER_SECOND +
              MAX_FORWARD_PROGRESS_BUFFER_METERS,
          );

    if (
      lastDistance !== undefined &&
      sample.distanceMeters - lastDistance > maxForwardProgressMeters
    ) {
      continue;
    }

    if (lastDistance !== undefined && sample.distanceMeters < lastDistance) {
      continue;
    }

    if (lastDistance !== undefined && sample.distanceMeters === lastDistance) {
      elapsedSeconds[elapsedSeconds.length - 1] = Math.max(
        elapsedSeconds[elapsedSeconds.length - 1] ?? 0,
        sample.elapsedSeconds,
      );
      continue;
    }

    distances.push(sample.distanceMeters);
    elapsedSeconds.push(sample.elapsedSeconds);
  }

  return distances.length ? { distances, elapsedSeconds } : null;
}

export function interpolateElapsedSeriesAtDistance(
  series: CourseActivityElapsedSeries,
  distanceMeters: number,
): number | null {
  const { distances, elapsedSeconds } = series;
  if (!distances.length) return null;
  if (distanceMeters <= distances[0]!) {
    return elapsedSeconds[0]!;
  }

  for (let i = 1; i < distances.length; i++) {
    const previousDistance = distances[i - 1]!;
    const currentDistance = distances[i]!;
    if (distanceMeters > currentDistance) continue;

    const previousElapsed = elapsedSeconds[i - 1]!;
    const currentElapsed = elapsedSeconds[i]!;
    const span = currentDistance - previousDistance;
    if (span <= 0) return currentElapsed;

    const ratio = (distanceMeters - previousDistance) / span;
    return previousElapsed + ratio * (currentElapsed - previousElapsed);
  }

  const lastDistance = distances[distances.length - 1]!;
  if (distanceMeters <= lastDistance + 1) {
    return elapsedSeconds[elapsedSeconds.length - 1]!;
  }

  return null;
}

export function getCourseActivityElapsedAtDistance(
  matchData: CourseActivityMatchData,
  distanceMeters: number,
): number | null {
  const series = buildCourseActivityElapsedSeries(matchData);
  if (!series) return null;
  return interpolateElapsedSeriesAtDistance(series, distanceMeters);
}

export function formatSignedDuration(deltaSeconds: number | null): string {
  if (deltaSeconds === null || !Number.isFinite(deltaSeconds)) {
    return "—";
  }

  const sign = deltaSeconds > 0 ? "+" : deltaSeconds < 0 ? "-" : "";
  const abs = Math.abs(Math.round(deltaSeconds));
  const hours = Math.floor(abs / 3600);
  const minutes = Math.floor((abs % 3600) / 60);
  const seconds = abs % 60;

  return `${sign}${hours.toString().padStart(2, "0")}:${minutes
    .toString()
    .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}
