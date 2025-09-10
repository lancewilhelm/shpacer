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
    owned: (Omit<SelectCourse, "originalFileContent" | "geoJsonData"> & {
        role?: string;
    })[];
    starred: (Omit<SelectCourse, "originalFileContent" | "geoJsonData"> & {
        role?: string;
    })[];
    courses: (Omit<SelectCourse, "originalFileContent" | "geoJsonData"> & {
        role?: string;
    })[]; // backward compatibility
    totalOwned: number;
    totalStarred: number;
    total: number;
}

const {
    data: coursesData,
    pending: coursesPending,
    error: coursesError,
    refresh: refreshCourses,
} = await useFetch<CourseListResponse>("/api/courses");

const userSettingsStore = useUserSettingsStore();

const ownedCourses = computed(() => coursesData.value?.owned || []);
const starredCourses = computed(() => coursesData.value?.starred || []);

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
function formatCourseDistance(meters?: number | null) {
    if (meters == null) return "";
    return formatDistance(meters, userSettingsStore.settings.units.distance);
}
function formatCourseElevation(meters?: number | null) {
    if (meters == null) return "";
    return formatElevation(meters, userSettingsStore.settings.units.elevation);
}

interface PublicCourse {
    id: string;
    name: string;
    description: string | null;
    totalDistance: number | null;
    elevationGain: number | null;
    elevationLoss: number | null;
    raceDate: string | null;
    createdAt: string | Date;
    updatedAt: string | Date;
    ownerId: string;
    ownerName: string | null;
}

const publicSearch = ref("");
const publicPage = ref(1);
const publicPageSize = 20;
const publicTotal = ref(0);
const publicCourses = ref<PublicCourse[]>([]);
const publicLoading = ref(false);
const publicError = ref<string | null>(null);
const addingCourseIds = ref<Set<string>>(new Set());

const publicTotalPages = computed(() =>
    Math.max(1, Math.ceil(publicTotal.value / publicPageSize)),
);

let abortController: AbortController | null = null;

async function fetchPublicCourses() {
    publicLoading.value = true;
    publicError.value = null;
    if (abortController) abortController.abort();
    abortController = new AbortController();
    try {
        const params = new URLSearchParams();
        if (publicSearch.value.trim()) {
            params.set("q", publicSearch.value.trim());
        }
        params.set("page", String(publicPage.value));
        params.set("pageSize", String(publicPageSize));
        const resp = await $fetch<{
            success: boolean;
            page: number;
            pageSize: number;
            total: number;
            totalPages: number;
            courses: PublicCourse[];
        }>(`/api/public-courses?${params.toString()}`, {
            signal: abortController.signal,
        });
        publicCourses.value = resp.courses;
        publicTotal.value = resp.total;
    } catch (e: unknown) {
        const isAbort =
            (e instanceof DOMException && e.name === "AbortError") ||
            (typeof e === "object" &&
                e !== null &&
                "name" in e &&
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (e as any).name === "AbortError");
        if (!isAbort) {
            console.error("Failed to load public courses:", e);
            publicError.value = "Failed to load public courses.";
            publicCourses.value = [];
            publicTotal.value = 0;
        }
    } finally {
        publicLoading.value = false;
    }
}

function executeSearch() {
    publicPage.value = 1;
    fetchPublicCourses();
}

let searchDebounce: number | null = null;
watch(
    () => publicSearch.value,
    () => {
        if (searchDebounce) window.clearTimeout(searchDebounce);
        searchDebounce = window.setTimeout(() => {
            publicPage.value = 1;
            fetchPublicCourses();
        }, 400);
    },
);

watch(publicPage, () => {
    fetchPublicCourses();
});

onMounted(() => {
    fetchPublicCourses();
});

async function addPublicCourse(id: string) {
    if (addingCourseIds.value.has(id)) return;
    addingCourseIds.value.add(id);
    try {
        await fetch(`/api/courses/${id}/add`, { method: "POST" });
        publicCourses.value = publicCourses.value.filter((c) => c.id !== id);
        refreshCourses();
        if (
            publicCourses.value.length === 0 &&
            publicPage.value < publicTotalPages.value
        ) {
            publicPage.value += 1;
        }
    } catch (e) {
        console.error("Failed to star course:", e);
        if (globalThis.alert) globalThis.alert("Failed to star course.");
    } finally {
        addingCourseIds.value.delete(id);
    }
}
</script>

