<script setup lang="ts">
import { formatDistance, formatElevation } from "~/utils/courseMetrics";
import { getDistanceUnitSSR, getElevationUnitSSR } from "~/utils/units";
import { getTagsByIds } from "~/utils/waypointTags";
import { getWaypointColorFromOrder } from "~/utils/waypoints";
import {
    calculateWaypointSegments,
    getSegmentAfterWaypoint,
} from "~/utils/waypointSegments";
import type { WaypointSegment } from "~/utils/waypointSegments";
import { extractElevationProfile } from "~/utils/elevationProfile";
import type { ElevationPoint } from "~/utils/elevationProfile";
import {
    calculateAllElapsedTimes,
    formatElapsedTime,
    getWaypointDelay,
    formatDelayTime,
} from "~/utils/timeCalculations";
import { getSegmentPacingInfo } from "~/utils/gradeAdjustedTimeCalculations";
import type { SelectPlan, SelectWaypointStoppageTime } from "~/utils/db/schema";

// Define a waypoint type that matches what we get from the API
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

interface Props {
    /**
     * When true, the list is rendered in read-only mode:
     * - No editing modal
     * - No saving / deleting notes
     * - No stoppage time edits
     */
    readOnly?: boolean;
    waypoints?: Waypoint[];
    selectedWaypoint?: Waypoint | null;
    currentPlanId?: string | null;
    currentPlan?: SelectPlan | null;
    waypointStoppageTimes?: SelectWaypointStoppageTime[];
    getWaypointNote?: (waypointId: string) => string;
    getWaypointStoppageTime?: (waypointId: string) => number;
    getDefaultStoppageTime?: () => number;
    geoJsonData?: GeoJSON.FeatureCollection[];
}

interface Emits {
    "waypoint-select": [waypoint: Waypoint];
    "waypoint-hover": [waypoint: Waypoint];
    "waypoint-leave": [];
    "save-waypoint-note": [waypointId: string, notes: string];
    "delete-waypoint-note": [waypointId: string];
    "save-waypoint-stoppage-time": [waypointId: string, stoppageTime: number];
    "delete-waypoint-stoppage-time": [waypointId: string];
}

const _props = withDefaults(defineProps<Props>(), {
    waypoints: () => [],
    selectedWaypoint: null,
    currentPlanId: null,
    currentPlan: null,
    waypointStoppageTimes: () => [],
    getWaypointNote: () => () => "",
    getWaypointStoppageTime: () => () => 0,
    getDefaultStoppageTime: () => () => 0,
    geoJsonData: () => [],
});

const {
    waypoints,
    selectedWaypoint,
    currentPlanId,
    currentPlan,
    waypointStoppageTimes,
    getWaypointNote,
    getWaypointStoppageTime,
    getDefaultStoppageTime,
    geoJsonData,
    readOnly,
} = toRefs(_props);

const emit = defineEmits<Emits>();

const userSettingsStore = useUserSettingsStore();

// State for waypoint editing modal
const editingWaypoint = ref<Waypoint | null>(null);
const editModalOpen = ref(false);

// Per-course smoothing settings (fallback to defaults if missing)
const courseIdForSmoothing = computed(
    () => currentPlan.value?.courseId || null,
);
const smoothingConfig = computed(() => {
    return userSettingsStore.getSmoothingForCourse(
        courseIdForSmoothing.value || undefined,
    );
});

// Extract elevation profile from GeoJSON data
const elevationProfile = computed((): ElevationPoint[] => {
    if (!geoJsonData.value || geoJsonData.value.length === 0) {
        return [];
    }

    // Combine all GeoJSON features
    const combinedGeoJson: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features: geoJsonData.value.flatMap(
            (collection) => collection.features,
        ),
    };

    return extractElevationProfile(combinedGeoJson);
});

// Calculate segments between waypoints
const waypointSegments = computed(() => {
    if (!waypoints.value || waypoints.value.length < 2) {
        return [];
    }
    return calculateWaypointSegments(waypoints.value, elevationProfile.value);
});

function handleWaypointClick(waypoint: Waypoint) {
    emit("waypoint-select", waypoint);
}

function handleWaypointHover(waypoint: Waypoint) {
    emit("waypoint-hover", waypoint);
}

function handleWaypointLeave() {
    emit("waypoint-leave");
}

function formatWaypointDistance(meters: number) {
    return formatDistance(meters, getDistanceUnitSSR());
}

function formatWaypointElevation(meters: number | null) {
    if (meters === null) return "";
    return formatElevation(meters, getElevationUnitSSR());
}

