<script setup lang="ts">
definePageMeta({
  auth: {
    only: "user",
    redirectGuestTo: "/login",
  },
});

// Page metadata
useHead({
  title: "Home",
});

// Map configuration
const mapCenter: [number, number] = [37.228907521653305, -80.42045661944468];
const mapMarkers = [
  {
    position: [37.228907521653305, -80.42045661944468] as [number, number],
    popup: "Let's get this",
    open: false,
  },
];

// GeoJSON data from uploaded files
const geoJsonData = ref<GeoJSON.FeatureCollection[]>([]);

// Handle file upload
function onFilesProcessed(
  files: Array<{ name: string; geoJson: GeoJSON.FeatureCollection }>,
) {
  // Clear existing data and add new files
  geoJsonData.value = files.map((file) => file.geoJson);
}

function onFileAdded(file: {
  name: string;
  geoJson: GeoJSON.FeatureCollection;
}) {
  // For single file upload, replace existing data
  geoJsonData.value = [file.geoJson];
}

function onFileRemoved(_fileName: string) {
  // Clear the GeoJSON data when file is removed
  geoJsonData.value = [];
}
</script>

<template>
  <div class="flex flex-col w-full h-full overflow-hidden">
    <AppHeader class="w-full" />
    <div class="w-full h-full p-4 flex flex-col gap-4">
      <div>
        <h2 class="text-2xl font-bold mb-2">shpacer</h2>
      </div>

      <!-- File Upload Section -->
      <div class="flex-shrink-0">
        <FileUpload
          @files-processed="onFilesProcessed"
          @file-added="onFileAdded"
          @file-removed="onFileRemoved"
        />
      </div>

      <!-- Map Section -->
      <div class="flex-1 min-h-0">
        <ClientOnly>
          <LeafletMap
            :center="mapCenter"
            :zoom="13"
            :markers="mapMarkers"
            :geo-json-data="geoJsonData"
          />
          <template #fallback>
            <div
              class="w-full h-full rounded-lg shadow-lg bg-gray-100 flex items-center justify-center"
            >
              <p class="text-gray-500">Loading map...</p>
            </div>
          </template>
        </ClientOnly>
      </div>
    </div>
  </div>
</template>
