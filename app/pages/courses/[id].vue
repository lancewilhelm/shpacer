<script setup lang="ts">
import type { SelectCourse } from "~/utils/db/schema";
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

const {
  data: courseData,
  pending,
  error,
  refresh,
} = await useFetch<{ course: SelectCourse }>(`/api/courses/${courseId}`);

const course = computed(() => courseData.value?.course);

const isEditing = ref(false);
const editName = ref("");
const editDescription = ref("");
const editRaceDate = ref("");
const editStartTime = ref("");
const isUpdating = ref(false);
const updateError = ref("");

function formatCourseDistance(meters: number) {
  return formatDistance(meters, userSettingsStore.settings.units.distance);
}

function formatCourseElevation(meters: number) {
  return formatElevation(meters, userSettingsStore.settings.units.elevation);
}

watchEffect(() => {
  if (course.value) {
    editName.value = course.value.name;
    editDescription.value = course.value.description || "";
    const raceDate = course.value.raceDate;
    if (raceDate) {
      // Convert to YYYY-MM-DD format without timezone conversion
      const dateObj = new Date(raceDate);
      const year = dateObj.getUTCFullYear();
      const month = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
      const day = String(dateObj.getUTCDate()).padStart(2, '0');
      editRaceDate.value = `${year}-${month}-${day}`;
      
      // Extract time in HH:MM format
      const hours = String(dateObj.getUTCHours()).padStart(2, '0');
      const minutes = String(dateObj.getUTCMinutes()).padStart(2, '0');
      editStartTime.value = `${hours}:${minutes}`;
    } else {
      editRaceDate.value = "";
      editStartTime.value = "";
    }
  }
});

useHead({
  title: computed(() => course.value?.name || "Course"),
});

async function startEditing() {
  isEditing.value = true;
  updateError.value = "";
}

function cancelEditing() {
  isEditing.value = false;
  editName.value = course.value?.name || "";
  editDescription.value = course.value?.description || "";
  const raceDate = course.value?.raceDate;
  if (raceDate) {
    // Convert to YYYY-MM-DD format without timezone conversion
    const dateObj = new Date(raceDate);
    const year = dateObj.getUTCFullYear();
    const month = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getUTCDate()).padStart(2, '0');
    editRaceDate.value = `${year}-${month}-${day}`;
    
    // Extract time in HH:MM format
    const hours = String(dateObj.getUTCHours()).padStart(2, '0');
    const minutes = String(dateObj.getUTCMinutes()).padStart(2, '0');
    editStartTime.value = `${hours}:${minutes}`;
  } else {
    editRaceDate.value = "";
    editStartTime.value = "";
  }
  updateError.value = "";
}

async function saveChanges() {
  if (!course.value || !editName.value.trim()) {
    return;
  }

  isUpdating.value = true;
  updateError.value = "";

  try {
    let raceDateTime = null;
    if (editRaceDate.value) {
      // Combine date and time into a single datetime value
      const time = editStartTime.value || "00:00";
      raceDateTime = `${editRaceDate.value}T${time}:00`;
    }

    const response = await $fetch<{ course: SelectCourse }>(
      `/api/courses/${courseId}`,
      {
        method: "PUT",
        body: {
          name: editName.value.trim(),
          description: editDescription.value.trim() || undefined,
          raceDate: raceDateTime,
        },
      }
    );

    // Update local data
    if (courseData.value) {
      courseData.value.course = response.course;
    }

    isEditing.value = false;
    
    // Trigger reactivity by refreshing the data
    await refresh();
  } catch (error) {
    console.error("Error updating course:", error);
    updateError.value = "Failed to update course. Please try again.";
  } finally {
    isUpdating.value = false;
  }
}

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

// Elevation chart interaction state
const elevationHoverPoint = ref<{
  lat: number;
  lng: number;
  distance: number;
  elevation: number;
} | null>(null);

const mapHoverDistance = ref<number | null>(null);

