/**
 * Elevation profile utilities for extracting and processing elevation data from GeoJSON
 */

import { calculateDistance } from "./distance";

export interface ElevationPoint {
  distance: number; // Cumulative distance in meters
  elevation: number; // Elevation in meters
  lat: number; // Latitude
  lng: number; // Longitude
  originalIndex: number; // Index in original coordinate array
}

/**
 * Extract coordinates from GeoJSON geometry
 * @param geometry GeoJSON geometry object
 * @returns Array of [longitude, latitude, elevation?] coordinates
 */
function extractCoordinates(geometry: GeoJSON.Geometry): number[][] {
  const coords: number[][] = [];

  if (geometry.type === "Point") {
    coords.push(geometry.coordinates as number[]);
  } else if (geometry.type === "LineString") {
    coords.push(...geometry.coordinates);
  } else if (geometry.type === "MultiLineString") {
    for (const line of geometry.coordinates) {
      coords.push(...line);
    }
  } else if (geometry.type === "Polygon") {
    if (geometry.coordinates[0]) {
      coords.push(...geometry.coordinates[0]);
    }
  } else if (geometry.type === "MultiPolygon") {
    for (const polygon of geometry.coordinates) {
      if (polygon[0]) {
        coords.push(...polygon[0]);
      }
    }
  } else if (geometry.type === "GeometryCollection") {
    for (const subGeometry of geometry.geometries) {
      coords.push(...extractCoordinates(subGeometry));
    }
  }

  return coords;
}

/**
 * Check whether a GeoJSON FeatureCollection contains any finite elevation samples.
 * @param geoJson GeoJSON FeatureCollection
 * @returns True when at least one coordinate has a finite third elevation value
 */
export function hasElevationSamples(
  geoJson: GeoJSON.FeatureCollection,
): boolean {
  for (const feature of geoJson.features) {
    if (!feature.geometry) continue;

    const coordinates = extractCoordinates(feature.geometry);
    const containsElevation = coordinates.some(
      (coord) =>
        coord.length >= 3 &&
        typeof coord[2] === "number" &&
        Number.isFinite(coord[2]),
    );

    if (containsElevation) {
      return true;
    }
  }

  return false;
}

/**
 * Extract elevation profile from GeoJSON data
 * @param geoJson GeoJSON FeatureCollection
 * @returns Array of elevation points with distance, elevation, and coordinates
 */