function getWaypointPrimaryColor(waypoint: Waypoint): string {
    return getWaypointColorFromOrder(waypoint, waypoints.value || []);
}

function getWaypointDisplayContent(waypoint: Waypoint): string {
    // Check if this is a start waypoint (order 0)
    if (waypoint.order === 0) {
        return "S";
    }

    // Check if this is a finish waypoint (highest order)
    const maxOrder = Math.max(...(waypoints.value?.map((w) => w.order) || [0]));
    if (waypoint.order === maxOrder && waypoint.order > 0) {
        return "F";
    }

    // Regular waypoints get numbered 1, 2, 3, etc.
    // Filter out start/finish waypoints and get the index
    const regularWaypoints =
        waypoints.value?.filter((w) => w.order !== 0 && w.order !== maxOrder) ||
        [];
    const regularIndex = regularWaypoints.findIndex(
        (w) => w.id === waypoint.id,
    );
    return (regularIndex + 1).toString();
}

function openEditModal(waypoint?: Waypoint) {
    if (_props.readOnly) return;
    editingWaypoint.value = waypoint || null;
    editModalOpen.value = true;
}

function closeEditModal() {
    editingWaypoint.value = null;
    editModalOpen.value = false;
}

function handleSaveNote(waypointId: string, notes: string) {
    if (_props.readOnly) return;
    emit("save-waypoint-note", waypointId, notes);
}

function handleDeleteNote(waypointId: string) {
    if (_props.readOnly) return;
    emit("delete-waypoint-note", waypointId);
}

function handleSaveStoppageTime(waypointId: string, stoppageTime: number) {
    if (_props.readOnly) return;
    emit("save-waypoint-stoppage-time", waypointId, stoppageTime);
}

function handleDeleteStoppageTime(waypointId: string) {
    if (_props.readOnly) return;
    emit("delete-waypoint-stoppage-time", waypointId);
}

function formatSegmentDistance(meters: number) {
    return formatDistance(meters, getDistanceUnitSSR());
}

function formatSegmentElevation(meters: number) {
    return formatElevation(meters, getElevationUnitSSR());
}

function getSegmentForWaypoint(waypointId: string): WaypointSegment | null {
    return getSegmentAfterWaypoint(waypointId, waypointSegments.value);
}

// Time calculation functions
const elapsedTimes = computed(() => {
    if (
        !currentPlan.value ||
        !currentPlan.value.pace ||
        !waypoints.value.length
    ) {
        return {};
    }

    return calculateAllElapsedTimes({
        plan: currentPlan.value,
        waypoints: waypoints.value,
        waypointStoppageTimes: waypointStoppageTimes.value,
        getDefaultStoppageTime: getDefaultStoppageTime.value,
        elevationProfile: elevationProfile.value,
        waypointSegments: waypointSegments.value,
        useGradeAdjustment: currentPlan.value?.useGradeAdjustment ?? true,
        gradeWindowMeters: smoothingConfig.value.gradeWindowMeters,
        sampleStepMeters: smoothingConfig.value.sampleStepMeters,
        maintainTargetAverage:
            (currentPlan.value?.paceMode || "pace") !== "normalized",
    });
});

function getElapsedTimeForWaypoint(waypointId: string): string {
    const elapsedSeconds = elapsedTimes.value[waypointId];
    return elapsedSeconds ? formatElapsedTime(elapsedSeconds) : "00:00:00";
}

function getDelayForWaypoint(waypointId: string): string {
    const delaySeconds = getWaypointDelay(
        waypointId,
        waypointStoppageTimes.value,
        getDefaultStoppageTime.value(),
        waypoints.value,
    );
    return formatDelayTime(delaySeconds);
}

function isStartOrFinishWaypoint(waypoint: Waypoint): boolean {
    if (waypoint.order === 0) return true; // Start waypoint
    const maxOrder = Math.max(...(waypoints.value?.map((w) => w.order) || [0]));
    if (waypoint.order === maxOrder && waypoint.order > 0) return true; // Finish waypoint
    return false;
}

