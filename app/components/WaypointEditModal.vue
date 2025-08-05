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
    (
        e: "delete-waypoint-note" | "delete-waypoint-stoppage-time",
        waypointId: string,
    ): void;
    (
        e: "save-waypoint-stoppage-time",
        waypointId: string,
        stoppageTime: number,
    ): void;
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
    stoppageMinutes: 0,
    stoppageSeconds: 0,
});

// Computed property for formatted seconds display
const formattedSeconds = computed({
    get: () => formData.value.stoppageSeconds.toString().padStart(2, "0"),
    set: (value: string) => {
        const num = parseInt(value) || 0;
        formData.value.stoppageSeconds = Math.min(Math.max(num, 0), 59);
    },
});

const isSubmitting = ref(false);
const error = ref("");

// Initialize form data when modal opens or waypoint changes
watch([() => props.isOpen, () => props.waypoint], () => {
    if (props.isOpen && props.waypoint) {
        formData.value.notes = props.getWaypointNote?.(props.waypoint.id) || "";

        if (canHaveStoppageTime(props.waypoint)) {
            const currentTime = getEffectiveStoppageTime(props.waypoint);
            formData.value.stoppageMinutes = Math.floor(currentTime / 60);
            formData.value.stoppageSeconds = currentTime % 60;
        } else {
            formData.value.stoppageMinutes = 0;
            formData.value.stoppageSeconds = 0;
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
    if (customTime !== undefined && customTime !== null) {
        return customTime;
    }
    // Only apply default to intermediate waypoints
    if (!canHaveStoppageTime(waypoint)) return 0;
    return props.getDefaultStoppageTime?.() || 0;
}

function incrementMinutes() {
    formData.value.stoppageMinutes = Math.min(
        formData.value.stoppageMinutes + 1,
        99,
    );
}

function decrementMinutes() {
    formData.value.stoppageMinutes = Math.max(
        formData.value.stoppageMinutes - 1,
        0,
    );
}

function incrementSeconds() {
    if (formData.value.stoppageSeconds >= 59) {
        formData.value.stoppageSeconds = 0;
        incrementMinutes();
    } else {
        formData.value.stoppageSeconds++;
    }
}

function decrementSeconds() {
    if (formData.value.stoppageSeconds <= 0) {
        if (formData.value.stoppageMinutes > 0) {
            formData.value.stoppageSeconds = 59;
            decrementMinutes();
        }
    } else {
        formData.value.stoppageSeconds--;
    }
}

async function handleSave() {
    if (!props.waypoint) return;

    // Validate that seconds are within valid range
    if (
        formData.value.stoppageSeconds < 0 ||
        formData.value.stoppageSeconds > 59
    ) {
        error.value = "Seconds must be between 0 and 59";
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
            const totalSeconds =
                formData.value.stoppageMinutes * 60 +
                formData.value.stoppageSeconds;

            // Always save the stoppage time, even if it's 0
            emit(
                "save-waypoint-stoppage-time",
                props.waypoint.id,
                totalSeconds,
            );
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
        <div class="max-w-md w-full">
            <div v-if="waypoint" class="mb-2">
                <h3 class="font-medium text-(--main-color)">
                    {{ waypoint.name }}
                </h3>
            </div>

            <form @submit.prevent="handleSave">
                <!-- Notes Section -->
                <div>
                    <h6
                        for="waypoint-notes"
                        class="block text-sm font-medium text-(--main-color) mb-1"
                    >
                        Notes
                    </h6>
                    <textarea
                        id="waypoint-notes"
                        v-model="formData.notes"
                        placeholder="Add notes for this waypoint..."
                        class="w-full px-3 py-2 border border-(--sub-color) rounded-lg bg-(--bg-color) text-(--main-color) placeholder--(--sub-color) focus:outline-none focus:ring-2 focus:ring-(--main-color) focus:border-transparent resize-none"
                        rows="4"
                        :disabled="isSubmitting"
                    ></textarea>
                </div>

                <!-- Stoppage Time Section (only for intermediate waypoints) -->
                <div v-if="waypoint && canHaveStoppageTime(waypoint)">
                    <h6
                        class="block text-sm font-medium text-(--main-color) mb-1"
                    >
                        Stoppage Time
                    </h6>
                    <div class="w-full flex gap-0.5 items-center">
                        <!-- Minutes Input -->
                        <div class="flex flex-col items-center">
                            <button
                                type="button"
                                :disabled="isSubmitting"
                                class="w-10 h-8 flex items-center justify-center border border-(--sub-color) rounded bg-(--bg-color) text-(--main-color) hover:bg-(--sub-color)/10 transition-colors disabled:opacity-50 my-0.25!"
                                @click="incrementMinutes"
                            >
                                +
                            </button>
                            <input
                                v-model.number="formData.stoppageMinutes"
                                type="text"
                                inputmode="numeric"
                                class="w-10 px-2 py-1 text-center border border-(--sub-color) rounded-sm! bg-(--bg-color) text-(--main-color) focus:outline-none focus:ring-2 focus:ring-(--main-color) focus:border-transparent my-1"
                                :disabled="isSubmitting"
                            />
                            <button
                                type="button"
                                :disabled="isSubmitting"
                                class="w-10 h-8 flex items-center justify-center border border-(--sub-color) rounded bg-(--bg-color) text-(--main-color) hover:bg-(--sub-color)/10 transition-colors disabled:opacity-50 my-0.25!"
                                @click="decrementMinutes"
                            >
                                -
                            </button>
                            <span class="text-xs text-(--sub-color) mt-1"
                                >min</span
                            >
                        </div>
                        <div class="-translate-y-2.5 text-(--text-color)">
                            :
                        </div>

                        <!-- Seconds Input -->
                        <div class="flex flex-col items-center">
                            <button
                                type="button"
                                :disabled="isSubmitting"
                                class="w-10 h-8 flex items-center justify-center border border-(--sub-color) rounded bg-(--bg-color) text-(--main-color) hover:bg-(--sub-color)/10 transition-colors disabled:opacity-50 my-0.25!"
                                @click="incrementSeconds"
                            >
                                +
                            </button>
                            <input
                                v-model="formattedSeconds"
                                type="text"
                                inputmode="numeric"
                                class="w-10 px-2 py-1 text-center border border-(--sub-color) rounded bg-(--bg-color) text-(--main-color) focus:outline-none focus:ring-2 focus:ring-(--main-color) focus:border-transparent my-1"
                                :disabled="isSubmitting"
                            />
                            <button
                                type="button"
                                :disabled="isSubmitting"
                                class="w-10 h-8 flex items-center justify-center border border-(--sub-color) rounded bg-(--bg-color) text-(--main-color) hover:bg-(--sub-color)/10 transition-colors disabled:opacity-50 my-0.25!"
                                @click="decrementSeconds"
                            >
                                -
                            </button>
                            <span class="text-xs text-(--sub-color) mt-1"
                                >sec</span
                            >
                        </div>
                    </div>
                </div>

                <!-- Error Message -->
                <div v-if="error" class="text-(--error-color) text-sm">
                    {{ error }}
                </div>

                <!-- Action Buttons -->
                <div class="flex gap-3 pt-2">
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
                        <span v-else>Save</span>
                    </button>
                    <button
                        type="button"
                        class="flex-1 px-4 py-2 border border-(--sub-color) rounded-lg text-(--main-color) hover:bg-(--sub-color)/10 transition-colors"
                        :disabled="isSubmitting"
                        @click="handleClose"
                    >
                        Cancel
                    </button>
                </div>
            </form>
        </div>
    </ModalWindow>
</template>
