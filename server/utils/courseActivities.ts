import {
  DOMParser,
  type Document as XmlDocument,
  type Element as XmlElement,
  type Node as XmlNode,
} from "@xmldom/xmldom";
import * as toGeoJSON from "@tmcw/togeojson";
import type {
  SelectCourseActivity,
  SelectPlan,
  SelectWaypoint,
  SelectWaypointStoppageTime,
} from "~/utils/db/schema";
import {
  type CourseActivityFileType,
  type CourseActivityMatchData,
  type CourseActivityPlanDetail,
  type CourseActivityPlanSummary,
  type CourseActivityProvider,
  getCourseActivityMatchData,
  type ParsedActivityPoint,
} from "~/utils/courseActivities";
import { calculateDistance } from "~/utils/distance";
import {
  buildOverlapIndexForGeoJsonTracks,
  getTrackDistanceCandidatesForPoint,
} from "~/utils/routeOverlapIndex";
import { calculateAllElapsedTimes } from "~/utils/timeCalculations";
import { extractElevationProfile } from "~/utils/elevationProfile";
import { calculateWaypointSegments } from "~/utils/waypointSegments";
import { buildPlanSplitRows } from "~/utils/planSplits";

const ACTIVITY_SAMPLE_MIN_SECONDS = 5;
const ACTIVITY_SAMPLE_MIN_METERS = 10;
const MAX_PRIMARY_LATERAL_ERROR_METERS = 60;
const MAX_FALLBACK_LATERAL_ERROR_METERS = 100;
const MAX_BACKWARD_JITTER_METERS = 25;

type NumericWaypoint = Pick<SelectWaypoint, "id" | "distance" | "order"> & {
  elevation: number | null;
};

interface ParseActivityFileOptions {
  fileType: CourseActivityFileType;
  sourceFileName: string;
  originalFileContent: string;
}

interface ParsedActivityFile {
  provider: CourseActivityProvider;
  geoJsonData: GeoJSON.FeatureCollection;
  points: ParsedActivityPoint[];
  startedAt: Date | null;
  endedAt: Date | null;
  elapsedTimeSeconds: number | null;
  recordedDistanceMeters: number;
}

interface MatchActivityToCourseOptions {
  courseGeoJson: GeoJSON.FeatureCollection;
  points: ParsedActivityPoint[];
  courseDistanceMeters: number;
}

interface XmlParentLike {
  childNodes: {
    length: number;
    item(index: number): XmlNode | null;
  };
  getElementsByTagName(tag: string): {
    length: number;
    item(index: number): XmlElement | null;
  };
}

function isElement(node: XmlNode | null | undefined): node is XmlElement {
  return !!node && node.nodeType === 1;
}

function getChildElementsByLocalName(
  parent: XmlParentLike,
  localName: string,
): XmlElement[] {
  const results: XmlElement[] = [];
  for (let i = 0; i < parent.childNodes.length; i++) {
    const child = parent.childNodes.item(i);
    if (!isElement(child)) continue;
    if ((child.localName || child.nodeName) === localName) {
      results.push(child);
    }
  }
  return results;
}

function getDescendantElementsByLocalName(
  parent: XmlParentLike,
  localName: string,
): XmlElement[] {
  const results: XmlElement[] = [];
  const allElements = parent.getElementsByTagName("*");

  for (let i = 0; i < allElements.length; i++) {
    const element = allElements.item(i);
    if (!element) continue;
    if ((element.localName || element.nodeName) === localName) {
      results.push(element);
    }
  }

  return results;
}

function getFirstChildText(parent: XmlParentLike, localName: string): string | null {
  const child = getChildElementsByLocalName(parent, localName)[0];
  const value = child?.textContent?.trim();
  return value ? value : null;
}

function detectProvider(sourceHint: string): CourseActivityProvider {
  const haystack = sourceHint.toLowerCase();
  if (haystack.includes("strava")) return "strava";
  if (haystack.includes("garmin")) return "garmin";
  return "unknown";
}

