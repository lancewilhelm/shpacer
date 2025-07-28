<script setup lang="ts">
import { formatDistance, formatElevation } from "~/utils/courseMetrics";
import { getTagsByIds } from "~/utils/waypointTags";
import { getWaypointColorFromOrder } from "~/utils/waypoints";

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
    waypoints?: Waypoint[];
    selectedWaypoint?: Waypoint | null;
    currentPlanId?: string | null;
    getWaypointNote?: (waypointId: string) => string;
    getWaypointStoppageTime?: (waypointId: string) => number;
    getDefaultStoppageTime?: () => number;
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
    getWaypointNote: () => () => "",
    getWaypointStoppageTime: () => () => 0,
    getDefaultStoppageTime: () => () => 0,
});

const {
    waypoints,
    selectedWaypoint,
    currentPlanId,
    getWaypointNote,
    getWaypointStoppageTime,
    getDefaultStoppageTime,
} = toRefs(_props);

const emit = defineEmits<Emits>();

const userSettingsStore = useUserSettingsStore();

// State for waypoint editing modal
const editingWaypoint = ref<Waypoint | null>(null);
const editModalOpen = ref(false);

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
    return formatDistance(meters, userSettingsStore.settings.units.distance);
}

function formatWaypointElevation(meters: number | null) {
    if (meters === null) return "";
    return formatElevation(meters, userSettingsStore.settings.units.elevation);
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

function openEditModal(waypoint: Waypoint) {
    editingWaypoint.value = waypoint;
    editModalOpen.value = true;
}

function closeEditModal() {
    editingWaypoint.value = null;
    editModalOpen.value = false;
}

function handleSaveNote(waypointId: string, notes: string) {
    emit("save-waypoint-note", waypointId, notes);
}

function handleDeleteNote(waypointId: string) {
    emit("delete-waypoint-note", waypointId);
}

function handleSaveStoppageTime(waypointId: string, stoppageTime: number) {
    emit("save-waypoint-stoppage-time", waypointId, stoppageTime);
}

function handleDeleteStoppageTime(waypointId: string) {
    emit("delete-waypoint-stoppage-time", waypointId);
}
</script>

<template>
    <div class="h-full flex flex-col">
        <div class="flex-1 overflow-y-auto">
            <div
                v-if="(waypoints?.length || 0) === 0"
                class="p-4 text-center text-(--sub-color)"
            >
                <Icon
                    name="heroicons:map-pin"
                    class="h-8 w-8 mx-auto mb-2 opacity-50"
                />
                <p class="text-sm">No waypoints found</p>
            </div>

            <div v-else class="space-y-1 p-1">
                <div
                    v-for="waypoint in waypoints"
                    :key="waypoint.id"
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
                            <div class="translate-y-0.25">
                                {{ getWaypointDisplayContent(waypoint) }}
                            </div>
                        </div>
                        <div class="flex-col gap-1 w-full">
                            <div class="flex items-start gap-2">
                                <!-- Waypoint Info -->
                                <div
                                    class="flex items-start justify-between gap-2"
                                >
                                    <div
                                        class="font-medium text-(--main-color) truncate"
                                    >
                                        {{ waypoint.name }}
                                    </div>
                                </div>

                                <!-- Distance, Elevation, and Edit Button Row -->
                                <div
                                    class="flex w-full items-center justify-between gap-4 mt-0.5 text-xs text-(--sub-color)"
                                >
                                    <div class="flex items-center gap-4">
                                        <span class="flex items-center gap-1">
                                            <Icon
                                                name="heroicons:map"
                                                class="h-3 w-3"
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
                                                name="heroicons:arrow-trending-up"
                                                class="h-3 w-3"
                                            />
                                            {{
                                                formatWaypointElevation(
                                                    waypoint.elevation,
                                                )
                                            }}
                                        </span>
                                    </div>

                                    <!-- Edit Waypoint Plan Button -->
                                    <div class="flex flex-1 justify-end">
                                        <button
                                            v-if="currentPlanId"
                                            class="text-(--accent-color) hover:text-(--main-color) transition-colors flex-shrink-0 m-0! p-1! rounded!"
                                            title="Edit waypoint"
                                            @click.stop="
                                                openEditModal(waypoint)
                                            "
                                        >
                                            <Icon
                                                name="heroicons:pencil"
                                                class="h-3 w-3"
                                            />
                                        </button>
                                    </div>
                                </div>
                            </div>

                            <!-- Tags Row -->
                            <div
                                v-if="waypoint.tags.length > 0"
                                class="flex gap-1 flex-wrap"
                            >
                                <div
                                    v-for="tagId in waypoint.tags"
                                    :key="tagId"
                                    class="w-5 h-5 rounded flex items-center justify-center"
                                    :style="{
                                        backgroundColor:
                                            getTagsByIds([tagId])[0]?.color ||
                                            '#6b7280',
                                    }"
                                    :title="
                                        getTagsByIds([tagId])[0]?.label || tagId
                                    "
                                >
                                    <Icon
                                        :name="
                                            getTagsByIds([tagId])[0]?.icon ||
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
                                class="text-xs text-(--main-color) py-2"
                            >
                                {{ getWaypointNote(waypoint.id) }}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Waypoint Edit Modal -->
        <WaypointEditModal
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
