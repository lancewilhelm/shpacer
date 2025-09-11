<script setup lang="ts">
import type { SelectCourse, SelectPlan } from "~/utils/db/schema";
import { formatDistance, formatElevation } from "~/utils/courseMetrics";
import { formatElapsedTime } from "~/utils/timeCalculations";
import { useUserSettingsStore } from "~/stores/userSettings";

definePageMeta({
    auth: {
        only: "user",
        redirectGuestTo: "/login",
    },
});

useHead({
    title: "shpacer",
});

interface PlanWithCourse extends SelectPlan {
    courseName: string;
}

interface CourseListResponse {
    courses: Omit<SelectCourse, "originalFileContent" | "geoJsonData">[];
}

interface PlanListResponse {
    plans: PlanWithCourse[];
}

const {
    data: coursesData,
    pending: coursesPending,
    error: coursesError,
} = await useFetch<CourseListResponse>("/api/courses");

const {
    data: plansData,
    pending: plansPending,
    error: plansError,
} = await useFetch<PlanListResponse>("/api/plans?limit=4");

const userSettingsStore = useUserSettingsStore();

const courses = computed(() => (coursesData.value?.courses ?? []).slice(0, 4));
const plans = computed(() => plansData.value?.plans ?? []);

function formatCourseDistance(
    meters: number,
    course?: { defaultDistanceUnit?: "kilometers" | "miles" },
) {
    const unit = userSettingsStore.getDistanceUnitForCourse(course);
    return formatDistance(meters, unit);
}

function formatCourseElevation(
    meters: number,
    course?: { defaultElevationUnit?: "meters" | "feet" },
) {
    const unit = userSettingsStore.getElevationUnitForCourse(course);
    return formatElevation(meters, unit);
}

function formatPace(pace: number, paceUnit: string) {
    const totalSeconds = Math.round(pace);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const unit = paceUnit === "min_per_mi" ? "/mi" : "/km";
    return `${minutes}:${seconds.toString().padStart(2, "0")} ${unit}`;
}
</script>

<template>
    <div class="flex flex-col w-full h-full overflow-hidden">
        <AppHeader class="w-full" />
        <div class="w-full h-full p-4 flex flex-col gap-6 overflow-auto">
            <div
                class="text-6xl font-bold text-(--main-color) logo text-center"
            >
                shpacer
            </div>
            <div class="flex flex-col gap-6">
                <!-- Recent Courses -->
                <div>
                    <h3 class="text-xl font-semibold text-(--main-color) mb-2">
                        Recent Courses
                    </h3>
                    <div
                        v-if="coursesPending"
                        class="flex items-center justify-center py-8"
                    >
                        <Icon
                            name="svg-spinners:6-dots-scale"
                            class="text-(--main-color) scale-200"
                        />
                    </div>
                    <div
                        v-else-if="coursesError"
                        class="text-(--error-color) py-8 text-center"
                    >
                        Failed to load courses
                    </div>
                    <div
                        v-else-if="courses.length === 0"
                        class="text-(--sub-color) py-8 text-center"
                    >
                        No courses yet
                    </div>
                    <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div
                            v-for="course in courses"
                            :key="course.id"
                            class="bg-(--sub-alt-color) border border-(--sub-color) rounded-lg p-4 hover:border-(--main-color) transition-colors group cursor-pointer"
                            @click="$router.push(`/courses/${course.id}`)"
                        >
                            <h4
                                class="font-semibold text-(--main-color) truncate"
                            >
                                {{ course.name }}
                            </h4>
                            <div
                                class="flex items-center gap-3 mt-2 text-xs text-(--main-color)"
                            >
                                <div
                                    v-if="course.totalDistance"
                                    class="flex items-center gap-1"
                                >
                                    <Icon
                                        name="lucide:move-horizontal"
                                        class="h-3 w-3 -translate-y-0.25"
                                    />
                                    <span>
                                        {{
                                            formatCourseDistance(
                                                course.totalDistance,
                                                course,
                                            )
                                        }}
                                    </span>
                                </div>
                                <div
                                    v-if="course.elevationGain"
                                    class="flex items-center gap-1"
                                >
                                    <Icon
                                        name="lucide:arrow-up"
                                        class="h-3 w-3 -translate-y-0.25"
                                    />
                                    <span>
                                        {{
                                            formatCourseElevation(
                                                course.elevationGain,
                                                course,
                                            )
                                        }}
                                    </span>
                                </div>
                                <div
                                    v-if="course.elevationLoss"
                                    class="flex items-center gap-1"
                                >
                                    <Icon
                                        name="lucide:arrow-down"
                                        class="h-3 w-3 -translate-y-0.25"
                                    />
                                    <span>
                                        {{
                                            formatCourseElevation(
                                                course.elevationLoss,
                                                course,
                                            )
                                        }}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Recent Plans -->
                <div>
                    <h3 class="text-xl font-semibold text-(--main-color) mb-2">
                        Recent Plans
                    </h3>
                    <div
                        v-if="plansPending"
                        class="flex items-center justify-center py-8"
                    >
                        <Icon
                            name="svg-spinners:6-dots-scale"
                            class="text-(--main-color) scale-200"
                        />
                    </div>
                    <div
                        v-else-if="plansError"
                        class="text-(--error-color) py-8 text-center"
                    >
                        Failed to load plans
                    </div>
                    <div
                        v-else-if="plans.length === 0"
                        class="text-(--sub-color) py-8 text-center"
                    >
                        No plans yet
                    </div>
                    <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div
                            v-for="plan in plans"
                            :key="plan.id"
                            class="bg-(--sub-alt-color) border border-(--sub-color) rounded-lg p-4 hover:border-(--main-color) transition-colors group cursor-pointer"
                            @click="
                                $router.push(
                                    `/courses/${plan.courseId}?plan=${plan.id}`,
                                )
                            "
                        >
                            <div
                                class="text-(--sub-color) font-semibold truncate"
                            >
                                {{ plan.courseName }}
                            </div>
                            <h4
                                class="font-medium text-(--main-color) truncate"
                            >
                                {{ plan.name }}
                            </h4>
                            <div
                                class="flex items-center gap-3 text-xs text-(--main-color)"
                            >
                                <div
                                    v-if="plan.pace"
                                    class="flex items-center gap-1"
                                >
                                    <Icon
                                        name="lucide:gauge"
                                        class="h-3 w-3 -translate-y-0.25"
                                    />
                                    <span>{{
                                        formatPace(plan.pace, plan.paceUnit)
                                    }}</span>
                                </div>
                                <div
                                    v-if="plan.targetTimeSeconds"
                                    class="flex items-center gap-1"
                                >
                                    <Icon
                                        name="lucide:timer"
                                        class="h-3 w-3 -translate-y-0.25"
                                    />
                                    <span>{{
                                        formatElapsedTime(
                                            plan.targetTimeSeconds,
                                        )
                                    }}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<style>
.logo {
    font-family: Poppins, sans-serif;
}
</style>
