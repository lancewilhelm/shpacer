import type { ElevationPoint } from "./elevationProfile";

export interface ElevationAnnotationContext {
  totalDistance: number;
  elevationRange: number;
  gradeWindowMeters: number;
}

export interface ElevationAnnotationOverrides {
  annotationMinDistanceMeters?: number;
  annotationMinVerticalMeters?: number;
  annotationMinAverageGradePercent?: number;
  annotationFlatGradeThresholdPercent?: number;
  annotationReversalConfirmDistanceMeters?: number;
  annotationMaxCount?: number;
}

export interface ResolvedElevationAnnotationSettings {
  annotationMinDistanceMeters: number;
  annotationMinVerticalMeters: number;
  annotationMinAverageGradePercent: number;
  annotationFlatGradeThresholdPercent: number;
  annotationReversalConfirmDistanceMeters: number;
  annotationMaxCount: number;
}

export interface ElevationAnnotationCandidate {
  direction: "climb" | "descent";
  startDistance: number;
  endDistance: number;
  startElevation: number;
  endElevation: number;
  horizontalDistanceMeters: number;
  verticalChangeMeters: number;
  averageGradePercent: number;
}

type SegmentDirection = "up" | "down" | "flat";

type ElevationSegment = {
  startIndex: number;
  endIndex: number;
  distance: number;
  gradePercent: number;
  direction: SegmentDirection;
};

function clampNonNegative(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, value);
}

function classifySegmentDirection(
  gradePercent: number,
  flatGradeThresholdPercent: number,
): SegmentDirection {
  if (gradePercent >= flatGradeThresholdPercent) return "up";
  if (gradePercent <= -flatGradeThresholdPercent) return "down";
  return "flat";
}

function buildSegments(
  points: ElevationPoint[],
  flatGradeThresholdPercent: number,
): ElevationSegment[] {
  const segments: ElevationSegment[] = [];

  for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1];
    const current = points[index];
    if (!previous || !current) continue;

    const distance = current.distance - previous.distance;
    if (!Number.isFinite(distance) || distance <= 0) continue;

    const gradePercent =
      ((current.elevation - previous.elevation) / distance) * 100;

    segments.push({
      startIndex: index - 1,
      endIndex: index,
      distance,
      gradePercent,
      direction: classifySegmentDirection(
        gradePercent,
        flatGradeThresholdPercent,
      ),
    });
  }

  return segments;
}

function buildCandidate(
  points: ElevationPoint[],
  startIndex: number,
  endIndex: number,
): ElevationAnnotationCandidate | null {
  const start = points[startIndex];
  const end = points[endIndex];
  if (!start || !end) return null;

  const horizontalDistanceMeters = end.distance - start.distance;
  if (!Number.isFinite(horizontalDistanceMeters) || horizontalDistanceMeters <= 0) {
    return null;
  }

  const verticalChangeMeters = end.elevation - start.elevation;
  if (verticalChangeMeters === 0) return null;

  const averageGradePercent =
    (verticalChangeMeters / horizontalDistanceMeters) * 100;

  return {
    direction: verticalChangeMeters > 0 ? "climb" : "descent",
    startDistance: start.distance,
    endDistance: end.distance,
    startElevation: start.elevation,
    endElevation: end.elevation,
    horizontalDistanceMeters,
    verticalChangeMeters,
    averageGradePercent,
  };
}

