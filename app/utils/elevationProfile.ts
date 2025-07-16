/**
 * Elevation profile utilities for extracting and processing elevation data from GeoJSON
 */

export interface ElevationPoint {
  distance: number; // Cumulative distance in meters
  elevation: number; // Elevation in meters
  lat: number; // Latitude
  lng: number; // Longitude
  originalIndex: number; // Index in original coordinate array
}

/**
 * Calculate the distance between two points using Haversine formula
 * @param lat1 Latitude of point 1
 * @param lon1 Longitude of point 1
 * @param lat2 Latitude of point 2
 * @param lon2 Longitude of point 2
 * @returns Distance in meters
 */
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000; // Earth's radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Extract coordinates from GeoJSON geometry
 * @param geometry GeoJSON geometry object
 * @returns Array of [longitude, latitude, elevation?] coordinates
 */
function extractCoordinates(geometry: GeoJSON.Geometry): number[][] {
  const coords: number[][] = [];
  
  if (geometry.type === 'Point') {
    coords.push(geometry.coordinates as number[]);
  } else if (geometry.type === 'LineString') {
    coords.push(...geometry.coordinates);
  } else if (geometry.type === 'MultiLineString') {
    for (const line of geometry.coordinates) {
      coords.push(...line);
    }
  } else if (geometry.type === 'Polygon') {
    if (geometry.coordinates[0]) {
      coords.push(...geometry.coordinates[0]);
    }
  } else if (geometry.type === 'MultiPolygon') {
    for (const polygon of geometry.coordinates) {
      if (polygon[0]) {
        coords.push(...polygon[0]);
      }
    }
  } else if (geometry.type === 'GeometryCollection') {
    for (const subGeometry of geometry.geometries) {
      coords.push(...extractCoordinates(subGeometry));
    }
  }
  
  return coords;
}

/**
 * Extract elevation profile from GeoJSON data
 * @param geoJson GeoJSON FeatureCollection
 * @param maxPoints Maximum number of points to include (for performance)
 * @returns Array of elevation points with distance, elevation, and coordinates
 */
export function extractElevationProfile(
  geoJson: GeoJSON.FeatureCollection,
  maxPoints: number = 1000
): ElevationPoint[] {
  const allCoordinates: number[][] = [];
  
  // Extract all coordinates from all features
  for (const feature of geoJson.features) {
    const coordinates = extractCoordinates(feature.geometry);
    allCoordinates.push(...coordinates);
  }
  
  if (allCoordinates.length === 0) {
    return [];
  }
  
  // Downsample if we have too many points
  let coordinates = allCoordinates;
  if (allCoordinates.length > maxPoints) {
    const step = Math.floor(allCoordinates.length / maxPoints);
    coordinates = allCoordinates.filter((_, index) => index % step === 0);
    // Always include the last point
    const lastCoord = allCoordinates[allCoordinates.length - 1];
    if (lastCoord && coordinates[coordinates.length - 1] !== lastCoord) {
      coordinates.push(lastCoord);
    }
  }
  
  const elevationPoints: ElevationPoint[] = [];
  let cumulativeDistance = 0;
  
  for (let i = 0; i < coordinates.length; i++) {
    const coord = coordinates[i];
    
    if (!coord || coord.length < 2) continue;
    
    const lon = coord[0];
    const lat = coord[1];
    const elevation = coord[2] ?? 0;
    
    if (typeof lon !== 'number' || typeof lat !== 'number') continue;
    
    // Calculate distance from previous point
    if (i > 0) {
      const prevCoord = coordinates[i - 1];
      if (prevCoord && prevCoord.length >= 2) {
        const prevLon = prevCoord[0];
        const prevLat = prevCoord[1];
        if (typeof prevLon === 'number' && typeof prevLat === 'number') {
          const distance = calculateDistance(prevLat, prevLon, lat, lon);
          cumulativeDistance += distance;
        }
      }
    }
    
    elevationPoints.push({
      distance: cumulativeDistance,
      elevation: elevation,
      lat: lat,
      lng: lon,
      originalIndex: i
    });
  }
  
  return elevationPoints;
}

/**
 * Interpolate elevation and coordinates at a specific distance
 * @param elevationPoints Array of elevation points
 * @param targetDistance Distance to interpolate at
 * @returns Interpolated elevation point or null if distance is out of range
 */
export function interpolateAtDistance(
  elevationPoints: ElevationPoint[],
  targetDistance: number
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
    
    if (targetDistance >= prevPoint.distance && targetDistance <= currentPoint.distance) {
      // Linear interpolation
      const ratio = (targetDistance - prevPoint.distance) / (currentPoint.distance - prevPoint.distance);
      
      return {
        distance: targetDistance,
        elevation: prevPoint.elevation + ratio * (currentPoint.elevation - prevPoint.elevation),
        lat: prevPoint.lat + ratio * (currentPoint.lat - prevPoint.lat),
        lng: prevPoint.lng + ratio * (currentPoint.lng - prevPoint.lng),
        originalIndex: -1 // Interpolated point
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
      elevationLoss: 0
    };
  }
  
  const firstPoint = elevationPoints[0];
  if (!firstPoint) {
    return {
      minElevation: 0,
      maxElevation: 0,
      totalDistance: 0,
      elevationGain: 0,
      elevationLoss: 0
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
    elevationLoss
  };
}
