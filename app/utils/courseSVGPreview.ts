/**
 * Generate SVG preview from GeoJSON course data
 */

interface SVGBounds {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

interface SVGCoordinate {
  x: number;
  y: number;
}

/**
 * Extract all coordinate pairs from GeoJSON
 * @param geoJson GeoJSON FeatureCollection
 * @returns Array of [longitude, latitude] coordinates
 */
function extractAllCoordinates(geoJson: GeoJSON.FeatureCollection): [number, number][] {
  const coords: [number, number][] = [];
  
  for (const feature of geoJson.features) {
    const featureCoords = extractGeometryCoordinates(feature.geometry);
    coords.push(...featureCoords);
  }
  
  return coords;
}

/**
 * Extract coordinates from a single geometry
 * @param geometry GeoJSON Geometry
 * @returns Array of [longitude, latitude] coordinates
 */
function extractGeometryCoordinates(geometry: GeoJSON.Geometry): [number, number][] {
  const coords: [number, number][] = [];
  
  if (geometry.type === 'Point') {
    const [lon, lat] = geometry.coordinates as [number, number];
    coords.push([lon, lat]);
  } else if (geometry.type === 'LineString') {
    for (const coord of geometry.coordinates) {
      const [lon, lat] = coord as [number, number];
      coords.push([lon, lat]);
    }
  } else if (geometry.type === 'MultiLineString') {
    for (const line of geometry.coordinates) {
      for (const coord of line) {
        const [lon, lat] = coord as [number, number];
        coords.push([lon, lat]);
      }
    }
  } else if (geometry.type === 'Polygon') {
    if (geometry.coordinates[0]) {
      for (const coord of geometry.coordinates[0]) {
        const [lon, lat] = coord as [number, number];
        coords.push([lon, lat]);
      }
    }
  } else if (geometry.type === 'MultiPolygon') {
    for (const polygon of geometry.coordinates) {
      if (polygon[0]) {
        for (const coord of polygon[0]) {
          const [lon, lat] = coord as [number, number];
          coords.push([lon, lat]);
        }
      }
    }
  } else if (geometry.type === 'GeometryCollection') {
    for (const subGeometry of geometry.geometries) {
      coords.push(...extractGeometryCoordinates(subGeometry));
    }
  }
  
  return coords;
}

/**
 * Calculate the bounding box of coordinates
 * @param coordinates Array of [longitude, latitude] coordinates
 * @returns Bounding box
 */
function calculateBounds(coordinates: [number, number][]): SVGBounds {
  if (coordinates.length === 0) {
    return { minLat: 0, maxLat: 0, minLon: 0, maxLon: 0 };
  }
  
  const firstCoord = coordinates[0]!;
  let minLat = firstCoord[1];
  let maxLat = firstCoord[1];
  let minLon = firstCoord[0];
  let maxLon = firstCoord[0];
  
  for (const [lon, lat] of coordinates) {
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLon = Math.min(minLon, lon);
    maxLon = Math.max(maxLon, lon);
  }
  
  return { minLat, maxLat, minLon, maxLon };
}

/**
 * Convert geographic coordinates to SVG coordinates
 * @param coordinates Array of [longitude, latitude] coordinates
 * @param bounds Bounding box
 * @param width SVG width
 * @param height SVG height
 * @param padding Padding around the shape
 * @returns Array of SVG coordinates
 */
function coordinatesToSVG(
  coordinates: [number, number][],
  bounds: SVGBounds,
  width: number,
  height: number,
  padding: number = 8
): SVGCoordinate[] {
  const { minLat, maxLat, minLon, maxLon } = bounds;
  
  // Calculate scale factors
  const latRange = maxLat - minLat;
  const lonRange = maxLon - minLon;
  
  // Handle edge case where all points are the same
  if (latRange === 0 && lonRange === 0) {
    return [{ x: width / 2, y: height / 2 }];
  }
  
  // Calculate available space after padding
  const availableWidth = width - (padding * 2);
  const availableHeight = height - (padding * 2);
  
  return coordinates.map(([lon, lat]) => {
    // Normalize coordinates (0-1)
    const normalizedLon = lonRange > 0 ? (lon - minLon) / lonRange : 0.5;
    const normalizedLat = latRange > 0 ? (lat - minLat) / latRange : 0.5;
    
    // Convert to SVG coordinates (flip Y axis for SVG)
    const x = padding + normalizedLon * (lonRange > 0 ? availableWidth : 0);
    const y = padding + (1 - normalizedLat) * (latRange > 0 ? availableHeight : 0);
    
    return { x, y };
  });
}

/**
 * Generate SVG path string from coordinates
 * @param coordinates Array of SVG coordinates
 * @returns SVG path string
 */
function generateSVGPath(coordinates: SVGCoordinate[]): string {
  if (coordinates.length === 0) return '';
  if (coordinates.length === 1) {
    // Single point - create a small circle
    const firstCoord = coordinates[0]!;
    const { x, y } = firstCoord;
    return `M ${x - 2} ${y} A 2 2 0 1 1 ${x + 2} ${y} A 2 2 0 1 1 ${x - 2} ${y}`;
  }
  
  const firstCoord = coordinates[0]!;
  let path = `M ${firstCoord.x} ${firstCoord.y}`;
  
  for (let i = 1; i < coordinates.length; i++) {
    const coord = coordinates[i]!;
    path += ` L ${coord.x} ${coord.y}`;
  }
  
  return path;
}

/**
 * Calculate the perpendicular distance from a point to a line segment
 * @param point Point coordinates [lon, lat]
 * @param lineStart Line segment start [lon, lat]
 * @param lineEnd Line segment end [lon, lat]
 * @returns Distance in coordinate units
 */
function perpendicularDistance(
  point: [number, number],
  lineStart: [number, number],
  lineEnd: [number, number]
): number {
  const [px, py] = point;
  const [x1, y1] = lineStart;
  const [x2, y2] = lineEnd;
  
  const dx = x2 - x1;
  const dy = y2 - y1;
  
  // If the line segment is actually a point
  if (dx === 0 && dy === 0) {
    return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
  }
  
  // Calculate the perpendicular distance
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  
  return Math.sqrt((px - projX) ** 2 + (py - projY) ** 2);
}

/**
 * Douglas-Peucker line simplification algorithm
 * @param coordinates Array of [longitude, latitude] coordinates
 * @param tolerance Distance tolerance for simplification
 * @returns Simplified array of coordinates
 */
function douglasPeucker(
  coordinates: [number, number][],
  tolerance: number
): [number, number][] {
  if (coordinates.length <= 2) {
    return coordinates;
  }
  
  // Find the point with the maximum distance from the line between start and end
  let maxDistance = 0;
  let maxIndex = 0;
  const start = coordinates[0]!;
  const end = coordinates[coordinates.length - 1]!;
  
  for (let i = 1; i < coordinates.length - 1; i++) {
    const distance = perpendicularDistance(coordinates[i]!, start, end);
    if (distance > maxDistance) {
      maxDistance = distance;
      maxIndex = i;
    }
  }
  
  // If the maximum distance is greater than tolerance, recursively simplify
  if (maxDistance > tolerance) {
    // Recursive call on the left side
    const leftResults = douglasPeucker(coordinates.slice(0, maxIndex + 1), tolerance);
    // Recursive call on the right side
    const rightResults = douglasPeucker(coordinates.slice(maxIndex), tolerance);
    
    // Combine results (remove duplicate point at the junction)
    return [...leftResults.slice(0, -1), ...rightResults];
  } else {
    // All points can be removed except the endpoints
    return [start, end];
  }
}

/**
 * Simplify coordinates using Douglas-Peucker algorithm with adaptive tolerance
 * @param coordinates Array of [longitude, latitude] coordinates
 * @param maxPoints Maximum number of points desired
 * @returns Simplified array of coordinates
 */
function simplifyCoordinates(
  coordinates: [number, number][],
  maxPoints: number
): [number, number][] {
  if (coordinates.length <= maxPoints) {
    return coordinates;
  }
  
  // Calculate the bounding box to determine appropriate tolerance
  const bounds = calculateBounds(coordinates);
  const latRange = bounds.maxLat - bounds.minLat;
  const lonRange = bounds.maxLon - bounds.minLon;
  const maxRange = Math.max(latRange, lonRange);
  
  // Start with a small tolerance and increase until we get the desired point count
  let tolerance = maxRange * 0.0001; // Start with 0.01% of the range
  let simplified = coordinates;
  
  // Binary search for the right tolerance
  let minTolerance = 0;
  let maxTolerance = maxRange * 0.1; // Up to 10% of the range
  
  for (let i = 0; i < 10; i++) { // Limit iterations to prevent infinite loops
    simplified = douglasPeucker(coordinates, tolerance);
    
    if (simplified.length <= maxPoints) {
      maxTolerance = tolerance;
      if (simplified.length >= maxPoints * 0.8) { // Within 80% of target is good enough
        break;
      }
      tolerance = (minTolerance + tolerance) / 2;
    } else {
      minTolerance = tolerance;
      tolerance = (tolerance + maxTolerance) / 2;
    }
    
    // Prevent infinite loops with very small tolerances
    if (maxTolerance - minTolerance < maxRange * 0.00001) {
      break;
    }
  }
  
  return simplified;
}

/**
 * Generate an SVG preview of a course from GeoJSON data
 * @param geoJson GeoJSON FeatureCollection
 * @param width SVG width (default: 120)
 * @param height SVG height (default: 80)
 * @param strokeColor Stroke color (default: currentColor)
 * @param strokeWidth Stroke width (default: 2)
 * @returns SVG string
 */
export function generateCourseSVGPreview(
  geoJson: GeoJSON.FeatureCollection,
  width: number = 120,
  height: number = 80,
  strokeColor: string = 'currentColor',
  strokeWidth: number = 2
): string {
  // Extract all coordinates
  const coordinates = extractAllCoordinates(geoJson);
  
  if (coordinates.length === 0) {
    return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <text x="50%" y="50%" text-anchor="middle" dominant-baseline="central" font-size="12" fill="${strokeColor}" opacity="0.5">No route</text>
    </svg>`;
  }
  
  // Calculate bounds
  const bounds = calculateBounds(coordinates);
  
  // Convert to SVG coordinates
  const svgCoords = coordinatesToSVG(coordinates, bounds, width, height);
  
  // Generate path
  const pathString = generateSVGPath(svgCoords);
  
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
    <path d="${pathString}" stroke="${strokeColor}" stroke-width="${strokeWidth}" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity="0.8"/>
  </svg>`;
}

/**
 * Generate a simplified SVG preview with reduced point density for better performance
 * @param geoJson GeoJSON FeatureCollection
 * @param width SVG width (default: 120)
 * @param height SVG height (default: 80)
 * @param maxPoints Maximum number of points to include (default: 75)
 * @param strokeColor Stroke color (default: currentColor)
 * @param strokeWidth Stroke width (default: 2)
 * @returns SVG string
 */
export function generateSimplifiedCourseSVGPreview(
  geoJson: GeoJSON.FeatureCollection,
  width: number = 120,
  height: number = 80,
  maxPoints: number = 75,
  strokeColor: string = 'currentColor',
  strokeWidth: number = 2
): string {
  // Extract all coordinates
  const allCoordinates = extractAllCoordinates(geoJson);
  
  if (allCoordinates.length === 0) {
    return generateCourseSVGPreview(geoJson, width, height, strokeColor, strokeWidth);
  }
  
  // Simplify coordinates using Douglas-Peucker algorithm
  const coordinates = simplifyCoordinates(allCoordinates, maxPoints);
  
  // Calculate bounds
  const bounds = calculateBounds(coordinates);
  
  // Convert to SVG coordinates
  const svgCoords = coordinatesToSVG(coordinates, bounds, width, height);
  
  // Generate path
  const pathString = generateSVGPath(svgCoords);
  
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
    <path d="${pathString}" stroke="${strokeColor}" stroke-width="${strokeWidth}" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity="0.8"/>
  </svg>`;
}

/**
 * Generate a simplified SVG path string for database storage
 * @param geoJson GeoJSON FeatureCollection
 * @param maxPoints Maximum number of points to include (default: 40)
 * @returns SVG path string for database storage
 */
export function generateSVGPathForStorage(
  geoJson: GeoJSON.FeatureCollection,
  maxPoints: number = 40
): string {
  // Extract all coordinates
  const allCoordinates = extractAllCoordinates(geoJson);
  
  if (allCoordinates.length === 0) {
    return '';
  }
  
  // Simplify coordinates using Douglas-Peucker algorithm
  const coordinates = simplifyCoordinates(allCoordinates, maxPoints);
  
  // Calculate bounds
  const bounds = calculateBounds(coordinates);
  
  // Use a standard viewBox size
  const width = 120;
  const height = 80;
  
  // Convert to SVG coordinates
  const svgCoords = coordinatesToSVG(coordinates, bounds, width, height);
  
  // Generate path
  return generateSVGPath(svgCoords);
}

/**
 * Generate SVG from stored path
 * @param svgPath Stored SVG path string
 * @param width SVG width (default: 120)
 * @param height SVG height (default: 80)
 * @param strokeColor Stroke color (default: currentColor)
 * @param strokeWidth Stroke width (default: 2)
 * @returns Complete SVG string
 */
export function generateSVGFromStoredPath(
  svgPath: string,
  width: number = 120,
  height: number = 80,
  strokeColor: string = 'currentColor',
  strokeWidth: number = 2
): string {
  if (!svgPath) {
    return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <text x="50%" y="50%" text-anchor="middle" dominant-baseline="central" font-size="12" fill="${strokeColor}" opacity="0.5">No route</text>
    </svg>`;
  }
  
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
    <path d="${svgPath}" stroke="${strokeColor}" stroke-width="${strokeWidth}" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity="0.8"/>
  </svg>`;
}
