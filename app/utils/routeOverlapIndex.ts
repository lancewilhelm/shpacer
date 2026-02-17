import { calculateDistance } from "./distance";

const METERS_PER_DEG_LAT = 110540;
const METERS_PER_DEG_LNG_AT_EQUATOR = 111320;
const GRID_CELL_SIZE_METERS = 25;
const DEFAULT_ROUTE_SEPARATION_MIN_METERS = 25;
const DEFAULT_DIRECTION_DOT_MIN = 0.97;
const DEFAULT_SEGMENT_DISTANCE_MAX_METERS = 3;
const DEFAULT_OVERLAP_LENGTH_MIN_METERS = 8;
const DEFAULT_OVERLAP_SHORTER_FRACTION_MIN = 0.2;

export interface TrackSegment {
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  segmentLengthMeters: number;
  cumulativeStartMeters: number;
  directionX: number;
  directionY: number;
}

export interface SegmentOverlapLink {
  otherSegmentIndex: number;
  thisTStart: number;
  thisTEnd: number;
  otherTStart: number;
  otherTEnd: number;
  maxLateralSeparationMeters: number;
}

export interface OverlapIndex {
  segments: TrackSegment[];
  linksBySegment: SegmentOverlapLink[][];
}

type LocalPoint = { x: number; y: number };

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function toLocalMeters(
  lat: number,
  lng: number,
  refLat: number,
  refLng: number,
  cosRefLat: number,
): LocalPoint {
  return {
    x: (lng - refLng) * METERS_PER_DEG_LNG_AT_EQUATOR * cosRefLat,
    y: (lat - refLat) * METERS_PER_DEG_LAT,
  };
}

function extractTrackCoordinates(geometry: GeoJSON.Geometry): number[][] {
  const coords: number[][] = [];

  if (geometry.type === "LineString") {
    coords.push(...geometry.coordinates);
  } else if (geometry.type === "MultiLineString") {
    for (const line of geometry.coordinates) {
      coords.push(...line);
    }
  }

  return coords;
}

function projectPointToSegmentXY(
  px: number,
  py: number,
  segment: TrackSegment,
): { t: number; closestX: number; closestY: number; distanceMeters: number } {
  const vx = segment.endX - segment.startX;
  const vy = segment.endY - segment.startY;
  const lenSq = vx * vx + vy * vy;

  let t = 0;
  if (lenSq > 0) {
    t = ((px - segment.startX) * vx + (py - segment.startY) * vy) / lenSq;
  }
  t = clamp01(t);

  const closestX = segment.startX + t * vx;
  const closestY = segment.startY + t * vy;
  const dx = px - closestX;
  const dy = py - closestY;

  return {
    t,
    closestX,
    closestY,
    distanceMeters: Math.hypot(dx, dy),
  };
}

function interpolateSegmentPoint(
  segment: TrackSegment,
  t: number,
): { lat: number; lng: number; x: number; y: number } {
  const ratio = clamp01(t);
  return {
    lat: segment.startLat + (segment.endLat - segment.startLat) * ratio,
    lng: segment.startLng + (segment.endLng - segment.startLng) * ratio,
    x: segment.startX + (segment.endX - segment.startX) * ratio,
    y: segment.startY + (segment.endY - segment.startY) * ratio,
  };
}

function projectedRangeOnSegment(
  base: TrackSegment,
  other: TrackSegment,
): [number, number] {
  const p0 = projectPointToSegmentXY(other.startX, other.startY, base).t;
  const p1 = projectPointToSegmentXY(other.endX, other.endY, base).t;
  return p0 <= p1 ? [p0, p1] : [p1, p0];
}

function segmentEndpointDistanceMeters(a: TrackSegment, b: TrackSegment): number {
  const aStart = projectPointToSegmentXY(a.startX, a.startY, b).distanceMeters;
  const aEnd = projectPointToSegmentXY(a.endX, a.endY, b).distanceMeters;
  const bStart = projectPointToSegmentXY(b.startX, b.startY, a).distanceMeters;
  const bEnd = projectPointToSegmentXY(b.endX, b.endY, a).distanceMeters;
  return Math.min(aStart, aEnd, bStart, bEnd);
}

