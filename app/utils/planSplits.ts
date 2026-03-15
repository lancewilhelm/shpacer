import type { SelectPlan, SelectWaypointStoppageTime } from "~/utils/db/schema";
import {
  extractElevationProfile,
  calculateGradeAtDistance,
  interpolateAtDistance,
} from "~/utils/elevationProfile";
import { paceAdjustment } from "~/utils/paceAdjustment";

export type PlanSplitRow = {
  index: number;
  start: number;
  end: number;
  dist: number;
  gain: number;
  loss: number;
  avgGrade: number;
  paceSecPerUnit: number | null;
  elapsedSec: number | null;
};

interface PlanSplitWaypoint {
  id: string;
  distance: number;
  order: number;
}

interface BuildPlanSplitRowsOptions {
  geoJsonData: GeoJSON.FeatureCollection[];
  currentPlan: SelectPlan | null;
  waypoints: PlanSplitWaypoint[];
  waypointStoppageTimes: SelectWaypointStoppageTime[];
  getDefaultStoppageTime: () => number;
  distanceUnit: "kilometers" | "miles";
  gradeWindowMeters?: number;
  sampleStepMeters?: number;
}

function getPacePerMeter(paceSeconds: number, paceUnit: string): number {
  if (paceUnit === "min_per_mi") return paceSeconds / 1609.344;
  return paceSeconds / 1000;
}

function calculateGradeAdjustmentFactor(gradePercent: number): number {
  const clamped = Math.max(-50, Math.min(50, gradePercent));
  const factor = paceAdjustment(clamped);
  return Math.max(0.5, Math.min(3.0, factor));
}

function getCumulativeStoppageUntil(
  targetDistance: number,
  waypoints: PlanSplitWaypoint[],
  waypointStoppageTimes: SelectWaypointStoppageTime[],
  getDefaultStoppageTime: () => number,
): number {
  if (!waypoints.length) return 0;

  const defaultStop = getDefaultStoppageTime();
  const maxOrder = Math.max(...waypoints.map((waypoint) => waypoint.order));
  let total = 0;

  for (const waypoint of waypoints) {
    if (waypoint.distance > targetDistance) continue;
    if (waypoint.order === 0) continue;
    if (waypoint.order === maxOrder && waypoint.order > 0) continue;

    const custom = waypointStoppageTimes.find(
      (stoppage) => stoppage.waypointId === waypoint.id,
    );
    total += custom ? custom.stoppageTime : defaultStop;
  }

  return total;
}

function computeGainLoss(
  points: ReturnType<typeof extractElevationProfile>,
  start: number,
  end: number,
): { gain: number; loss: number } {
  if (points.length < 2 || end <= start) return { gain: 0, loss: 0 };

  const startPoint = interpolateAtDistance(points, start);
  const endPoint = interpolateAtDistance(points, end);
  if (!startPoint || !endPoint) return { gain: 0, loss: 0 };

  const acc: Array<{ d: number; e: number }> = [{ d: start, e: startPoint.elevation }];
  for (const point of points) {
    if (point.distance > start && point.distance < end) {
      acc.push({ d: point.distance, e: point.elevation });
    }
  }
  acc.push({ d: end, e: endPoint.elevation });
  acc.sort((a, b) => a.d - b.d);

  let gain = 0;
  let loss = 0;
  for (let i = 1; i < acc.length; i++) {
    const diff = acc[i]!.e - acc[i - 1]!.e;
    if (diff > 0) gain += diff;
    else loss += -diff;
  }

  return { gain, loss };
}

