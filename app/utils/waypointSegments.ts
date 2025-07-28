/**
 * Utility functions for calculating segments between waypoints
 */

import type { ElevationPoint } from "./elevationProfile";

// Generic waypoint interface for segment calculations
interface WaypointForSegments {
  id: string;
  distance: number;
  elevation: number | null | undefined;
  order: number;
}

export interface WaypointSegment {
  fromWaypoint: string; // waypoint ID
  toWaypoint: string; // waypoint ID
  distance: number; // distance between waypoints in meters
  elevationGain: number; // cumulative elevation gain along the route segment in meters
  elevationLoss: number; // cumulative elevation loss along the route segment in meters (as positive value)
}

/**
 * Calculate elevation gain and loss along a route segment between two distances
 * @param elevationProfile Array of elevation points along the route
 * @param startDistance Starting distance in meters
 * @param endDistance Ending distance in meters
 * @returns Object with elevationGain and elevationLoss
 */
function calculateSegmentElevationStats(
  elevationProfile: ElevationPoint[],
  startDistance: number,
  endDistance: number,
): { elevationGain: number; elevationLoss: number } {
  if (elevationProfile.length === 0) {
    return { elevationGain: 0, elevationLoss: 0 };
  }

  // Find elevation points within the segment distance range
  const segmentPoints = elevationProfile.filter(
    (point) => point.distance >= startDistance && point.distance <= endDistance,
  );

  if (segmentPoints.length < 2) {
    // If we don't have enough points in the segment, fall back to simple calculation
    const startPoint = elevationProfile.find(
      (point) => point.distance >= startDistance,
    );
    const endPoint = elevationProfile
      .slice()
      .reverse()
      .find((point) => point.distance <= endDistance);

    if (startPoint && endPoint) {
      const elevationDiff = endPoint.elevation - startPoint.elevation;
      return {
        elevationGain: elevationDiff > 0 ? elevationDiff : 0,
        elevationLoss: elevationDiff < 0 ? Math.abs(elevationDiff) : 0,
      };
    }

    return { elevationGain: 0, elevationLoss: 0 };
  }

  // Calculate cumulative elevation gain and loss along the segment
  let elevationGain = 0;
  let elevationLoss = 0;

  for (let i = 1; i < segmentPoints.length; i++) {
    const currentPoint = segmentPoints[i];
    const prevPoint = segmentPoints[i - 1];

    if (!currentPoint || !prevPoint) continue;

    const elevationDiff = currentPoint.elevation - prevPoint.elevation;

    if (elevationDiff > 0) {
      elevationGain += elevationDiff;
    } else {
      elevationLoss += Math.abs(elevationDiff);
    }
  }

  return { elevationGain, elevationLoss };
}

/**
 * Calculate segments between consecutive waypoints with accurate elevation statistics
 * @param waypoints Array of waypoints sorted by order
 * @param elevationProfile Optional elevation profile for accurate gain/loss calculation
 * @returns Array of segments with distance and elevation data
 */
export function calculateWaypointSegments(
  waypoints: WaypointForSegments[],
  elevationProfile?: ElevationPoint[],
): WaypointSegment[] {
  if (waypoints.length < 2) {
    return [];
  }

  const segments: WaypointSegment[] = [];

  // Sort waypoints by order to ensure correct sequence
  const sortedWaypoints = [...waypoints].sort((a, b) => a.order - b.order);

  for (let i = 0; i < sortedWaypoints.length - 1; i++) {
    const fromWaypoint = sortedWaypoints[i];
    const toWaypoint = sortedWaypoints[i + 1];

    if (!fromWaypoint || !toWaypoint) {
      continue;
    }

    // Calculate distance between waypoints using their route distances
    // This gives us the distance along the actual route path
    const routeDistance = Math.abs(toWaypoint.distance - fromWaypoint.distance);

    // Calculate elevation gain and loss
    let elevationGain = 0;
    let elevationLoss = 0;

    if (elevationProfile && elevationProfile.length > 0) {
      // Use detailed elevation profile for accurate calculation
      const stats = calculateSegmentElevationStats(
        elevationProfile,
        Math.min(fromWaypoint.distance, toWaypoint.distance),
        Math.max(fromWaypoint.distance, toWaypoint.distance),
      );
      elevationGain = stats.elevationGain;
      elevationLoss = stats.elevationLoss;
    } else if (
      fromWaypoint.elevation !== null &&
      fromWaypoint.elevation !== undefined &&
      toWaypoint.elevation !== null &&
      toWaypoint.elevation !== undefined
    ) {
      // Fall back to simple net elevation difference
      const elevationDifference = toWaypoint.elevation - fromWaypoint.elevation;

      if (elevationDifference > 0) {
        elevationGain = elevationDifference;
      } else {
        elevationLoss = Math.abs(elevationDifference);
      }
    }

    segments.push({
      fromWaypoint: fromWaypoint.id,
      toWaypoint: toWaypoint.id,
      distance: routeDistance,
      elevationGain,
      elevationLoss,
    });
  }

  return segments;
}

/**
 * Get segment between two specific waypoints
 * @param fromWaypointId ID of the starting waypoint
 * @param toWaypointId ID of the ending waypoint
 * @param segments Array of calculated segments
 * @returns The segment between the specified waypoints, or null if not found
 */
export function getSegmentBetweenWaypoints(
  fromWaypointId: string,
  toWaypointId: string,
  segments: WaypointSegment[],
): WaypointSegment | null {
  return (
    segments.find(
      (segment) =>
        segment.fromWaypoint === fromWaypointId &&
        segment.toWaypoint === toWaypointId,
    ) || null
  );
}

/**
 * Get segment that follows a specific waypoint
 * @param waypointId ID of the waypoint
 * @param segments Array of calculated segments
 * @returns The segment that starts from the specified waypoint, or null if not found
 */
export function getSegmentAfterWaypoint(
  waypointId: string,
  segments: WaypointSegment[],
): WaypointSegment | null {
  return (
    segments.find((segment) => segment.fromWaypoint === waypointId) || null
  );
}

/**
 * Calculate total distance for all segments
 * @param segments Array of segments
 * @returns Total distance in meters
 */
export function getTotalSegmentDistance(segments: WaypointSegment[]): number {
  return segments.reduce((total, segment) => total + segment.distance, 0);
}

/**
 * Calculate total elevation gain for all segments
 * @param segments Array of segments
 * @returns Total elevation gain in meters
 */
export function getTotalElevationGain(segments: WaypointSegment[]): number {
  return segments.reduce((total, segment) => total + segment.elevationGain, 0);
}

/**
 * Calculate total elevation loss for all segments
 * @param segments Array of segments
 * @returns Total elevation loss in meters
 */
export function getTotalElevationLoss(segments: WaypointSegment[]): number {
  return segments.reduce((total, segment) => total + segment.elevationLoss, 0);
}
