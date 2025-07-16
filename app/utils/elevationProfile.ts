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
 * @returns Array of elevation points with distance, elevation, and coordinates
 */
export function extractElevationProfile(
  geoJson: GeoJSON.FeatureCollection
): ElevationPoint[] {
  console.log('Processing GeoJSON with', geoJson.features.length, 'features');
  
  // Group coordinates by feature to analyze track segments
  const featureCoordinates: number[][][] = [];
  
  for (const feature of geoJson.features) {
    const coordinates = extractCoordinates(feature.geometry);
    if (coordinates.length > 0) {
      featureCoordinates.push(coordinates);
      console.log('Feature with', coordinates.length, 'coordinates');
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
  
  console.log('Using longest segment with', longestSegment.length, 'coordinates out of', featureCoordinates.length, 'total segments');
  
  // For multi-segment tracks, we need to be more careful about which segments to include
  let allCoordinates: number[][] = [];
  
  if (featureCoordinates.length === 1) {
    // Single track segment - use all coordinates
    allCoordinates = longestSegment;
  } else {
    // Multiple segments - use heuristics to determine which represent the main track
    console.log('Multi-segment track detected, analyzing segments...');
    
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
      
      if (segmentStart && segmentEnd && mainStart && mainEnd &&
          segmentStart.length >= 2 && segmentEnd.length >= 2 &&
          mainStart.length >= 2 && mainEnd.length >= 2 &&
          typeof segmentStart[0] === 'number' && typeof segmentStart[1] === 'number' &&
          typeof segmentEnd[0] === 'number' && typeof segmentEnd[1] === 'number' &&
          typeof mainStart[0] === 'number' && typeof mainStart[1] === 'number' &&
          typeof mainEnd[0] === 'number' && typeof mainEnd[1] === 'number') {
        const startToMainStart = calculateDistance(segmentStart[1], segmentStart[0], mainStart[1], mainStart[0]);
        const startToMainEnd = calculateDistance(segmentStart[1], segmentStart[0], mainEnd[1], mainEnd[0]);
        const endToMainStart = calculateDistance(segmentEnd[1], segmentEnd[0], mainStart[1], mainStart[0]);
        const endToMainEnd = calculateDistance(segmentEnd[1], segmentEnd[0], mainEnd[1], mainEnd[0]);
        
        const minDistance = Math.min(startToMainStart, startToMainEnd, endToMainStart, endToMainEnd);
        
        // Only include if the segment connects closely (within 1km) to the main track
        if (minDistance < 1000) {
          console.log('Including connected segment with', segment.length, 'points (min distance:', minDistance, 'm)');
          // Determine best connection point and add accordingly
          if (startToMainEnd < 500) {
            allCoordinates.push(...segment);
          } else if (endToMainStart < 500) {
            allCoordinates.unshift(...segment.reverse());
          }
        } else {
          console.log('Skipping disconnected segment with', segment.length, 'points (min distance:', minDistance, 'm)');
        }
      }
    }
  }
  
  console.log('Raw coordinates extracted:', allCoordinates.length);
  
  if (allCoordinates.length === 0) {
    return [];
  }
  
  // Filter out invalid coordinates before processing
  const validCoordinates = allCoordinates.filter(coord => {
    if (!coord || coord.length < 2) return false;
    const [lon, lat] = coord;
    // Check for valid latitude and longitude ranges
    return typeof lon === 'number' && typeof lat === 'number' && 
           lat >= -90 && lat <= 90 && 
           lon >= -180 && lon <= 180 &&
           !isNaN(lat) && !isNaN(lon);
  });
  
  console.log('Valid coordinates after filtering:', validCoordinates.length);
  
  // Remove duplicate consecutive coordinates that might cause issues
  const deduplicatedCoordinates: number[][] = [];
  for (let i = 0; i < validCoordinates.length; i++) {
    const current = validCoordinates[i];
    const previous = i > 0 ? validCoordinates[i - 1] : null;
    
    if (!current) continue;
    
    // Skip if this point is identical to the previous one
    if (previous && current.length >= 2 && previous.length >= 2 &&
        current[0] !== undefined && current[1] !== undefined &&
        previous[0] !== undefined && previous[1] !== undefined &&
        Math.abs(current[0] - previous[0]) < 0.000001 && 
        Math.abs(current[1] - previous[1]) < 0.000001) {
      continue;
    }
    
    deduplicatedCoordinates.push(current);
  }
  
  console.log('Coordinates after deduplication:', deduplicatedCoordinates.length);
  
  // Use all coordinates for maximum accuracy
  const coordinates = deduplicatedCoordinates;
  console.log('Using all coordinates for maximum accuracy:', coordinates.length);
  
  const elevationPoints: ElevationPoint[] = [];
  let cumulativeDistance = 0;
  
  for (let i = 0; i < coordinates.length; i++) {
    const coord = coordinates[i];
    
    if (!coord || coord.length < 2) continue;
    
    const lon = coord[0];
    const lat = coord[1];
    const elevation = coord[2] ?? 0;
    
    // Additional validation for numeric values
    if (typeof lon !== 'number' || typeof lat !== 'number' || 
        isNaN(lon) || isNaN(lat) || 
        lat < -90 || lat > 90 || 
        lon < -180 || lon > 180) {
      console.warn('Skipping invalid coordinate at index', i, ':', coord);
      continue;
    }
    
    // Calculate distance from previous point
    if (i > 0) {
      const prevCoord = coordinates[i - 1];
      if (prevCoord && prevCoord.length >= 2) {
        const prevLon = prevCoord[0];
        const prevLat = prevCoord[1];
        if (typeof prevLon === 'number' && typeof prevLat === 'number' &&
            !isNaN(prevLon) && !isNaN(prevLat)) {
          const distance = calculateDistance(prevLat, prevLon, lat, lon);
          // Skip if distance calculation seems unreasonable (> 5km between consecutive points for more strict filtering)
          if (!isNaN(distance) && distance < 5000) {
            cumulativeDistance += distance;
          } else {
            console.warn('Skipping unreasonable distance calculation:', distance, 'between points', i-1, 'and', i);
            console.warn('Previous coord:', prevCoord);
            console.warn('Current coord:', coord);
            // For very large jumps, don't add the distance but still include the point
            // This prevents teleportation but keeps the actual track data
          }
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
  
  // Final validation: remove any points that seem to jump backward significantly in distance
  // This can happen if coordinates get out of order during processing
  const validatedPoints: ElevationPoint[] = [];
  let maxDistanceSeen = 0;
  
  for (const point of elevationPoints) {
    // Allow for small backward movements (GPS noise), but reject large jumps backward
    if (point.distance >= maxDistanceSeen - 500) { // Stricter threshold
      validatedPoints.push(point);
      maxDistanceSeen = Math.max(maxDistanceSeen, point.distance);
    } else {
      console.warn('Removing out-of-order point at distance', point.distance, 'when max seen was', maxDistanceSeen);
    }
  }
  
  console.log('Final elevation points created:', validatedPoints.length);
  console.log('Total track distance:', validatedPoints[validatedPoints.length - 1]?.distance || 0, 'meters');
  console.log('Total track distance (km):', ((validatedPoints[validatedPoints.length - 1]?.distance || 0) / 1000).toFixed(1));
  
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
