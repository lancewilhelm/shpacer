import { getWaypointColorFromOrder } from '~/utils/waypoints';

const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const OSM_ATTRIBUTION = 'Map data © OpenStreetMap contributors';
const TILE_SIZE = 256;
const MIN_ZOOM = 1;
const MAX_ZOOM = 19;
const EXPORT_RADIUS_METERS = 1200;
const TILE_TIMEOUT_MS = 6000;
const ROUTE_COLOR = '#1d4ed8';
const ROUTE_WIDTH = 4;
const CANVAS_BACKGROUND = '#eef2f7';

interface WaypointForExport {
  id: string;
  name: string;
  lat: number;
  lng: number;
  order: number;
}

interface CaptureWaypointMapImageOptions {
  geoJsonData: GeoJSON.FeatureCollection[];
  waypoint: WaypointForExport;
  allWaypoints: WaypointForExport[];
  size?: {
    width: number;
    height: number;
  };
}

interface CaptureCourseOverviewMapImageOptions {
  geoJsonData: GeoJSON.FeatureCollection[];
  allWaypoints: WaypointForExport[];
  size?: {
    width: number;
    height: number;
  };
}

type LatLng = { lat: number; lng: number };
type Viewport = {
  zoom: number;
  center: LatLng;
};
type GeographicBounds = {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
};

const waypointIconCache = new Map<string, Promise<HTMLImageElement>>();

function getWaypointDisplayContent(
  waypoint: WaypointForExport,
  allWaypoints: WaypointForExport[],
): string {
  const sortedWaypoints = [...allWaypoints].sort((a, b) => a.order - b.order);
  const waypointIndex = sortedWaypoints.findIndex((w) => w.id === waypoint.id);

  if (waypointIndex <= 0) return 'S';
  if (waypointIndex === sortedWaypoints.length - 1) return 'F';
  return waypointIndex.toString();
}

