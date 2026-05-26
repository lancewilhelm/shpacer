<script setup lang="ts">
import { useUserSettingsStore } from "~/stores/userSettings";
import { calculateDistance } from "~/utils/distance";
import {
    MAP_BASEMAPS,
    createRasterBasemapStyle,
    getBasemapLayerId,
    getBasemapSourceId,
    normalizeMapBasemapId,
    type MapBasemapId,
} from "~/utils/mapBasemaps";
import {
    buildOverlapIndexForGeoJsonTracks,
    getTrackDistanceCandidatesForPoint,
    type OverlapIndex,
    type TrackDistanceCandidate,
} from "~/utils/routeOverlapIndex";
import { getWaypointColorFromOrder } from "~/utils/waypoints";

type Waypoint = {
    id: string;
    name: string;
    description: string | null;
    lat: number;
    lng: number;
    elevation: number | null;
    distance: number;
    tags: string[];
    order: number;
};

type MapLibreModule = typeof import("maplibre-gl");
type MapLibreMap = import("maplibre-gl").Map;
type MapLibrePopup = import("maplibre-gl").Popup;
type GeoJSONSource = import("maplibre-gl").GeoJSONSource;
type MapLayerMouseEvent = import("maplibre-gl").MapLayerMouseEvent;
type IControl = import("maplibre-gl").IControl;

interface Props {
    center?: [number, number];
    zoom?: number;
    markers?: Array<{
        position: [number, number];
        popup?: string;
        open?: boolean;
    }>;
    geoJsonData?: GeoJSON.FeatureCollection[];
    overlayGeoJsonData?: GeoJSON.FeatureCollection[];
    waypoints?: Waypoint[];
    selectedWaypoint?: Waypoint | null;
    elevationHoverPoint?: {
        lat: number;
        lng: number;
        distance: number;
        elevation: number;
        grade: number;
    } | null;
    autoZoomToWaypoint?: boolean;
    mapClickLocation?: {
        lat: number;
        lng: number;
        distance: number;
    } | null;
    displayMarkersAsSplits?: boolean;
    highlightSegment?: { start: number; end: number } | null;
    highlightColor?: string;
    fitHighlight?: boolean;
    resetToCourseBoundsKey?: number;
}

const props = withDefaults(defineProps<Props>(), {
    center: undefined,
    zoom: undefined,
    markers: () => [],
    geoJsonData: () => [],
    overlayGeoJsonData: () => [],
    waypoints: () => [],
    selectedWaypoint: null,
    elevationHoverPoint: null,
    autoZoomToWaypoint: false,
    mapClickLocation: null,
    displayMarkersAsSplits: false,
    highlightSegment: null,
    highlightColor: "#ff0000",
    fitHighlight: false,
    resetToCourseBoundsKey: 0,
});

const emit = defineEmits<{
    "map-hover": [
        event: {
            lat: number;
            lng: number;
            distance: number;
            distances: number[];
        },
    ];
    "map-leave": [];
    "waypoint-click": [waypoint: Waypoint];
    "line-click": [coords: { lat: number; lng: number }];
    "track-click": [
        event: {
            lat: number;
            lng: number;
            distance: number;
            distances: number[];
            candidates: TrackDistanceCandidate[];
            screenX: number;
            screenY: number;
        },
    ];
}>();

const MAX_HOVER_DISTANCES = 2;
const TRACK_SOURCE_ID = "course-tracks";
const TRACK_LAYER_ID = "course-tracks-visible";
const TRACK_HIT_LAYER_ID = "course-tracks-hit";
const OVERLAY_SOURCE_ID = "course-overlay-tracks";
const OVERLAY_LAYER_ID = "course-overlay-visible";
const HIGHLIGHT_SOURCE_ID = "course-highlight";
const HIGHLIGHT_LAYER_ID = "course-highlight-visible";
const ELEVATION_HOVER_SOURCE_ID = "course-elevation-hover";
const ELEVATION_HOVER_LAYER_ID = "course-elevation-hover-circle";
const WAYPOINT_SOURCE_ID = "course-waypoints";
const WAYPOINT_HIT_LAYER_ID = "course-waypoints-hit";
const WAYPOINT_SYMBOL_LAYER_ID = "course-waypoints-symbol";
const MARKER_SOURCE_ID = "course-generic-markers";
const MARKER_LAYER_ID = "course-generic-markers-circle";
const FALLBACK_CENTER: [number, number] = [51.505, -0.09];
const FALLBACK_ZOOM = 13;

let maplibregl: MapLibreModule | null = null;
if (import.meta.client) {
    await import("maplibre-gl/dist/maplibre-gl.css");
    maplibregl = await import("maplibre-gl");
}

const mapContainerRef = ref<HTMLDivElement | null>(null);
const userSettingsStore = useUserSettingsStore();

let map: MapLibreMap | null = null;
let resetViewButton: HTMLButtonElement | null = null;
let resizeObserver: ResizeObserver | null = null;
let overlapIndex: OverlapIndex | null = null;
let trackHoverFrame: number | null = null;
let pendingTrackHover: {
    lat: number;
    lng: number;
} | null = null;
let selectedWaypointPopup: MapLibrePopup | null = null;
let selectedGenericMarkerPopup: MapLibrePopup | null = null;
let resetViewControl: IControl | null = null;
let basemapControl: IControl | null = null;
let basemapMenuButton: HTMLButtonElement | null = null;
let basemapMenuPanel: HTMLDivElement | null = null;
let basemapMenuContainer: HTMLDivElement | null = null;
const basemapOptionButtons = new Map<MapBasemapId, HTMLButtonElement>();
let hasDoneInitialFit = false;
let prevFitHighlight = false;
let lastFittedSegmentKey: string | null = null;
let windowResizeHandler: (() => void) | null = null;
let documentPointerDownHandler: ((event: PointerEvent) => void) | null = null;
let activeBasemapId: MapBasemapId = normalizeMapBasemapId(
    userSettingsStore.settings.mapStyle?.basemapId,
);
let basemapMenuOpen = false;