// Handle elevation chart hover events
function handleElevationHover(event: { lat: number; lng: number; distance: number; elevation: number }) {
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
          <div class="flex items-center gap-4 mb-4">
            <div class="flex-1">
              <div v-if="!isEditing" class="flex items-center gap-4">
                <h1 class="text-2xl font-bold text-(--main-color)">
                  {{ course.name }}
                </h1>
                <button
                  class="p-2 text-(--sub-color) hover:text-(--main-color) transition-colors rounded"
                  title="Edit course"
                  @click="startEditing"
                >
                  <Icon name="heroicons:pencil" class="h-4 w-4" />
                </button>
              </div>

              <div v-if="!isEditing && course.description" class="mb-4">
                <p class="text-(--sub-color)">{{ course.description }}</p>
              </div>

              <div v-if="isEditing" class="space-y-2 mt-2">
                <input
                  v-model="editName"
                  type="text"
                  class="text-2xl font-bold border border-(--sub-color) focus:border-(--main-color) text-(--main-color) w-full"
                  placeholder="Course name"
                />
                <textarea
                  v-model="editDescription"
                  placeholder="Course description (optional)"
                  rows="2"
                  class="w-full px-3 py-2 border border-(--sub-color) rounded-lg bg-(--bg-color) text-(--main-color) placeholder-(--sub-color) focus:border-(--main-color) mb-0!"
                />
                <div>
                  <label class="block text-sm font-medium text-(--main-color) mb-1">
                    Race Date
                  </label>
                  <input
                    v-model="editRaceDate"
                    type="date"
                    class="w-full px-3 py-2 border border-(--sub-color) rounded-lg bg-(--bg-color) text-(--main-color) focus:border-(--main-color)"
                  />
                </div>
                <div>
                  <label class="block text-sm font-medium text-(--main-color) mb-1">
                    Start Time
                  </label>
                  <input
                    v-model="editStartTime"
                    type="time"
                    class="w-full px-3 py-2 border border-(--sub-color) rounded-lg bg-(--bg-color) text-(--main-color) focus:border-(--main-color)"
                  />
                  <p class="text-xs text-(--sub-color) mt-1">Optional: Set a start time if this course is for a specific race</p>
                </div>
                <div class="flex items-center gap-2">
                  <button
                    class="px-3 py-1 bg-(--main-color) text-(--bg-color) rounded text-sm hover:opacity-80 transition-opacity disabled:opacity-50"
                    :disabled="isUpdating"
                    @click="saveChanges"
                  >
                    {{ isUpdating ? "Saving..." : "Save" }}
                  </button>
                  <button
                    class="px-3 py-1 border border-(--sub-color) text-(--main-color) rounded text-sm hover:bg-(--sub-alt-color) transition-colors"
                    @click="cancelEditing"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div
            v-if="updateError"
            class="mb-4 p-3 bg-(--error-color) bg-opacity-10 border border-(--error-color) rounded-lg"
          >
            <p class="text-(--error-color) text-sm">{{ updateError }}</p>
          </div>

          <div class="flex flex-col gap-4">
            <!-- Course Metrics -->
            <div class="flex items-center gap-6 text-sm">
              <div
                v-if="course.totalDistance"
                class="flex items-center gap-2 text-(--main-color)"
              >
                <Icon name="heroicons:map-pin" class="h-5 w-5" />
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
                <Icon name="heroicons:arrow-trending-up" class="h-5 w-5" />
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
                <Icon name="heroicons:arrow-trending-down" class="h-5 w-5" />
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
        <div class="flex-1 flex flex-col overflow-hidden">
          <!-- Elevation Chart Section -->
          <div class="p-4 border-b border-(--sub-color)">
            <h2 class="text-lg font-semibold text-(--main-color) mb-3">Elevation Profile</h2>
            <ElevationChart
              :geo-json-data="geoJsonData"
              :height="200"
              :map-hover-distance="mapHoverDistance"
              @elevation-hover="handleElevationHover"
              @elevation-leave="handleElevationLeave"
            />
          </div>

          <!-- Map Section -->
          <div class="flex-1 p-4">
            <div class="h-full rounded-lg overflow-hidden">
              <ClientOnly>
                <LeafletMap
                  :geo-json-data="geoJsonData"
                  :center="[0, 0]"
                  :zoom="10"
                  :elevation-hover-point="elevationHoverPoint"
                  @map-hover="handleMapHover"
                  @map-leave="handleMapLeave"
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
      </div>
    </div>
  </div>
</template>