function parseTimestamp(value: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function buildRecordedDistance(points: ParsedActivityPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!;
    const current = points[i]!;
    total += calculateDistance(prev.lat, prev.lng, current.lat, current.lng);
  }
  return Math.round(total);
}

function parseGpxPoints(doc: XmlDocument): ParsedActivityPoint[] {
  const trackPoints = getDescendantElementsByLocalName(
    doc as unknown as XmlParentLike,
    "trkpt",
  );
  const points: ParsedActivityPoint[] = [];

  for (const point of trackPoints) {
    const lat = Number.parseFloat(point.getAttribute("lat") || "");
    const lng = Number.parseFloat(point.getAttribute("lon") || "");
    const timestamp = getFirstChildText(
      point as unknown as XmlParentLike,
      "time",
    );
    const elevationValue = getFirstChildText(
      point as unknown as XmlParentLike,
      "ele",
    );
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !timestamp) continue;

    points.push({
      lat,
      lng,
      elevation:
        elevationValue && Number.isFinite(Number.parseFloat(elevationValue))
          ? Number.parseFloat(elevationValue)
          : null,
      timestamp,
    });
  }

  return points;
}

function parseTcxPoints(doc: XmlDocument): ParsedActivityPoint[] {
  const trackPoints = getDescendantElementsByLocalName(
    doc as unknown as XmlParentLike,
    "Trackpoint",
  );
  const points: ParsedActivityPoint[] = [];

  for (const point of trackPoints) {
    const position = getChildElementsByLocalName(
      point as unknown as XmlParentLike,
      "Position",
    )[0];
    const lat = Number.parseFloat(
      getFirstChildText(
        (position || point) as unknown as XmlParentLike,
        "LatitudeDegrees",
      ) || "",
    );
    const lng = Number.parseFloat(
      getFirstChildText(
        (position || point) as unknown as XmlParentLike,
        "LongitudeDegrees",
      ) || "",
    );
    const timestamp = getFirstChildText(
      point as unknown as XmlParentLike,
      "Time",
    );
    const elevationValue = getFirstChildText(
      point as unknown as XmlParentLike,
      "AltitudeMeters",
    );

    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !timestamp) continue;

    points.push({
      lat,
      lng,
      elevation:
        elevationValue && Number.isFinite(Number.parseFloat(elevationValue))
          ? Number.parseFloat(elevationValue)
          : null,
      timestamp,
    });
  }

  return points;
}

export function parseActivityFile(
  options: ParseActivityFileOptions,
): ParsedActivityFile {
  const doc = new DOMParser().parseFromString(
    options.originalFileContent,
    "text/xml",
  );
  const parserError = doc.getElementsByTagName("parsererror")[0];
  if (parserError) {
    throw createError({
      statusCode: 400,
      statusMessage: "Invalid XML file",
    });
  }

  const root = doc.documentElement;
  const sourceHint = [
    options.sourceFileName,
    root?.getAttribute("creator") || "",
    root?.getAttribute("xmlns") || "",
  ].join(" ");
  const browserDoc = doc as unknown as Document;

  const geoJsonData =
    options.fileType === "gpx"
      ? toGeoJSON.gpx(browserDoc)
      : toGeoJSON.tcx(browserDoc);
  const points =
    options.fileType === "gpx" ? parseGpxPoints(doc) : parseTcxPoints(doc);

  if (points.length < 2) {
    throw createError({
      statusCode: 400,
      statusMessage: "Activity file must include at least two timestamped trackpoints",
    });
  }

  const startedAt = parseTimestamp(points[0]?.timestamp || null);
  const endedAt = parseTimestamp(points[points.length - 1]?.timestamp || null);
  const elapsedTimeSeconds =
    startedAt && endedAt
      ? Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000))
      : null;

  return {
    provider: detectProvider(sourceHint),
    geoJsonData,
    points,
    startedAt,
    endedAt,
    elapsedTimeSeconds,
    recordedDistanceMeters: buildRecordedDistance(points),
  };
}

