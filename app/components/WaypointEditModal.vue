<script setup lang="ts">
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

interface Props {
    isOpen: boolean;
    waypoint?: Waypoint | null;
    waypoints?: Waypoint[];
    currentPlanId?: string | null;
    getWaypointNote?: (waypointId: string) => string;
    getWaypointStoppageTime?: (waypointId: string) => number;
    getDefaultStoppageTime?: () => number;
}

interface Emits {
    (e: "close"): void;
    (e: "save-waypoint-note", waypointId: string, notes: string): void;
    (e: "delete-waypoint-note", waypointId: string): void;
    (
        e: "save-waypoint-stoppage-time",
        waypointId: string,
        stoppageTime: number,
    ): void;
    (e: "delete-waypoint-stoppage-time", waypointId: string): void;
}

const props = withDefaults(defineProps<Props>(), {
    waypoint: null,
    waypoints: () => [],
    currentPlanId: null,
    getWaypointNote: () => () => "",
    getWaypointStoppageTime: () => () => 0,
    getDefaultStoppageTime: () => () => 0,
});

const emit = defineEmits<Emits>();

// Form state
const formData = ref({
    notes: "",
    stoppageTime: "",
});

const isSubmitting = ref(false);
const error = ref("");

// Initialize form data when modal opens or waypoint changes
watch([() => props.isOpen, () => props.waypoint], () => {
    if (props.isOpen && props.waypoint) {
        formData.value.notes = props.getWaypointNote?.(props.waypoint.id) || "";

        if (canHaveStoppageTime(props.waypoint)) {
            const currentTime = getEffectiveStoppageTime(props.waypoint);
            formData.value.stoppageTime =
                formatStoppageTimeForInput(currentTime);
        } else {
            formData.value.stoppageTime = "";
        }
        error.value = "";
    }
});

// Helper functions
function canHaveStoppageTime(waypoint: Waypoint): boolean {
    if (waypoint.order === 0) return false; // Start waypoint
    const maxOrder = Math.max(...(props.waypoints?.map((w) => w.order) || [0]));
    if (waypoint.order === maxOrder && waypoint.order > 0) return false; // Finish waypoint
    return true;
}

function getEffectiveStoppageTime(waypoint: Waypoint): number {
    const customTime = props.getWaypointStoppageTime?.(waypoint.id);
    if (customTime && customTime > 0) {
        return customTime;
    }
    // Only apply default to intermediate waypoints
    if (!canHaveStoppageTime(waypoint)) return 0;
    return props.getDefaultStoppageTime?.() || 0;
}

function formatStoppageTimeForInput(seconds: number): string {
    if (!seconds) return "";
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

function parseStoppageTimeToSeconds(timeString: string): number | null {
    if (!timeString.trim()) return null;

    const parts = timeString.split(":");
    if (parts.length !== 2) return null;

    const minutes = parseInt(parts[0]!);
    const seconds = parseInt(parts[1]!);

    if (isNaN(minutes) || isNaN(seconds) || seconds >= 60 || seconds < 0)
        return null;

    return minutes * 60 + seconds;
}

function validateStoppageTimeInput(timeString: string): boolean {
    if (!timeString.trim()) return true; // Empty is valid (optional field)

    const timeRegex = /^\d{1,2}:\d{2}$/;
    return timeRegex.test(timeString);
}

async function handleSave() {
    if (!props.waypoint) return;

    if (
        formData.value.stoppageTime &&
        !validateStoppageTimeInput(formData.value.stoppageTime)
    ) {
        error.value = "Stoppage time must be in MM:SS format (e.g., 2:00)";
        return;
    }

    isSubmitting.value = true;
    error.value = "";

    try {
        // Save notes
        const notes = formData.value.notes.trim();
        if (notes) {
            emit("save-waypoint-note", props.waypoint.id, notes);
        } else {
            // If notes are empty, delete the note
            emit("delete-waypoint-note", props.waypoint.id);
        }

        // Save stoppage time (only for intermediate waypoints)
        if (canHaveStoppageTime(props.waypoint)) {
            const timeString = formData.value.stoppageTime.trim();
            const timeInSeconds = parseStoppageTimeToSeconds(timeString);

            if (timeInSeconds !== null && timeInSeconds > 0) {
                emit(
                    "save-waypoint-stoppage-time",
                    props.waypoint.id,
                    timeInSeconds,
                );
            } else {
                // If time is empty or zero, delete the custom time (use default)
                emit("delete-waypoint-stoppage-time", props.waypoint.id);
            }
        }

        emit("close");
    } catch (err: unknown) {
        console.error("Error saving waypoint data:", err);
        error.value = "Failed to save waypoint data";
    } finally {
        isSubmitting.value = false;
    }
}

function handleClose() {
    if (!isSubmitting.value) {
        emit("close");
    }
}

// Handle escape key
function handleKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
        handleClose();
    }
}