export function resolveElevationAnnotationSettings(
  overrides: ElevationAnnotationOverrides | undefined,
  context: ElevationAnnotationContext,
): ResolvedElevationAnnotationSettings {
  const totalDistance = Number.isFinite(context.totalDistance)
    ? context.totalDistance
    : 0;
  const gradeWindowMeters = Number.isFinite(context.gradeWindowMeters)
    ? context.gradeWindowMeters
    : 0;

  return {
    annotationMinDistanceMeters: clampNonNegative(
      overrides?.annotationMinDistanceMeters ?? Math.max(400, totalDistance * 0.015),
      Math.max(400, totalDistance * 0.015),
    ),
    annotationMinVerticalMeters: clampNonNegative(
      overrides?.annotationMinVerticalMeters ?? 20,
      20,
    ),
    annotationMinAverageGradePercent: clampNonNegative(
      overrides?.annotationMinAverageGradePercent ?? 2,
      2,
    ),
    annotationFlatGradeThresholdPercent: clampNonNegative(
      overrides?.annotationFlatGradeThresholdPercent ?? 1.5,
      1.5,
    ),
    annotationReversalConfirmDistanceMeters: clampNonNegative(
      overrides?.annotationReversalConfirmDistanceMeters ??
        Math.max(80, gradeWindowMeters || 80),
      Math.max(80, gradeWindowMeters || 80),
    ),
    annotationMaxCount: clampNonNegative(overrides?.annotationMaxCount ?? 0, 0),
  };
}

export function detectElevationAnnotationCandidates(
  points: ElevationPoint[],
  settings: ResolvedElevationAnnotationSettings,
): ElevationAnnotationCandidate[] {
  if (points.length < 2) {
    return [];
  }

  const segments = buildSegments(points, settings.annotationFlatGradeThresholdPercent);
  const firstDirectionalIndex = segments.findIndex(
    (segment) => segment.direction !== "flat",
  );

  if (firstDirectionalIndex === -1) {
    return [];
  }

  let currentDirection = segments[firstDirectionalIndex]!.direction as "up" | "down";
  let currentStartIndex = segments[firstDirectionalIndex]!.startIndex;
  let lastConfirmedEndIndex = segments[firstDirectionalIndex]!.endIndex;
  let pendingOppositeStartIndex: number | null = null;
  let pendingOppositeEndIndex: number | null = null;
  let pendingOppositeDistance = 0;
  const candidates: ElevationAnnotationCandidate[] = [];

  for (
    let segmentIndex = firstDirectionalIndex;
    segmentIndex < segments.length;
    segmentIndex++
  ) {
    const segment = segments[segmentIndex]!;

    if (segment.direction === "flat" || segment.direction === currentDirection) {
      pendingOppositeStartIndex = null;
      pendingOppositeEndIndex = null;
      pendingOppositeDistance = 0;
      lastConfirmedEndIndex = segment.endIndex;
      continue;
    }

    if (pendingOppositeStartIndex === null) {
      pendingOppositeStartIndex = segment.startIndex;
      pendingOppositeEndIndex = segment.endIndex;
      pendingOppositeDistance = segment.distance;
    } else {
      pendingOppositeEndIndex = segment.endIndex;
      pendingOppositeDistance += segment.distance;
    }

    if (
      pendingOppositeDistance >=
      settings.annotationReversalConfirmDistanceMeters
    ) {
      const candidate = buildCandidate(
        points,
        currentStartIndex,
        pendingOppositeStartIndex,
      );
      if (candidate) {
        candidates.push(candidate);
      }

      currentDirection = segment.direction;
      currentStartIndex = pendingOppositeStartIndex;
      lastConfirmedEndIndex = pendingOppositeEndIndex ?? segment.endIndex;
      pendingOppositeStartIndex = null;
      pendingOppositeEndIndex = null;
      pendingOppositeDistance = 0;
    }
  }

  const tailCandidate = buildCandidate(
    points,
    currentStartIndex,
    lastConfirmedEndIndex,
  );
  if (tailCandidate) {
    candidates.push(tailCandidate);
  }

  return candidates
    .filter((candidate) => {
      return (
        candidate.horizontalDistanceMeters >=
          settings.annotationMinDistanceMeters &&
        Math.abs(candidate.verticalChangeMeters) >=
          settings.annotationMinVerticalMeters &&
        Math.abs(candidate.averageGradePercent) >=
          settings.annotationMinAverageGradePercent
      );
    })
    .sort((left, right) => {
      const verticalDelta =
        Math.abs(right.verticalChangeMeters) - Math.abs(left.verticalChangeMeters);
      if (verticalDelta !== 0) return verticalDelta;
      return right.horizontalDistanceMeters - left.horizontalDistanceMeters;
    });
}