function downsampleActivityPoints(points: ParsedActivityPoint[]): ParsedActivityPoint[] {
  if (points.length <= 2) return points;

  const sampled: ParsedActivityPoint[] = [points[0]!];

  for (let i = 1; i < points.length - 1; i++) {
    const previous = sampled[sampled.length - 1]!;
    const current = points[i]!;
    const previousTime = parseTimestamp(previous.timestamp);
    const currentTime = parseTimestamp(current.timestamp);
    const secondsDelta =
      previousTime && currentTime
        ? Math.max(0, (currentTime.getTime() - previousTime.getTime()) / 1000)
        : 0;
    const distanceDelta = calculateDistance(
      previous.lat,
      previous.lng,
      current.lat,
      current.lng,
    );

    if (
      secondsDelta >= ACTIVITY_SAMPLE_MIN_SECONDS ||
      distanceDelta >= ACTIVITY_SAMPLE_MIN_METERS
    ) {
      sampled.push(current);
    }
  }

  sampled.push(points[points.length - 1]!);
  return sampled;
}

export function matchActivityToCourse(
  options: MatchActivityToCourseOptions,
): CourseActivityMatchData {
  const overlapIndex = buildOverlapIndexForGeoJsonTracks([options.courseGeoJson]);
  const sampledPoints = downsampleActivityPoints(options.points);
  const diagnostics: string[] = [];
  const samples: CourseActivityMatchData["samples"] = [];
  let acceptedPoints = 0;
  let lastAcceptedDistance = 0;
  const startTime = parseTimestamp(sampledPoints[0]?.timestamp || null);

  for (const point of sampledPoints) {
    const candidates = getTrackDistanceCandidatesForPoint(
      overlapIndex,
      point.lat,
      point.lng,
    );
    if (candidates.length === 0) {
      diagnostics.push(`No route candidate for ${point.timestamp}`);
      continue;
    }

    const viable = candidates.filter(
      (candidate) => candidate.pointerDistanceMeters <= MAX_FALLBACK_LATERAL_ERROR_METERS,
    );
    if (viable.length === 0) {
      diagnostics.push(`Point too far from route at ${point.timestamp}`);
      continue;
    }

    const chosen =
      viable
        .filter(
          (candidate) =>
            candidate.distance >= lastAcceptedDistance - MAX_BACKWARD_JITTER_METERS,
        )
        .sort((a, b) => {
          const aBackward = a.distance < lastAcceptedDistance ? lastAcceptedDistance - a.distance : 0;
          const bBackward = b.distance < lastAcceptedDistance ? lastAcceptedDistance - b.distance : 0;
          const aScore = a.pointerDistanceMeters + aBackward * 10 + Math.abs(a.distance - lastAcceptedDistance) * 0.02;
          const bScore = b.pointerDistanceMeters + bBackward * 10 + Math.abs(b.distance - lastAcceptedDistance) * 0.02;
          return aScore - bScore;
        })[0] || viable[0];

    if (!chosen) continue;

    const accepted =
      chosen.pointerDistanceMeters <= MAX_PRIMARY_LATERAL_ERROR_METERS ||
      chosen.distance >= lastAcceptedDistance - MAX_BACKWARD_JITTER_METERS;
    if (!accepted) {
      diagnostics.push(`Rejected candidate at ${point.timestamp}`);
      continue;
    }

    const elapsedSeconds =
      startTime && parseTimestamp(point.timestamp)
        ? Math.max(
            0,
            Math.round(
              (parseTimestamp(point.timestamp)!.getTime() - startTime.getTime()) /
                1000,
            ),
          )
        : 0;

    const matchedDistance = Math.max(
      lastAcceptedDistance,
      Math.min(options.courseDistanceMeters, chosen.distance),
    );
    lastAcceptedDistance = matchedDistance;
    acceptedPoints += 1;

    samples.push({
      distanceMeters: matchedDistance,
      elapsedSeconds,
      lat: chosen.lat,
      lng: chosen.lng,
      elevation: point.elevation,
      rawLat: point.lat,
      rawLng: point.lng,
      lateralErrorMeters: chosen.pointerDistanceMeters,
      accepted: true,
      timestamp: point.timestamp,
    });
  }

  const coverageRatio =
    sampledPoints.length > 0 ? acceptedPoints / sampledPoints.length : 0;
  const endProgressRatio =
    options.courseDistanceMeters > 0
      ? Math.min(1, lastAcceptedDistance / options.courseDistanceMeters)
      : 0;

  return {
    samples,
    totalPoints: options.points.length,
    sampledPoints: sampledPoints.length,
    acceptedPoints,
    coverageRatio,
    endProgressRatio,
    diagnostics,
  };
}