function rebuildOverlapIndex() {
    overlapIndex = buildOverlapIndexForGeoJsonTracks(props.geoJsonData);
}

function getTrackColor(index: number): string {
    const colors = [
        "#0000ff",
        "#ff0000",
        "#00ff00",
        "#ff00ff",
        "#ffff00",
        "#00ffff",
        "#ff8000",
        "#8000ff",
        "#0080ff",
        "#80ff00",
    ];

    return colors[index % colors.length] || "#0000ff";
}

function isLineGeometry(
    geometry: GeoJSON.Geometry | null | undefined,
): geometry is GeoJSON.LineString | GeoJSON.MultiLineString {
    return (
        geometry?.type === "LineString" || geometry?.type === "MultiLineString"
    );
}

function buildTrackFeatureCollection(): GeoJSON.FeatureCollection {
    const features: GeoJSON.Feature[] = [];

    props.geoJsonData.forEach((collection, index) => {
        collection.features.forEach((feature) => {
            if (!isLineGeometry(feature.geometry)) return;

            features.push({
                type: "Feature",
                geometry: feature.geometry,
                properties: {
                    ...(feature.properties ?? {}),
                    trackColor: getTrackColor(index),
                },
            });
        });
    });

    return {
        type: "FeatureCollection",
        features,
    };
}

function buildOverlayFeatureCollection(): GeoJSON.FeatureCollection {
    const features: GeoJSON.Feature[] = [];

    props.overlayGeoJsonData.forEach((collection) => {
        collection.features.forEach((feature) => {
            if (!isLineGeometry(feature.geometry)) return;
            features.push({
                type: "Feature",
                geometry: feature.geometry,
                properties: feature.properties ?? {},
            });
        });
    });

    return {
        type: "FeatureCollection",
        features,
    };
}

function emptyFeatureCollection(): GeoJSON.FeatureCollection {
    return {
        type: "FeatureCollection",
        features: [],
    };
}

function ensureBasemapSourcesAndLayers() {
    const mapInstance = map;
    if (!mapInstance) return;

    MAP_BASEMAPS.forEach((basemap) => {
        const sourceId = getBasemapSourceId(basemap.id);
        const layerId = getBasemapLayerId(basemap.id);

        if (!mapInstance.getSource(sourceId)) {
            mapInstance.addSource(sourceId, {
                type: "raster",
                tiles: basemap.tiles,
                tileSize: 256,
                maxzoom: basemap.maxzoom,
                attribution: basemap.attributionHtml,
            });
        }

        if (!mapInstance.getLayer(layerId)) {
            mapInstance.addLayer({
                id: layerId,
                type: "raster",
                source: sourceId,
                layout: {
                    visibility:
                        basemap.id === activeBasemapId ? "visible" : "none",
                },
            });
        }
    });
}

function persistBasemapSelection(nextBasemapId: MapBasemapId) {
    if (userSettingsStore.settings.mapStyle?.basemapId === nextBasemapId) {
        return;
    }

    userSettingsStore.updateSettings({
        mapStyle: {
            ...userSettingsStore.settings.mapStyle,
            basemapId: nextBasemapId,
        },
    });
}

function updateBasemapSelection(
    nextBasemapId: MapBasemapId,
    options?: { persist?: boolean },
) {
    activeBasemapId = normalizeMapBasemapId(nextBasemapId);

    if (options?.persist !== false) {
        persistBasemapSelection(activeBasemapId);
    }

    const mapInstance = map;
    if (!mapInstance) return;

    MAP_BASEMAPS.forEach((basemap) => {
        const layerId = getBasemapLayerId(basemap.id);
        if (!mapInstance.getLayer(layerId)) return;

        mapInstance.setLayoutProperty(
            layerId,
            "visibility",
            basemap.id === activeBasemapId ? "visible" : "none",
        );
    });

    basemapOptionButtons.forEach((button, basemapId) => {
        const selected = basemapId === activeBasemapId;
        button.dataset.selected = selected ? "true" : "false";
        button.setAttribute("aria-pressed", String(selected));
        button.setAttribute("aria-checked", String(selected));
    });
}

function setBasemapMenuOpen(open: boolean) {
    basemapMenuOpen = open;

    if (basemapMenuButton) {
        basemapMenuButton.setAttribute("aria-expanded", String(open));
    }

    if (basemapMenuPanel) {
        basemapMenuPanel.hidden = !open;
    }
}

function getWaypointDisplayContent(
    waypoint: Waypoint,
    waypoints: Waypoint[],
): string {
    const sortedWaypoints = [...waypoints].sort((a, b) => a.order - b.order);
    const waypointIndex = sortedWaypoints.findIndex(
        (w) => w.id === waypoint.id,
    );

    if (waypointIndex === -1) return "?";

    if (props.displayMarkersAsSplits) {
        if (waypointIndex === 0) return "S";
        if (waypointIndex === sortedWaypoints.length - 1) return "F";
        return waypointIndex.toString();
    }

    if (waypointIndex === 0) return "S";
    if (waypointIndex === sortedWaypoints.length - 1) return "F";
    return waypointIndex.toString();
}

function getWaypointTooltipContent(waypoint: Waypoint): string {
    return `<strong>${waypoint.name}</strong>`;
}

function getWaypointImageId(waypoint: Waypoint, isSelected: boolean): string {
    const label = getWaypointDisplayContent(waypoint, props.waypoints);
    const color = getWaypointColorFromOrder(waypoint, props.waypoints).replace(
        "#",
        "",
    );
    return `waypoint-${label}-${color}-${isSelected ? "selected" : "default"}`;
}

