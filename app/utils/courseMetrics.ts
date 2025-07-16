/**
 * Calculate distance and elevation metrics from GeoJSON data
 */

interface CourseMetrics {
  totalDistance: number; // in meters
  elevationGain: number; // in meters
  elevationLoss: number; // in meters
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
  const R = 6371e3; // Earth's radius in meters
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
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
 * Calculate course metrics from GeoJSON data
 * @param geoJson GeoJSON FeatureCollection
 * @returns Course metrics including distance and elevation data
 */
export function calculateCourseMetrics(geoJson: GeoJSON.FeatureCollection): CourseMetrics {
  let totalDistance = 0;
  let elevationGain = 0;
  let elevationLoss = 0;
  
  // Process each feature in the collection
  for (const feature of geoJson.features) {
    const coordinates = extractCoordinates(feature.geometry);
    
    if (coordinates.length < 2) continue;
    
    // Calculate distance and elevation for this feature
    for (let i = 1; i < coordinates.length; i++) {
      const coord1 = coordinates[i - 1];
      const coord2 = coordinates[i];
      
      if (!coord1 || !coord2 || coord1.length < 2 || coord2.length < 2) continue;
      
      const [lon1, lat1, elev1] = coord1;
      const [lon2, lat2, elev2] = coord2;

      if (!lon1 || !lat1 || !lon2 || !lat2) continue; // Skip if coordinates are invalid
      
      // Calculate distance between consecutive points
      const distance = calculateDistance(lat1, lon1, lat2, lon2);
      totalDistance += distance;
      
      // Calculate elevation gain/loss if elevation data is available
      if (elev1 !== undefined && elev2 !== undefined) {
        const elevationDiff = elev2 - elev1;
        if (elevationDiff > 0) {
          elevationGain += elevationDiff;
        } else {
          elevationLoss += Math.abs(elevationDiff);
        }
      }
    }
  }
  
  return {
    totalDistance: Math.round(totalDistance),
    elevationGain: Math.round(elevationGain),
    elevationLoss: Math.round(elevationLoss),
  };
}

/**
 * Format distance for display
 * @param meters Distance in meters
 * @param unit Unit preference: 'kilometers' or 'miles'
 * @returns Formatted distance string
 */
export function formatDistance(meters: number, unit: 'kilometers' | 'miles' = 'kilometers'): string {
  if (unit === 'miles') {
    const miles = meters * 0.000621371;
    if (miles < 1) {
      const feet = meters * 3.28084;
      return `${Math.round(feet)}ft`;
    } else {
      return `${miles.toFixed(1)}mi`;
    }
  } else {
    if (meters < 1000) {
      return `${meters}m`;
    } else {
      return `${(meters / 1000).toFixed(1)}km`;
    }
  }
}

/**
 * Format elevation for display
 * @param meters Elevation in meters
 * @param unit Unit preference: 'meters' or 'feet'
 * @returns Formatted elevation string
 */
export function formatElevation(meters: number, unit: 'meters' | 'feet' = 'meters'): string {
  if (unit === 'feet') {
    const feet = meters * 3.28084;
    return `${Math.round(feet)}ft`;
  } else {
    return `${meters}m`;
  }
}
