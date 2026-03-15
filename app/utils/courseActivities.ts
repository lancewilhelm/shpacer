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
  splits: CourseActivitySplitComparison[];
}

export interface CourseActivitiesResponse {
  activities: SelectCourseActivity[];
  primaryActivityId: string | null;
}

export function getCourseActivityMatchData(
  activity: Pick<SelectCourseActivity, "matchData">,
): CourseActivityMatchData {
  return activity.matchData as CourseActivityMatchData;
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