export function extractElevationProfile(
  geoJson: GeoJSON.FeatureCollection,
): ElevationPoint[] {
  // Group coordinates by feature to analyze track segments
  const featureCoordinates: number[][][] = [];

  for (const feature of geoJson.features) {
    if (!feature.geometry) continue;

    const coordinates = extractCoordinates(feature.geometry);
    if (coordinates.length > 0) {
      featureCoordinates.push(coordinates);
    }
  }

  // Find the longest track segment (main track)
  let longestSegment: number[][] = [];
  let longestLength = 0;

  for (const segment of featureCoordinates) {
    if (segment.length > longestLength) {
      longestLength = segment.length;
      longestSegment = segment;
    }
  }

  // For multi-segment tracks, we need to be more careful about which segments to include
  let allCoordinates: number[][] = [];

  if (featureCoordinates.length === 1) {
    // Single track segment - use all coordinates
    allCoordinates = longestSegment;
  } else {
    // Multiple segments - use heuristics to determine which represent the main track

    // Start with the longest segment as the main track
    allCoordinates = [...longestSegment];

    // For other segments, only include them if they seem to connect to the main track
    // This helps avoid including waypoints, POIs, or alternate routes
    for (const segment of featureCoordinates) {
      if (segment === longestSegment || segment.length < 10) continue; // Skip short segments

      // Check if this segment connects reasonably to our main track
      const segmentStart = segment[0];
      const segmentEnd = segment[segment.length - 1];
      const mainStart = allCoordinates[0];
      const mainEnd = allCoordinates[allCoordinates.length - 1];

      if (
        segmentStart &&
        segmentEnd &&
        mainStart &&
        mainEnd &&
        segmentStart.length >= 2 &&
        segmentEnd.length >= 2 &&
        mainStart.length >= 2 &&
        mainEnd.length >= 2 &&
        typeof segmentStart[0] === "number" &&
        typeof segmentStart[1] === "number" &&
        typeof segmentEnd[0] === "number" &&
        typeof segmentEnd[1] === "number" &&
        typeof mainStart[0] === "number" &&
        typeof mainStart[1] === "number" &&
        typeof mainEnd[0] === "number" &&
        typeof mainEnd[1] === "number"
      ) {
        const startToMainStart = calculateDistance(
          segmentStart[1],
          segmentStart[0],
          mainStart[1],
          mainStart[0],
        );
        const startToMainEnd = calculateDistance(
          segmentStart[1],
          segmentStart[0],
          mainEnd[1],
          mainEnd[0],
        );
        const endToMainStart = calculateDistance(
          segmentEnd[1],
          segmentEnd[0],
          mainStart[1],
          mainStart[0],
        );
        const endToMainEnd = calculateDistance(
          segmentEnd[1],
          segmentEnd[0],
          mainEnd[1],
          mainEnd[0],
        );

        const minDistance = Math.min(
          startToMainStart,
          startToMainEnd,
          endToMainStart,
          endToMainEnd,
        );

        // Only include if the segment connects closely (within 1km) to the main track
        if (minDistance < 1000) {
          // Determine best connection point and add accordingly
          if (startToMainEnd < 500) {
            allCoordinates.push(...segment);
          } else if (endToMainStart < 500) {
            allCoordinates.unshift(...segment.reverse());
          }
        }
      }
    }
  }

  if (allCoordinates.length === 0) {
    return [];
  }

  // Filter out invalid coordinates before processing
  const validCoordinates = allCoordinates.filter((coord) => {
    if (!coord || coord.length < 2) return false;
    const [lon, lat] = coord;
    // Check for valid latitude and longitude ranges
    return (
      typeof lon === "number" &&
      typeof lat === "number" &&
      lat >= -90 &&
      lat <= 90 &&
      lon >= -180 &&
      lon <= 180 &&
      !isNaN(lat) &&
      !isNaN(lon)
    );
  });

  // Remove duplicate consecutive coordinates that might cause issues
  const deduplicatedCoordinates: number[][] = [];
  for (let i = 0; i < validCoordinates.length; i++) {
    const current = validCoordinates[i];
    const previous = i > 0 ? validCoordinates[i - 1] : null;

    if (!current) continue;

    // Skip if this point is identical to the previous one
    if (
      previous &&
      current.length >= 2 &&
      previous.length >= 2 &&
      current[0] !== undefined &&
      current[1] !== undefined &&
      previous[0] !== undefined &&
      previous[1] !== undefined &&
      Math.abs(current[0] - previous[0]) < 0.000001 &&
      Math.abs(current[1] - previous[1]) < 0.000001
    ) {
      continue;
    }

    deduplicatedCoordinates.push(current);
  }

  // Use all coordinates for maximum accuracy
  const coordinates = deduplicatedCoordinates;

  const elevationPoints: ElevationPoint[] = [];
  let cumulativeDistance = 0;

  for (let i = 0; i < coordinates.length; i++) {
    const coord = coordinates[i];

    if (!coord || coord.length < 2) continue;

    const lon = coord[0];
    const lat = coord[1];
    const elevation = coord[2] ?? 0;

    // Additional validation for numeric values
    if (
      typeof lon !== "number" ||
      typeof lat !== "number" ||
      isNaN(lon) ||
      isNaN(lat) ||
      lat < -90 ||
      lat > 90 ||
      lon < -180 ||
      lon > 180
    ) {
      console.warn("Skipping invalid coordinate at index", i, ":", coord);
      continue;
    }

    // Calculate distance from previous point
    if (i > 0) {
      const prevCoord = coordinates[i - 1];
      if (prevCoord && prevCoord.length >= 2) {
        const prevLon = prevCoord[0];
        const prevLat = prevCoord[1];
        if (
          typeof prevLon === "number" &&
          typeof prevLat === "number" &&
          !isNaN(prevLon) &&
          !isNaN(prevLat)
        ) {
          const distance = calculateDistance(prevLat, prevLon, lat, lon);
          // Accept large segment distances (e.g., sparse GPX with far-apart points)
          if (!isNaN(distance) && isFinite(distance) && distance >= 0) {
            cumulativeDistance += distance;
          } else {
            console.warn(
              "Skipping invalid distance calculation:",
              distance,
              "between points",
              i - 1,
              "and",
              i,
            );
            console.warn("Previous coord:", prevCoord);
            console.warn("Current coord:", coord);
          }
        }
      }
    }

    elevationPoints.push({
      distance: cumulativeDistance,
      elevation: elevation,
      lat: lat,
      lng: lon,
      originalIndex: i,
    });
  }

  // Final validation: remove any points that seem to jump backward significantly in distance
  // This can happen if coordinates get out of order during processing
  const validatedPoints: ElevationPoint[] = [];
  let maxDistanceSeen = 0;

  for (const point of elevationPoints) {
    // Allow for small backward movements (GPS noise), but reject large jumps backward
    if (point.distance >= maxDistanceSeen - 500) {
      // Stricter threshold
      validatedPoints.push(point);
      maxDistanceSeen = Math.max(maxDistanceSeen, point.distance);
    } else {
      console.warn(
        "Removing out-of-order point at distance",
        point.distance,
        "when max seen was",
        maxDistanceSeen,
      );
    }
  }

  return validatedPoints;
}