function getSegmentPacingData(waypointId: string) {
    if (
        !currentPlan.value ||
        !elevationProfile.value.length ||
        !waypointSegments.value.length
    ) {
        return null;
    }

    const nextWaypoint = waypoints.value?.find((w, index) => {
        const currentIndex = waypoints.value?.findIndex(
            (wp) => wp.id === waypointId,
        );
        return currentIndex !== undefined && index === currentIndex + 1;
    });

    if (!nextWaypoint) {
        return null;
    }

    return getSegmentPacingInfo(waypointId, nextWaypoint.id, {
        plan: currentPlan.value,
        waypoints: waypoints.value || [],
        waypointStoppageTimes: waypointStoppageTimes.value || [],
        elevationProfile: elevationProfile.value,
        waypointSegments: waypointSegments.value,
        useGradeAdjustment: currentPlan.value?.useGradeAdjustment ?? true,
        getDefaultStoppageTime: getDefaultStoppageTime.value,
        gradeWindowMeters: smoothingConfig.value.gradeWindowMeters,
        sampleStepMeters: smoothingConfig.value.sampleStepMeters,
        maintainTargetAverage:
            (currentPlan.value?.paceMode || "pace") !== "normalized",
    });
}

function getSegmentTime(waypointId: string): string {
    const segment = getSegmentForWaypoint(waypointId);
    if (!segment || !currentPlan.value?.pace) {
        return "-";
    }

    const nextWaypoint = waypoints.value?.find((w, index) => {
        const currentIndex = waypoints.value?.findIndex(
            (wp) => wp.id === waypointId,
        );
        return currentIndex !== undefined && index === currentIndex + 1;
    });

    if (!nextWaypoint) {
        return "-";
    }

    // Calculate current elapsed times for both waypoints
    const currentElapsed = elapsedTimes.value[waypointId] || 0;
    const nextElapsed = elapsedTimes.value[nextWaypoint.id] || 0;

    // Subtract stoppage time to get just travel time
    const nextStoppageTime =
        getWaypointStoppageTime.value?.(nextWaypoint.id) || 0;
    const segmentTime = nextElapsed - currentElapsed - nextStoppageTime;

    if (segmentTime <= 0) {
        return "-";
    }

    const hours = Math.floor(segmentTime / 3600);
    const minutes = Math.floor((segmentTime % 3600) / 60);
    const seconds = Math.round(segmentTime % 60);
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds
        .toString()
        .padStart(2, "0")}`;
}

function getSegmentPace(waypointId: string): string {
    const segment = getSegmentForWaypoint(waypointId);
    if (!segment || !currentPlan.value?.pace) {
        return "-";
    }

    let segmentPace = currentPlan.value.pace; // Base pace

    // Apply pacing strategy and/or grade adjustments
    const pacingData = getSegmentPacingData(waypointId);
    if (pacingData) {
        segmentPace = pacingData.adjustedPace;
    }

    const minutes = Math.floor(segmentPace / 60);
    const seconds = Math.round(segmentPace % 60);
    const paceUnit =
        currentPlan.value.paceUnit === "min_per_mi" ? "/mi" : "/km";

    return `${minutes}:${seconds.toString().padStart(2, "0")}${paceUnit}`;
}

function getSegmentGradeDisplay(waypointId: string): string {
    const pacingData = getSegmentPacingData(waypointId);
    if (!pacingData) {
        return "-";
    }

    const grade = pacingData.averageGrade;
    const sign = grade >= 0 ? "+" : "";
    return `${sign}${grade.toFixed(1)}%`;
}
</script>

<template>
    <div class="h-full flex flex-col">
        <div class="flex-1 overflow-y-auto">
            <div class="flex">
                <!-- Waypoint List Column -->
                <div class="flex-1 space-y-1 p-1">
                    <template
                        v-for="(waypoint, index) in waypoints"
                        :key="waypoint.id"
                    >
                        <!-- Waypoint Item -->
                        <div
                            class="p-1 rounded-lg cursor-pointer transition-all duration-200 hover:bg-(--sub-alt-color) border"
                            :class="{
                                'bg-(--sub-alt-color) border-(--main-color)':
                                    selectedWaypoint?.id === waypoint.id,
                                'border-transparent':
                                    selectedWaypoint?.id !== waypoint.id,
                            }"
                            @click="handleWaypointClick(waypoint)"
                            @mouseenter="handleWaypointHover(waypoint)"
                            @mouseleave="handleWaypointLeave"
                        >
                            <div class="flex gap-2">
                                <!-- Waypoint Number/Letter -->
                                <div
                                    class="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white"
                                    :style="{
                                        backgroundColor:
                                            getWaypointPrimaryColor(waypoint),
                                    }"
                                >
                                    <div>
                                        {{
                                            getWaypointDisplayContent(waypoint)
                                        }}
                                    </div>
                                </div>
                                <div class="flex-col gap-1 w-full">
                                    <div
                                        class="flex items-start gap-2 w-full justify-between"
                                    >
                                        <!-- Waypoint Info -->
                                        <div
                                            class="font-medium text-(--main-color) truncate text-ellipsis flex-1 w-0"
                                        >
                                            {{ waypoint.name }}
                                        </div>

                                        <!-- Edit Waypoint Plan Button -->
                                        <button
                                            v-if="currentPlanId && !readOnly"
                                            v-tooltip="'Edit waypoint'"
                                            class="text-(--sub-color) transition-colors flex-shrink-0 m-0! p-1! rounded!"
                                            @click.stop="
                                                openEditModal(waypoint)
                                            "
                                        >
                                            <Icon
                                                name="lucide:pencil"
                                                class="h-3 w-3"
                                            />
                                        </button>
                                    </div>

                                    <!-- Distance and Elevation -->
                                    <div
                                        class="flex items-center gap-4 text-(--sub-color) text-sm mb-1"
                                    >
                                        <span class="flex items-center gap-1">
                                            <Icon
                                                name="lucide:arrow-right-to-line"
                                                class="h-3 w-3 -translate-y-0.25"
                                            />
                                            {{
                                                formatWaypointDistance(
                                                    waypoint.distance,
                                                )
                                            }}
                                        </span>

                                        <span
                                            v-if="
                                                waypoint.elevation !== undefined
                                            "
                                            class="flex items-center gap-1"
                                        >
                                            <Icon
                                                name="lucide:mountain-snow"
                                                class="h-3 w-3 -translate-y-0.25"
                                            />
                                            {{
                                                formatWaypointElevation(
                                                    waypoint.elevation,
                                                )
                                            }}
                                        </span>
                                    </div>

                                    <!-- Time Information (when plan is selected) -->
                                    <div
                                        v-if="currentPlan && currentPlan.pace"
                                        class="flex items-center gap-4 text-(--main-color) text-sm mb-1"
                                    >
                                        <span class="flex items-center gap-1">
                                            <Icon
                                                name="lucide:clock"
                                                class="h-3 w-3 -translate-y-0.25"
                                            />
                                            <span class="font-medium">
                                                {{
                                                    getElapsedTimeForWaypoint(
                                                        waypoint.id,
                                                    )
                                                }}
                                            </span>
                                        </span>

                                        <span
                                            v-if="
                                                !isStartOrFinishWaypoint(
                                                    waypoint,
                                                ) &&
                                                (getWaypointStoppageTime?.(
                                                    waypoint.id,
                                                ) > 0 ||
                                                    getDefaultStoppageTime?.() >
                                                        0)
                                            "
                                            class="flex items-center gap-1 text-(--main-color)"
                                        >
                                            <Icon
                                                name="lucide:pause"
                                                class="h-3 w-3 -translate-y-0.25"
                                            />
                                            <span class="text-xs">
                                                {{
                                                    getDelayForWaypoint(
                                                        waypoint.id,
                                                    )
                                                }}
                                            </span>
                                        </span>
                                    </div>

                                    <!-- Tags Row -->
                                    <div
                                        v-if="waypoint.tags.length > 0"
                                        class="flex gap-1 flex-wrap"
                                    >
                                        <div
                                            v-for="tagId in waypoint.tags"
                                            :key="tagId"
                                            v-tooltip="
                                                getTagsByIds([tagId])[0]
                                                    ?.label || tagId
                                            "
                                            class="w-5 h-5 rounded flex items-center justify-center"
                                            :style="{
                                                backgroundColor:
                                                    getTagsByIds([tagId])[0]
                                                        ?.color || '#6b7280',
                                            }"
                                        >
                                            <Icon
                                                :name="
                                                    getTagsByIds([tagId])[0]
                                                        ?.icon ||
                                                    'lucide:map-pin'
                                                "
                                                class="h-3 w-3 text-white"
                                            />
                                        </div>
                                    </div>

                                    <!-- Notes Display (when present) -->
                                    <div
                                        v-if="
                                            currentPlanId &&
                                            getWaypointNote?.(waypoint.id)
                                        "
                                        class="text-xs text-(--main-color) py-2 course-description"
                                    >
                                        <MDC
                                            :value="
                                                getWaypointNote(waypoint.id)
                                            "
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- Segment Information (between this waypoint and the next) -->
                        <div
                            v-if="index < waypoints.length - 1"
                            class="flex justify-center my-1 border-t border-b border-dotted text-(--sub-color)"
                        >
                            <div class="w-full">
                                <div
                                    v-if="getSegmentForWaypoint(waypoint.id)"
                                    class="px-2 py-1 text-xs"
                                >
                                    <div
                                        class="flex flex-wrap items-center justify-center gap-x-4 text-(--sub-color)"
                                    >
                                        <!-- Distance -->
                                        <div
                                            v-tooltip="'Segment distance'"
                                            class="flex items-center gap-1"
                                        >
                                            <Icon
                                                name="lucide:move-horizontal"
                                                class="h-3 w-3 -translate-y-0.25"
                                            />
                                            <span class="font-medium">
                                                {{
                                                    formatSegmentDistance(
                                                        getSegmentForWaypoint(
                                                            waypoint.id,
                                                        )!.distance,
                                                    )
                                                }}
                                            </span>
                                        </div>

                                        <!-- Elevation Gain -->
                                        <div
                                            v-if="
                                                getSegmentForWaypoint(
                                                    waypoint.id,
                                                )!.elevationGain > 0
                                            "
                                            v-tooltip="'Elevation gain'"
                                            class="flex items-center gap-1 text-(--sub-color)"
                                        >
                                            <Icon
                                                name="lucide:arrow-up"
                                                class="h-3 w-3 -translate-y-0.25"
                                            />
                                            <span class="font-medium">
                                                {{
                                                    formatSegmentElevation(
                                                        getSegmentForWaypoint(
                                                            waypoint.id,
                                                        )!.elevationGain,
                                                    )
                                                }}
                                            </span>
                                        </div>

                                        <!-- Elevation Loss -->
                                        <div
                                            v-if="
                                                getSegmentForWaypoint(
                                                    waypoint.id,
                                                )!.elevationLoss > 0
                                            "
                                            v-tooltip="'Elevation loss'"
                                            class="flex items-center gap-1 text-(--sub-color)"
                                        >
                                            <Icon
                                                name="lucide:arrow-down"
                                                class="h-3 w-3 -translate-y-0.25"
                                            />
                                            <span class="font-medium">
                                                {{
                                                    formatSegmentElevation(
                                                        getSegmentForWaypoint(
                                                            waypoint.id,
                                                        )!.elevationLoss,
                                                    )
                                                }}
                                            </span>
                                        </div>

                                        <!-- Segment Time and Pace -->
                                        <div
                                            v-if="currentPlan"
                                            class="contents"
                                        >
                                            <!-- Segment Time -->
                                            <div
                                                v-tooltip="'Estimated duration'"
                                                class="flex items-center gap-1"
                                            >
                                                <Icon
                                                    name="lucide:clock"
                                                    class="w-3 h-3 -translate-y-0.25"
                                                />
                                                <span>{{
                                                    getSegmentTime(waypoint.id)
                                                }}</span>
                                            </div>

                                            <!-- Segment Pace -->
                                            <div
                                                v-tooltip="
                                                    'Segment average pace'
                                                "
                                                class="flex items-center gap-1"
                                            >
                                                <Icon
                                                    name="lucide:activity"
                                                    class="w-3 h-3 -translate-y-0.25"
                                                />
                                                <span>{{
                                                    getSegmentPace(waypoint.id)
                                                }}</span>
                                            </div>

                                            <!-- Grade (when grade adjustment is enabled) -->
                                            <div
                                                v-if="
                                                    (currentPlan?.useGradeAdjustment ??
                                                        true) &&
                                                    getSegmentPacingData(
                                                        waypoint.id,
                                                    )
                                                "
                                                v-tooltip="
                                                    'Segment average grade'
                                                "
                                                class="flex items-center gap-1"
                                            >
                                                <Icon
                                                    name="lucide:triangle-right"
                                                    class="w-3 h-3 -translate-y-0.25"
                                                    :class="
                                                        getSegmentGradeDisplay(
                                                            waypoint.id,
                                                        ).slice(0, 1) === '-'
                                                            ? '-scale-x-100'
                                                            : ''
                                                    "
                                                />
                                                <span>{{
                                                    getSegmentGradeDisplay(
                                                        waypoint.id,
                                                    )
                                                }}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </template>
                </div>
            </div>
        </div>

        <!-- Waypoint Edit Modal -->
        <WaypointEditModal
            v-if="!readOnly"
            :is-open="editModalOpen"
            :waypoint="editingWaypoint"
            :waypoints="waypoints"
            :current-plan-id="currentPlanId"
            :get-waypoint-note="getWaypointNote"
            :get-waypoint-stoppage-time="getWaypointStoppageTime"
            :get-default-stoppage-time="getDefaultStoppageTime"
            @close="closeEditModal"
            @save-waypoint-note="handleSaveNote"
            @delete-waypoint-note="handleDeleteNote"
            @save-waypoint-stoppage-time="handleSaveStoppageTime"
            @delete-waypoint-stoppage-time="handleDeleteStoppageTime"
        />
    </div>
</template>

<style scoped>
.line-clamp-2 {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
}
</style>