function makeLink(
  from: TrackSegment,
  to: TrackSegment,
  fromRange: [number, number],
  maxDistance: number,
): SegmentOverlapLink | null {
  const [thisTStart, thisTEnd] = fromRange;
  if (thisTEnd <= thisTStart) return null;

  const fromStartPoint = interpolateSegmentPoint(from, thisTStart);
  const fromEndPoint = interpolateSegmentPoint(from, thisTEnd);

  const otherTStart = projectPointToSegmentXY(
    fromStartPoint.x,
    fromStartPoint.y,
    to,
  ).t;
  const otherTEnd = projectPointToSegmentXY(
    fromEndPoint.x,
    fromEndPoint.y,
    to,
  ).t;

  const mappedStart = interpolateSegmentPoint(to, otherTStart);
  const mappedEnd = interpolateSegmentPoint(to, otherTEnd);
  const startLateral = Math.hypot(
    fromStartPoint.x - mappedStart.x,
    fromStartPoint.y - mappedStart.y,
  );
  const endLateral = Math.hypot(
    fromEndPoint.x - mappedEnd.x,
    fromEndPoint.y - mappedEnd.y,
  );

  return {
    otherSegmentIndex: -1,
    thisTStart,
    thisTEnd,
    otherTStart,
    otherTEnd,
    maxLateralSeparationMeters: Math.max(maxDistance, startLateral, endLateral),
  };
}

function buildSegments(geoJsonData: GeoJSON.FeatureCollection[]): TrackSegment[] {
  const validCoords: Array<{ lat: number; lng: number }> = [];
  for (const fc of geoJsonData) {
    for (const feature of fc.features) {
      const coords = extractTrackCoordinates(feature.geometry);
      for (const coord of coords) {
        if (!coord || coord.length < 2) continue;
        const lng = coord[0];
        const lat = coord[1];
        if (typeof lat !== "number" || typeof lng !== "number") continue;
        validCoords.push({ lat, lng });
      }
    }
  }

  if (validCoords.length === 0) return [];
  const refLat = validCoords[0]!.lat;
  const refLng = validCoords[0]!.lng;
  const cosRefLat = Math.cos((refLat * Math.PI) / 180);

  const segments: TrackSegment[] = [];
  let cumulative = 0;

  for (const fc of geoJsonData) {
    for (const feature of fc.features) {
      const coords = extractTrackCoordinates(feature.geometry);
      for (let i = 0; i < coords.length - 1; i++) {
        const start = coords[i];
        const end = coords[i + 1];
        if (!start || !end || start.length < 2 || end.length < 2) continue;

        const startLng = start[0];
        const startLat = start[1];
        const endLng = end[0];
        const endLat = end[1];
        if (
          typeof startLat !== "number" ||
          typeof startLng !== "number" ||
          typeof endLat !== "number" ||
          typeof endLng !== "number"
        ) {
          continue;
        }

        const segmentLengthMeters = calculateDistance(
          startLat,
          startLng,
          endLat,
          endLng,
        );
        if (!Number.isFinite(segmentLengthMeters) || segmentLengthMeters <= 0) {
          continue;
        }

        const startPoint = toLocalMeters(
          startLat,
          startLng,
          refLat,
          refLng,
          cosRefLat,
        );
        const endPoint = toLocalMeters(endLat, endLng, refLat, refLng, cosRefLat);
        const dx = endPoint.x - startPoint.x;
        const dy = endPoint.y - startPoint.y;
        const dirNorm = Math.hypot(dx, dy);
        if (dirNorm === 0) continue;

        segments.push({
          startLat,
          startLng,
          endLat,
          endLng,
          startX: startPoint.x,
          startY: startPoint.y,
          endX: endPoint.x,
          endY: endPoint.y,
          segmentLengthMeters,
          cumulativeStartMeters: cumulative,
          directionX: dx / dirNorm,
          directionY: dy / dirNorm,
        });

        cumulative += segmentLengthMeters;
      }
    }
  }

  return segments;
}