/**
 * Interpolate elevation and coordinates at a specific distance
 * @param elevationPoints Array of elevation points
 * @param targetDistance Distance to interpolate at
 * @returns Interpolated elevation point or null if distance is out of range
 */
export function interpolateAtDistance(
  elevationPoints: ElevationPoint[],
  targetDistance: number,
): ElevationPoint | null {
  if (elevationPoints.length === 0) return null;

  // Handle edge cases
  if (targetDistance <= 0) return elevationPoints[0] || null;
  const lastPoint = elevationPoints[elevationPoints.length - 1];
  if (!lastPoint || targetDistance >= lastPoint.distance) {
    return lastPoint || null;
  }

  // Find the two points that bracket the target distance
  for (let i = 1; i < elevationPoints.length; i++) {
    const prevPoint = elevationPoints[i - 1];
    const currentPoint = elevationPoints[i];

    if (!prevPoint || !currentPoint) continue;

    if (
      targetDistance >= prevPoint.distance &&
      targetDistance <= currentPoint.distance
    ) {
      // Linear interpolation
      const ratio =
        (targetDistance - prevPoint.distance) /
        (currentPoint.distance - prevPoint.distance);

      return {
        distance: targetDistance,
        elevation:
          prevPoint.elevation +
          ratio * (currentPoint.elevation - prevPoint.elevation),
        lat: prevPoint.lat + ratio * (currentPoint.lat - prevPoint.lat),
        lng: prevPoint.lng + ratio * (currentPoint.lng - prevPoint.lng),
        originalIndex: -1, // Interpolated point
      };
    }
  }

  return null;
}

/**
 * Get elevation statistics from elevation profile
 * @param elevationPoints Array of elevation points
 * @returns Statistics about the elevation profile
 */
export function getElevationStats(elevationPoints: ElevationPoint[]) {
  if (elevationPoints.length === 0) {
    return {
      minElevation: 0,
      maxElevation: 0,
      totalDistance: 0,
      elevationGain: 0,
      elevationLoss: 0,
    };
  }

  const firstPoint = elevationPoints[0];
  if (!firstPoint) {
    return {
      minElevation: 0,
      maxElevation: 0,
      totalDistance: 0,
      elevationGain: 0,
      elevationLoss: 0,
    };
  }

  let minElevation = firstPoint.elevation;
  let maxElevation = firstPoint.elevation;
  let elevationGain = 0;
  let elevationLoss = 0;

  for (let i = 1; i < elevationPoints.length; i++) {
    const currentPoint = elevationPoints[i];
    const prevPoint = elevationPoints[i - 1];

    if (!currentPoint || !prevPoint) continue;

    const currentElevation = currentPoint.elevation;
    const prevElevation = prevPoint.elevation;

    minElevation = Math.min(minElevation, currentElevation);
    maxElevation = Math.max(maxElevation, currentElevation);

    const elevationDiff = currentElevation - prevElevation;
    if (elevationDiff > 0) {
      elevationGain += elevationDiff;
    } else {
      elevationLoss += Math.abs(elevationDiff);
    }
  }

  const lastPoint = elevationPoints[elevationPoints.length - 1];

  return {
    minElevation,
    maxElevation,
    totalDistance: lastPoint?.distance || 0,
    elevationGain,
    elevationLoss,
  };
}

/**
 * Calculate grade percentage at a specific distance using a window of points
 * @param elevationPoints Array of elevation points
 * @param targetDistance Distance to calculate grade at
 * @param windowDistance Distance window around target point (in meters)
 * @returns Grade percentage (-100 to 100, where positive is uphill)
 */