export function buildPlanSplitRows(
  options: BuildPlanSplitRowsOptions,
): PlanSplitRow[] {
  const {
    geoJsonData,
    currentPlan,
    waypoints,
    waypointStoppageTimes,
    getDefaultStoppageTime,
    distanceUnit,
  } = options;

  if (!geoJsonData.length) return [];

  const combined: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: geoJsonData.flatMap((fc) => fc.features),
  };
  const points = extractElevationProfile(combined);
  if (!points.length) return [];

  const total = points[points.length - 1]?.distance || 0;
  if (total <= 0) return [];

  const splitLengthMeters = distanceUnit === "miles" ? 1609.344 : 1000;
  const boundaries: number[] = [0];
  let pos = splitLengthMeters;
  while (pos < total - 1e-6) {
    boundaries.push(pos);
    pos += splitLengthMeters;
  }
  if (boundaries[boundaries.length - 1] !== total) {
    boundaries.push(total);
  }

  const sampleStep =
    options.sampleStepMeters === 0
      ? 50
      : Math.max(1, options.sampleStepMeters ?? 50);
  const gradeWindow = options.gradeWindowMeters ?? 100;

  const courseEnd =
    waypoints.length > 0
      ? [...waypoints].sort((a, b) => a.order - b.order)[waypoints.length - 1]!
          .distance
      : total;

  const basePacePerMeter =
    currentPlan?.pace && currentPlan.paceUnit
      ? getPacePerMeter(currentPlan.pace, currentPlan.paceUnit)
      : null;

  let normalizationScale = 1;
  if (
    currentPlan?.pace &&
    (currentPlan.paceMode || "pace") !== "normalized" &&
    points.length >= 2
  ) {
    let equivalentDistanceSum = 0;
    let cursor = 0;
    while (cursor < total) {
      const next = Math.min(cursor + sampleStep, total);
      const mid = (cursor + next) / 2;
      const grade = calculateGradeAtDistance(points, mid, gradeWindow);
      const gradeFactor =
        currentPlan.useGradeAdjustment !== false
          ? calculateGradeAdjustmentFactor(grade)
          : 1;
      let pacingFactor = 1;
      if ((currentPlan.pacingStrategy || "flat") === "linear" && courseEnd > 0) {
        const t = Math.max(0, Math.min(1, mid / courseEnd));
        const p =
          Math.max(-50, Math.min(50, currentPlan.pacingLinearPercent ?? 0)) /
          100;
        pacingFactor = 1 + (t - 0.5) * p;
      }
      equivalentDistanceSum += gradeFactor * pacingFactor * (next - cursor);
      cursor = next;
    }
    if (equivalentDistanceSum > 0) {
      normalizationScale = total / equivalentDistanceSum;
    }
  }

  let timeScale = 1;
  if (
    currentPlan?.pace &&
    basePacePerMeter &&
    courseEnd > 0 &&
    (currentPlan.paceMode || "pace") === "time" &&
    currentPlan.targetTimeSeconds
  ) {
    let travelBase = 0;
    let cursor = 0;
    while (cursor < courseEnd) {
      const next = Math.min(cursor + sampleStep, courseEnd);
      const mid = (cursor + next) / 2;
      const grade = calculateGradeAtDistance(points, mid, gradeWindow);
      const gradeFactor =
        currentPlan.useGradeAdjustment !== false
          ? calculateGradeAdjustmentFactor(grade)
          : 1;
      let pacingFactor = 1;
      if ((currentPlan.pacingStrategy || "flat") === "linear" && courseEnd > 0) {
        const t = Math.max(0, Math.min(1, mid / courseEnd));
        const p =
          Math.max(-50, Math.min(50, currentPlan.pacingLinearPercent ?? 0)) /
          100;
        pacingFactor = 1 + (t - 0.5) * p;
      }
      travelBase +=
        (next - cursor) *
        basePacePerMeter *
        gradeFactor *
        pacingFactor *
        normalizationScale;
      cursor = next;
    }

    const includeStops = currentPlan.targetIncludesStoppages === true;
    const stoppageTotal = includeStops
      ? getCumulativeStoppageUntil(
          courseEnd,
          waypoints,
          waypointStoppageTimes,
          getDefaultStoppageTime,
        )
      : 0;
    const desiredTravel = includeStops
      ? Math.max(0, currentPlan.targetTimeSeconds - stoppageTotal)
      : currentPlan.targetTimeSeconds;
    if (travelBase > 0) {
      timeScale = desiredTravel / travelBase;
    }
  }

  let cumulativeTravel = 0;
  const rows: PlanSplitRow[] = [];

  for (let i = 0; i < boundaries.length - 1; i++) {
    const start = boundaries[i]!;
    const end = boundaries[i + 1]!;
    const dist = Math.max(0, end - start);
    const { gain, loss } = computeGainLoss(points, start, end);
    const startPoint = interpolateAtDistance(points, start);
    const endPoint = interpolateAtDistance(points, end);
    const avgGrade =
      startPoint && endPoint && dist > 0
        ? ((endPoint.elevation - startPoint.elevation) / dist) * 100
        : 0;

    let paceSecPerUnit: number | null = null;
    let segmentSeconds = 0;

    if (currentPlan?.pace && basePacePerMeter && dist > 0) {
      let weightedFactorSum = 0;
      let cursor = start;
      while (cursor < end) {
        const next = Math.min(cursor + sampleStep, end);
        const mid = (cursor + next) / 2;
        const grade = calculateGradeAtDistance(points, mid, gradeWindow);
        const gradeFactor =
          currentPlan.useGradeAdjustment !== false
            ? calculateGradeAdjustmentFactor(grade)
            : 1;
        let pacingFactor = 1;
        if ((currentPlan.pacingStrategy || "flat") === "linear" && courseEnd > 0) {
          const t = Math.max(0, Math.min(1, mid / courseEnd));
          const p =
            Math.max(-50, Math.min(50, currentPlan.pacingLinearPercent ?? 0)) /
            100;
          pacingFactor = 1 + (t - 0.5) * p;
        }
        weightedFactorSum += gradeFactor * pacingFactor * (next - cursor);
        cursor = next;
      }

      const meanFactor = dist > 0 ? weightedFactorSum / dist : 1;
      const adjustedPacePerMeter =
        basePacePerMeter * meanFactor * normalizationScale;
      segmentSeconds = dist * adjustedPacePerMeter * timeScale;
      const unitMeters = currentPlan.paceUnit === "min_per_mi" ? 1609.344 : 1000;
      paceSecPerUnit = adjustedPacePerMeter * unitMeters * timeScale;
      cumulativeTravel += segmentSeconds;
    }

    rows.push({
      index: i + 1,
      start,
      end,
      dist,
      gain,
      loss,
      avgGrade,
      paceSecPerUnit,
      elapsedSec: currentPlan?.pace
        ? cumulativeTravel +
          getCumulativeStoppageUntil(
            end,
            waypoints,
            waypointStoppageTimes,
            getDefaultStoppageTime,
          )
        : null,
    });
  }

  if (currentPlan?.pace && rows.length > 0) {
    const lastIdx = rows.length - 1;
    const lastBoundary = boundaries[boundaries.length - 1]!;
    const stoppageLast = getCumulativeStoppageUntil(
      lastBoundary,
      waypoints,
      waypointStoppageTimes,
      getDefaultStoppageTime,
    );
    const rawLast = rows[lastIdx]!.elapsedSec ?? 0;

    let desiredLast = rawLast;
    if ((currentPlan.paceMode || "pace") === "time" && currentPlan.targetTimeSeconds) {
      desiredLast =
        currentPlan.targetTimeSeconds +
        (currentPlan.targetIncludesStoppages === true ? 0 : stoppageLast);
    } else {
      desiredLast = Math.round(rawLast);
    }

    const rawTravelLast = Math.max(0, rawLast - stoppageLast);
    const desiredTravelLast = Math.max(0, desiredLast - stoppageLast);
    const extraScale =
      rawTravelLast > 0 ? desiredTravelLast / rawTravelLast : 1;

    if (isFinite(extraScale) && extraScale > 0) {
      for (const row of rows) {
        const stop = getCumulativeStoppageUntil(
          row.end,
          waypoints,
          waypointStoppageTimes,
          getDefaultStoppageTime,
        );
        const rawTravel = Math.max(0, (row.elapsedSec ?? 0) - stop);
        row.elapsedSec = rawTravel * extraScale + stop;
      }
      rows[lastIdx]!.elapsedSec = desiredLast;
    }
  }

  return rows;
}
