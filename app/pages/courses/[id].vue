<script setup lang="ts">
import type { SelectCourse } from "~/utils/db/schema";
import { formatDistance, formatElevation } from "~/utils/courseMetrics";

// Define the waypoint type that matches what we get from the API
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

definePageMeta({
    auth: {
        only: "user",
        redirectGuestTo: "/login",
    },
});

// Get the course ID from the route parameters
const route = useRoute();
const courseId = route.params.id as string;

// Import necessary stores
const userSettingsStore = useUserSettingsStore();
const uiStore = useUiStore();

// Fetch course data
const {
    data: courseData,
    pending,
    error,
    refresh,
} = await useFetch<{ course: SelectCourse }>(`/api/courses/${courseId}`);

// Fetch waypoints data
const {
    data: waypointsData,
    pending: _waypointsPending,
    error: _waypointsError,
    refresh: _refreshWaypoints,
} = await useFetch<{ waypoints: Waypoint[] }>(
    `/api/courses/${courseId}/waypoints`,
);

// Store the course and waypoints data in computed properties
const course = computed(() => courseData.value?.course);
const waypoints = computed(() => waypointsData.value?.waypoints || []);

// Set the page title dynamically based on the course name
useHead({
    title: computed(() => course.value?.name || "Course"),
});

// Course edit modal state
const courseEditModalOpen = ref(false);

// Panel resizing state
const isResizing = ref(false);
const resizeStartX = ref(0);
const resizeStartWidth = ref(0);

// Waypoint panel resizing functions
/**
 * Start resizing the waypoint panel
 * @param event MouseEvent
 */
function startResize(event: MouseEvent) {
    isResizing.value = true;
    resizeStartX.value = event.clientX;
    resizeStartWidth.value = uiStore.waypointPanelWidth;

    document.addEventListener("mousemove", handleResize);
    document.addEventListener("mouseup", stopResize);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
}

/**
 * Handle the resizing of the waypoint panel
 * @param event MouseEvent
 */
function handleResize(event: MouseEvent) {
    if (!isResizing.value) return;

    const deltaX = resizeStartX.value - event.clientX; // Subtract because we're resizing from the left
    const newWidth = resizeStartWidth.value + deltaX;
    uiStore.setWaypointPanelWidth(newWidth);
}

/**
 * Stop resizing the waypoint panel
 */
function stopResize() {
    isResizing.value = false;
    document.removeEventListener("mousemove", handleResize);
    document.removeEventListener("mouseup", stopResize);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
}

/**
 * Download the original course file (GPX or TCX)
 */
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

/**
 * Delete the course
 */
async function deleteCourse() {
    if (!course.value) return;

    const confirmed = confirm(
        `Are you sure you want to delete "${course.value.name}"? This action cannot be undone.`,
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

/**
 * Format a date for display
 * @param date Date | string | number
 */
function formatDate(date: Date | string | number) {
    return new Date(date).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

/**
 * Format a race date for display
 * @param date Date | string | number | null
 */
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
        const timeStr = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
        return `${dateStr} at ${timeStr}`;
    }

    return dateStr;
}

// Compute GeoJSON data for the map. This is used to render the course on the map.
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
    grade: number;
} | null>(null);

// Stores the distance for mouse hover on the map course
const mapHoverDistance = ref<number | null>(null);

// Handle elevation chart hover events
function handleElevationHover(event: {
    lat: number;
    lng: number;
    distance: number;
    elevation: number;
    grade: number;
}) {
    elevationHoverPoint.value = event;
}

// Reset elevation hover point when leaving the chart
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

// Waypoint interaction state
const selectedWaypoint = ref<Waypoint | null>(null);

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