function createWaypointIconDataUrl(
    waypoint: Waypoint,
    isSelected: boolean,
): string {
    const color = getWaypointColorFromOrder(waypoint, props.waypoints);
    const label = getWaypointDisplayContent(waypoint, props.waypoints);
    const radius = isSelected ? 16 : 12;
    const borderWidth = isSelected ? 3 : 2;
    const diameter = radius * 2;
    const fontSize = isSelected ? 13 : 10;
    const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${diameter}" height="${diameter}" viewBox="0 0 ${diameter} ${diameter}">
      <circle cx="${radius}" cy="${radius}" r="${radius - borderWidth}" fill="${color}" stroke="#ffffff" stroke-width="${borderWidth}" />
      <text
        x="${radius}"
        y="${radius}"
        dominant-baseline="central"
        text-anchor="middle"
        font-family="Arial, sans-serif"
        font-size="${fontSize}"
        font-weight="700"
        fill="#ffffff"
      >${label}</text>
    </svg>
  `;

    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

async function ensureWaypointImage(waypoint: Waypoint, isSelected: boolean) {
    if (!map) return;

    const imageId = getWaypointImageId(waypoint, isSelected);
    if (map.hasImage(imageId)) return;

    const image = new Image();
    image.src = createWaypointIconDataUrl(waypoint, isSelected);
    await image.decode();
    if (!map.hasImage(imageId)) {
        map.addImage(imageId, image);
    }
}

function offsetWaypointCoordinate(
    waypoint: Waypoint,
    overlapIndex: number,
    overlapCount: number,
): [number, number] {
    if (overlapCount <= 1) {
        return [waypoint.lng, waypoint.lat];
    }

    const offsetMeters = overlapCount === 2 ? 12 : 7;
    const angleDegrees =
        overlapCount === 2
            ? 180 + overlapIndex * 180
            : -90 + overlapIndex * (360 / overlapCount);
    const angleRadians = (angleDegrees * Math.PI) / 180;
    const northMeters = Math.cos(angleRadians) * offsetMeters;
    const eastMeters = Math.sin(angleRadians) * offsetMeters;

    const latOffset = northMeters / 111_320;
    const lngOffset =
        eastMeters /
        (111_320 * Math.max(0.2, Math.cos((waypoint.lat * Math.PI) / 180)));

    return [waypoint.lng + lngOffset, waypoint.lat + latOffset];
}

function buildWaypointFeatures(): GeoJSON.Feature[] {
    const groupedWaypoints: Waypoint[][] = [];

    props.waypoints.forEach((waypoint) => {
        const group = groupedWaypoints.find((existingGroup) => {
            const anchor = existingGroup[0];
            if (!anchor) return false;
            return (
                calculateDistance(
                    anchor.lat,
                    anchor.lng,
                    waypoint.lat,
                    waypoint.lng,
                ) <= 3
            );
        });

        if (group) {
            group.push(waypoint);
        } else {
            groupedWaypoints.push([waypoint]);
        }
    });

    const overlapPositionById = new Map<string, [number, number]>();
    groupedWaypoints.forEach((group) => {
        group.forEach((waypoint, overlapIndex) => {
            overlapPositionById.set(
                waypoint.id,
                offsetWaypointCoordinate(waypoint, overlapIndex, group.length),
            );
        });
    });

    return props.waypoints.map((waypoint) => {
        const isSelected = props.selectedWaypoint?.id === waypoint.id;
        const [displayLng, displayLat] = overlapPositionById.get(
            waypoint.id,
        ) ?? [waypoint.lng, waypoint.lat];

        return {
            type: "Feature",
            geometry: {
                type: "Point",
                coordinates: [displayLng, displayLat],
            },
            properties: {
                waypointId: waypoint.id,
                isSelected,
                tooltip: waypoint.name,
                imageId: getWaypointImageId(waypoint, isSelected),
            },
        } satisfies GeoJSON.Feature;
    });
}

function buildWaypointFeatureCollection(): GeoJSON.FeatureCollection {
    return {
        type: "FeatureCollection",
        features: buildWaypointFeatures(),
    };
}

function extractTrackPoints(): Array<{
    lat: number;
    lng: number;
    dist: number;
}> {
    const track: Array<{ lat: number; lng: number; dist: number }> = [];
    let cumulative = 0;

    const pushCoordinate = (coordinate: number[]) => {
        if (coordinate.length < 2) return;
        const lng = coordinate[0];
        const lat = coordinate[1];
        if (lng === undefined || lat === undefined) return;
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;

        if (track.length > 0) {
            const prev = track[track.length - 1];
            if (prev) {
                cumulative += calculateDistance(prev.lat, prev.lng, lat, lng);
            }
        }

        track.push({ lat, lng, dist: cumulative });
    };

    props.geoJsonData.forEach((collection) => {
        collection.features.forEach((feature) => {
            if (!feature.geometry) return;

            if (feature.geometry.type === "LineString") {
                feature.geometry.coordinates.forEach(pushCoordinate);
            } else if (feature.geometry.type === "MultiLineString") {
                feature.geometry.coordinates.forEach((line) => {
                    line.forEach(pushCoordinate);
                });
            }
        });
    });

    return track;
}

function createBoundsFromCoordinates(
    coordinates: Array<[number, number]>,
): import("maplibre-gl").LngLatBounds | null {
    if (!maplibregl) return null;

    let bounds: import("maplibre-gl").LngLatBounds | null = null;

    for (const [lng, lat] of coordinates) {
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;

        if (!bounds) {
            bounds = new maplibregl.LngLatBounds([lng, lat], [lng, lat]);
        } else {
            bounds.extend([lng, lat]);
        }
    }

    return bounds;
}

function createCourseBounds(): import("maplibre-gl").LngLatBounds | null {
    const coordinates: Array<[number, number]> = [];

    props.geoJsonData.forEach((collection) => {
        collection.features.forEach((feature) => {
            if (!feature.geometry) return;

            if (feature.geometry.type === "LineString") {
                feature.geometry.coordinates.forEach((coordinate) => {
                    if (coordinate.length < 2) return;
                    const lng = coordinate[0];
                    const lat = coordinate[1];
                    if (lng === undefined || lat === undefined) return;
                    coordinates.push([lng, lat]);
                });
            } else if (feature.geometry.type === "MultiLineString") {
                feature.geometry.coordinates.forEach((line) => {
                    line.forEach((coordinate) => {
                        if (coordinate.length < 2) return;
                        const lng = coordinate[0];
                        const lat = coordinate[1];
                        if (lng === undefined || lat === undefined) return;
                        coordinates.push([lng, lat]);
                    });
                });
            }
        });
    });

    props.waypoints.forEach((waypoint) => {
        coordinates.push([waypoint.lng, waypoint.lat]);
    });

    return createBoundsFromCoordinates(coordinates);
}

function toMapLibreCenter(center: [number, number]): [number, number] {
    return [center[1], center[0]];
}

function buildGenericMarkerFeatureCollection(): GeoJSON.FeatureCollection {
    return {
        type: "FeatureCollection",
        features: props.markers.map((marker, index) => ({
            type: "Feature",
            geometry: {
                type: "Point",
                coordinates: [marker.position[1], marker.position[0]],
            },
            properties: {
                markerIndex: index,
            },
        })),
    };
}

function updateGenericMarkers() {
    if (!map || !maplibregl) return;

    const source = map.getSource(MARKER_SOURCE_ID) as GeoJSONSource | undefined;
    source?.setData(buildGenericMarkerFeatureCollection());

    if (!selectedGenericMarkerPopup) {
        selectedGenericMarkerPopup = new maplibregl.Popup({
            closeButton: false,
            closeOnClick: false,
            maxWidth: "220px",
        });
    }

    const openMarker = props.markers.find(
        (marker) =>
            marker.open &&
            typeof marker.popup === "string" &&
            marker.popup.length > 0,
    );
    if (!openMarker || !openMarker.popup) {
        selectedGenericMarkerPopup.remove();
        return;
    }

    selectedGenericMarkerPopup
        .setLngLat([openMarker.position[1], openMarker.position[0]])
        .setHTML(openMarker.popup)
        .addTo(map);
}

function hasCourseBounds() {
    return createCourseBounds() !== null;
}

function updateResetViewControlState() {
    if (!resetViewButton) return;

    const disabled = !hasCourseBounds();
    resetViewButton.disabled = disabled;
    resetViewButton.setAttribute("aria-disabled", String(disabled));
    resetViewButton.title = disabled
        ? "Reset view unavailable"
        : "Reset map view";
}

function fitToCourseBounds(options?: { animate?: boolean }) {
    if (!map) return false;

    const bounds = createCourseBounds();
    if (!bounds) return false;

    map.fitBounds(bounds, {
        padding: 20,
        duration: options?.animate ? 500 : 0,
    });

    return true;
}

function resolveInitialMapOptions() {
    const hasExplicitViewport =
        Array.isArray(props.center) && typeof props.zoom === "number";

    if (!hasExplicitViewport) {
        const bounds = createCourseBounds();
        if (bounds) {
            hasDoneInitialFit = true;
            return {
                bounds,
                fitBoundsOptions: {
                    padding: 20,
                    duration: 0,
                },
            };
        }
    }

    return {
        center: toMapLibreCenter(props.center ?? FALLBACK_CENTER),
        zoom: typeof props.zoom === "number" ? props.zoom : FALLBACK_ZOOM,
    };
}

function buildHighlightFeatureCollection(): GeoJSON.FeatureCollection {
    const seg = props.highlightSegment;
    if (!seg) return emptyFeatureCollection();

    const track = extractTrackPoints();
    if (track.length < 2) return emptyFeatureCollection();

    const startDistance = Math.max(0, seg.start);
    const endDistance = Math.max(startDistance, seg.end);

    const interpolateAt = (target: number): [number, number] | null => {
        const first = track[0];
        const last = track[track.length - 1];
        if (!first || !last) return null;

        if (target <= first.dist) return [first.lng, first.lat];
        if (target >= last.dist) return [last.lng, last.lat];

        for (let index = 1; index < track.length; index++) {
            const previous = track[index - 1];
            const current = track[index];
            if (!previous || !current) continue;

            if (target >= previous.dist && target <= current.dist) {
                const span = current.dist - previous.dist || 1;
                const ratio = (target - previous.dist) / span;
                const lat = previous.lat + ratio * (current.lat - previous.lat);
                const lng = previous.lng + ratio * (current.lng - previous.lng);
                return [lng, lat];
            }
        }

        return null;
    };

    const points: [number, number][] = [];
    const startPoint = interpolateAt(startDistance);
    if (!startPoint) return emptyFeatureCollection();
    points.push(startPoint);

    for (let index = 1; index < track.length - 1; index++) {
        const point = track[index];
        if (!point) continue;
        if (point.dist > startDistance && point.dist < endDistance) {
            points.push([point.lng, point.lat]);
        }
    }

    const endPoint = interpolateAt(endDistance);
    if (endPoint) {
        points.push(endPoint);
    }

    if (points.length < 2) return emptyFeatureCollection();

    return {
        type: "FeatureCollection",
        features: [
            {
                type: "Feature",
                geometry: {
                    type: "LineString",
                    coordinates: points,
                },
                properties: {},
            },
        ],
    };
}

function updateTrackSources() {
    if (!map) return;

    rebuildOverlapIndex();

    const trackSource = map.getSource(TRACK_SOURCE_ID) as
        | GeoJSONSource
        | undefined;
    trackSource?.setData(buildTrackFeatureCollection());

    const overlaySource = map.getSource(OVERLAY_SOURCE_ID) as
        | GeoJSONSource
        | undefined;
    overlaySource?.setData(buildOverlayFeatureCollection());

    updateResetViewControlState();

    if (!hasDoneInitialFit && hasCourseBounds()) {
        fitToCourseBounds();
        hasDoneInitialFit = true;
    }
}

function updateElevationHoverMarker() {
    if (!map) return;

    const source = map.getSource(ELEVATION_HOVER_SOURCE_ID) as
        | GeoJSONSource
        | undefined;
    if (!source) return;

    if (!props.elevationHoverPoint) {
        source.setData(emptyFeatureCollection());
        return;
    }

    source.setData({
        type: "FeatureCollection",
        features: [
            {
                type: "Feature",
                geometry: {
                    type: "Point",
                    coordinates: [
                        props.elevationHoverPoint.lng,
                        props.elevationHoverPoint.lat,
                    ],
                },
                properties: {},
            },
        ],
    });
}

function updateSelectedWaypointPopup() {
    if (!map || !maplibregl) return;

    if (!selectedWaypointPopup) {
        selectedWaypointPopup = new maplibregl.Popup({
            closeButton: false,
            closeOnClick: false,
            offset: [0, -18],
            className: "maplibre-waypoint-popup",
            maxWidth: "220px",
        });
    }

    if (!props.selectedWaypoint) {
        selectedWaypointPopup.remove();
        return;
    }

    const selectedFeature = buildWaypointFeatures().find(
        (feature) =>
            feature.properties?.waypointId === props.selectedWaypoint?.id,
    );
    const popupCoordinates: [number, number] =
        selectedFeature?.geometry.type === "Point"
            ? [
                  selectedFeature.geometry.coordinates[0] ??
                      props.selectedWaypoint.lng,
                  selectedFeature.geometry.coordinates[1] ??
                      props.selectedWaypoint.lat,
              ]
            : [props.selectedWaypoint.lng, props.selectedWaypoint.lat];

    selectedWaypointPopup
        .setLngLat([popupCoordinates[0], popupCoordinates[1]])
        .setHTML(getWaypointTooltipContent(props.selectedWaypoint))
        .addTo(map);
}

async function updateWaypointSource() {
    if (!map) return;

    await Promise.all(
        props.waypoints.flatMap((waypoint) => [
            ensureWaypointImage(waypoint, false),
            ensureWaypointImage(waypoint, true),
        ]),
    );

    const source = map.getSource(WAYPOINT_SOURCE_ID) as
        | GeoJSONSource
        | undefined;
    source?.setData(buildWaypointFeatureCollection());
    updateSelectedWaypointPopup();
}

function updateHighlightSegment() {
    if (!map) return;

    const source = map.getSource(HIGHLIGHT_SOURCE_ID) as
        | GeoJSONSource
        | undefined;
    if (!source) return;

    const highlightData = buildHighlightFeatureCollection();
    source.setData(highlightData);

    const firstFeature = highlightData.features[0];
    if (
        !firstFeature ||
        firstFeature.geometry.type !== "LineString" ||
        firstFeature.geometry.coordinates.length < 2
    ) {
        prevFitHighlight = Boolean(props.fitHighlight);
        lastFittedSegmentKey = null;
        return;
    }

    const segmentKey = `${props.highlightSegment?.start ?? 0}-${props.highlightSegment?.end ?? 0}`;
    const shouldFit =
        !!props.fitHighlight &&
        (!prevFitHighlight || lastFittedSegmentKey !== segmentKey);

    if (shouldFit) {
        const bounds = createBoundsFromCoordinates(
            firstFeature.geometry.coordinates.map(
                (coordinate) =>
                    [coordinate[0], coordinate[1]] as [number, number],
            ),
        );

        if (bounds) {
            map.fitBounds(bounds, {
                padding: 20,
                duration: 0,
            });
        }
    }

    prevFitHighlight = !!props.fitHighlight;
    lastFittedSegmentKey = segmentKey;
}

function ensureSource(id: string, data: GeoJSON.FeatureCollection) {
    if (!map) return;
    if (map.getSource(id)) return;

    map.addSource(id, {
        type: "geojson",
        data,
    });
}

function ensureLayer(
    id: string,
    layer: Parameters<MapLibreMap["addLayer"]>[0],
) {
    if (!map) return;
    if (map.getLayer(id)) return;
    map.addLayer(layer);
}

function ensureSourcesAndLayers() {
    if (!map) return;

    ensureSource(TRACK_SOURCE_ID, emptyFeatureCollection());
    ensureLayer(TRACK_LAYER_ID, {
        id: TRACK_LAYER_ID,
        type: "line",
        source: TRACK_SOURCE_ID,
        paint: {
            "line-color": ["coalesce", ["get", "trackColor"], "#0000ff"],
            "line-width": 3,
            "line-opacity": 0.8,
        },
        layout: {
            "line-cap": "round",
            "line-join": "round",
        },
    });

    ensureLayer(TRACK_HIT_LAYER_ID, {
        id: TRACK_HIT_LAYER_ID,
        type: "line",
        source: TRACK_SOURCE_ID,
        paint: {
            "line-color": "#000000",
            "line-width": 15,
            "line-opacity": 0.01,
        },
        layout: {
            "line-cap": "round",
            "line-join": "round",
        },
    });

    ensureSource(OVERLAY_SOURCE_ID, emptyFeatureCollection());
    ensureLayer(OVERLAY_LAYER_ID, {
        id: OVERLAY_LAYER_ID,
        type: "line",
        source: OVERLAY_SOURCE_ID,
        paint: {
            "line-color": "#d97706",
            "line-width": 3,
            "line-opacity": 0.85,
            "line-dasharray": [2, 2],
        },
        layout: {
            "line-cap": "round",
            "line-join": "round",
        },
    });

    ensureSource(HIGHLIGHT_SOURCE_ID, emptyFeatureCollection());
    ensureLayer(HIGHLIGHT_LAYER_ID, {
        id: HIGHLIGHT_LAYER_ID,
        type: "line",
        source: HIGHLIGHT_SOURCE_ID,
        paint: {
            "line-color": props.highlightColor,
            "line-width": 6,
            "line-opacity": 0.9,
        },
        layout: {
            "line-cap": "round",
            "line-join": "round",
        },
    });

    ensureSource(ELEVATION_HOVER_SOURCE_ID, emptyFeatureCollection());
    ensureLayer(ELEVATION_HOVER_LAYER_ID, {
        id: ELEVATION_HOVER_LAYER_ID,
        type: "circle",
        source: ELEVATION_HOVER_SOURCE_ID,
        paint: {
            "circle-radius": 6,
            "circle-color": "#ff4444",
            "circle-opacity": 0.8,
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 0,
        },
    });

    ensureSource(WAYPOINT_SOURCE_ID, emptyFeatureCollection());
    ensureLayer(WAYPOINT_HIT_LAYER_ID, {
        id: WAYPOINT_HIT_LAYER_ID,
        type: "circle",
        source: WAYPOINT_SOURCE_ID,
        paint: {
            "circle-radius": [
                "case",
                ["boolean", ["get", "isSelected"], false],
                20,
                16,
            ],
            "circle-color": "#000000",
            "circle-opacity": 0.01,
            "circle-stroke-width": 0,
        },
    });
    ensureLayer(WAYPOINT_SYMBOL_LAYER_ID, {
        id: WAYPOINT_SYMBOL_LAYER_ID,
        type: "symbol",
        source: WAYPOINT_SOURCE_ID,
        layout: {
            "icon-image": ["to-string", ["get", "imageId"]],
            "icon-size": 1,
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
        },
        paint: {
            "icon-opacity": 1,
        },
    });

    ensureSource(MARKER_SOURCE_ID, emptyFeatureCollection());
    ensureLayer(MARKER_LAYER_ID, {
        id: MARKER_LAYER_ID,
        type: "circle",
        source: MARKER_SOURCE_ID,
        paint: {
            "circle-radius": 7,
            "circle-color": "#2563eb",
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 2,
            "circle-opacity": 0.95,
        },
    });
}

function handleTrackHover(event: MapLayerMouseEvent) {
    pendingTrackHover = {
        lat: event.lngLat.lat,
        lng: event.lngLat.lng,
    };

    if (trackHoverFrame !== null) return;

    trackHoverFrame = requestAnimationFrame(() => {
        trackHoverFrame = null;
        const hover = pendingTrackHover;
        pendingTrackHover = null;

        if (!hover || !overlapIndex || !map) return;

        const candidates = getTrackDistanceCandidatesForPoint(
            overlapIndex,
            hover.lat,
            hover.lng,
        ).slice(0, MAX_HOVER_DISTANCES);
        const primaryCandidate = candidates[0];
        if (!primaryCandidate) return;

        emit("map-hover", {
            lat: hover.lat,
            lng: hover.lng,
            distance: primaryCandidate.distance,
            distances: candidates.map((candidate) => candidate.distance),
        });
    });
}

function handleTrackLeave() {
    pendingTrackHover = null;
    if (trackHoverFrame !== null) {
        cancelAnimationFrame(trackHoverFrame);
        trackHoverFrame = null;
    }

    if (map) {
        map.getCanvas().style.cursor = "";
    }

    emit("map-leave");
}

function handleTrackClick(event: MapLayerMouseEvent) {
    if (!overlapIndex) return;

    const candidates = getTrackDistanceCandidatesForPoint(
        overlapIndex,
        event.lngLat.lat,
        event.lngLat.lng,
    ).slice(0, MAX_HOVER_DISTANCES);
    const primaryCandidate = candidates[0];
    if (!primaryCandidate) return;

    emit("track-click", {
        lat: event.lngLat.lat,
        lng: event.lngLat.lng,
        distance: primaryCandidate.distance,
        distances: candidates.map((candidate) => candidate.distance),
        candidates,
        screenX: event.point.x,
        screenY: event.point.y,
    });
}

function getWaypointFromFeatureProperties(
    properties: Record<string, unknown> | null | undefined,
) {
    const waypointId = properties?.waypointId;
    if (typeof waypointId !== "string") return null;
    return props.waypoints.find((item) => item.id === waypointId) ?? null;
}

function createResetViewControl() {
    if (!map || !maplibregl || resetViewControl) return;

    class ResetViewControl implements IControl {
        private mapInstance: MapLibreMap | null = null;
        private container: HTMLDivElement | null = null;

        onAdd(mapInstance: MapLibreMap) {
            this.mapInstance = mapInstance;

            const container = document.createElement("div");
            container.className = "maplibregl-ctrl maplibregl-ctrl-group";

            const button = document.createElement("button");
            button.type = "button";
            button.className =
                "maplibre-reset-view-button w-8 h-8 rounded cursor-pointer";
            button.setAttribute("aria-label", "Reset map view");
            button.innerHTML = `
        <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path
            d="M3.5 8a4.5 4.5 0 1 0 1.318-3.182"
            fill="none"
            stroke="#444444"
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.5"
          />
          <path
            d="M2.5 2.5v3h3"
            fill="none"
            stroke="#444444"
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.5"
          />
        </svg>
      `;
            button.addEventListener("click", (event) => {
                event.preventDefault();
                fitToCourseBounds({ animate: true });
            });

            container.appendChild(button);
            this.container = container;
            resetViewButton = button;
            updateResetViewControlState();

            return container;
        }

        onRemove() {
            this.container?.remove();
            this.container = null;
            this.mapInstance = null;
            resetViewButton = null;
        }
    }

    resetViewControl = new ResetViewControl();
    map.addControl(resetViewControl, "top-left");
}

function createBasemapControl() {
    if (!map || !maplibregl || basemapControl) return;

    class BasemapControl implements IControl {
        private mapInstance: MapLibreMap | null = null;
        private container: HTMLDivElement | null = null;

        onAdd(mapInstance: MapLibreMap) {
            this.mapInstance = mapInstance;

            const container = document.createElement("div");
            container.className =
                "maplibregl-ctrl maplibregl-ctrl-group maplibre-basemap-control";

            const button = document.createElement("button");
            button.type = "button";
            button.className =
                "maplibre-reset-view-button maplibre-basemap-button w-8 h-8 rounded cursor-pointer";
            button.setAttribute("aria-label", "Choose basemap");
            button.setAttribute("aria-haspopup", "menu");
            button.setAttribute("aria-expanded", "false");
            button.innerHTML = `
        <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path
            d="M2 4.25 5.5 3l5 1.75L14 3.5v8L10.5 12.75l-5-1.75L2 12.25z"
            fill="none"
            stroke="#444444"
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.25"
          />
          <path
            d="M5.5 3v8M10.5 4.75v8"
            fill="none"
            stroke="#444444"
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.25"
          />
        </svg>
      `;

            const panel = document.createElement("div");
            panel.className = "maplibre-basemap-panel rounded";
            panel.hidden = true;
            panel.setAttribute("role", "menu");
            panel.setAttribute("aria-label", "Basemap options");

            basemapOptionButtons.clear();
            MAP_BASEMAPS.forEach((basemap) => {
                const optionButton = document.createElement("button");
                optionButton.type = "button";
                optionButton.className = "maplibre-basemap-option";
                optionButton.setAttribute("role", "menuitemradio");
                optionButton.setAttribute("aria-checked", "false");
                optionButton.innerHTML = `
          <span class="maplibre-basemap-option-label">${basemap.label}</span>
          <span class="maplibre-basemap-option-check" aria-hidden="true">✓</span>
        `;
                optionButton.addEventListener("click", () => {
                    updateBasemapSelection(basemap.id);
                    setBasemapMenuOpen(false);
                });

                basemapOptionButtons.set(basemap.id, optionButton);
                panel.appendChild(optionButton);
            });

            button.addEventListener("click", (event) => {
                event.preventDefault();
                event.stopPropagation();
                setBasemapMenuOpen(!basemapMenuOpen);
            });

            container.appendChild(button);
            container.appendChild(panel);
            this.container = container;
            basemapMenuButton = button;
            basemapMenuPanel = panel;
            basemapMenuContainer = container;
            updateBasemapSelection(activeBasemapId);
            setBasemapMenuOpen(false);

            return container;
        }

        onRemove() {
            this.container?.remove();
            this.container = null;
            this.mapInstance = null;
            basemapMenuButton = null;
            basemapMenuPanel = null;
            basemapMenuContainer = null;
            basemapOptionButtons.clear();
        }
    }

    basemapControl = new BasemapControl();
    map.addControl(basemapControl, "top-right");
}

function collapseCompactAttributionControl() {
    if (!map) return;

    const attribution = map
        .getContainer()
        .querySelector(".maplibregl-ctrl-attrib.maplibregl-compact");

    if (!(attribution instanceof HTMLDetailsElement)) return;

    attribution.classList.remove("maplibregl-compact-show");
    attribution.removeAttribute("open");
}

function createAttributionControl() {
    if (!map || !maplibregl) return;

    map.addControl(
        new maplibregl.AttributionControl({
            compact: true,
        }),
        "bottom-right",
    );

    requestAnimationFrame(() => {
        collapseCompactAttributionControl();
    });

    map.once("idle", () => {
        collapseCompactAttributionControl();
    });
}

onMounted(() => {
    if (!maplibregl || !mapContainerRef.value) return;

    map = new maplibregl.Map({
        container: mapContainerRef.value,
        attributionControl: false,
        style: createRasterBasemapStyle(activeBasemapId),
        ...resolveInitialMapOptions(),
    });

    map.on("load", () => {
        if (!map) return;

        createAttributionControl();
        createResetViewControl();
        ensureBasemapSourcesAndLayers();
        createBasemapControl();
        ensureSourcesAndLayers();
        updateTrackSources();
        void updateWaypointSource();
        updateElevationHoverMarker();
        updateHighlightSegment();
        updateGenericMarkers();
        updateBasemapSelection(activeBasemapId, { persist: false });

        map.on("mousemove", TRACK_HIT_LAYER_ID, (event) => {
            if (!map) return;
            map.getCanvas().style.cursor = "pointer";
            handleTrackHover(event);
        });
        map.on("mouseleave", TRACK_HIT_LAYER_ID, () => {
            handleTrackLeave();
        });

        const handleWaypointEnter = () => {
            map?.getCanvas().style.setProperty("cursor", "pointer");
        };

        const handleWaypointLeave = () => {
            map?.getCanvas().style.setProperty("cursor", "");
        };

        map.on("mouseenter", WAYPOINT_HIT_LAYER_ID, handleWaypointEnter);
        map.on("mouseenter", WAYPOINT_SYMBOL_LAYER_ID, handleWaypointEnter);
        map.on("mouseleave", WAYPOINT_HIT_LAYER_ID, handleWaypointLeave);
        map.on("mouseleave", WAYPOINT_SYMBOL_LAYER_ID, handleWaypointLeave);
        map.on("click", (event) => {
            if (!map) return;

            const queryRadius = 18;
            const features = map.queryRenderedFeatures(
                [
                    [event.point.x - queryRadius, event.point.y - queryRadius],
                    [event.point.x + queryRadius, event.point.y + queryRadius],
                ],
                {
                    layers: [WAYPOINT_SYMBOL_LAYER_ID, WAYPOINT_HIT_LAYER_ID],
                },
            );

            const waypoint = features
                .map((feature) =>
                    getWaypointFromFeatureProperties(
                        feature.properties as
                            | Record<string, unknown>
                            | undefined,
                    ),
                )
                .find(Boolean);

            if (waypoint) {
                emit("waypoint-click", waypoint);
                return;
            }

            const trackFeatures = map.queryRenderedFeatures(event.point, {
                layers: [TRACK_HIT_LAYER_ID],
            });
            if (trackFeatures.length > 0) {
                handleTrackClick(event);
            }
        });

        window.setTimeout(() => {
            map?.resize();
        }, 100);
    });

    windowResizeHandler = () => {
        map?.resize();
    };
    window.addEventListener("resize", windowResizeHandler);

    documentPointerDownHandler = (event) => {
        const target = event.target;
        if (!(target instanceof Node)) return;
        if (basemapMenuContainer?.contains(target)) return;
        setBasemapMenuOpen(false);
    };
    document.addEventListener("pointerdown", documentPointerDownHandler);

    resizeObserver = new ResizeObserver(() => {
        map?.resize();
    });
    resizeObserver.observe(mapContainerRef.value);
});

watch(
    () => [props.geoJsonData, props.overlayGeoJsonData],
    () => {
        updateTrackSources();
        updateHighlightSegment();
    },
    { deep: true },
);

watch(
    () => props.waypoints,
    () => {
        void updateWaypointSource();
        updateResetViewControlState();
    },
    { deep: true },
);

watch(
    () => [props.selectedWaypoint, props.displayMarkersAsSplits] as const,
    ([newWaypoint], [oldWaypoint]) => {
        void updateWaypointSource();

        const selectionChanged = oldWaypoint?.id !== newWaypoint?.id;
        const positionChanged =
            oldWaypoint?.lat !== newWaypoint?.lat ||
            oldWaypoint?.lng !== newWaypoint?.lng;

        if (
            props.autoZoomToWaypoint &&
            newWaypoint &&
            map &&
            (selectionChanged || positionChanged)
        ) {
            map.easeTo({
                center: [newWaypoint.lng, newWaypoint.lat],
                zoom:
                    typeof props.zoom === "number" ? props.zoom : map.getZoom(),
                duration: 500,
            });
        }
    },
    { deep: true },
);

watch(
    () => props.markers,
    () => {
        updateGenericMarkers();
    },
    { deep: true },
);

watch(
    () => [props.center, props.zoom] as const,
    ([newCenter, newZoom], [oldCenter, oldZoom]) => {
        const centerChanged =
            !oldCenter ||
            !newCenter ||
            oldCenter[0] !== newCenter[0] ||
            oldCenter[1] !== newCenter[1];
        const zoomChanged = oldZoom !== newZoom;

        if (
            map &&
            newCenter &&
            typeof newZoom === "number" &&
            (centerChanged || zoomChanged)
        ) {
            map.jumpTo({
                center: toMapLibreCenter(newCenter),
                zoom: newZoom,
            });
        }
    },
    { deep: true },
);

watch(
    () => userSettingsStore.settings.mapStyle?.basemapId,
    (nextBasemapId) => {
        const normalized = normalizeMapBasemapId(nextBasemapId);
        if (normalized === activeBasemapId) return;
        updateBasemapSelection(normalized, { persist: false });
    },
    { immediate: true },
);

watch(
    () => props.resetToCourseBoundsKey,
    (newKey, oldKey) => {
        if (newKey !== oldKey) {
            fitToCourseBounds();
        }
    },
);

watch(
    () => props.elevationHoverPoint,
    () => {
        updateElevationHoverMarker();
    },
    { deep: true },
);

watch(
    () => [props.highlightSegment, props.highlightColor, props.fitHighlight],
    () => {
        if (map?.getLayer(HIGHLIGHT_LAYER_ID)) {
            map.setPaintProperty(
                HIGHLIGHT_LAYER_ID,
                "line-color",
                props.highlightColor,
            );
        }
        updateHighlightSegment();
    },
    { deep: true },
);

onUnmounted(() => {
    if (trackHoverFrame !== null) {
        cancelAnimationFrame(trackHoverFrame);
        trackHoverFrame = null;
    }

    pendingTrackHover = null;
    resizeObserver?.disconnect();
    resizeObserver = null;

    selectedWaypointPopup?.remove();
    selectedWaypointPopup = null;
    selectedGenericMarkerPopup?.remove();
    selectedGenericMarkerPopup = null;

    if (windowResizeHandler) {
        window.removeEventListener("resize", windowResizeHandler);
        windowResizeHandler = null;
    }
    if (documentPointerDownHandler) {
        document.removeEventListener("pointerdown", documentPointerDownHandler);
        documentPointerDownHandler = null;
    }

    if (map) {
        map.remove();
        map = null;
    }

    basemapControl = null;
    resetViewControl = null;
    basemapMenuButton = null;
    basemapMenuPanel = null;
    basemapMenuContainer = null;
    basemapOptionButtons.clear();
    resetViewButton = null;
});
</script>

<template>
    <div ref="mapContainerRef" class="w-full h-full rounded-lg shadow-lg z-0" />
</template>

<style scoped>
:deep(.maplibre-reset-view-button) {
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(255, 255, 255, 0.96);
    opacity: 1;
}

:deep(.maplibre-reset-view-button svg) {
    width: 16px;
    height: 16px;
}

:deep(.maplibre-reset-view-button:hover),
:deep(.maplibre-reset-view-button:focus-visible),
:deep(.maplibre-basemap-button:hover),
:deep(.maplibre-basemap-button:focus-visible) {
    background: rgba(255, 255, 255, 0.96);
    opacity: 1;
    box-shadow: none;
}

:deep(.maplibre-reset-view-button:disabled) {
    cursor: not-allowed;
    opacity: 0.5;
}

:deep(.maplibre-basemap-control) {
    position: relative;
}

:deep(.maplibre-basemap-button) {
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(255, 255, 255, 0.96);
    opacity: 1;
}

:deep(.maplibre-basemap-button svg) {
    width: 16px;
    height: 16px;
}

:deep(.maplibre-basemap-panel) {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    min-width: 182px;
    border: 1px solid rgba(148, 163, 184, 0.35);
    background: rgba(255, 255, 255, 0.96);
    box-shadow: 0 10px 24px rgba(15, 23, 42, 0.18);
}

:deep(.maplibre-basemap-option) {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    border: 0;
    border-radius: 0;
    background: transparent;
    color: #444444;
    font-size: 12px;
    line-height: 1.2;
    padding: 9px 12px;
    text-align: left;
}

/*:deep(.maplibre-basemap-option[data-selected="true"]) {
    background: color-mix(in srgb, var(--main-color, #2563eb) 10%, white);
}*/

/*:deep(.maplibre-basemap-option:hover) {
    background:  #f8fafc);
}*/

:deep(.maplibre-basemap-option-check) {
    visibility: hidden;
    font-size: 12px;
    font-weight: 700;
    color: #444444;
}

:deep(
    .maplibre-basemap-option[data-selected="true"]
        .maplibre-basemap-option-check
) {
    visibility: visible;
}

:deep(.maplibre-waypoint-popup .maplibregl-popup-content) {
    padding: 4px 8px;
    font-size: 12px;
    border-radius: 9999px;
    color: #444444;
}

:deep(.maplibre-waypoint-popup .maplibregl-popup-tip) {
    display: none;
}
</style>
