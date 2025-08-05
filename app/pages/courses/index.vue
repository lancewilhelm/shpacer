<script setup lang="ts">
import type { SelectCourse } from "~/utils/db/schema";
import { formatDistance, formatElevation } from "~/utils/courseMetrics";

definePageMeta({
    auth: {
        only: "user",
        redirectGuestTo: "/login",
    },
});

useHead({
    title: "Courses",
});

interface CourseListResponse {
    courses: Omit<SelectCourse, "originalFileContent" | "geoJsonData">[];
    total: number;
}

const {
    data: coursesData,
    pending,
    error,
    refresh,
} = await useFetch<CourseListResponse>("/api/courses");
const userSettingsStore = useUserSettingsStore();

const courses = computed(() => coursesData.value?.courses || []);

function formatDate(date: Date | string | number) {
    return new Date(date).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
    });
}

function formatRaceDate(date: Date | string | number | null) {
    if (!date) return null;
    return new Date(date).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
    });
}

function getFileTypeIcon(fileType: string) {
    return fileType === "gpx" ? "heroicons:map" : "heroicons:chart-bar";
}

function formatCourseDistance(meters: number) {
    return formatDistance(meters, userSettingsStore.settings.units.distance);
}

function formatCourseElevation(meters: number) {
    return formatElevation(meters, userSettingsStore.settings.units.elevation);
}
</script>

<template>
    <div class="flex flex-col w-full h-full overflow-hidden">
        <AppHeader class="w-full" />

        <div class="w-full h-full p-4 flex flex-col gap-4 overflow-auto">
            <div class="flex items-center justify-between">
                <div>
                    <h1 class="text-3xl font-bold text-(--main-color)">
                        Courses
                    </h1>
                    <p class="text-(--sub-color) mt-1">
                        {{ courses.length }} course{{
                            courses.length !== 1 ? "s" : ""
                        }}
                    </p>
                </div>

                <NuxtLink
                    to="/courses/new"
                    class="px-4 py-2 bg-(--main-color) text-(--bg-color) rounded-lg hover:opacity-80 transition-opacity flex items-center gap-2"
                >
                    <Icon name="heroicons:plus" class="h-5 w-5" />
                    New Course
                </NuxtLink>
            </div>

            <div v-if="pending" class="flex items-center justify-center py-12">
                <Icon
                    name="svg-spinners:6-dots-scale"
                    class="text-(--main-color) scale-200"
                />
            </div>

            <div
                v-else-if="error"
                class="flex items-center justify-center py-12"
            >
                <div class="text-center">
                    <Icon
                        name="heroicons:exclamation-triangle"
                        class="h-12 w-12 text-(--error-color) mx-auto mb-4"
                    />
                    <p class="text-(--error-color)">Failed to load courses</p>
                    <button
                        class="mt-2 px-4 py-2 bg-(--main-color) text-(--bg-color) rounded"
                        @click="refresh()"
                    >
                        Try Again
                    </button>
                </div>
            </div>

            <div
                v-else-if="courses.length === 0"
                class="flex items-center justify-center py-12"
            >
                <div class="text-center">
                    <Icon
                        name="heroicons:map"
                        class="h-16 w-16 text-(--sub-color) mx-auto mb-4 scale-300"
                    />
                    <h3 class="text-xl font-semibold text-(--main-color) mb-2">
                        No courses yet
                    </h3>
                    <p class="text-(--sub-color) mb-4">
                        Create your first course by uploading a GPX or TCX file
                    </p>
                    <NuxtLink
                        to="/courses/new"
                        class="px-4 py-2 bg-(--main-color) text-(--bg-color) rounded-lg hover:opacity-80 transition-opacity"
                    >
                        Create First Course
                    </NuxtLink>
                </div>
            </div>

            <div
                v-else
                class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
            >
                <div
                    v-for="course in courses"
                    :key="course.id"
                    class="bg-(--sub-alt-color) border border-(--sub-color) rounded-lg p-4 hover:border-(--main-color) transition-colors group cursor-pointer"
                    @click="() => $router.push(`/courses/${course.id}`)"
                >
                    <div class="flex h-full gap-4">
                        <!-- Content -->
                        <div class="flex flex-col flex-1 min-w-0">
                            <!-- Header -->
                            <div class="flex items-start justify-between mb-2">
                                <div class="flex items-center gap-2">
                                    <Icon
                                        :name="getFileTypeIcon(course.fileType)"
                                        class="h-4 w-4 text-(--main-color)"
                                    />
                                    <span
                                        class="text-xs text-(--main-color) uppercase"
                                        >{{ course.fileType }}</span
                                    >
                                </div>
                                <div
                                    v-if="formatRaceDate(course.raceDate)"
                                    class="flex items-center gap-1 text-xs text-(--main-color)"
                                >
                                    <Icon
                                        name="heroicons:flag"
                                        class="h-3 w-3"
                                    />
                                    <span>{{
                                        formatRaceDate(course.raceDate)
                                    }}</span>
                                </div>
                            </div>

                            <!-- Title -->
                            <h3
                                class="font-semibold flex-1 text-(--main-color) mb-1 group-hover:text-(--main-color) transition-colors truncate"
                            >
                                {{ course.name }}
                            </h3>

                            <!-- Description -->
                            <p
                                v-if="course.description"
                                class="text-sm text-(--main-color) mb-2 line-clamp-2"
                            >
                                {{ course.description }}
                            </p>

                            <!-- Metrics -->
                            <div class="flex items-center gap-3 mb-2 text-xs">
                                <div
                                    v-if="course.totalDistance"
                                    class="flex items-center gap-1 text-(--main-color)"
                                >
                                    <Icon
                                        name="heroicons:map-pin"
                                        class="h-3 w-3"
                                    />
                                    <span>{{
                                        formatCourseDistance(
                                            course.totalDistance,
                                        )
                                    }}</span>
                                </div>
                                <div
                                    v-if="course.elevationGain"
                                    class="flex items-center gap-1 text-(--main-color)"
                                >
                                    <Icon
                                        name="heroicons:arrow-trending-up"
                                        class="h-3 w-3"
                                    />
                                    <span>{{
                                        formatCourseElevation(
                                            course.elevationGain,
                                        )
                                    }}</span>
                                </div>
                                <div
                                    v-if="course.elevationLoss"
                                    class="flex items-center gap-1 text-(--main-color)"
                                >
                                    <Icon
                                        name="heroicons:arrow-trending-down"
                                        class="h-3 w-3"
                                    />
                                    <span>{{
                                        formatCourseElevation(
                                            course.elevationLoss,
                                        )
                                    }}</span>
                                </div>
                            </div>

                            <!-- Footer -->
                            <div
                                class="flex items-center justify-between text-xs text-(--sub-color) mt-auto"
                            >
                                <span class="truncate">{{
                                    course.originalFileName
                                }}</span>
                                <span class="flex-shrink-0 ml-2">{{
                                    formatDate(course.createdAt)
                                }}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>