export function getMatchStatusFromData(
  matchData: Pick<CourseActivityMatchData, "coverageRatio" | "endProgressRatio">,
): "matched" | "partial" | "failed" {
  if (matchData.coverageRatio >= 0.8 && matchData.endProgressRatio >= 0.95) {
    return "matched";
  }
  if (matchData.coverageRatio >= 0.5 && matchData.endProgressRatio >= 0.5) {
    return "partial";
  }
  return "failed";
}

export function getMatchConfidence(matchData: CourseActivityMatchData): number {
  const score = Math.min(
    1,
    matchData.coverageRatio * 0.7 + matchData.endProgressRatio * 0.3,
  );
  return Math.round(score * 100);
}

function formatTargetLabel(plan: SelectPlan): string | null {
  if (plan.paceMode === "time" && plan.targetTimeSeconds) {
    const hours = Math.floor(plan.targetTimeSeconds / 3600);
    const minutes = Math.floor((plan.targetTimeSeconds % 3600) / 60);
    const seconds = plan.targetTimeSeconds % 60;
    return `${hours.toString().padStart(2, "0")}:${minutes
      .toString()
      .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }
  if (plan.pace) {
    const minutes = Math.floor(plan.pace / 60);
    const seconds = plan.pace % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}${
      plan.paceUnit === "min_per_mi" ? "/mi" : "/km"
    }`;
  }
  return null;
}

function getActivityElapsedAtDistance(
  matchData: CourseActivityMatchData,
  distanceMeters: number,
): number | null {
  const samples = matchData.samples;
  if (!samples.length) return null;
  if (distanceMeters <= samples[0]!.distanceMeters) {
    return samples[0]!.elapsedSeconds;
  }

  for (let i = 1; i < samples.length; i++) {
    const previous = samples[i - 1]!;
    const current = samples[i]!;
    if (distanceMeters > current.distanceMeters) continue;

    const span = current.distanceMeters - previous.distanceMeters;
    if (span <= 0) return current.elapsedSeconds;
    const ratio = (distanceMeters - previous.distanceMeters) / span;
    return previous.elapsedSeconds + ratio * (current.elapsedSeconds - previous.elapsedSeconds);
  }

  const last = samples[samples.length - 1]!;
  if (distanceMeters <= last.distanceMeters + 1) {
    return last.elapsedSeconds;
  }

  return null;
}

function normalizeWaypoints(waypoints: SelectWaypoint[]): NumericWaypoint[] {
  return waypoints
    .map((waypoint) => ({
      id: waypoint.id,
      distance: waypoint.distance,
      order: waypoint.order,
      elevation: waypoint.elevation,
    }))
    .sort((a, b) => a.order - b.order);
}

function buildPlannedWaypointTimes(options: {
  plan: SelectPlan;
  waypoints: NumericWaypoint[];
  waypointStoppageTimes: SelectWaypointStoppageTime[];
  courseGeoJson: GeoJSON.FeatureCollection;
  gradeWindowMeters?: number;
  sampleStepMeters?: number;
}): Record<string, number> {
  const elevationProfile = extractElevationProfile(options.courseGeoJson);
  const waypointSegments = calculateWaypointSegments(
    options.waypoints,
    elevationProfile,
  );

  return calculateAllElapsedTimes({
    plan: options.plan,
    waypoints: options.waypoints,
    waypointStoppageTimes: options.waypointStoppageTimes,
    getDefaultStoppageTime: () => options.plan.defaultStoppageTime ?? 0,
    elevationProfile,
    waypointSegments,
    useGradeAdjustment: options.plan.useGradeAdjustment ?? true,
    gradeWindowMeters: options.gradeWindowMeters,
    sampleStepMeters: options.sampleStepMeters,
    maintainTargetAverage: (options.plan.paceMode || "pace") !== "normalized",
  });
}

