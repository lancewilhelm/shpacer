/**
 * Waypoint utilities for extracting and processing waypoint data from GeoJSON
 */

import { calculateDistance } from "./distance";

export interface Waypoint {
  id: string;
  name: string;
  description?: string;
  lat: number; // Snapped coordinates on the route
  lng: number; // Snapped coordinates on the route
  originalLat?: number; // Original GPS coordinates from GPX file
  originalLng?: number; // Original GPS coordinates from GPX file
  elevation?: number;
  distance: number; // Distance along route in meters
  tags: string[]; // Array of tag IDs
  icon?: string;
  order: number; // Order along the route (0 = start, 999999 = finish)
  snapDistance?: number; // Distance from original point to snapped point (for quality assessment)
}

export interface WaypointMarker {
  waypoint: Waypoint;
  position: [number, number];
  popup?: string;
  icon?: string;
}

/**
 * Find the closest point on a line segment to a target point
 */
function closestPointOnSegment(
  targetLat: number,
  targetLng: number,
  startLat: number,
  startLng: number,
  endLat: number,
  endLng: number,
): { lat: number; lng: number; distance: number; ratio: number } {
  // Convert to simple cartesian coordinates for calculation
  const A = targetLat - startLat;
  const B = targetLng - startLng;
  const C = endLat - startLat;
  const D = endLng - startLng;

  const dot = A * C + B * D;
  const lenSq = C * C + D * D;

  let param = -1;
  if (lenSq !== 0) {
    param = dot / lenSq;
  }

  let closestLat: number;
  let closestLng: number;
  let ratio: number;

  if (param < 0) {
    // Closest point is the start of the segment
    closestLat = startLat;
    closestLng = startLng;
    ratio = 0;
  } else if (param > 1) {
    // Closest point is the end of the segment
    closestLat = endLat;
    closestLng = endLng;
    ratio = 1;
  } else {
    // Closest point is somewhere on the segment
    closestLat = startLat + param * C;
    closestLng = startLng + param * D;
    ratio = param;
  }

  const distance = calculateDistance(
    targetLat,
    targetLng,
    closestLat,
    closestLng,
  );
  return { lat: closestLat, lng: closestLng, distance, ratio };
}

/**
 * Find the closest point on a route to a given coordinate with precise line segment snapping
 */
function findClosestPointOnRoute(
  targetLat: number,
  targetLng: number,
  routeCoordinates: number[][],
): {
  distance: number;
  closestIndex: number;
  snappedLat: number;
  snappedLng: number;
  snappedElevation?: number;
  segmentRatio: number;
} {
  let minDistance = Infinity;
  let closestIndex = 0;
  let cumulativeDistance = 0;
  let closestRouteDistance = 0;
  let snappedLat = targetLat;
  let snappedLng = targetLng;
  let snappedElevation: number | undefined;
  let segmentRatio = 0;

  for (let i = 0; i < routeCoordinates.length - 1; i++) {
    const startCoord = routeCoordinates[i];
    const endCoord = routeCoordinates[i + 1];

    if (
      !startCoord ||
      !endCoord ||
      startCoord.length < 2 ||
      endCoord.length < 2
    )
      continue;

    const [startLng, startLat, startElev] = startCoord;
    const [endLng, endLat, endElev] = endCoord;

    if (
      typeof startLng !== "number" ||
      typeof startLat !== "number" ||
      typeof endLng !== "number" ||
      typeof endLat !== "number"
    )
      continue;

    // Find closest point on this line segment
    const closest = closestPointOnSegment(
      targetLat,
      targetLng,
      startLat,
      startLng,
      endLat,
      endLng,
    );

    if (closest.distance < minDistance) {
      minDistance = closest.distance;
      closestIndex = i;
      closestRouteDistance =
        cumulativeDistance +
        closest.ratio * calculateDistance(startLat, startLng, endLat, endLng);
      snappedLat = closest.lat;
      snappedLng = closest.lng;
      segmentRatio = closest.ratio;

      // Interpolate elevation if available
      if (typeof startElev === "number" && typeof endElev === "number") {
        snappedElevation = startElev + (endElev - startElev) * closest.ratio;
      } else if (typeof startElev === "number") {
        snappedElevation = startElev;
      } else if (typeof endElev === "number") {
        snappedElevation = endElev;
      }
    }

    // Calculate cumulative distance for next iteration
    cumulativeDistance += calculateDistance(startLat, startLng, endLat, endLng);
  }

  return {
    distance: closestRouteDistance,
    closestIndex,
    snappedLat,
    snappedLng,
    snappedElevation,
    segmentRatio,
  };
}

