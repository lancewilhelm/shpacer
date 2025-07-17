<script setup lang="ts">
import type { SelectCourse } from "~/utils/db/schema";
import type { Waypoint } from "~/utils/waypoints";
import { formatDistance, formatElevation } from "~/utils/courseMetrics";

definePageMeta({
  auth: {
    only: "user",
    redirectGuestTo: "/login",
  },
});

const route = useRoute();
const courseId = route.params.id as string;
const userSettingsStore = useUserSettingsStore();
const uiStore = useUiStore();

const {
  data: courseData,
  pending,
  error,
  refresh,
} = await useFetch<{ course: SelectCourse }>(`/api/courses/${courseId}`);

const {
  data: waypointsData,
  pending: _waypointsPending,
  error: _waypointsError,
  refresh: _refreshWaypoints,
} = await useFetch<{ waypoints: Waypoint[] }>(`/api/courses/${courseId}/waypoints`);

const course = computed(() => courseData.value?.course);
const waypoints = computed(() => waypointsData.value?.waypoints || []);

// Course edit modal state
const courseEditModalOpen = ref(false);

// Waypoint interaction state
const selectedWaypoint = ref<Waypoint | null>(null);

// Panel resizing state
const isResizing = ref(false);
const resizeStartX = ref(0);
const resizeStartWidth = ref(0);

// Waypoint panel resizing functions
function startResize(event: MouseEvent) {
  isResizing.value = true;
  resizeStartX.value = event.clientX;
  resizeStartWidth.value = uiStore.waypointPanelWidth;
  
  document.addEventListener('mousemove', handleResize);
  document.addEventListener('mouseup', stopResize);
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
}

function handleResize(event: MouseEvent) {
  if (!isResizing.value) return;
  
  const deltaX = resizeStartX.value - event.clientX; // Subtract because we're resizing from the left
  const newWidth = resizeStartWidth.value + deltaX;
  uiStore.setWaypointPanelWidth(newWidth);
}

function stopResize() {
  isResizing.value = false;
  document.removeEventListener('mousemove', handleResize);
  document.removeEventListener('mouseup', stopResize);
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
}

function formatCourseDistance(meters: number) {
  return formatDistance(meters, userSettingsStore.settings.units.distance);
}

function formatCourseElevation(meters: number) {
  return formatElevation(meters, userSettingsStore.settings.units.elevation);
}

useHead({
  title: computed(() => course.value?.name || "Course"),
});

async function downloadOriginalFile() {
  if (!course.value) return;

  try {
    const response = await fetch(`/api/courses/${courseId}/download`);
    if (!response.ok) throw new Error("Download failed");

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = course.value.originalFileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  } catch (error) {
    console.error("Error downloading file:", error);
    alert("Failed to download file");
  }
}

async function deleteCourse() {
  if (!course.value) return;

  const confirmed = confirm(
    `Are you sure you want to delete "${course.value.name}"? This action cannot be undone.`
  );
  if (!confirmed) return;

  try {
    await $fetch(`/api/courses/${courseId}`, {
      method: "DELETE",
    });

    await navigateTo("/courses");
  } catch (error) {
    console.error("Error deleting course:", error);
    alert("Failed to delete course");
  }
}

