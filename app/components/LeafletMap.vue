<script setup lang="ts">
import { formatDistance, formatElevation } from '~/utils/courseMetrics';
import { getWaypointColorFromOrder } from '~/utils/waypoints';

// Define a waypoint type that matches what we get from the API
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

// Only import Leaflet on client side to avoid SSR issues
let L: typeof import("leaflet") | null = null;
if (import.meta.client) {
  await import("leaflet/dist/leaflet.css");
  L = (await import("leaflet")).default;
}

interface Props {
  center?: [number, number];
  zoom?: number;
  markers?: Array<{
    position: [number, number];
    popup?: string;
    open?: boolean;
  }>;
  geoJsonData?: GeoJSON.FeatureCollection[];
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
}

const props = withDefaults(defineProps<Props>(), {
  center: () => [51.505, -0.09],
  zoom: 13,
  markers: () => [],
  geoJsonData: () => [],
  waypoints: () => [],
  selectedWaypoint: null,
  elevationHoverPoint: null,
  autoZoomToWaypoint: false,
  mapClickLocation: null,
});

const emit = defineEmits<{
  'map-hover': [event: { lat: number; lng: number; distance: number }];
  'map-leave': [];
  'waypoint-click': [waypoint: Waypoint];
  'line-click': [coords: { lat: number; lng: number }];
  'track-click': [coords: { lat: number; lng: number }];
}>();

const userSettingsStore = useUserSettingsStore();

// Generate unique map ID
const mapId = `map-${Math.random().toString(36).substr(2, 9)}`;

let map: L.Map | null = null;
const geoJsonLayers: L.GeoJSON[] = [];
const waypointMarkers: Map<string, L.Marker> = new Map(); // Track markers by waypoint ID
let elevationHoverMarker: L.CircleMarker | null = null;

// Function to handle track hover and calculate distance along route
function handleTrackHover(e: L.LeafletMouseEvent, geoJson: GeoJSON.FeatureCollection) {
  const hoverLat = e.latlng.lat;
  const hoverLng = e.latlng.lng;

  // Find the closest point on the track and calculate cumulative distance
  let closestDistance = Infinity;
  let closestPointDistance = 0;
  let cumulativeDistance = 0;

  // Extract coordinates from the GeoJSON
  const extractCoordinates = (geometry: GeoJSON.Geometry): number[][] => {
    const coords: number[][] = [];
    
    if (geometry.type === 'LineString') {
      coords.push(...geometry.coordinates);
    } else if (geometry.type === 'MultiLineString') {
      for (const line of geometry.coordinates) {
        coords.push(...line);
      }
    } else if (geometry.type === 'Point') {
      coords.push(geometry.coordinates as number[]);
    }
    
    return coords;
  };

  // Process all features in the GeoJSON
  for (const feature of geoJson.features) {
    const coordinates = extractCoordinates(feature.geometry);
    
    for (let i = 0; i < coordinates.length; i++) {
      const coord = coordinates[i];
      if (!coord || coord.length < 2) continue;
      
      const [lon, lat] = coord;
      if (typeof lon !== 'number' || typeof lat !== 'number') continue;

      // Calculate distance from hover point to this coordinate
      const distance = Math.sqrt(
        Math.pow(lat - hoverLat, 2) + Math.pow(lon - hoverLng, 2)
      );

      // If this is the closest point so far
      if (distance < closestDistance) {
        closestDistance = distance;
        closestPointDistance = cumulativeDistance;
      }

      // Calculate cumulative distance for next iteration
      if (i > 0) {
        const prevCoord = coordinates[i - 1];
        if (prevCoord && prevCoord.length >= 2) {
          const [prevLon, prevLat] = prevCoord;
          if (typeof prevLon === 'number' && typeof prevLat === 'number') {
            // Haversine formula for accurate distance
            const R = 6371000; // Earth's radius in meters
            const dLat = (lat - prevLat) * Math.PI / 180;
            const dLon = (lon - prevLon) * Math.PI / 180;
            const a = 
              Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(prevLat * Math.PI / 180) * Math.cos(lat * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            cumulativeDistance += R * c;
          }
        }
      }
    }
  }

  // Emit the hover event with the calculated distance
  emit('map-hover', {
    lat: hoverLat,
    lng: hoverLng,
    distance: closestPointDistance
  });
}

// Function to add GeoJSON layers
function addGeoJsonLayers() {
  if (!map || !L) return;

  // Clear existing GeoJSON layers
  geoJsonLayers.forEach((layer) => {
    map!.removeLayer(layer);
  });
  geoJsonLayers.length = 0;

  // Add new GeoJSON layers
  props.geoJsonData.forEach((geoJson, index) => {
    // Create the visible track layer
    const visibleLayer = L.geoJSON(geoJson, {
      style: {
        color: getTrackColor(index),
        weight: 3, // Visual weight
        opacity: 0.8,
        fillOpacity: 0.1,
      },
      pointToLayer: () => {
        // Return null to prevent automatic point markers
        return null as unknown as L.Layer;
      },
      filter: (feature) => {
        // Only show LineString and MultiLineString, filter out Point features
        return feature.geometry.type === 'LineString' || feature.geometry.type === 'MultiLineString';
      },
    }).addTo(map!);

    // Create an invisible buffer layer for easier hovering
    const bufferLayer = L.geoJSON(geoJson, {
      style: {
        color: 'transparent',
        weight: 15, // Large invisible buffer for hover detection
        opacity: 0,
        fillOpacity: 0,
      },
      filter: (feature) => {
        // Only show LineString and MultiLineString, filter out Point features
        return feature.geometry.type === 'LineString' || feature.geometry.type === 'MultiLineString';
      },
      onEachFeature: (feature, layer) => {
        // Add hover events for track interaction
        layer.on('mousemove', (e: L.LeafletMouseEvent) => {
          handleTrackHover(e, geoJson);
        });

        layer.on('mouseout', () => {
          emit('map-leave');
        });

        // Add click event for track clicking (for waypoint creation)
        layer.on('click', (e: L.LeafletMouseEvent) => {
          emit('track-click', { lat: e.latlng.lat, lng: e.latlng.lng });
        });
      },
    }).addTo(map!);

    geoJsonLayers.push(visibleLayer);
    geoJsonLayers.push(bufferLayer);
  });

  // Fit bounds to show all tracks
  if (geoJsonLayers.length > 0) {
    const group = new L.FeatureGroup(geoJsonLayers);
    map!.fitBounds(group.getBounds(), { padding: [20, 20] });
  }
}

// Function to generate different colors for tracks
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
  return colors[index % colors.length] || "#ff0000";
}