/**
 * Extract coordinates from GeoJSON geometry for route analysis
 */
function extractRouteCoordinates(
  geoJson: GeoJSON.FeatureCollection,
): number[][] {
  const coordinates: number[][] = [];

  for (const feature of geoJson.features) {
    if (feature.geometry.type === "LineString") {
      coordinates.push(...feature.geometry.coordinates);
    } else if (feature.geometry.type === "MultiLineString") {
      for (const line of feature.geometry.coordinates) {
        coordinates.push(...line);
      }
    }
  }

  return coordinates;
}

/**
 * Extract waypoints from GeoJSON data with precise route snapping
 */
export function extractWaypoints(
  geoJson: GeoJSON.FeatureCollection,
): Waypoint[] {
  const waypoints: Waypoint[] = [];
  const routeCoordinates = extractRouteCoordinates(geoJson);

  // Calculate total route distance to avoid finish waypoint conflict
  let totalRouteDistance = 0;
  for (let i = 1; i < routeCoordinates.length; i++) {
    const prevCoord = routeCoordinates[i - 1];
    const currentCoord = routeCoordinates[i];

    if (
      prevCoord &&
      currentCoord &&
      prevCoord.length >= 2 &&
      currentCoord.length >= 2
    ) {
      const [prevLng, prevLat] = prevCoord;
      const [currentLng, currentLat] = currentCoord;

      if (
        typeof prevLng === "number" &&
        typeof prevLat === "number" &&
        typeof currentLng === "number" &&
        typeof currentLat === "number"
      ) {
        totalRouteDistance += calculateDistance(
          prevLat,
          prevLng,
          currentLat,
          currentLng,
        );
      }
    }
  }

  // Extract Point features as waypoints
  for (const feature of geoJson.features) {
    if (feature.geometry.type === "Point") {
      const [lng, lat, elevation] = feature.geometry.coordinates;

      if (typeof lng !== "number" || typeof lat !== "number") continue;

      const properties = feature.properties || {};
      const name =
        properties.name || properties.title || properties.desc || "Waypoint";

      // Find the closest point on the route to determine distance and snap coordinates
      const snappedResult = findClosestPointOnRoute(lat, lng, routeCoordinates);

      // Ensure imported waypoints don't conflict with start/finish positions
      // Add minimum buffer to avoid being treated as start waypoint (distance 0)
      // and finish waypoint (distance = totalRouteDistance)
      let adjustedDistance = snappedResult.distance;
      const MIN_BUFFER = 50; // 50 meters minimum buffer

      if (adjustedDistance < MIN_BUFFER) {
        adjustedDistance = MIN_BUFFER;
      } else if (adjustedDistance > totalRouteDistance - MIN_BUFFER) {
        adjustedDistance = totalRouteDistance - MIN_BUFFER;
      }

      const waypoint: Waypoint = {
        id: `waypoint-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        name: String(name),
        // Remove description for waypoints - they should not have descriptions
        lat: snappedResult.snappedLat, // Use snapped coordinates
        lng: snappedResult.snappedLng, // Use snapped coordinates
        originalLat: lat, // Store original coordinates
        originalLng: lng, // Store original coordinates
        elevation:
          snappedResult.snappedElevation ||
          (typeof elevation === "number" ? elevation : undefined),
        distance: adjustedDistance, // Use adjusted distance to avoid conflicts
        tags: [], // No tags by default, user can add them later
        order: Math.floor(adjustedDistance), // Use adjusted distance as order
        snapDistance: calculateDistance(
          lat,
          lng,
          snappedResult.snappedLat,
          snappedResult.snappedLng,
        ),
      };

      waypoints.push(waypoint);
    }
  }

  return waypoints;
}

/**
 * Generate start and finish waypoints for a route
 */
export function generateStartFinishWaypoints(
  geoJson: GeoJSON.FeatureCollection,
): Waypoint[] {
  const routeCoordinates = extractRouteCoordinates(geoJson);

  if (routeCoordinates.length < 2) {
    return [];
  }

  const waypoints: Waypoint[] = [];

  // Start waypoint
  const startCoord = routeCoordinates[0];
  if (startCoord && startCoord.length >= 2) {
    const [startLng, startLat, startElevation] = startCoord;

    if (typeof startLng === "number" && typeof startLat === "number") {
      waypoints.push({
        id: `start-${Date.now()}`,
        name: "Start",
        lat: startLat,
        lng: startLng,
        elevation:
          typeof startElevation === "number" ? startElevation : undefined,
        distance: 0,
        tags: [], // No tags by default
        icon: "heroicons:play",
        order: 0,
      });
    }
  }

  // Calculate total distance for finish waypoint
  let totalDistance = 0;
  for (let i = 1; i < routeCoordinates.length; i++) {
    const prevCoord = routeCoordinates[i - 1];
    const currentCoord = routeCoordinates[i];

    if (
      prevCoord &&
      currentCoord &&
      prevCoord.length >= 2 &&
      currentCoord.length >= 2
    ) {
      const [prevLng, prevLat] = prevCoord;
      const [currentLng, currentLat] = currentCoord;

      if (
        typeof prevLng === "number" &&
        typeof prevLat === "number" &&
        typeof currentLng === "number" &&
        typeof currentLat === "number"
      ) {
        totalDistance += calculateDistance(
          prevLat,
          prevLng,
          currentLat,
          currentLng,
        );
      }
    }
  }

  // Finish waypoint
  const finishCoord = routeCoordinates[routeCoordinates.length - 1];
  if (finishCoord && finishCoord.length >= 2) {
    const [finishLng, finishLat, finishElevation] = finishCoord;

    if (typeof finishLng === "number" && typeof finishLat === "number") {
      waypoints.push({
        id: `finish-${Date.now()}`,
        name: "Finish",
        lat: finishLat,
        lng: finishLng,
        elevation:
          typeof finishElevation === "number" ? finishElevation : undefined,
        distance: totalDistance,
        tags: [], // No tags by default
        icon: "heroicons:flag",
        order: 999999,
      });
    }
  }

  return waypoints;
}

/**
 * Combine extracted waypoints with generated start/finish waypoints
 */
export function processAllWaypoints(
  geoJson: GeoJSON.FeatureCollection,
): Waypoint[] {
  const extractedWaypoints = extractWaypoints(geoJson);
  const startFinishWaypoints = generateStartFinishWaypoints(geoJson);

  // Combine and sort by order (distance)
  const allWaypoints = [...startFinishWaypoints, ...extractedWaypoints];

  return allWaypoints.sort((a, b) => a.order - b.order);
}

/**
 * Convert waypoints to marker format for map display
 */
export function waypointsToMarkers(waypoints: Waypoint[]): WaypointMarker[] {
  return waypoints.map((waypoint) => ({
    waypoint,
    position: [waypoint.lat, waypoint.lng] as [number, number],
    popup: `<strong>${waypoint.name}</strong>`,
    icon: waypoint.icon,
  }));
}

/**
 * Get waypoint color based on type
 * @deprecated Use getWaypointColorFromOrder for new database waypoints
 */
export function getWaypointColor(
  type: "start" | "finish" | "waypoint" | "poi",
): string {
  switch (type) {
    case "start":
      return "#10b981"; // Green
    case "finish":
      return "#ef4444"; // Red
    case "waypoint":
      return "#3b82f6"; // Blue
    case "poi":
      return "#f59e0b"; // Amber
    default:
      return "#6b7280"; // Gray
  }
}

/**
 * Create a new waypoint at a specific position on the route
 */
export function createWaypointAtPosition(
  geoJson: GeoJSON.FeatureCollection,
  lat: number,
  lng: number,
  name: string,
  tags: string[] = [],
): Waypoint {
  const routeCoordinates = extractRouteCoordinates(geoJson);
  const snappedResult = findClosestPointOnRoute(lat, lng, routeCoordinates);

  return {
    id: `waypoint-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    name,
    lat: snappedResult.snappedLat,
    lng: snappedResult.snappedLng,
    originalLat: lat,
    originalLng: lng,
    elevation: snappedResult.snappedElevation,
    distance: snappedResult.distance,
    tags,
    order: Math.floor(snappedResult.distance),
    snapDistance: calculateDistance(
      lat,
      lng,
      snappedResult.snappedLat,
      snappedResult.snappedLng,
    ),
  };
}

/**
 * Update waypoint position by snapping to a new location on the route
 */
export function updateWaypointPosition(
  waypoint: Waypoint,
  geoJson: GeoJSON.FeatureCollection,
  newLat: number,
  newLng: number,
): Waypoint {
  const routeCoordinates = extractRouteCoordinates(geoJson);
  const snappedResult = findClosestPointOnRoute(
    newLat,
    newLng,
    routeCoordinates,
  );

  return {
    ...waypoint,
    lat: snappedResult.snappedLat,
    lng: snappedResult.snappedLng,
    originalLat: newLat,
    originalLng: newLng,
    elevation: snappedResult.snappedElevation,
    distance: snappedResult.distance,
    order: Math.floor(snappedResult.distance),
    snapDistance: calculateDistance(
      newLat,
      newLng,
      snappedResult.snappedLat,
      snappedResult.snappedLng,
    ),
  };
}

/**
 * Validate waypoint quality based on snap distance
 */
export function getWaypointQuality(
  waypoint: Waypoint,
): "excellent" | "good" | "fair" | "poor" {
  const snapDistance = waypoint.snapDistance || 0;

  if (snapDistance < 10) return "excellent"; // Within 10 meters
  if (snapDistance < 50) return "good"; // Within 50 meters
  if (snapDistance < 200) return "fair"; // Within 200 meters
  return "poor"; // Over 200 meters
}

/**
 * Get quality color for UI display
 */
export function getQualityColor(
  quality: ReturnType<typeof getWaypointQuality>,
): string {
  switch (quality) {
    case "excellent":
      return "#10b981"; // Green
    case "good":
      return "#3b82f6"; // Blue
    case "fair":
      return "#f59e0b"; // Amber
    case "poor":
      return "#ef4444"; // Red
  }
}

/**
 * Get waypoint color for database waypoints (using order to determine start/finish)
 * This function works with the new database schema that uses tags instead of type
 */
export function getWaypointColorFromOrder(
  waypoint: { order: number },
  allWaypoints: { order: number }[],
): string {
  // Check if this is a start waypoint (order 0)
  if (waypoint.order === 0) {
    return "#10b981"; // Green for start
  }

  // Check if this is a finish waypoint (highest order)
  const maxOrder = Math.max(...allWaypoints.map((w) => w.order));
  if (waypoint.order === maxOrder && waypoint.order > 0) {
    return "#ef4444"; // Red for finish
  }

  // Regular waypoints get blue
  return "#3b82f6";
}
