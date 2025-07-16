<script setup lang="ts">
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
  elevationHoverPoint?: {
    lat: number;
    lng: number;
    distance: number;
    elevation: number;
  } | null;
}

const props = withDefaults(defineProps<Props>(), {
  center: () => [51.505, -0.09],
  zoom: 13,
  markers: () => [],
  geoJsonData: () => [],
  elevationHoverPoint: null,
});

const emit = defineEmits<{
  'map-hover': [event: { lat: number; lng: number; distance: number }];
  'map-leave': [];
}>();

// Generate unique map ID
const mapId = `map-${Math.random().toString(36).substr(2, 9)}`;

let map: L.Map | null = null;
const geoJsonLayers: L.GeoJSON[] = [];
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
    }).addTo(map!);

    // Create an invisible buffer layer for easier hovering
    const bufferLayer = L.geoJSON(geoJson, {
      style: {
        color: 'transparent',
        weight: 15, // Large invisible buffer for hover detection
        opacity: 0,
        fillOpacity: 0,
      },
      onEachFeature: (feature, layer) => {
        // Add hover events for track interaction
        layer.on('mousemove', (e: L.LeafletMouseEvent) => {
          handleTrackHover(e, geoJson);
        });

        layer.on('mouseout', () => {
          emit('map-leave');
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
    elevationHoverMarker.bindTooltip(
      `Distance: ${(props.elevationHoverPoint.distance / 1000).toFixed(1)}km<br/>` +
      `Elevation: ${props.elevationHoverPoint.elevation.toFixed(0)}m`,
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
