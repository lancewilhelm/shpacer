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

// Generate unique map ID
const mapId = `map-${Math.random().toString(36).substr(2, 9)}`;

let map: L.Map | null = null;
const geoJsonLayers: L.GeoJSON[] = [];
let elevationHoverMarker: L.CircleMarker | null = null;
const showGeoJsonModal = ref(false);
const selectedGeoJson = ref<GeoJSON.FeatureCollection | null>(null);
const selectedFeatureIndex = ref<number>(-1);

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
    const layer = L.geoJSON(geoJson, {
      style: {
        color: getTrackColor(index),
        weight: 3,
        opacity: 0.8,
        fillOpacity: 0.1,
      },
      onEachFeature: (feature, layer) => {
        // Add popup with track information
        if (feature.properties) {
          const popupContent = createPopupContent(feature.properties, index);
          layer.bindPopup(popupContent);
        }
      },
    }).addTo(map!);

    geoJsonLayers.push(layer);
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

// Function to create popup content from feature properties
function createPopupContent(
  properties: Record<string, unknown>,
  geoJsonIndex: number
): string {
  let content = '<div class="track-popup">';

  if (properties.name && typeof properties.name === "string") {
    content += `<h3 style="margin: 0 0 8px 0; font-weight: bold;">${properties.name}</h3>`;
  }

  if (
    (properties.desc || properties.description) &&
    typeof (properties.desc || properties.description) === "string"
  ) {
    content += `<p style="margin: 0 0 8px 0;">${
      properties.desc || properties.description
    }</p>`;
  }

  if (
    properties.time &&
    (typeof properties.time === "string" || typeof properties.time === "number")
  ) {
    content += `<p style="margin: 0; font-size: 0.9em; color: #666;"><strong>Time:</strong> ${new Date(
      properties.time
    ).toLocaleString()}</p>`;
  }

  if (properties.distance && typeof properties.distance === "number") {
    content += `<p style="margin: 0; font-size: 0.9em; color: #666;"><strong>Distance:</strong> ${(
      properties.distance / 1000
    ).toFixed(2)} km</p>`;
  }

  // Add a button to view GeoJSON
  content += `<div style="margin-top: 8px; text-align: center;">
    <button 
      onclick="window.viewGeoJsonFromMap(${geoJsonIndex})"
      style="
        background: #3b82f6; 
        color: white; 
        border: none; 
        padding: 4px 8px; 
        border-radius: 4px; 
        cursor: pointer;
        font-size: 12px;
      "
    >
      View GeoJSON
    </button>
  </div>`;

  content += "</div>";
  return content;
}

function viewGeoJsonFromMap(geoJsonIndex: number) {
  if (props.geoJsonData[geoJsonIndex]) {
    selectedGeoJson.value = props.geoJsonData[geoJsonIndex];
    selectedFeatureIndex.value = geoJsonIndex;
    showGeoJsonModal.value = true;
  }
}

function closeGeoJsonModal() {
  showGeoJsonModal.value = false;
  selectedGeoJson.value = null;
  selectedFeatureIndex.value = -1;
}

function copyGeoJsonToClipboard() {
  if (selectedGeoJson.value) {
    const jsonString = JSON.stringify(selectedGeoJson.value, null, 2);
    navigator.clipboard
      .writeText(jsonString)
      .then(() => {
        console.log("GeoJSON copied to clipboard");
      })
      .catch((err) => {
        console.error("Failed to copy GeoJSON:", err);
      });
  }
}

onMounted(() => {
  if (!L) return; // Guard against SSR
  
  // Initialize the map
  map = L.map(mapId).setView(props.center, props.zoom);

  // Expose viewGeoJsonFromMap function globally for popup button
  (
    window as typeof window & { viewGeoJsonFromMap: (index: number) => void }
  ).viewGeoJsonFromMap = viewGeoJsonFromMap;

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
  // Clean up global function
  if (typeof window !== "undefined") {
    delete (
      window as typeof window & { viewGeoJsonFromMap?: (index: number) => void }
    ).viewGeoJsonFromMap;
  }
});
</script>

<template>
  <div :id="mapId" class="w-full h-full rounded-lg shadow-lg z-0" />

  <!-- GeoJSON Modal -->
  <ModalWindow :open="showGeoJsonModal" @close="closeGeoJsonModal">
    <div class="max-w-4xl w-full">
      <div class="flex items-center justify-between mb-4">
        <div class="text-md font-semibold text-(--main-color)">
          GeoJSON Data - Track {{ selectedFeatureIndex + 1 }}
        </div>
        <div class="flex items-center gap-2">
          <button
            class="px-3 py-1 bg-(--main-color) text-(--bg-color) rounded hover:opacity-80 transition-opacity text-sm"
            @click="copyGeoJsonToClipboard"
          >
            <Icon
              name="lucide:copy"
              class="h-4 w-4 inline mr-1"
            />
            Copy
          </button>
          <button
            class="text-(--sub-color) hover:text-(--main-color) transition-colors"
            @click="closeGeoJsonModal"
          >
            <Icon name="heroicons:x-mark" class="h-5 w-5" />
          </button>
        </div>
      </div>

      <div
        class="bg-(--bg-color) border border-(--sub-color) rounded-lg p-4 max-h-96 overflow-auto"
      >
        <pre class="text-sm text-(--main-color) whitespace-pre-wrap">{{
          selectedGeoJson ? JSON.stringify(selectedGeoJson, null, 2) : ""
        }}</pre>
      </div>
    </div>
  </ModalWindow>
</template>