export function calculateGradeAtDistance(
  elevationPoints: ElevationPoint[],
  targetDistance: number,
  windowDistance: number = 50, // 50 meter window by default
): number {
  if (elevationPoints.length < 2) return 0;

  // If windowDistance is 0, calculate grade using adjacent points
  if (windowDistance === 0) {
    // Find the two points that bracket the target distance
    for (let i = 0; i < elevationPoints.length - 1; i++) {
      const currentPoint = elevationPoints[i];
      const nextPoint = elevationPoints[i + 1];

      if (!currentPoint || !nextPoint) continue;

      if (
        targetDistance >= currentPoint.distance &&
        targetDistance <= nextPoint.distance
      ) {
        const rise = nextPoint.elevation - currentPoint.elevation;
        const run = nextPoint.distance - currentPoint.distance;

        if (run === 0) return 0;

        const grade = (rise / run) * 100;
        return Math.max(-100, Math.min(100, grade));
      }
    }

    // If not found between points, use first or last segment
    if (targetDistance <= elevationPoints[0]!.distance && elevationPoints[1]) {
      const rise = elevationPoints[1].elevation - elevationPoints[0]!.elevation;
      const run = elevationPoints[1].distance - elevationPoints[0]!.distance;
      if (run > 0) {
        const grade = (rise / run) * 100;
        return Math.max(-100, Math.min(100, grade));
      }
    }

    const lastIdx = elevationPoints.length - 1;
    if (
      targetDistance >= elevationPoints[lastIdx]!.distance &&
      elevationPoints[lastIdx - 1]
    ) {
      const rise =
        elevationPoints[lastIdx]!.elevation -
        elevationPoints[lastIdx - 1]!.elevation;
      const run =
        elevationPoints[lastIdx]!.distance -
        elevationPoints[lastIdx - 1]!.distance;
      if (run > 0) {
        const grade = (rise / run) * 100;
        return Math.max(-100, Math.min(100, grade));
      }
    }

    return 0;
  }

  // Find points within the window around the target distance
  const halfWindow = windowDistance / 2;
  const startDistance = targetDistance - halfWindow;
  const endDistance = targetDistance + halfWindow;

  // Find the points that bracket our window
  let startPoint: ElevationPoint | null = null;
  let endPoint: ElevationPoint | null = null;

  // Find the start point (interpolate if needed)
  for (let i = 0; i < elevationPoints.length - 1; i++) {
    const currentPoint = elevationPoints[i];
    const nextPoint = elevationPoints[i + 1];

    if (!currentPoint || !nextPoint) continue;

    if (
      startDistance >= currentPoint.distance &&
      startDistance <= nextPoint.distance
    ) {
      // Interpolate the start point
      const ratio =
        (startDistance - currentPoint.distance) /
        (nextPoint.distance - currentPoint.distance);
      startPoint = {
        distance: startDistance,
        elevation:
          currentPoint.elevation +
          ratio * (nextPoint.elevation - currentPoint.elevation),
        lat: currentPoint.lat + ratio * (nextPoint.lat - currentPoint.lat),
        lng: currentPoint.lng + ratio * (nextPoint.lng - currentPoint.lng),
        originalIndex: -1,
      };
      break;
    }
  }

  // Find the end point (interpolate if needed)
  for (let i = 0; i < elevationPoints.length - 1; i++) {
    const currentPoint = elevationPoints[i];
    const nextPoint = elevationPoints[i + 1];

    if (!currentPoint || !nextPoint) continue;

    if (
      endDistance >= currentPoint.distance &&
      endDistance <= nextPoint.distance
    ) {
      // Interpolate the end point
      const ratio =
        (endDistance - currentPoint.distance) /
        (nextPoint.distance - currentPoint.distance);
      endPoint = {
        distance: endDistance,
        elevation:
          currentPoint.elevation +
          ratio * (nextPoint.elevation - currentPoint.elevation),
        lat: currentPoint.lat + ratio * (nextPoint.lat - currentPoint.lat),
        lng: currentPoint.lng + ratio * (nextPoint.lng - currentPoint.lng),
        originalIndex: -1,
      };
      break;
    }
  }

  // Fall back to actual points if we can't interpolate
  if (!startPoint) {
    // Use the closest point at or before startDistance
    for (let i = 0; i < elevationPoints.length; i++) {
      const point = elevationPoints[i];
      if (point && point.distance >= startDistance) {
        startPoint = elevationPoints[Math.max(0, i - 1)] || point;
        break;
      }
    }
    if (!startPoint) startPoint = elevationPoints[0] || null;
  }

  if (!endPoint) {
    // Use the closest point at or after endDistance
    for (let i = elevationPoints.length - 1; i >= 0; i--) {
      const point = elevationPoints[i];
      if (point && point.distance <= endDistance) {
        endPoint =
          elevationPoints[Math.min(elevationPoints.length - 1, i + 1)] || point;
        break;
      }
    }
    if (!endPoint)
      endPoint = elevationPoints[elevationPoints.length - 1] || null;
  }

  if (!startPoint || !endPoint || startPoint.distance === endPoint.distance) {
    return 0;
  }

  // Calculate grade: (rise / run) * 100
  const rise = endPoint.elevation - startPoint.elevation;
  const run = endPoint.distance - startPoint.distance;

  if (run === 0) return 0;

  const grade = (rise / run) * 100;

  // Clamp to reasonable range
  return Math.max(-100, Math.min(100, grade));
}