// Function to get waypoint display content (S, F, or number)
function getWaypointDisplayContent(waypoint: Waypoint, waypoints: Waypoint[]): string {
  const sortedWaypoints = [...waypoints].sort((a, b) => a.order - b.order);
  const waypointIndex = sortedWaypoints.findIndex(w => w.id === waypoint.id);
  
  if (waypointIndex === -1) return '?';
  
  // First waypoint is Start
  if (waypointIndex === 0) return 'S';
  
  // Last waypoint is Finish
  if (waypointIndex === sortedWaypoints.length - 1) return 'F';
  
  // Middle waypoints are numbered 1, 2, 3, etc.
  return waypointIndex.toString();
}

// Function to get waypoint primary color
function getWaypointPrimaryColor(waypoint: Waypoint, waypoints: Waypoint[]): string {
  return getWaypointColorFromOrder(waypoint, waypoints);
}

// Function to create custom waypoint icon
function createWaypointIcon(waypoint: Waypoint, waypoints: Waypoint[], isSelected: boolean = false): L.DivIcon | null {
  if (!L) return null;

  const color = getWaypointPrimaryColor(waypoint, waypoints);
  const displayContent = getWaypointDisplayContent(waypoint, waypoints);
  const size = isSelected ? 16 : 12;
  const borderWidth = isSelected ? 3 : 2;

  return L.divIcon({
    html: `
      <div style="
        width: ${size * 2}px;
        height: ${size * 2}px;
        background-color: ${color};
        border: ${borderWidth}px solid white;
        border-radius: 50%;
        box-shadow: 0 2px 6px rgba(0,0,0,0.3);
        display: flex;
        align-items: center;
        justify-content: center;
        position: relative;
        font-weight: bold;
        color: white;
        font-size: ${size * 0.8}px;
      ">
        ${displayContent}
      </div>
    `,
    className: 'waypoint-marker',
    iconSize: [size * 2, size * 2],
    iconAnchor: [size, size],
  });
}