export function buildPlanComparisonSummary(options: {
  activity: SelectCourseActivity;
  plan: SelectPlan;
  courseGeoJson: GeoJSON.FeatureCollection;
  waypoints: SelectWaypoint[];
  waypointStoppageTimes: SelectWaypointStoppageTime[];
  gradeWindowMeters?: number;
  sampleStepMeters?: number;
}): CourseActivityPlanSummary {
  const matchData = getCourseActivityMatchData(options.activity);
  const numericWaypoints = normalizeWaypoints(options.waypoints);
  const plannedWaypointTimes = buildPlannedWaypointTimes({
    plan: options.plan,
    waypoints: numericWaypoints,
    waypointStoppageTimes: options.waypointStoppageTimes,
    courseGeoJson: options.courseGeoJson,
    gradeWindowMeters: options.gradeWindowMeters,
    sampleStepMeters: options.sampleStepMeters,
  });
  const finishWaypoint = numericWaypoints[numericWaypoints.length - 1];
  const plannedElapsedSeconds = finishWaypoint
    ? plannedWaypointTimes[finishWaypoint.id] ?? null
    : null;
  const actualElapsedSeconds = options.activity.elapsedTimeSeconds ?? null;
  const deltaSeconds =
    plannedElapsedSeconds !== null &&
    actualElapsedSeconds !== null &&
    options.activity.matchStatus !== "failed"
      ? actualElapsedSeconds - plannedElapsedSeconds
      : null;
  const closestFitScore =
    deltaSeconds === null
      ? null
      : Math.round(
          Math.abs(deltaSeconds) + (1 - matchData.coverageRatio) * 1800,
        );

  return {
    planId: options.plan.id,
    planName: options.plan.name,
    plannedElapsedSeconds,
    actualElapsedSeconds,
    deltaSeconds,
    targetLabel: formatTargetLabel(options.plan),
    recordedDistanceMeters: options.activity.recordedDistanceMeters,
    matchedDistanceMeters: options.activity.matchedDistanceMeters,
    matchStatus: options.activity.matchStatus as CourseActivityPlanSummary["matchStatus"],
    matchConfidence: options.activity.matchConfidence,
    coverageRatio: matchData.coverageRatio,
    closestFitScore,
  };
}

