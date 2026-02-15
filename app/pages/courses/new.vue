<script setup lang="ts">
import type { SelectCourse } from "~/utils/db/schema";
import {
    calculateCourseMetrics,
    formatDistance,
    formatElevation,
} from "~/utils/courseMetrics";
import { hasElevationSamples } from "~/utils/elevationProfile";

definePageMeta({
    auth: {
        only: "user",
        redirectGuestTo: "/login",
    },
});

useHead({
    title: "New Course",
});

interface ProcessedFile {
    name: string;
    originalContent: string;
    fileType: "gpx" | "tcx";
    geoJson: GeoJSON.FeatureCollection;
}

interface PreviewStats {
    distance: string;
    elevationGain: string;
    elevationLoss: string;
    hasElevation: boolean;
}

const processedFile = ref<ProcessedFile | null>(null);
const courseName = ref("");
const courseDescription = ref("");
const raceDate = ref("");
const startTime = ref("");
const isCreating = ref(false);
const createError = ref("");

function onFileProcessed(file: ProcessedFile) {
    processedFile.value = file;
    // Auto-fill course name from filename (without extension)
    if (!courseName.value) {
        courseName.value = file.name.replace(/\.(gpx|tcx)$/i, "");
    }
}

function onFileRemoved() {
    processedFile.value = null;
    courseName.value = "";
    courseDescription.value = "";
    raceDate.value = "";
    startTime.value = "";
}

async function createCourse() {
    if (!processedFile.value || !courseName.value.trim()) {
        return;
    }

    isCreating.value = true;
    createError.value = "";

    try {
        let raceDateTime = null;
        if (raceDate.value) {
            const raw = (startTime.value || "").trim();
            let time = "00:00:00";
            if (raw) {
                const parts = raw.split(":").map((p) => parseInt(p, 10));
                if (parts.length === 2) {
                    const h = parts[0];
                    const m = parts[1];
                    if (
                        typeof h === "number" &&
                        typeof m === "number" &&
                        Number.isFinite(h) &&
                        Number.isFinite(m) &&
                        h >= 0 &&
                        h <= 23 &&
                        m >= 0 &&
                        m <= 59
                    ) {
                        time = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
                    }
                } else if (parts.length === 3) {
                    const h = parts[0];
                    const m = parts[1];
                    const s = parts[2];
                    if (
                        typeof h === "number" &&
                        typeof m === "number" &&
                        typeof s === "number" &&
                        Number.isFinite(h) &&
                        Number.isFinite(m) &&
                        Number.isFinite(s) &&
                        h >= 0 &&
                        h <= 23 &&
                        m >= 0 &&
                        m <= 59 &&
                        s >= 0 &&
                        s <= 59
                    ) {
                        time = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
                    }
                }
            }
            raceDateTime = `${raceDate.value}T${time}`;
        }

        const response = await $fetch<{ course: SelectCourse }>(
            "/api/courses",
            {
                method: "POST",
                body: {
                    name: courseName.value.trim(),
                    description: courseDescription.value.trim() || undefined,
                    originalFileName: processedFile.value.name,
                    originalFileContent: processedFile.value.originalContent,
                    fileType: processedFile.value.fileType,
                    geoJsonData: processedFile.value.geoJson,
                    raceDate: raceDateTime,
                },
            },
        );

        // Redirect to the new course page
        await navigateTo(`/courses/${response.course.id}`);
    } catch (error) {
        console.error("Error creating course:", error);
        createError.value = "Failed to create course. Please try again.";
    } finally {
        isCreating.value = false;
    }
}

const canCreate = computed(() => {
    return processedFile.value && courseName.value.trim() && !isCreating.value;
});

const previewStats = computed<PreviewStats | null>(() => {
    if (!processedFile.value) {
        return null;
    }

    const metrics = calculateCourseMetrics(processedFile.value.geoJson);
    const hasElevation = hasElevationSamples(processedFile.value.geoJson);

    return {
        distance: formatDistance(metrics.totalDistance, "miles"),
        elevationGain: hasElevation
            ? formatElevation(metrics.elevationGain, "feet")
            : "N/A",
        elevationLoss: hasElevation
            ? formatElevation(metrics.elevationLoss, "feet")
            : "N/A",
        hasElevation,
    };
});
</script>