// Function to efficiently update waypoint markers
function updateWaypointMarkers() {
  if (!map || !L) return;

  const currentWaypointIds = new Set(props.waypoints.map(w => w.id));
  const existingMarkerIds = new Set(waypointMarkers.keys());

  // Remove markers for waypoints that no longer exist
  for (const markerId of existingMarkerIds) {
    if (!currentWaypointIds.has(markerId)) {
      const marker = waypointMarkers.get(markerId);
      if (marker) {
        map.removeLayer(marker);
        waypointMarkers.delete(markerId);
      }
    }
  }

  // Update or create markers for each waypoint
  props.waypoints.forEach((waypoint) => {
    const isSelected = props.selectedWaypoint?.id === waypoint.id;
    const existingMarker = waypointMarkers.get(waypoint.id);

    if (existingMarker) {
      // Get current marker position to check if it actually changed
      const currentPos = existingMarker.getLatLng();
      const positionChanged = currentPos.lat !== waypoint.lat || currentPos.lng !== waypoint.lng;
      
      // Only update position if it actually changed
      if (positionChanged) {
        existingMarker.setLatLng([waypoint.lat, waypoint.lng]);
      }
      
      // Check if icon needs updating (selection state or waypoint number changed)
      const icon = existingMarker.getIcon() as L.DivIcon;
      const iconHtml = typeof icon?.options?.html === 'string' ? icon.options.html : '';
      const currentlySelected = iconHtml.includes('border: 3px');
      const shouldBeSelected = isSelected;
      const iconNeedsUpdate = currentlySelected !== shouldBeSelected;
      
      if (iconNeedsUpdate) {
        const newIcon = createWaypointIcon(waypoint, props.waypoints, isSelected);
        if (newIcon) {
          existingMarker.setIcon(newIcon);
        }
      }

      // Only update tooltip if selection state changed
      if (iconNeedsUpdate) {
        // Update tooltip
        existingMarker.unbindTooltip();
        existingMarker.bindTooltip(
          `<strong>${waypoint.name}</strong>`,
          {
            permanent: isSelected,
            direction: 'top',
            offset: [0, -10]
          }
        );

        // Handle tooltip visibility
        if (isSelected) {
          existingMarker.openTooltip();
        } else {
          existingMarker.closeTooltip();
        }
      }
    } else {
      // Create new marker
      const icon = createWaypointIcon(waypoint, props.waypoints, isSelected);
      if (!icon) return;

      const marker = L.marker(
        [waypoint.lat, waypoint.lng],
        { icon }
      ).addTo(map!);

      // Add click handler
      marker.on('click', () => {
        emit('waypoint-click', waypoint);
      });

      // Add tooltip
      marker.bindTooltip(
        `<strong>${waypoint.name}</strong>`,
        {
          permanent: isSelected,
          direction: 'top',
          offset: [0, -10]
        }
      );

      // If this waypoint is selected, open the tooltip
      if (isSelected) {
        marker.openTooltip();
      }

      waypointMarkers.set(waypoint.id, marker);
    }
  });
}

onMounted(() => {
  if (!L) return; // Guard against SSR
  
  // Initialize the map
  map = L.map(mapId).setView(props.center, props.zoom);

  // OSM tiles
  const osm = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution:
      '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);

  // OSM-HOT tiles
  const osmHot = L.tileLayer(
    "https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png",
    {
      maxZoom: 19,
      attribution:
        '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, Tiles styled by <a href="https://www.hotosm.org/">Humanitarian OpenStreetMap Team</a> hosted by <a href="https://openstreetmap.fr/">OpenStreetMap France</a>',
    }
  );

  // OpenTopoMap tiles
  const openTopoMap = L.tileLayer(
    "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    {
      maxZoom: 19,
      attribution:
        'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, <a href="http://viewfinderpanoramas.org/">SRTM</a> | Map style: © <a href="https://opentopomap.org/">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)',
    }
  );

  // // Google Satellite tiles (optional, uncomment if needed)
  // const googleSat = L.tileLayer(
  //   "http://{s}.google.com/vt/lyrs=s,h&x={x}&y={y}&z={z}",
  //   {
  //     maxZoom: 20,
  //     subdomains: ["mt0", "mt1", "mt2", "mt3"],
  //   }
  // );

  const mapLink = '<a href="http://www.esri.com/">Esri</a>';
  const wholink =
    "i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community";

  const esri = L.tileLayer(
    "http://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      attribution: "&copy; " + mapLink + ", " + wholink,
      maxZoom: 18,
    }
  );

  const baseMaps = {
    OpenStreetMap: osm,
    "OpenStreetMap.HOT": osmHot,
    OpenTopoMap: openTopoMap,
    // "Google Hybrid": googleSat,
    "Esri Satellite": esri,
  };

  // Create the layer control and add to map
  L.control.layers(baseMaps).addTo(map);

  // Add markers
  props.markers.forEach((marker) => {
    const leafletMarker = L.marker(marker.position).addTo(map!);
    if (marker.popup) {
      leafletMarker.bindPopup(marker.popup);
    }
    if (marker.open) {
      leafletMarker.openPopup();
    }
  });

  // Add GeoJSON layers
  addGeoJsonLayers();

  // Add waypoint markers
  updateWaypointMarkers();

  // Force map to resize in case of layout issues
  setTimeout(() => {
    if (map) {
      map.invalidateSize();
    }
  }, 100);
});