function handleElevationWaypointClick(chartWaypoint: {
    id: string;
    name: string;
    distance: number;
    order: number;
    tags: string[];
}) {
    // Find the full waypoint object from the waypoints array
    const fullWaypoint = waypoints.value.find(
        (wp) => wp.id === chartWaypoint.id,
    );
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

function handleWaypointCreated(_createdWaypoint: Waypoint) {
    // Refresh waypoints to get the latest data after creation
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

            <div
                v-else-if="error"
                class="flex items-center justify-center h-full"
            >
                <div class="text-center">
                    <Icon
                        name="heroicons:exclamation-triangle"
                        class="h-16 w-16 text-(--error-color) mx-auto mb-4"
                    />
                    <h2 class="text-xl font-semibold text-(--main-color) mb-2">
                        Course Not Found
                    </h2>
                    <p class="text-(--sub-color) mb-4">
                        The course you're looking for doesn't exist or you don't
                        have access to it.
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
                        class="text-(--sub-color) hover:text-(--main-color) transition-colors rounded flex items-center w-min mb-4"
                    >
                        <Icon name="heroicons:arrow-left" class="h-5 w-5" />
                    </NuxtLink>
                    <div class="flex items-center justify-between gap-4 mb-4">
                        <div class="flex-1">
                            <h1 class="text-2xl font-bold text-(--main-color)">
                                {{ course.name }}
                            </h1>
                            <div v-if="course.description" class="mt-2">
                                <p class="text-(--sub-color)">
                                    {{ course.description }}
                                </p>
                            </div>
                        </div>
                        <CourseActionsDropdown
                            :course="course"
                            @edit-course="openCourseEditModal"
                            @download-file="downloadOriginalFile"
                            @delete-course="deleteCourse"
                        />
                    </div>

                    <div class="flex flex-col gap-4">
                        <!-- Course Metrics -->
                        <div class="flex items-center gap-6 text-sm">
                            <div
                                v-if="course.totalDistance"
                                class="flex items-center gap-2 text-(--main-color)"
                            >
                                <Icon
                                    name="heroicons:map-pin"
                                    class="h-5 w-5 scale-150"
                                />
                                <div class="flex flex-col">
                                    <span class="font-medium">{{
                                        formatDistance(
                                            course.totalDistance,
                                            userSettingsStore.settings.units
                                                .distance,
                                        )
                                    }}</span>
                                    <span class="text-xs text-(--sub-color)"
                                        >Distance</span
                                    >
                                </div>
                            </div>
                            <div
                                v-if="course.elevationGain"
                                class="flex items-center gap-2 text-(--main-color)"
                            >
                                <Icon
                                    name="heroicons:arrow-trending-up"
                                    class="h-5 w-5 scale-150"
                                />
                                <div class="flex flex-col">
                                    <span class="font-medium">{{
                                        formatElevation(
                                            course.elevationGain,
                                            userSettingsStore.settings.units
                                                .elevation,
                                        )
                                    }}</span>
                                    <span class="text-xs text-(--sub-color)"
                                        >Elevation Gain</span
                                    >
                                </div>
                            </div>
                            <div
                                v-if="course.elevationLoss"
                                class="flex items-center gap-2 text-(--main-color)"
                            >
                                <Icon
                                    name="heroicons:arrow-trending-down"
                                    class="h-5 w-5 scale-150"
                                />
                                <div class="flex flex-col">
                                    <span class="font-medium">{{
                                        formatElevation(
                                            course.elevationLoss,
                                            userSettingsStore.settings.units
                                                .elevation,
                                        )
                                    }}</span>
                                    <span class="text-xs text-(--sub-color)"
                                        >Elevation Loss</span
                                    >
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
                                    <span class="text-xs text-(--sub-color)"
                                        >Race Date</span
                                    >
                                </div>
                            </div>
                        </div>

                        <!-- File Info -->
                        <div
                            class="flex items-center gap-4 text-sm text-(--sub-color)"
                        >
                            <span class="flex items-center gap-1">
                                <Icon
                                    name="heroicons:document"
                                    class="h-4 w-4"
                                />
                                {{ course.originalFileName }}
                            </span>
                            <span class="flex items-center gap-1">
                                <Icon
                                    name="heroicons:calendar"
                                    class="h-4 w-4"
                                />
                                {{ formatDate(course.createdAt) }}
                            </span>
                            <span class="flex items-center gap-1 uppercase">
                                <Icon name="heroicons:tag" class="h-4 w-4" />
                                {{ course.fileType }}
                            </span>
                        </div>
                    </div>
                </div>

                <!-- Content Section -->
                <div class="flex-1 flex overflow-hidden">
                    <!-- Left Panel: Charts and Map -->
                    <div class="flex-1 flex flex-col overflow-hidden">
                        <!-- Elevation Chart Section -->
                        <div class="p-4 border-b border-(--sub-color)">
                            <h2
                                class="text-lg font-semibold text-(--main-color) mb-3"
                            >
                                Elevation Profile
                            </h2>
                            <ElevationChart
                                :geo-json-data="geoJsonData"
                                :height="200"
                                :map-hover-distance="mapHoverDistance"
                                :selected-waypoint-distance="
                                    selectedWaypoint?.distance || null
                                "
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
                                        :waypoints="waypoints"
                                        :selected-waypoint="selectedWaypoint"
                                        :elevation-hover-point="
                                            elevationHoverPoint
                                        "
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
                                                <p class="text-(--sub-color)">
                                                    Loading map...
                                                </p>
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
                            :class="{
                                'w-2 bg-(--main-color)': isResizing,
                                'bg-transparent hover:bg-(--main-color)':
                                    !isResizing,
                            }"
                            @mousedown="startResize"
                        />

                        <div class="p-4 border-b border-(--sub-color)">
                            <div
                                class="text-lg font-semibold text-(--main-color)"
                            >
                                Waypoints
                            </div>
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
            @waypoint-created="handleWaypointCreated"
        />
    </div>
</template>