export function buildPlanComparisonDetail(options: {
  activity: SelectCourseActivity;
  plan: SelectPlan;
  courseGeoJson: GeoJSON.FeatureCollection;
  waypoints: SelectWaypoint[];
  waypointStoppageTimes: SelectWaypointStoppageTime[];
  distanceUnit: "kilometers" | "miles";
  gradeWindowMeters?: number;
  sampleStepMeters?: number;
}): CourseActivityPlanDetail {
  const matchData = getCourseActivityMatchData(options.activity);
  const numericWaypoints = normalizeWaypoints(options.waypoints);
  const plannedWaypointTimes = buildPlannedWaypointTimes({
    plan: options.plan,
    waypoints: numericWaypoints,
    waypointStoppageTimes: options.waypointStoppageTimes,
    courseGeoJson: options.courseGeoJson,
    gradeWindowMeters: options.gradeWindowMeters,
    sampleStepMeters: options.sampleStepMeters,
  });

  const waypointComparisons = numericWaypoints.map((waypoint, index) => {
    const previousWaypoint = index > 0 ? numericWaypoints[index - 1] : null;
    const plannedElapsed = plannedWaypointTimes[waypoint.id] ?? null;
    const actualElapsed = getActivityElapsedAtDistance(matchData, waypoint.distance);
    const previousPlanned =
      previousWaypoint ? plannedWaypointTimes[previousWaypoint.id] ?? null : null;
    const previousActual = previousWaypoint
      ? getActivityElapsedAtDistance(matchData, previousWaypoint.distance)
      : null;

    return {
      waypointId: waypoint.id,
      plannedElapsedSeconds: plannedElapsed,
      actualElapsedSeconds: actualElapsed,
      deltaSeconds:
        plannedElapsed !== null && actualElapsed !== null
          ? actualElapsed - plannedElapsed
          : null,
      plannedSegmentSeconds:
        previousPlanned !== null && plannedElapsed !== null
          ? plannedElapsed - previousPlanned
          : null,
      actualSegmentSeconds:
        previousActual !== null && actualElapsed !== null
          ? actualElapsed - previousActual
          : null,
      segmentDeltaSeconds:
        previousPlanned !== null &&
        plannedElapsed !== null &&
        previousActual !== null &&
        actualElapsed !== null
          ? actualElapsed - previousActual - (plannedElapsed - previousPlanned)
          : null,
    };
  });

  const splitRows = buildPlanSplitRows({
    geoJsonData: [options.courseGeoJson],
    currentPlan: options.plan,
    waypoints: numericWaypoints,
    waypointStoppageTimes: options.waypointStoppageTimes,
    getDefaultStoppageTime: () => options.plan.defaultStoppageTime ?? 0,
    distanceUnit: options.distanceUnit,
    gradeWindowMeters: options.gradeWindowMeters,
    sampleStepMeters: options.sampleStepMeters,
  });

  const splitComparisons = splitRows.map((row, index) => {
    const actualElapsed = getActivityElapsedAtDistance(matchData, row.end);
    const previousActual =
      index > 0
        ? getActivityElapsedAtDistance(matchData, splitRows[index - 1]!.end)
        : 0;
    const actualSplitSeconds =
      actualElapsed !== null && previousActual !== null
        ? actualElapsed - previousActual
        : null;
    const distanceMeters = row.end - row.start;
    const unitMeters = options.plan.paceUnit === "min_per_mi" ? 1609.344 : 1000;

    return {
      index: row.index,
      startMeters: row.start,
      endMeters: row.end,
      plannedElapsedSeconds: row.elapsedSec,
      actualElapsedSeconds: actualElapsed,
      plannedSplitSeconds:
        row.elapsedSec !== null
          ? row.elapsedSec - (index > 0 ? splitRows[index - 1]!.elapsedSec || 0 : 0)
          : null,
      actualSplitSeconds,
      deltaSeconds:
        row.elapsedSec !== null && actualElapsed !== null
          ? actualElapsed - row.elapsedSec
          : null,
      actualPaceSecondsPerUnit:
        actualSplitSeconds !== null && distanceMeters > 0
          ? (actualSplitSeconds / distanceMeters) * unitMeters
          : null,
    };
  });

  const finishWaypoint = numericWaypoints[numericWaypoints.length - 1];
  const plannedElapsedSeconds = finishWaypoint
    ? plannedWaypointTimes[finishWaypoint.id] ?? null
    : null;
  const actualElapsedSeconds = options.activity.elapsedTimeSeconds ?? null;

  return {
    activityId: options.activity.id,
    planId: options.plan.id,
    planName: options.plan.name,
    matchStatus: options.activity.matchStatus as CourseActivityPlanDetail["matchStatus"],
    matchConfidence: options.activity.matchConfidence,
    coverageRatio: matchData.coverageRatio,
    recordedDistanceMeters: options.activity.recordedDistanceMeters,
    matchedDistanceMeters: options.activity.matchedDistanceMeters,
    plannedElapsedSeconds,
    actualElapsedSeconds,
    deltaSeconds:
      plannedElapsedSeconds !== null && actualElapsedSeconds !== null
        ? actualElapsedSeconds - plannedElapsedSeconds
        : null,
    targetLabel: formatTargetLabel(options.plan),
    waypoints: waypointComparisons,
    splits: splitComparisons,
  };
}