<template>
    <div class="flex flex-col w-full h-full overflow-hidden">
        <AppHeader class="w-full" />
        <div class="w-full h-full p-4 flex flex-col gap-10 overflow-auto">
            <!-- Owned Courses -->
            <div class="flex items-center justify-between">
                <div>
                    <h1 class="text-3xl font-bold text-(--main-color)">
                        My Courses
                    </h1>
                    <p class="text-(--sub-color) mt-1">
                        {{ ownedCourses.length }} course{{
                            ownedCourses.length !== 1 ? "s" : ""
                        }}
                    </p>
                </div>
                <NuxtLink
                    to="/courses/new"
                    class="px-4 py-2 bg-(--main-color) text-(--bg-color) rounded-lg hover:opacity-80 transition-opacity flex items-center gap-2"
                >
                    <Icon name="lucide:plus" class="h-5 w-5 scale-125" />
                    New Course
                </NuxtLink>
            </div>

            <div
                v-if="coursesPending"
                class="flex items-center justify-center py-12"
            >
                <Icon
                    name="svg-spinners:6-dots-scale"
                    class="text-(--main-color) scale-200"
                />
            </div>

            <div
                v-else-if="coursesError"
                class="flex items-center justify-center py-12"
            >
                <div class="text-center">
                    <Icon
                        name="lucide:triangle-alert"
                        class="h-12 w-12 text-(--error-color) mx-auto mb-4"
                    />
                    <button
                        class="mt-2 px-4 py-2 bg-(--main-color) text-(--bg-color) rounded"
                        @click="refreshCourses()"
                    >
                        Try Again
                    </button>
                    <p class="text-(--error-color) mt-4">
                        Failed to load courses
                    </p>
                </div>
            </div>

            <div
                v-else-if="ownedCourses.length === 0"
                class="flex items-center justify-center py-12"
            >
                <div class="text-center">
                    <Icon
                        name="lucide:map"
                        class="h-16 w-16 text-(--sub-color) mx-auto mb-4 scale-300"
                    />
                    <h3 class="text-xl font-semibold text-(--main-color) mb-2">
                        No owned courses yet
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
                    v-for="course in ownedCourses"
                    :key="course.id"
                    class="bg-(--sub-alt-color) border border-(--sub-color) rounded-lg p-4 hover:border-(--main-color) transition-colors group cursor-pointer flex flex-col"
                    @click="$router.push(`/courses/${course.id}`)"
                >
                    <h3
                        class="font-semibold text-(--main-color) mb-1 group-hover:text-(--main-color) transition-colors truncate flex items-center gap-2"
                    >
                        <span class="truncate">{{ course.name }}</span>
                        <Icon
                            v-tooltip="course.public ? 'Public' : 'Private'"
                            :name="
                                course.public ? 'lucide:globe' : 'lucide:lock'
                            "
                            class="h-3 w-3 text-(--sub-color) flex-shrink-0"
                        />
                    </h3>
                    <p
                        v-if="course.description"
                        class="text-xs text-(--sub-color) line-clamp-2 mb-2"
                    >
                        {{ course.description }}
                    </p>
                    <div class="flex items-center gap-3 mb-2 text-[11px]">
                        <div
                            v-if="course.totalDistance"
                            class="flex items-center gap-1 text-(--main-color)"
                        >
                            <Icon
                                name="lucide:move-horizontal"
                                class="h-3 w-3"
                            />
                            <span>{{
                                formatCourseDistance(course.totalDistance)
                            }}</span>
                        </div>
                        <div
                            v-if="course.elevationGain"
                            class="flex items-center gap-1 text-(--main-color)"
                        >
                            <Icon name="lucide:arrow-up" class="h-3 w-3" />
                            <span>{{
                                formatCourseElevation(course.elevationGain)
                            }}</span>
                        </div>
                        <div
                            v-if="course.elevationLoss"
                            class="flex items-center gap-1 text-(--main-color)"
                        >
                            <Icon name="lucide:arrow-down" class="h-3 w-3" />
                            <span>{{
                                formatCourseElevation(course.elevationLoss)
                            }}</span>
                        </div>
                        <div
                            v-if="course.raceDate"
                            class="flex items-center gap-1 text-(--main-color)"
                        >
                            <Icon name="lucide:calendar" class="h-3 w-3" />
                            <span>{{ formatRaceDate(course.raceDate) }}</span>
                        </div>
                    </div>
                    <div
                        class="mt-auto flex items-center justify-between text-[11px] text-(--sub-color)"
                    >
                        <span class="truncate">{{
                            course.originalFileName
                        }}</span>
                        <span>{{ formatDate(course.createdAt) }}</span>
                    </div>
                </div>
            </div>

            <!-- Starred Courses -->
            <section v-if="starredCourses.length" class="flex flex-col gap-6">
                <div class="flex items-center justify-between">
                    <div>
                        <h2 class="text-2xl font-bold text-(--main-color)">
                            Starred Courses
                        </h2>
                        <p class="text-(--sub-color) mt-1 text-sm">
                            {{ starredCourses.length }} starred course{{
                                starredCourses.length !== 1 ? "s" : ""
                            }}
                        </p>
                    </div>
                </div>
                <div
                    class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
                >
                    <div
                        v-for="course in starredCourses"
                        :key="course.id"
                        class="bg-(--sub-alt-color) border border-(--sub-color) rounded-lg p-4 hover:border-(--main-color) transition-colors group cursor-pointer flex flex-col relative"
                        @click="$router.push(`/courses/${course.id}`)"
                    >
                        <div
                            class="absolute top-2 right-2 flex items-center gap-1 text-(--main-color) text-[11px] px-2 py-0.5 rounded bg-(--main-color)/10"
                        >
                            <Icon name="lucide:star" class="h-3 w-3" />
                            <span>Starred</span>
                        </div>
                        <h3
                            class="font-semibold text-(--main-color) mb-1 group-hover:text-(--main-color) transition-colors truncate flex items-center gap-2 pr-12"
                        >
                            <span class="truncate">{{ course.name }}</span>
                            <Icon
                                v-tooltip="course.public ? 'Public' : 'Private'"
                                :name="
                                    course.public
                                        ? 'lucide:globe'
                                        : 'lucide:lock'
                                "
                                class="h-3 w-3 text-(--sub-color) flex-shrink-0"
                            />
                        </h3>
                        <p
                            v-if="course.description"
                            class="text-xs text-(--sub-color) line-clamp-2 mb-2"
                        >
                            {{ course.description }}
                        </p>
                        <div class="flex items-center gap-3 mb-2 text-[11px]">
                            <div
                                v-if="course.totalDistance"
                                class="flex items-center gap-1 text-(--main-color)"
                            >
                                <Icon
                                    name="lucide:move-horizontal"
                                    class="h-3 w-3"
                                />
                                <span>{{
                                    formatCourseDistance(course.totalDistance)
                                }}</span>
                            </div>
                            <div
                                v-if="course.elevationGain"
                                class="flex items-center gap-1 text-(--main-color)"
                            >
                                <Icon name="lucide:arrow-up" class="h-3 w-3" />
                                <span>{{
                                    formatCourseElevation(course.elevationGain)
                                }}</span>
                            </div>
                            <div
                                v-if="course.elevationLoss"
                                class="flex items-center gap-1 text-(--main-color)"
                            >
                                <Icon
                                    name="lucide:arrow-down"
                                    class="h-3 w-3"
                                />
                                <span>{{
                                    formatCourseElevation(course.elevationLoss)
                                }}</span>
                            </div>
                            <div
                                v-if="course.raceDate"
                                class="flex items-center gap-1 text-(--main-color)"
                            >
                                <Icon name="lucide:calendar" class="h-3 w-3" />
                                <span>{{
                                    formatRaceDate(course.raceDate)
                                }}</span>
                            </div>
                        </div>
                        <div
                            class="mt-auto flex items-center justify-between text-[11px] text-(--sub-color)"
                        >
                            <span class="truncate">{{
                                course.originalFileName
                            }}</span>
                            <span>{{ formatDate(course.createdAt) }}</span>
                        </div>
                    </div>
                </div>
            </section>

            <!-- Public Courses Search -->
            <section class="flex flex-col gap-4">
                <div class="flex items-center justify-between">
                    <h2 class="text-2xl font-bold text-(--main-color)">
                        Find a Course
                    </h2>
                </div>

                <div class="flex flex-col md:flex-row gap-2 md:items-center">
                    <div class="flex items-center gap-2 flex-1">
                        <input
                            v-model="publicSearch"
                            type="text"
                            placeholder="Search public courses by name..."
                            class="w-full px-3 py-2 rounded border border-(--sub-color) bg-(--sub-alt-color) focus:outline-none focus:border-(--main-color)"
                        />
                        <button
                            class="px-3 py-2 bg-(--main-color) text-(--bg-color) rounded-md hover:opacity-80 transition-opacity flex items-center gap-1"
                            :disabled="publicLoading"
                            @click="executeSearch"
                        >
                            <Icon name="lucide:search" class="h-4 w-4" />
                            Search
                        </button>
                    </div>
                    <div class="flex items-center gap-2">
                        <button
                            class="px-2 py-1 rounded border border-(--sub-color) text-sm disabled:opacity-40"
                            :disabled="publicPage === 1 || publicLoading"
                            @click="publicPage > 1 && publicPage--"
                        >
                            Prev
                        </button>
                        <span class="text-sm text-(--sub-color)">
                            Page {{ publicPage }} / {{ publicTotalPages }}
                        </span>
                        <button
                            class="px-2 py-1 rounded border border-(--sub-color) text-sm disabled:opacity-40"
                            :disabled="
                                publicLoading || publicPage >= publicTotalPages
                            "
                            @click="
                                publicPage < publicTotalPages && publicPage++
                            "
                        >
                            Next
                        </button>
                    </div>
                </div>

                <div
                    v-if="publicLoading"
                    class="flex items-center justify-center py-12"
                >
                    <Icon
                        name="svg-spinners:6-dots-scale"
                        class="text-(--main-color) scale-150"
                    />
                </div>

                <div
                    v-else-if="publicError"
                    class="flex items-center justify-center py-12"
                >
                    <div class="text-center">
                        <Icon
                            name="lucide:triangle-alert"
                            class="h-12 w-12 text-(--error-color) mx-auto mb-4"
                        />
                        <p class="text-(--error-color) font-medium mb-2">
                            {{ publicError }}
                        </p>
                        <button
                            class="px-4 py-2 bg-(--main-color) text-(--bg-color) rounded hover:opacity-80"
                            @click="fetchPublicCourses"
                        >
                            Retry
                        </button>
                    </div>
                </div>

                <div
                    v-else-if="publicCourses.length === 0"
                    class="flex flex-col items-center justify-center py-12 text-center border border-dashed border-(--sub-color) rounded-lg p-6"
                >
                    <Icon
                        name="lucide:search"
                        class="h-12 w-12 text-(--sub-color) mb-4"
                    />
                    <p class="text-(--main-color) font-medium mb-1">
                        No public courses found
                    </p>
                    <p class="text-(--sub-color) text-sm">
                        Try adjusting your search terms.
                    </p>
                </div>

                <div
                    v-else
                    class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
                >
                    <div
                        v-for="pc in publicCourses"
                        :key="pc.id"
                        class="bg-(--sub-alt-color) border border-(--sub-color) rounded-lg p-4 flex flex-col gap-2"
                    >
                        <div class="flex items-start justify-between gap-2">
                            <div class="min-w-0">
                                <h3
                                    class="font-semibold text-(--main-color) mb-1 truncate"
                                >
                                    {{ pc.name }}
                                </h3>
                                <p
                                    v-if="pc.description"
                                    class="text-xs text-(--sub-color) line-clamp-2"
                                >
                                    {{ pc.description }}
                                </p>
                            </div>
                            <button
                                class="px-2 py-1 text-xs rounded bg-(--main-color) text-(--bg-color) hover:opacity-80 disabled:opacity-40 flex items-center justify-center"
                                :disabled="addingCourseIds.has(pc.id)"
                                @click.stop="addPublicCourse(pc.id)"
                            >
                                <span v-if="addingCourseIds.has(pc.id)">
                                    <Icon
                                        name="svg-spinners:3-dots-fade"
                                        class="h-4 w-4"
                                    />
                                </span>
                                <span v-else>Star</span>
                            </button>
                        </div>
                        <div
                            class="flex flex-wrap items-center gap-3 text-[10px] text-(--sub-color)"
                        >
                            <div v-if="pc.totalDistance">
                                <Icon
                                    name="lucide:move-horizontal"
                                    class="inline h-3 w-3 -translate-y-0.5"
                                />
                                {{ formatCourseDistance(pc.totalDistance) }}
                            </div>
                            <div v-if="pc.elevationGain">
                                <Icon
                                    name="lucide:arrow-up"
                                    class="inline h-3 w-3 -translate-y-0.5"
                                />
                                {{ formatCourseElevation(pc.elevationGain) }}
                            </div>
                            <div v-if="pc.elevationLoss">
                                <Icon
                                    name="lucide:arrow-down"
                                    class="inline h-3 w-3 -translate-y-0.5"
                                />
                                {{ formatCourseElevation(pc.elevationLoss) }}
                            </div>
                            <div v-if="pc.ownerName">
                                <Icon
                                    name="lucide:user"
                                    class="inline h-3 w-3 -translate-y-0.5"
                                />
                                {{ pc.ownerName }}
                            </div>
                        </div>
                    </div>
                </div>
            </section>
        </div>
    </div>
</template>