function segmentAabb(seg: TrackSegment, padding: number) {
  return {
    minX: Math.min(seg.startX, seg.endX) - padding,
    maxX: Math.max(seg.startX, seg.endX) + padding,
    minY: Math.min(seg.startY, seg.endY) - padding,
    maxY: Math.max(seg.startY, seg.endY) + padding,
  };
}

function overlapRange(a: [number, number], b: [number, number]): [number, number] {
  return [Math.max(a[0], b[0]), Math.min(a[1], b[1])];
}

function isWithinRange(value: number, start: number, end: number): boolean {
  const min = Math.min(start, end);
  const max = Math.max(start, end);
  return value >= min - 1e-6 && value <= max + 1e-6;
}

export function buildOverlapIndexForGeoJsonTracks(
  geoJsonData: GeoJSON.FeatureCollection[],
): OverlapIndex {
  const segments = buildSegments(geoJsonData);
  const linksBySegment: SegmentOverlapLink[][] = segments.map(() => []);
  if (segments.length < 2) {
    return { segments, linksBySegment };
  }

  const cells = new Map<string, number[]>();
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    const box = segmentAabb(seg, DEFAULT_SEGMENT_DISTANCE_MAX_METERS);
    const minCellX = Math.floor(box.minX / GRID_CELL_SIZE_METERS);
    const maxCellX = Math.floor(box.maxX / GRID_CELL_SIZE_METERS);
    const minCellY = Math.floor(box.minY / GRID_CELL_SIZE_METERS);
    const maxCellY = Math.floor(box.maxY / GRID_CELL_SIZE_METERS);

    for (let cx = minCellX; cx <= maxCellX; cx++) {
      for (let cy = minCellY; cy <= maxCellY; cy++) {
        const key = `${cx}:${cy}`;
        const list = cells.get(key);
        if (list) list.push(i);
        else cells.set(key, [i]);
      }
    }
  }

  const seenPairs = new Set<string>();
  const candidates: Array<[number, number]> = [];
  for (const cellList of cells.values()) {
    for (let i = 0; i < cellList.length; i++) {
      const a = cellList[i]!;
      for (let j = i + 1; j < cellList.length; j++) {
        const b = cellList[j]!;
        const low = Math.min(a, b);
        const high = Math.max(a, b);
        const pairKey = `${low}:${high}`;
        if (seenPairs.has(pairKey)) continue;
        seenPairs.add(pairKey);
        candidates.push([low, high]);
      }
    }
  }

  for (const [aIdx, bIdx] of candidates) {
    const a = segments[aIdx]!;
    const b = segments[bIdx]!;

    if (
      Math.abs(a.cumulativeStartMeters - b.cumulativeStartMeters) <
      DEFAULT_ROUTE_SEPARATION_MIN_METERS
    ) {
      continue;
    }

    const directionDot =
      a.directionX * b.directionX + a.directionY * b.directionY;
    if (Math.abs(directionDot) < DEFAULT_DIRECTION_DOT_MIN) {
      continue;
    }

    const minDist = segmentEndpointDistanceMeters(a, b);
    if (minDist > DEFAULT_SEGMENT_DISTANCE_MAX_METERS) {
      continue;
    }

    const aProjRange = projectedRangeOnSegment(a, b);
    const bProjRange = projectedRangeOnSegment(b, a);
    const aOverlap = overlapRange([0, 1], aProjRange);
    const bOverlap = overlapRange([0, 1], bProjRange);

    const aOverlapLen = Math.max(0, aOverlap[1] - aOverlap[0]) * a.segmentLengthMeters;
    const bOverlapLen = Math.max(0, bOverlap[1] - bOverlap[0]) * b.segmentLengthMeters;
    const overlapLen = Math.min(aOverlapLen, bOverlapLen);
    const shorterLen = Math.min(a.segmentLengthMeters, b.segmentLengthMeters);

    if (
      overlapLen < DEFAULT_OVERLAP_LENGTH_MIN_METERS ||
      overlapLen < DEFAULT_OVERLAP_SHORTER_FRACTION_MIN * shorterLen
    ) {
      continue;
    }

    const linkAB = makeLink(a, b, aOverlap, minDist);
    const linkBA = makeLink(b, a, bOverlap, minDist);
    if (!linkAB || !linkBA) continue;
    if (linkAB.maxLateralSeparationMeters > DEFAULT_SEGMENT_DISTANCE_MAX_METERS) {
      continue;
    }
    if (linkBA.maxLateralSeparationMeters > DEFAULT_SEGMENT_DISTANCE_MAX_METERS) {
      continue;
    }

    linkAB.otherSegmentIndex = bIdx;
    linkBA.otherSegmentIndex = aIdx;
    linksBySegment[aIdx]!.push(linkAB);
    linksBySegment[bIdx]!.push(linkBA);
  }

  return { segments, linksBySegment };
}