function formatDate(date: Date | string | number) {
  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatRaceDate(date: Date | string | number | null) {
  if (!date) return null;
  // Use UTC methods to avoid timezone conversion
  const dateObj = new Date(date);
  const year = dateObj.getUTCFullYear();
  const month = dateObj.getUTCMonth();
  const day = dateObj.getUTCDate();
  const hours = dateObj.getUTCHours();
  const minutes = dateObj.getUTCMinutes();
  
  const dateStr = new Date(year, month, day).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  
  // Add time if it's not midnight
  if (hours !== 0 || minutes !== 0) {
    const timeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    return `${dateStr} at ${timeStr}`;
  }
  
  return dateStr;
}

const geoJsonData = computed(() => {
  if (!course.value?.geoJsonData) return [];
  return [course.value.geoJsonData as GeoJSON.FeatureCollection];
});

// Compute map center and zoom from course data
const mapCenter = computed((): [number, number] => {
  // If we have waypoints, use the first waypoint as center
  if (waypoints.value.length > 0) {
    const firstWaypoint = waypoints.value[0];
    if (firstWaypoint) {
      return [firstWaypoint.lat, firstWaypoint.lng];
    }
  }
  
  // If we have geo data, try to extract center from it
  if (geoJsonData.value.length > 0) {
    const geoJson = geoJsonData.value[0];
    if (geoJson && geoJson.features.length > 0) {
      const firstFeature = geoJson.features[0];
      if (firstFeature && firstFeature.geometry.type === 'LineString') {
        const coords = firstFeature.geometry.coordinates[0];
        if (coords && coords.length >= 2 && typeof coords[0] === 'number' && typeof coords[1] === 'number') {
          return [coords[1], coords[0]]; // Note: GeoJSON is [lng, lat], Leaflet expects [lat, lng]
        }
      } else if (firstFeature && firstFeature.geometry.type === 'Point') {
        const coords = firstFeature.geometry.coordinates;
        if (coords && coords.length >= 2 && typeof coords[0] === 'number' && typeof coords[1] === 'number') {
          return [coords[1], coords[0]];
        }
      }
    }
  }
  
  // Fallback center
  return [40.7128, -74.0060]; // New York City as a reasonable default
});

const mapZoom = computed((): number => {
  return 13; // Good default zoom level for viewing a course
});

// Elevation chart interaction state
const elevationHoverPoint = ref<{
  lat: number;
  lng: number;
  distance: number;
  elevation: number;
  grade: number;
} | null>(null);

const mapHoverDistance = ref<number | null>(null);

// Handle elevation chart hover events
function handleElevationHover(event: { lat: number; lng: number; distance: number; elevation: number; grade: number }) {
  elevationHoverPoint.value = event;
}

function handleElevationLeave() {
  elevationHoverPoint.value = null;
}

// Handle map hover events
function handleMapHover(event: { lat: number; lng: number; distance: number }) {
  mapHoverDistance.value = event.distance;
}

function handleMapLeave() {
  mapHoverDistance.value = null;
}

// Handle waypoint events
function handleWaypointSelect(waypoint: Waypoint) {
  // Toggle selection: if the same waypoint is clicked, deselect it
  if (selectedWaypoint.value?.id === waypoint.id) {
    selectedWaypoint.value = null;
  } else {
    selectedWaypoint.value = waypoint;
  }
}

function handleWaypointHover(_waypoint: Waypoint) {
  // Could add hover effects here if needed
}

function handleWaypointLeave() {
  // Could clear hover effects here if needed
}

function handleWaypointClick(waypoint: Waypoint) {
  // Toggle selection: if the same waypoint is clicked, deselect it
  if (selectedWaypoint.value?.id === waypoint.id) {
    selectedWaypoint.value = null;
  } else {
    selectedWaypoint.value = waypoint;
  }
}

function handleElevationWaypointClick(chartWaypoint: { id: string; name: string; distance: number; type: 'start' | 'finish' | 'waypoint' | 'poi' }) {
  // Find the full waypoint object from the waypoints array
  const fullWaypoint = waypoints.value.find(wp => wp.id === chartWaypoint.id);
  if (fullWaypoint) {
    handleWaypointClick(fullWaypoint);
  }
}

// Course edit modal handlers
function openCourseEditModal() {
  courseEditModalOpen.value = true;
}

function closeCourseEditModal() {
  courseEditModalOpen.value = false;
}

function handleCourseUpdated(updatedCourse: SelectCourse) {
  if (courseData.value) {
    courseData.value.course = updatedCourse;
  }
  refresh(); // Refresh to get the latest data
}

function handleWaypointUpdated(_updatedWaypoint: Waypoint) {
  // Refresh waypoints to get the latest data
  _refreshWaypoints();
}

function handleWaypointDeleted(_waypointId: string) {
  // Refresh waypoints to get the latest data after deletion
  _refreshWaypoints();
}

// Cleanup resize listeners on unmount
onUnmounted(() => {
  if (isResizing.value) {
    stopResize();
  }
});
</script>

<template>
  <div class="flex flex-col w-full h-full overflow-hidden">
    <AppHeader class="w-full" />

    <div class="w-full h-full flex flex-col overflow-hidden">
      <div v-if="pending" class="flex items-center justify-center h-full">
        <Icon
          name="svg-spinners:6-dots-scale"
          class="text-(--main-color) scale-200"
        />
      </div>

      <div v-else-if="error" class="flex items-center justify-center h-full">
        <div class="text-center">
          <Icon
            name="heroicons:exclamation-triangle"
            class="h-16 w-16 text-(--error-color) mx-auto mb-4"
          />
          <h2 class="text-xl font-semibold text-(--main-color) mb-2">
            Course Not Found
          </h2>
          <p class="text-(--sub-color) mb-4">
            The course you're looking for doesn't exist or you don't have access
            to it.
          </p>
          <NuxtLink
            to="/courses"
            class="px-4 py-2 bg-(--main-color) text-(--bg-color) rounded-lg hover:opacity-80 transition-opacity"
          >
            Back to Courses
          </NuxtLink>
        </div>
      </div>

      <div v-else-if="course" class="flex flex-col h-full">
        <!-- Header Section -->
        <div class="p-4 border-b border-(--sub-color) bg-(--bg-color)">
          <NuxtLink
            to="/courses"
            class="text-(--sub-color) hover:text-(--main-color) transition-colors rounded flex items-center w-min"
          >
            <Icon name="heroicons:arrow-left" class="h-5 w-5" />
          </NuxtLink>
          <div class="flex items-center justify-between gap-4 mb-4">
            <div class="flex-1">
              <h1 class="text-2xl font-bold text-(--main-color)">
                {{ course.name }}
              </h1>
              <div v-if="course.description" class="mt-2">
                <p class="text-(--sub-color)">{{ course.description }}</p>
              </div>
            </div>
            <button
              class="px-4 py-2 bg-(--main-color) text-(--bg-color) rounded-lg hover:opacity-80 transition-opacity flex items-center gap-2"
              @click="courseEditModalOpen = true"
            >
              <Icon name="heroicons:pencil" class="h-4 w-4" />
              Edit Course
            </button>
          </div>

          <div class="flex flex-col gap-4">
            <!-- Course Metrics -->
            <div class="flex items-center gap-6 text-sm">
              <div
                v-if="course.totalDistance"
                class="flex items-center gap-2 text-(--main-color)"
              >
                <Icon name="heroicons:map-pin" class="h-5 w-5 scale-150" />
                <div class="flex flex-col">
                  <span class="font-medium">{{
                    formatCourseDistance(course.totalDistance)
                  }}</span>
                  <span class="text-xs text-(--sub-color)">Distance</span>
                </div>
              </div>
              <div
                v-if="course.elevationGain"
                class="flex items-center gap-2 text-(--main-color)"
              >
                <Icon name="heroicons:arrow-trending-up" class="h-5 w-5 scale-150" />
                <div class="flex flex-col">
                  <span class="font-medium">{{
                    formatCourseElevation(course.elevationGain)
                  }}</span>
                  <span class="text-xs text-(--sub-color)">Elevation Gain</span>
                </div>
              </div>
              <div
                v-if="course.elevationLoss"
                class="flex items-center gap-2 text-(--main-color)"
              >
                <Icon name="heroicons:arrow-trending-down" class="h-5 w-5 scale-150" />
                <div class="flex flex-col">
                  <span class="font-medium">{{
                    formatCourseElevation(course.elevationLoss)
                  }}</span>
                  <span class="text-xs text-(--sub-color)">Elevation Loss</span>
                </div>
              </div>
              <div
                v-if="formatRaceDate(course.raceDate)"
                class="flex items-center gap-2 text-(--accent-color)"
              >
                <Icon name="heroicons:flag" class="h-5 w-5" />
                <div class="flex flex-col">
                  <span class="font-medium">{{
                    formatRaceDate(course.raceDate)
                  }}</span>
                  <span class="text-xs text-(--sub-color)">Race Date</span>
                </div>
              </div>
            </div>

            <!-- File Info -->
            <div class="flex items-center justify-between gap-4">
              <div class="flex items-center gap-4 text-sm text-(--sub-color)">
                <span class="flex items-center gap-1">
                  <Icon name="heroicons:document" class="h-4 w-4" />
                  {{ course.originalFileName }}
                </span>
                <span class="flex items-center gap-1">
                  <Icon name="heroicons:calendar" class="h-4 w-4" />
                  {{ formatDate(course.createdAt) }}
                </span>
                <span class="flex items-center gap-1 uppercase">
                  <Icon name="heroicons:tag" class="h-4 w-4" />
                  {{ course.fileType }}
                </span>
              </div>

              <div class="flex items-center gap-2">
                <button
                  class="px-3 py-1 border border-(--main-color) text-(--main-color) rounded hover:bg-(--main-color) hover:text-(--bg-color) transition-colors text-sm flex items-center gap-1"
                  title="Edit course and waypoints"
                  @click="openCourseEditModal"
                >
                  <Icon name="heroicons:pencil" class="h-4 w-4" />
                  Edit
                </button>
                <button
                  class="px-3 py-1 border border-(--sub-color) text-(--main-color) rounded hover:bg-(--sub-alt-color) transition-colors text-sm flex items-center gap-1"
                  title="Download original file"
                  @click="downloadOriginalFile"
                >
                  <Icon name="heroicons:arrow-down-tray" class="h-4 w-4" />
                  Download
                </button>
                <button
                  class="px-3 py-1 border border-(--error-color) text-(--error-color) rounded hover:bg-(--error-color) hover:text-(--bg-color) transition-colors text-sm flex items-center gap-1"
                  title="Delete course"
                  @click="deleteCourse"
                >
                  <Icon name="heroicons:trash" class="h-4 w-4" />
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Content Section -->
        <div class="flex-1 flex overflow-hidden">
          <!-- Left Panel: Charts and Map -->
          <div class="flex-1 flex flex-col overflow-hidden">
            <!-- Elevation Chart Section -->
            <div class="p-4 border-b border-(--sub-color)">
              <h2 class="text-lg font-semibold text-(--main-color) mb-3">Elevation Profile</h2>
              <ElevationChart
                :geo-json-data="geoJsonData"
                :height="200"
                :map-hover-distance="mapHoverDistance"
                :selected-waypoint-distance="selectedWaypoint?.distance || null"
                :waypoints="waypoints"
                @elevation-hover="handleElevationHover"
                @elevation-leave="handleElevationLeave"
                @waypoint-click="handleElevationWaypointClick"
              />
            </div>

            <!-- Map Section -->
            <div class="flex-1 p-4">
              <div class="h-full rounded-lg overflow-hidden">
                <ClientOnly>
                  <LeafletMap
                    :geo-json-data="geoJsonData"
                    :center="mapCenter"
                    :zoom="mapZoom"
                    :waypoints="waypoints"
                    :selected-waypoint="selectedWaypoint"
                    :elevation-hover-point="elevationHoverPoint"
                    @map-hover="handleMapHover"
                    @map-leave="handleMapLeave"
                    @waypoint-click="handleWaypointClick"
                  />
                  <template #fallback>
                    <div
                      class="w-full h-full bg-(--sub-alt-color) rounded-lg flex items-center justify-center"
                    >
                      <div class="text-center">
                        <Icon
                          name="svg-spinners:6-dots-scale"
                          class="text-(--main-color) scale-200 mb-2"
                        />
                        <p class="text-(--sub-color)">Loading map...</p>
                      </div>
                    </div>
                  </template>
                </ClientOnly>
              </div>
            </div>
          </div>
          
          <!-- Right Panel: Waypoints List -->
          <div 
            class="border-l border-(--sub-color) flex flex-col relative"
            :style="{ width: `${uiStore.waypointPanelWidth}px` }"
          >
            <!-- Resize handle -->
            <div 
              class="absolute left-0 top-0 w-1 h-full cursor-col-resize transition-all duration-200 z-10 hover:w-[3px] hover:bg-(--main-color)"
              :class="{ 'w-2 bg-(--main-color)': isResizing, 'bg-transparent hover:bg-(--main-color)': !isResizing }"
              @mousedown="startResize"
            />
            
            <div class="p-4 border-b border-(--sub-color)">
              <h4 class="text-lg font-semibold text-(--main-color)">Waypoints</h4>
            </div>
            <div class="flex-1 overflow-hidden">
              <WaypointList
                :waypoints="waypoints"
                :selected-waypoint="selectedWaypoint"
                @waypoint-select="handleWaypointSelect"
                @waypoint-hover="handleWaypointHover"
                @waypoint-leave="handleWaypointLeave"
              />
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Course Edit Modal -->
    <CourseEditModal
      :open="courseEditModalOpen"
      :course="course || null"
      :waypoints="waypoints"
      :geo-json-data="geoJsonData"
      @close="closeCourseEditModal"
      @course-updated="handleCourseUpdated"
      @waypoint-updated="handleWaypointUpdated"
      @waypoint-deleted="handleWaypointDeleted"
    />
  </div>
</template>