onMounted(() => {
    document.addEventListener("keydown", handleKeydown);
});

onBeforeUnmount(() => {
    document.removeEventListener("keydown", handleKeydown);
});
</script>

<template>
    <ModalWindow :open="isOpen" @close="handleClose">
        <div class="p-6 max-w-md w-full">
            <h2 class="text-xl font-semibold text-(--main-color) mb-4">
                Edit Waypoint
            </h2>

            <div v-if="waypoint" class="mb-4">
                <h3 class="font-medium text-(--main-color)">
                    {{ waypoint.name }}
                </h3>
                <p class="text-sm text-(--sub-color)">
                    {{
                        waypoint.order === 0
                            ? "Start"
                            : waypoint.order ===
                                    Math.max(
                                        ...(waypoints?.map((w) => w.order) || [
                                            0,
                                        ]),
                                    ) && waypoint.order > 0
                              ? "Finish"
                              : `Waypoint ${waypoint.order}`
                    }}
                </p>
            </div>

            <form class="space-y-4" @submit.prevent="handleSave">
                <!-- Notes Section -->
                <div>
                    <label
                        for="waypoint-notes"
                        class="block text-sm font-medium text-(--main-color) mb-1"
                    >
                        Notes
                    </label>
                    <textarea
                        id="waypoint-notes"
                        v-model="formData.notes"
                        placeholder="Add notes for this waypoint..."
                        class="w-full px-3 py-2 border border-(--sub-color) rounded-lg bg-(--bg-color) text-(--main-color) placeholder--(--sub-color) focus:outline-none focus:ring-2 focus:ring-(--accent-color) focus:border-transparent resize-none"
                        rows="4"
                        :disabled="isSubmitting"
                    ></textarea>
                </div>

                <!-- Stoppage Time Section (only for intermediate waypoints) -->
                <div v-if="waypoint && canHaveStoppageTime(waypoint)">
                    <label
                        for="stoppage-time"
                        class="block text-sm font-medium text-(--main-color) mb-1"
                    >
                        Stoppage Time
                    </label>
                    <input
                        id="stoppage-time"
                        v-model="formData.stoppageTime"
                        type="text"
                        placeholder="2:00"
                        pattern="\d{1,2}:\d{2}"
                        class="w-full px-3 py-2 border border-(--sub-color) rounded-lg bg-(--bg-color) text-(--main-color) placeholder--(--sub-color) focus:outline-none focus:ring-2 focus:ring-(--accent-color) focus:border-transparent"
                        :disabled="isSubmitting"
                    />
                    <p class="text-xs text-(--sub-color) mt-1">
                        Format: MM:SS (e.g., 2:00 for 2 minutes). Leave empty to
                        use default
                        <span v-if="getDefaultStoppageTime?.()">
                            ({{
                                formatStoppageTimeForInput(
                                    getDefaultStoppageTime(),
                                )
                            }})
                        </span>
                    </p>
                </div>

                <!-- Error Message -->
                <div v-if="error" class="text-(--error-color) text-sm">
                    {{ error }}
                </div>

                <!-- Action Buttons -->
                <div class="flex gap-3 pt-4">
                    <button
                        type="button"
                        class="flex-1 px-4 py-2 border border-(--sub-color) rounded-lg text-(--main-color) hover:bg-(--sub-color)/10 transition-colors"
                        :disabled="isSubmitting"
                        @click="handleClose"
                    >
                        Cancel
                    </button>
                    <button
                        type="submit"
                        :disabled="isSubmitting"
                        class="flex-1 px-4 py-2 bg-(--main-color) text-(--bg-color) rounded-lg hover:opacity-80 transition-opacity disabled:opacity-50"
                    >
                        <span
                            v-if="isSubmitting"
                            class="flex items-center justify-center gap-2"
                        >
                            <Icon
                                name="svg-spinners:6-dots-scale"
                                class="scale-75"
                            />
                            Saving...
                        </span>
                        <span v-else> Save Changes </span>
                    </button>
                </div>
            </form>
        </div>
    </ModalWindow>
</template>
