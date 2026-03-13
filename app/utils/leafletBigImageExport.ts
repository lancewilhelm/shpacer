import { getWaypointColorFromOrder } from '~/utils/waypoints';

const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const OSM_ATTRIBUTION = 'Map data © OpenStreetMap contributors';
const EXPORT_RADIUS_METERS = 1200;
const TILE_TIMEOUT_MS = 6000;

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

type LeafletModule = typeof import('leaflet');
type LeafletMap = import('leaflet').Map;
type BigImageControl = {
  _map: LeafletMap;
  zoom: number;
  bounds: { min: { x: number; y: number }; max: { x: number; y: number } };
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  tilesImgs: Record<string, { img: HTMLImageElement; x: number; y: number }>;
  markers: Record<string, { img: HTMLImageElement; x: number; y: number }>;
  path: Record<
    string,
    {
      parts: Array<{ x: number; y: number }>;
      closed: boolean;
      options: Record<string, unknown>;
    }
  >;
  circles: Record<string, unknown>;
  tileSize: number;
  _getLayers: (resolve: () => void) => void;
  _changeScale: (scale: number) => void;
  _drawPath: (value: BigImageControl['path'][string]) => void;
  _drawCircle: (value: unknown) => void;
  _loadTile: (
    tilePoint: { x: number; y: number },
    tilePos: { x: number; y: number },
    layer: { getTileUrl: (point: { x: number; y: number }) => string },
    resolve: () => void,
  ) => void;
};

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
        y="22"
        text-anchor="middle"
        font-family="Arial, sans-serif"
        font-size="14"
        font-weight="700"
        fill="#ffffff"
      >${label}</text>
    </svg>
  `;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function extractLineCoordinates(
  geoJsonData: GeoJSON.FeatureCollection[],
): Array<Array<[number, number]>> {
  const lines: Array<Array<[number, number]>> = [];

  for (const collection of geoJsonData) {
    for (const feature of collection.features) {
      if (!feature.geometry) continue;

      if (feature.geometry.type === 'LineString') {
        const coords = feature.geometry.coordinates
          .filter(
            (coordinate): coordinate is [number, number] =>
              Array.isArray(coordinate) &&
              coordinate.length >= 2 &&
              typeof coordinate[0] === 'number' &&
              typeof coordinate[1] === 'number',
          )
          .map((coordinate) => [coordinate[1], coordinate[0]] as [number, number]);

        if (coords.length > 1) lines.push(coords);
      } else if (feature.geometry.type === 'MultiLineString') {
        for (const segment of feature.geometry.coordinates) {
          const coords = segment
            .filter(
              (coordinate): coordinate is [number, number] =>
                Array.isArray(coordinate) &&
                coordinate.length >= 2 &&
                typeof coordinate[0] === 'number' &&
                typeof coordinate[1] === 'number',
            )
            .map((coordinate) => [coordinate[1], coordinate[0]] as [number, number]);

          if (coords.length > 1) lines.push(coords);
        }
      }
    }
  }

  return lines;
}

function getBoundsForCourse(
  L: LeafletModule,
  lineCoordinates: Array<Array<[number, number]>>,
  allWaypoints: WaypointForExport[],
) {
  const bounds = L.latLngBounds([]);

  for (const line of lineCoordinates) {
    for (const [lat, lng] of line) {
      bounds.extend([lat, lng]);
    }
  }

  for (const waypoint of allWaypoints) {
    bounds.extend([waypoint.lat, waypoint.lng]);
  }

  if (bounds.isValid()) {
    return bounds;
  }

  if (allWaypoints[0]) {
    return getBoundsForWaypoint(L, allWaypoints[0], EXPORT_RADIUS_METERS);
  }

  return L.latLngBounds(
    [0 - 0.01, 0 - 0.01],
    [0 + 0.01, 0 + 0.01],
  );
}

function getBoundsForWaypoint(
  L: LeafletModule,
  waypoint: WaypointForExport,
  radiusMeters: number,
) {
  const latDelta = radiusMeters / 111_320;
  const lngDelta =
    radiusMeters / (111_320 * Math.max(0.2, Math.cos((waypoint.lat * Math.PI) / 180)));

  return L.latLngBounds(
    [waypoint.lat - latDelta, waypoint.lng - lngDelta],
    [waypoint.lat + latDelta, waypoint.lng + lngDelta],
  );
}

function createHiddenContainer(width: number, height: number): HTMLDivElement {
  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.left = '-10000px';
  container.style.top = '0';
  container.style.width = `${width}px`;
  container.style.height = `${height}px`;
  container.style.opacity = '0';
  container.style.pointerEvents = 'none';
  container.style.zIndex = '-1';
  document.body.appendChild(container);
  return container;
}

async function waitForMapReady() {
  await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
  await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
}

function patchTileLoader(control: BigImageControl) {
  control._loadTile = function loadTile(tilePoint, tilePos, layer, resolve) {
    const image = new Image();
    image.crossOrigin = 'Anonymous';

    const done = () => {
      window.clearTimeout(timeoutId);
      resolve();
    };

    const timeoutId = window.setTimeout(done, TILE_TIMEOUT_MS);

    image.onload = () => {
      const imgIndex = `${tilePoint.x}:${tilePoint.y}:${control.zoom}`;
      if (!control.tilesImgs[imgIndex]) {
        control.tilesImgs[imgIndex] = {
          img: image,
          x: tilePos.x,
          y: tilePos.y,
        };
      }
      done();
    };

    image.onerror = done;
    image.src = layer.getTileUrl(tilePoint);
  };
}

async function renderMapToDataUrl(
  L: LeafletModule,
  map: LeafletMap,
): Promise<string> {
  const BigImageCtor = (
    L.Control as unknown as { BigImage?: new (options?: Record<string, unknown>) => BigImageControl }
  ).BigImage;

  if (!BigImageCtor) {
    throw new Error('Leaflet.BigImage failed to load');
  }

  const control = new BigImageCtor({
    minScale: 1,
    maxScale: 1,
  });

  control._map = map;
  control.tilesImgs = {};
  control.markers = {};
  control.path = {};
  control.circles = {};

  const dimensions = map.getSize();
  control.zoom = map.getZoom();
  control.bounds = map.getPixelBounds() as BigImageControl['bounds'];
  control.canvas = document.createElement('canvas');
  control.canvas.width = dimensions.x;
  control.canvas.height = dimensions.y;

  const ctx = control.canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas rendering is not available');
  }
  control.ctx = ctx;

  patchTileLoader(control);

  await new Promise<void>((resolve) => {
    control._getLayers(resolve);
  });

  for (const value of Object.values(control.tilesImgs)) {
    control.ctx.drawImage(value.img, value.x, value.y, control.tileSize, control.tileSize);
  }

  for (const value of Object.values(control.path)) {
    control._drawPath(value);
  }

  for (const value of Object.values(control.markers)) {
    control.ctx.drawImage(value.img, value.x, value.y);
  }

  for (const value of Object.values(control.circles)) {
    control._drawCircle(value);
  }

  return control.canvas.toDataURL('image/png');
}

function addRouteAndWaypointLayers(
  L: LeafletModule,
  map: LeafletMap,
  geoJsonData: GeoJSON.FeatureCollection[],
  allWaypoints: WaypointForExport[],
) {
  const lineCoordinates = extractLineCoordinates(geoJsonData);

  for (const line of lineCoordinates) {
    L.polyline(line, {
      color: '#1d4ed8',
      weight: 4,
      opacity: 0.9,
    }).addTo(map);
  }

  for (const waypoint of allWaypoints) {
    const waypointIcon = L.icon({
      iconUrl: createWaypointIconDataUrl(waypoint, allWaypoints),
      iconSize: [36, 36],
      iconAnchor: [18, 18],
    });

    L.marker([waypoint.lat, waypoint.lng], {
      icon: waypointIcon,
    }).addTo(map);
  }

  return lineCoordinates;
}

export async function captureWaypointMapImage(
  options: CaptureWaypointMapImageOptions,
): Promise<string> {
  if (typeof window === 'undefined') return '';

  const [leafletModule] = await Promise.all([
    import('leaflet'),
    import('leaflet.bigimage'),
  ]);
  const L = (
    'default' in leafletModule ? leafletModule.default : leafletModule
  ) as unknown as LeafletModule;

  const width = options.size?.width ?? 420;
  const height = options.size?.height ?? 250;
  const container = createHiddenContainer(width, height);

  let map: LeafletMap | null = null;

  try {
    map = L.map(container, {
      zoomControl: false,
      attributionControl: false,
      preferCanvas: false,
      zoomAnimation: false,
      fadeAnimation: false,
      markerZoomAnimation: false,
      inertia: false,
    });

    L.tileLayer(OSM_TILE_URL, {
      maxZoom: 19,
      crossOrigin: true,
    }).addTo(map);

    for (const line of extractLineCoordinates(options.geoJsonData)) {
      L.polyline(line, {
        color: '#1d4ed8',
        weight: 4,
        opacity: 0.9,
      }).addTo(map);
    }

    const waypointIcon = L.icon({
      iconUrl: createWaypointIconDataUrl(options.waypoint, options.allWaypoints),
      iconSize: [36, 36],
      iconAnchor: [18, 18],
    });

    L.marker([options.waypoint.lat, options.waypoint.lng], {
      icon: waypointIcon,
    }).addTo(map);

    map.fitBounds(getBoundsForWaypoint(L, options.waypoint, EXPORT_RADIUS_METERS), {
      padding: [24, 24],
      animate: false,
    });
    map.invalidateSize(false);

    await waitForMapReady();

    return await renderMapToDataUrl(L, map);
  } finally {
    if (map) {
      map.remove();
    }
    container.remove();
  }
}

export async function captureCourseOverviewMapImage(
  options: CaptureCourseOverviewMapImageOptions,
): Promise<string> {
  if (typeof window === 'undefined') return '';

  const [leafletModule] = await Promise.all([
    import('leaflet'),
    import('leaflet.bigimage'),
  ]);
  const L = (
    'default' in leafletModule ? leafletModule.default : leafletModule
  ) as unknown as LeafletModule;

  const width = options.size?.width ?? 620;
  const height = options.size?.height ?? 360;
  const container = createHiddenContainer(width, height);

  let map: LeafletMap | null = null;

  try {
    map = L.map(container, {
      zoomControl: false,
      attributionControl: false,
      preferCanvas: false,
      zoomAnimation: false,
      fadeAnimation: false,
      markerZoomAnimation: false,
      inertia: false,
    });

    L.tileLayer(OSM_TILE_URL, {
      maxZoom: 19,
      crossOrigin: true,
    }).addTo(map);

    const lineCoordinates = addRouteAndWaypointLayers(
      L,
      map,
      options.geoJsonData,
      options.allWaypoints,
    );

    map.fitBounds(
      getBoundsForCourse(L, lineCoordinates, options.allWaypoints),
      {
        padding: [30, 30],
        animate: false,
      },
    );
    map.invalidateSize(false);

    await waitForMapReady();

    return await renderMapToDataUrl(L, map);
  } finally {
    if (map) {
      map.remove();
    }
    container.remove();
  }
}