// Function to handle elevation hover point
function updateElevationHoverMarker() {
  if (!map || !L) return;

  // Remove existing marker
  if (elevationHoverMarker) {
    map.removeLayer(elevationHoverMarker);
    elevationHoverMarker = null;
  }

  // Add new marker if point exists
  if (props.elevationHoverPoint) {
    elevationHoverMarker = L.circleMarker(
      [props.elevationHoverPoint.lat, props.elevationHoverPoint.lng],
      {
        radius: 8,
        fillColor: '#ff4444',
        color: '#ffffff',
        weight: 2,
        opacity: 1,
        fillOpacity: 0.8,
      }
    ).addTo(map);

    // Add tooltip with elevation info
    const gradeFormatted = props.elevationHoverPoint.grade >= 0 
      ? `+${props.elevationHoverPoint.grade.toFixed(1)}%` 
      : `${props.elevationHoverPoint.grade.toFixed(1)}%`;
    
    elevationHoverMarker.bindTooltip(
      `Distance: ${formatDistance(props.elevationHoverPoint.distance, userSettingsStore.settings.units.distance)}<br/>` +
      `Elevation: ${formatElevation(props.elevationHoverPoint.elevation, userSettingsStore.settings.units.elevation)}<br/>` +
      `Grade: ${gradeFormatted}`,
      {
        permanent: false,
        direction: 'top',
        offset: [0, -10]
      }
    );
  }
}

// Watch for changes in geoJsonData
watch(
  () => props.geoJsonData,
  () => {
    addGeoJsonLayers();
  },
  { deep: true }
);

// Watch for changes in waypoints
watch(
  () => props.waypoints,
  () => {
    updateWaypointMarkers();
  },
  { deep: true }
);

// Watch for changes in selected waypoint
watch(
  () => props.selectedWaypoint,
  (newWaypoint, oldWaypoint) => {
    // Only update if selection actually changed
    if (oldWaypoint?.id !== newWaypoint?.id) {
      updateWaypointMarkers();
      
      // Only zoom to selected waypoint if auto-zoom is enabled
      if (props.autoZoomToWaypoint && newWaypoint && map) {
        map.setView([newWaypoint.lat, newWaypoint.lng], 16, {
          animate: true,
          duration: 0.5
        });
      }
    }
  },
  { deep: true }
);

// Watch for changes in center and zoom
watch(
  () => [props.center, props.zoom] as const,
  ([newCenter, newZoom], [oldCenter, oldZoom]) => {
    const centerChanged = !oldCenter || !newCenter || 
      oldCenter[0] !== newCenter[0] || oldCenter[1] !== newCenter[1];
    const zoomChanged = oldZoom !== newZoom;
    
    if (map && newCenter && typeof newZoom === 'number' && (centerChanged || zoomChanged)) {
      map.setView(newCenter, newZoom);
    }
  },
  { deep: true }
);

// Watch for changes in elevation hover point
watch(
  () => props.elevationHoverPoint,
  () => {
    updateElevationHoverMarker();
  },
  { deep: true }
);

onUnmounted(() => {
  if (map) {
    map.remove();
    map = null;
  }
});
</script>

<template>
  <div :id="mapId" class="w-full h-full rounded-lg shadow-lg z-0" />
</template>