<template>
    <div class="flex flex-col w-full h-full overflow-hidden">
        <AppHeader class="w-full" />

        <div class="w-full h-full p-4 flex flex-col gap-6 overflow-auto">
            <div class="flex items-center gap-4">
                <NuxtLink
                    to="/courses"
                    class="p-2 text-(--sub-color) hover:text-(--main-color) transition-colors"
                >
                    <Icon name="lucide:arrow-left" class="h-5 w-5 scale-150" />
                </NuxtLink>
                <div>
                    <h1 class="text-3xl font-bold text-(--main-color)">
                        New Course
                    </h1>
                    <p class="text-(--sub-color) mt-1">
                        Upload a GPX or TCX file and create a course
                    </p>
                </div>
            </div>

            <div
                :class="[
                    'mx-auto w-full space-y-6',
                    processedFile ? 'max-w-6xl' : 'max-w-2xl',
                ]"
            >
                <!-- File Upload Section -->
                <div>
                    <h2 class="text-xl font-semibold text-(--main-color) mb-4">
                        Upload File
                    </h2>
                    <FileUpload
                        @file-processed="onFileProcessed"
                        @file-removed="onFileRemoved"
                    />
                </div>

                <div
                    v-if="processedFile"
                    class="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8 lg:items-start"
                >
                    <!-- Course Details Section -->
                    <div class="space-y-4 order-1 lg:order-2">
                        <h2 class="text-xl font-semibold text-(--main-color)">
                            Course Details
                        </h2>

                        <div>
                            <label
                                class="block text-sm font-medium text-(--main-color) mb-2"
                            >
                                Course Name *
                            </label>
                            <input
                                v-model="courseName"
                                type="text"
                                required
                                placeholder="Enter course name"
                                class="w-full px-3 py-2 border border-(--sub-color) rounded-lg bg-(--bg-color) text-(--main-color) placeholder-(--sub-color) focus:outline-none focus:border-(--main-color)"
                            />
                        </div>

                        <div>
                            <label
                                class="block text-sm font-medium text-(--main-color) mb-2"
                            >
                                Description
                            </label>
                            <textarea
                                v-model="courseDescription"
                                placeholder="Enter course description (optional)"
                                rows="3"
                                class="w-full px-3 py-2 border border-(--sub-color) rounded-lg bg-(--bg-color) text-(--main-color) placeholder-(--sub-color) focus:outline-none focus:border-(--main-color)"
                            />
                        </div>

                        <div>
                            <label
                                class="block text-sm font-medium text-(--main-color) mb-2"
                            >
                                Race Date
                            </label>
                            <input
                                v-model="raceDate"
                                type="date"
                                class="w-full px-3 py-2 border border-(--sub-color) rounded-lg bg-(--bg-color) text-(--main-color) focus:outline-none focus:border-(--main-color)"
                            />
                        </div>

                        <div>
                            <label
                                class="block text-sm font-medium text-(--main-color) mb-2"
                            >
                                Start Time
                            </label>
                            <input
                                v-model="startTime"
                                v-time-mask="'hhmmss'"
                                type="text"
                                inputmode="numeric"
                                placeholder="HH:MM:SS"
                                pattern="\d{1,2}:\d{2}:\d{2}"
                                class="w-full px-3 py-2 border border-(--sub-color) rounded-lg bg-(--bg-color) text-(--main-color) focus:outline-none focus:border-(--main-color)"
                            />
                            <p class="text-xs text-(--sub-color) mt-1">
                                Optional: Set a start time if this course is
                                for a specific race
                            </p>
                        </div>

                        <div
                            v-if="createError"
                            class="p-4 bg-(--error-color) bg-opacity-10 border border-(--error-color) rounded-lg"
                        >
                            <p class="text-(--error-color) text-sm">
                                {{ createError }}
                            </p>
                        </div>

                        <div class="flex items-center gap-4 pt-4">
                            <button
                                class="px-6 py-2 bg-(--main-color) text-(--bg-color) rounded-lg hover:opacity-80 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                                :disabled="!canCreate"
                                @click="createCourse"
                            >
                                <Icon
                                    v-if="isCreating"
                                    name="svg-spinners:6-dots-scale"
                                    class="h-4 w-4"
                                />
                                <Icon
                                    v-else
                                    name="lucide:plus"
                                    class="h-4 w-4 scale-125 -translate-y-0.25"
                                />
                                {{
                                    isCreating
                                        ? "Creating..."
                                        : "Create Course"
                                }}
                            </button>

                            <NuxtLink
                                to="/courses"
                                class="px-6 py-2 border border-(--sub-color) text-(--main-color) rounded-lg hover:bg-(--sub-alt-color) transition-colors"
                            >
                                Cancel
                            </NuxtLink>
                        </div>
                    </div>

                    <!-- File Preview Section -->
                    <div class="order-2 lg:order-1">
                        <h2 class="text-xl font-semibold text-(--main-color) mb-4">
                            Preview
                        </h2>
                        <div
                            class="bg-(--sub-alt-color) border border-(--sub-color) rounded-lg p-4"
                        >
                            <div class="flex items-center gap-3 mb-4">
                                <Icon
                                    name="lucide:file-chart-line"
                                    class="h-5 w-5 text-(--main-color)"
                                />
                                <span class="text-(--main-color) font-medium">{{
                                    processedFile.name
                                }}</span>
                                <span
                                    class="text-xs text-(--sub-color) uppercase bg-(--bg-color) px-2 py-1 rounded"
                                >
                                    {{ processedFile.fileType }}
                                </span>
                            </div>

                            <div class="h-64 rounded-lg overflow-hidden">
                                <ClientOnly>
                                    <LeafletMap
                                        :geo-json-data="[processedFile.geoJson]"
                                        :center="[0, 0]"
                                        :zoom="10"
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

                            <div v-if="previewStats" class="mt-4">
                                <div
                                    class="grid grid-cols-1 sm:grid-cols-3 gap-3"
                                >
                                    <div
                                        class="bg-(--bg-color) border border-(--sub-color) rounded-lg p-3"
                                    >
                                        <p
                                            class="text-xs uppercase tracking-wide text-(--sub-color)"
                                        >
                                            Distance
                                        </p>
                                        <p
                                            class="text-lg font-semibold text-(--main-color) mt-1"
                                        >
                                            {{ previewStats.distance }}
                                        </p>
                                    </div>

                                    <div
                                        class="bg-(--bg-color) border border-(--sub-color) rounded-lg p-3"
                                    >
                                        <p
                                            class="text-xs uppercase tracking-wide text-(--sub-color)"
                                        >
                                            Elevation Gain
                                        </p>
                                        <p
                                            class="text-lg font-semibold text-(--main-color) mt-1"
                                        >
                                            {{ previewStats.elevationGain }}
                                        </p>
                                    </div>

                                    <div
                                        class="bg-(--bg-color) border border-(--sub-color) rounded-lg p-3"
                                    >
                                        <p
                                            class="text-xs uppercase tracking-wide text-(--sub-color)"
                                        >
                                            Elevation Loss
                                        </p>
                                        <p
                                            class="text-lg font-semibold text-(--main-color) mt-1"
                                        >
                                            {{ previewStats.elevationLoss }}
                                        </p>
                                    </div>
                                </div>

                                <p
                                    v-if="!previewStats.hasElevation"
                                    class="mt-2 text-xs text-(--sub-color)"
                                >
                                    No elevation samples found in file;
                                    gain/loss unavailable.
                                </p>
                            </div>

                            <ElevationProfilePreview
                                :geo-json="processedFile.geoJson"
                            />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>