function createWaypointIconDataUrl(
  waypoint: WaypointForExport,
  allWaypoints: WaypointForExport[],
): string {
  const color = getWaypointColorFromOrder(waypoint, allWaypoints);
  const label = getWaypointDisplayContent(waypoint, allWaypoints);
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">
      <circle cx="18" cy="18" r="15" fill="${color}" stroke="#ffffff" stroke-width="4" />
      <text
        x="18"
        y="18"
        text-anchor="middle"
        dominant-baseline="central"
        font-family="Arial, sans-serif"
        font-size="14"
        font-weight="700"
        fill="#ffffff"
      >${label}</text>
    </svg>
  `;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function clampLatitude(lat: number): number {
  return Math.max(-85.05112878, Math.min(85.05112878, lat));
}

function projectLatLng(lat: number, lng: number, zoom: number) {
  const scale = TILE_SIZE * 2 ** zoom;
  const normalizedLng = ((lng + 180) / 360) * scale;
  const sinLat = Math.sin((clampLatitude(lat) * Math.PI) / 180);
  const normalizedLat =
    (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale;

  return {
    x: normalizedLng,
    y: normalizedLat,
  };
}

function unprojectPoint(x: number, y: number, zoom: number): LatLng {
  const scale = TILE_SIZE * 2 ** zoom;
  const lng = (x / scale) * 360 - 180;
  const mercatorY = Math.PI * (1 - (2 * y) / scale);
  const lat =
    (Math.atan(Math.sinh(mercatorY)) * 180) / Math.PI;

  return { lat, lng };
}

function normalizeCoordinate(
  coordinate: number[],
): LatLng | null {
  if (
    coordinate.length < 2 ||
    !Number.isFinite(coordinate[0]) ||
    !Number.isFinite(coordinate[1])
  ) {
    return null;
  }

  return {
    lat: coordinate[1] as number,
    lng: coordinate[0] as number,
  };
}

function extractLineCoordinates(
  geoJsonData: GeoJSON.FeatureCollection[],
): LatLng[][] {
  const lines: LatLng[][] = [];

  for (const collection of geoJsonData) {
    for (const feature of collection.features) {
      const geometry = feature.geometry;
      if (!geometry) continue;

      if (geometry.type === 'LineString') {
        const line = geometry.coordinates
          .map(normalizeCoordinate)
          .filter((coordinate): coordinate is LatLng => coordinate !== null);
        if (line.length > 1) lines.push(line);
      } else if (geometry.type === 'MultiLineString') {
        for (const segment of geometry.coordinates) {
          const line = segment
            .map(normalizeCoordinate)
            .filter((coordinate): coordinate is LatLng => coordinate !== null);
          if (line.length > 1) lines.push(line);
        }
      }
    }
  }

  return lines;
}

function createEmptyBounds(): GeographicBounds {
  return {
    minLat: Number.POSITIVE_INFINITY,
    maxLat: Number.NEGATIVE_INFINITY,
    minLng: Number.POSITIVE_INFINITY,
    maxLng: Number.NEGATIVE_INFINITY,
  };
}

function extendBounds(bounds: GeographicBounds, point: LatLng) {
  bounds.minLat = Math.min(bounds.minLat, point.lat);
  bounds.maxLat = Math.max(bounds.maxLat, point.lat);
  bounds.minLng = Math.min(bounds.minLng, point.lng);
  bounds.maxLng = Math.max(bounds.maxLng, point.lng);
}

function finalizeBounds(bounds: GeographicBounds): GeographicBounds | null {
  if (
    !Number.isFinite(bounds.minLat) ||
    !Number.isFinite(bounds.maxLat) ||
    !Number.isFinite(bounds.minLng) ||
    !Number.isFinite(bounds.maxLng)
  ) {
    return null;
  }

  return bounds;
}

function getBoundsForWaypoint(waypoint: WaypointForExport): GeographicBounds {
  const latDelta = EXPORT_RADIUS_METERS / 111_320;
  const lngDelta =
    EXPORT_RADIUS_METERS /
    (111_320 * Math.max(0.2, Math.cos((waypoint.lat * Math.PI) / 180)));

  return {
    minLat: waypoint.lat - latDelta,
    maxLat: waypoint.lat + latDelta,
    minLng: waypoint.lng - lngDelta,
    maxLng: waypoint.lng + lngDelta,
  };
}

function getBoundsForCourse(
  lineCoordinates: LatLng[][],
  allWaypoints: WaypointForExport[],
): GeographicBounds {
  const bounds = createEmptyBounds();

  for (const line of lineCoordinates) {
    for (const point of line) {
      extendBounds(bounds, point);
    }
  }

  for (const waypoint of allWaypoints) {
    extendBounds(bounds, {
      lat: waypoint.lat,
      lng: waypoint.lng,
    });
  }

  return finalizeBounds(bounds) ?? getBoundsForWaypoint(allWaypoints[0] ?? {
    id: 'fallback',
    name: 'Fallback',
    lat: 0,
    lng: 0,
    order: 0,
  });
}

function selectViewport(
  bounds: GeographicBounds,
  width: number,
  height: number,
  padding: number,
): Viewport {
  const availableWidth = Math.max(1, width - padding * 2);
  const availableHeight = Math.max(1, height - padding * 2);

  let selectedZoom = MIN_ZOOM;

  for (let zoom = MAX_ZOOM; zoom >= MIN_ZOOM; zoom--) {
    const northWest = projectLatLng(bounds.maxLat, bounds.minLng, zoom);
    const southEast = projectLatLng(bounds.minLat, bounds.maxLng, zoom);
    const projectedWidth = Math.abs(southEast.x - northWest.x);
    const projectedHeight = Math.abs(southEast.y - northWest.y);

    if (projectedWidth <= availableWidth && projectedHeight <= availableHeight) {
      selectedZoom = zoom;
      break;
    }
  }

  const northWest = projectLatLng(bounds.maxLat, bounds.minLng, selectedZoom);
  const southEast = projectLatLng(bounds.minLat, bounds.maxLng, selectedZoom);
  const centerX = (northWest.x + southEast.x) / 2;
  const centerY = (northWest.y + southEast.y) / 2;

  return {
    zoom: selectedZoom,
    center: unprojectPoint(centerX, centerY, selectedZoom),
  };
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function loadImage(src: string, crossOrigin = false): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    if (crossOrigin) {
      image.crossOrigin = 'Anonymous';
    }

    const timeoutId = window.setTimeout(() => {
      reject(new Error(`Timed out loading image: ${src}`));
    }, TILE_TIMEOUT_MS);

    image.onload = () => {
      window.clearTimeout(timeoutId);
      resolve(image);
    };
    image.onerror = () => {
      window.clearTimeout(timeoutId);
      reject(new Error(`Failed to load image: ${src}`));
    };
    image.src = src;
  });
}

function getWaypointIconImage(
  waypoint: WaypointForExport,
  allWaypoints: WaypointForExport[],
): Promise<HTMLImageElement> {
  const key = `${waypoint.id}:${getWaypointDisplayContent(waypoint, allWaypoints)}:${getWaypointColorFromOrder(waypoint, allWaypoints)}`;
  let cached = waypointIconCache.get(key);

  if (!cached) {
    cached = loadImage(createWaypointIconDataUrl(waypoint, allWaypoints));
    waypointIconCache.set(key, cached);
  }

  return cached;
}

async function drawTiles(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  viewport: Viewport,
) {
  const worldCenter = projectLatLng(
    viewport.center.lat,
    viewport.center.lng,
    viewport.zoom,
  );
  const topLeftX = worldCenter.x - width / 2;
  const topLeftY = worldCenter.y - height / 2;
  const bottomRightX = topLeftX + width;
  const bottomRightY = topLeftY + height;
  const tilesPerAxis = 2 ** viewport.zoom;

  const minTileX = Math.floor(topLeftX / TILE_SIZE);
  const maxTileX = Math.floor((bottomRightX - 1) / TILE_SIZE);
  const minTileY = Math.floor(topLeftY / TILE_SIZE);
  const maxTileY = Math.floor((bottomRightY - 1) / TILE_SIZE);

  const tiles: Array<{
    x: number;
    y: number;
    screenX: number;
    screenY: number;
  }> = [];

  for (let tileX = minTileX; tileX <= maxTileX; tileX++) {
    for (let tileY = minTileY; tileY <= maxTileY; tileY++) {
      if (tileY < 0 || tileY >= tilesPerAxis) continue;

      const wrappedTileX = ((tileX % tilesPerAxis) + tilesPerAxis) % tilesPerAxis;
      tiles.push({
        x: wrappedTileX,
        y: tileY,
        screenX: tileX * TILE_SIZE - topLeftX,
        screenY: tileY * TILE_SIZE - topLeftY,
      });
    }
  }

  const tileImages = await Promise.all(
    tiles.map(async (tile) => {
      try {
        const image = await loadImage(
          OSM_TILE_URL
            .replace('{z}', String(viewport.zoom))
            .replace('{x}', String(tile.x))
            .replace('{y}', String(tile.y)),
          true,
        );

        return { ...tile, image };
      } catch {
        return null;
      }
    }),
  );

  for (const tile of tileImages) {
    if (!tile) continue;
    ctx.drawImage(tile.image, tile.screenX, tile.screenY, TILE_SIZE, TILE_SIZE);
  }
}

function toScreenPoint(
  point: LatLng,
  viewport: Viewport,
  width: number,
  height: number,
): { x: number; y: number } {
  const worldCenter = projectLatLng(
    viewport.center.lat,
    viewport.center.lng,
    viewport.zoom,
  );
  const worldPoint = projectLatLng(point.lat, point.lng, viewport.zoom);

  return {
    x: worldPoint.x - worldCenter.x + width / 2,
    y: worldPoint.y - worldCenter.y + height / 2,
  };
}

function drawRoutes(
  ctx: CanvasRenderingContext2D,
  lineCoordinates: LatLng[][],
  viewport: Viewport,
  width: number,
  height: number,
) {
  ctx.save();
  ctx.strokeStyle = ROUTE_COLOR;
  ctx.lineWidth = ROUTE_WIDTH;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const line of lineCoordinates) {
    if (line.length < 2) continue;

    ctx.beginPath();
    line.forEach((point, index) => {
      const screenPoint = toScreenPoint(point, viewport, width, height);
      if (index === 0) {
        ctx.moveTo(screenPoint.x, screenPoint.y);
      } else {
        ctx.lineTo(screenPoint.x, screenPoint.y);
      }
    });
    ctx.stroke();
  }

  ctx.restore();
}

async function drawWaypoints(
  ctx: CanvasRenderingContext2D,
  waypointList: WaypointForExport[],
  allWaypoints: WaypointForExport[],
  viewport: Viewport,
  width: number,
  height: number,
) {
  const icons = await Promise.all(
    waypointList.map(async (waypoint) => ({
      waypoint,
      image: await getWaypointIconImage(waypoint, allWaypoints),
    })),
  );

  for (const { waypoint, image } of icons) {
    const screenPoint = toScreenPoint(
      { lat: waypoint.lat, lng: waypoint.lng },
      viewport,
      width,
      height,
    );
    ctx.drawImage(image, screenPoint.x - 18, screenPoint.y - 18, 36, 36);
  }
}

async function renderMapImage(options: {
  geoJsonData: GeoJSON.FeatureCollection[];
  bounds: GeographicBounds;
  waypointsToDraw: WaypointForExport[];
  allWaypoints: WaypointForExport[];
  width: number;
  height: number;
  padding: number;
}): Promise<string> {
  const { geoJsonData, bounds, waypointsToDraw, allWaypoints, width, height, padding } =
    options;
  const lineCoordinates = extractLineCoordinates(geoJsonData);
  const viewport = selectViewport(bounds, width, height, padding);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('Canvas rendering is not available');
  }

  ctx.fillStyle = CANVAS_BACKGROUND;
  ctx.fillRect(0, 0, width, height);

  await drawTiles(ctx, width, height, viewport);
  drawRoutes(ctx, lineCoordinates, viewport, width, height);
  await drawWaypoints(ctx, waypointsToDraw, allWaypoints, viewport, width, height);

  try {
    return canvas.toDataURL('image/png');
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? `Map export failed: ${error.message}`
        : 'Map export failed while serializing canvas',
    );
  }
}

export async function captureWaypointMapImage(
  options: CaptureWaypointMapImageOptions,
): Promise<string> {
  if (typeof window === 'undefined') return '';

  const width = options.size?.width ?? 420;
  const height = options.size?.height ?? 250;

  return renderMapImage({
    geoJsonData: options.geoJsonData,
    bounds: getBoundsForWaypoint(options.waypoint),
    waypointsToDraw: [options.waypoint],
    allWaypoints: options.allWaypoints,
    width,
    height,
    padding: 24,
  });
}

export async function captureCourseOverviewMapImage(
  options: CaptureCourseOverviewMapImageOptions,
): Promise<string> {
  if (typeof window === 'undefined') return '';

  const width = options.size?.width ?? 620;
  const height = options.size?.height ?? 360;
  const lineCoordinates = extractLineCoordinates(options.geoJsonData);

  return renderMapImage({
    geoJsonData: options.geoJsonData,
    bounds: getBoundsForCourse(lineCoordinates, options.allWaypoints),
    waypointsToDraw: options.allWaypoints,
    allWaypoints: options.allWaypoints,
    width,
    height,
    padding: 30,
  });
}