export function projectPointOnTrackSegment(
  targetLat: number,
  targetLng: number,
  segment: TrackSegment,
): { t: number; snappedLat: number; snappedLng: number } {
  const dLat = segment.endLat - segment.startLat;
  const dLng = segment.endLng - segment.startLng;
  const lenSq = dLat * dLat + dLng * dLng;

  let t = 0;
  if (lenSq > 0) {
    t =
      ((targetLat - segment.startLat) * dLat +
        (targetLng - segment.startLng) * dLng) /
      lenSq;
  }
  t = clamp01(t);

  return {
    t,
    snappedLat: segment.startLat + t * dLat,
    snappedLng: segment.startLng + t * dLng,
  };
}

export function resolveSecondaryFromOverlap(
  overlapIndex: OverlapIndex,
  primarySegmentIndex: number,
  primaryT: number,
  primarySnappedLat: number,
  primarySnappedLng: number,
): { distance: number; snappedLat: number; snappedLng: number } | null {
  const links = overlapIndex.linksBySegment[primarySegmentIndex];
  if (!links || links.length === 0) return null;

  let best:
    | { distance: number; lateral: number; snappedLat: number; snappedLng: number }
    | null = null;
  for (const link of links) {
    if (!isWithinRange(primaryT, link.thisTStart, link.thisTEnd)) continue;

    const denom = link.thisTEnd - link.thisTStart;
    const ratio =
      Math.abs(denom) < 1e-9 ? 0.5 : (primaryT - link.thisTStart) / denom;
    const otherT = clamp01(
      link.otherTStart + ratio * (link.otherTEnd - link.otherTStart),
    );

    const otherSegment = overlapIndex.segments[link.otherSegmentIndex];
    if (!otherSegment) continue;

    const otherLat = otherSegment.startLat + (otherSegment.endLat - otherSegment.startLat) * otherT;
    const otherLng = otherSegment.startLng + (otherSegment.endLng - otherSegment.startLng) * otherT;
    const lateral = calculateDistance(
      primarySnappedLat,
      primarySnappedLng,
      otherLat,
      otherLng,
    );
    if (lateral > DEFAULT_SEGMENT_DISTANCE_MAX_METERS) continue;

    const distance =
      otherSegment.cumulativeStartMeters + otherT * otherSegment.segmentLengthMeters;
    if (
      !best ||
      lateral < best.lateral ||
      (lateral === best.lateral && distance < best.distance)
    ) {
      best = {
        distance,
        lateral,
        snappedLat: otherLat,
        snappedLng: otherLng,
      };
    }
  }

  return best
    ? {
        distance: best.distance,
        snappedLat: best.snappedLat,
        snappedLng: best.snappedLng,
      }
    : null;
}
