<script setup lang="ts">
interface Props {
    isOpen: boolean;
    courseId: string;
    courseTotalDistance?: number | null;
    existingPlan?: {
        id: string;
        name: string;
        pace?: number;
        paceUnit: string;
        defaultStoppageTime?: number;
        paceMode?: "pace" | "time" | "normalized";
        targetTimeSeconds?: number;
    } | null;
}

interface Emits {
    (e: "close"): void;
    (e: "plan-created" | "plan-updated", plan: unknown): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const userSettingsStore = useUserSettingsStore();

// Form state
const formData = ref({
    name: "",
    paceMode: "pace" as "pace" | "time" | "normalized",
    pace: "",
    targetTime: "",
    paceUnit: "min_per_km" as "min_per_km" | "min_per_mi",
    defaultStoppageTime: "",
});

const isSubmitting = ref(false);
const error = ref("");
const courseTotalDistance = computed(() => props.courseTotalDistance ?? null);

// Initialize form data when modal opens or existing plan changes
watch([() => props.isOpen, () => props.existingPlan], () => {
    if (props.isOpen) {
        if (props.existingPlan) {
            formData.value.name = props.existingPlan.name;
            formData.value.paceMode =
                (props.existingPlan.paceMode as
                    | "pace"
                    | "time"
                    | "normalized") || "pace";
            formData.value.pace = props.existingPlan.pace
                ? formatPaceForInput(props.existingPlan.pace)
                : "";
            formData.value.targetTime =
                formData.value.paceMode === "time" &&
                typeof props.existingPlan.targetTimeSeconds === "number"
                    ? formatSecondsToHHMMSS(
                          props.existingPlan.targetTimeSeconds,
                      )
                    : "";
            formData.value.paceUnit = props.existingPlan.paceUnit as
                | "min_per_km"
                | "min_per_mi";
            formData.value.defaultStoppageTime = props.existingPlan
                .defaultStoppageTime
                ? formatStoppageTimeForInput(
                      props.existingPlan.defaultStoppageTime,
                  )
                : "";
        } else {
            // Reset form for new plan
            formData.value.name = "";
            formData.value.paceMode = "pace";
            formData.value.pace = "";
            formData.value.targetTime = "";
            formData.value.paceUnit =
                userSettingsStore.settings.units.distance === "kilometers"
                    ? "min_per_km"
                    : "min_per_mi";
            formData.value.defaultStoppageTime = "";
        }
        error.value = "";
    }
});

// Format pace from seconds to MM:SS format for input (rounded for display)
// Note: We intentionally round to the nearest second for display purposes only.
// Persisted values (e.g., computed from target finish time) may retain sub-second precision.
// Do not use this function for calculations.
function formatPaceForInput(paceInSeconds: number): string {
    if (!paceInSeconds) return "";
    const totalSeconds = Math.round(paceInSeconds);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

// Parse pace from MM:SS format to seconds
function parsePaceToSeconds(paceString: string): number | null {
    if (!paceString.trim()) return null;

    const parts = paceString.split(":");
    if (parts.length !== 2) return null;

    const minutes = parseInt(parts[0]!);
    const seconds = parseInt(parts[1]!);

    if (isNaN(minutes) || isNaN(seconds) || seconds >= 60 || seconds < 0)
        return null;

    return minutes * 60 + seconds;
}

// Format stoppage time from seconds to MM:SS format for input
function formatStoppageTimeForInput(timeInSeconds: number): string {
    if (!timeInSeconds) return "";
    const minutes = Math.floor(timeInSeconds / 60);
    const seconds = timeInSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

// Parse stoppage time from MM:SS format to seconds
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

// Format seconds to HH:MM:SS for input
function formatSecondsToHHMMSS(totalSeconds: number): string {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds
        .toString()
        .padStart(2, "0")}`;
}

// Validate pace input format
function validatePaceInput(paceString: string): boolean {
    if (!paceString.trim()) return true; // Empty is valid (optional field)

    const paceRegex = /^\d{1,2}:\d{2}$/;
    return paceRegex.test(paceString);
}

// Validate stoppage time input format
function validateStoppageTimeInput(timeString: string): boolean {
    if (!timeString.trim()) return true; // Empty is valid (optional field)

    const timeRegex = /^\d{1,2}:\d{2}$/;
    return timeRegex.test(timeString);
}

// Validate target finish time input format (HH:MM:SS)
function validateTargetTimeInput(timeString: string): boolean {
    if (!timeString.trim()) return false;
    const timeRegex = /^\d{1,2}:\d{2}:\d{2}$/;
    return timeRegex.test(timeString);
}

// Parse HH:MM:SS to seconds
function parseTimeToSeconds(timeString: string): number | null {
    if (!validateTargetTimeInput(timeString)) return null;
    const parts = timeString.split(":");
    if (parts.length !== 3) return null;
    const hours = parseInt(parts[0]!);
    const minutes = parseInt(parts[1]!);
    const seconds = parseInt(parts[2]!);
    if (
        isNaN(hours) ||
        isNaN(minutes) ||
        isNaN(seconds) ||
        minutes < 0 ||
        minutes >= 60 ||
        seconds < 0 ||
        seconds >= 60
    ) {
        return null;
    }
    return hours * 3600 + minutes * 60 + seconds;
}

async function handleSubmit() {
    if (!formData.value.name.trim()) {
        error.value = "Plan name is required";
        return;
    }

    // Conditional validations based on pace mode
    if (formData.value.paceMode === "time") {
        if (!validateTargetTimeInput(formData.value.targetTime)) {
            error.value =
                "Target finish time must be in HH:MM:SS format (e.g., 3:45:00)";
            return;
        }
        if (!courseTotalDistance.value || courseTotalDistance.value <= 0) {
            error.value =
                "Course distance is unavailable. Please reload and try again.";
            return;
        }
    } else {
        if (formData.value.pace && !validatePaceInput(formData.value.pace)) {
            error.value = "Pace must be in MM:SS format (e.g., 7:30)";
            return;
        }
    }

    if (
        formData.value.defaultStoppageTime &&
        !validateStoppageTimeInput(formData.value.defaultStoppageTime)
    ) {
        error.value = "Stoppage time must be in MM:SS format (e.g., 2:00)";
        return;
    }

    isSubmitting.value = true;
    error.value = "";

    try {
        let paceInSeconds: number | null = null;
        let targetTimeSeconds: number | undefined = undefined;

        if (formData.value.paceMode === "time") {
            // Compute base pace from target finish time and course distance
            const t = parseTimeToSeconds(formData.value.targetTime)!;
            targetTimeSeconds = t;

            const distanceUnits =
                formData.value.paceUnit === "min_per_km"
                    ? courseTotalDistance.value! / 1000
                    : courseTotalDistance.value! / 1609.344;

            if (distanceUnits <= 0) {
                throw new Error("Invalid course distance");
            }

            paceInSeconds = t / distanceUnits;
        } else {
            // 'pace' or 'normalized' both carry an explicit pace entry (optional)
            paceInSeconds = formData.value.pace
                ? parsePaceToSeconds(formData.value.pace)
                : null;
        }

        const defaultStoppageTimeInSeconds = formData.value.defaultStoppageTime
            ? parseStoppageTimeToSeconds(formData.value.defaultStoppageTime)
            : 0;

        const payload: Record<string, unknown> = {
            name: formData.value.name.trim(),
            pace: paceInSeconds,
            paceUnit: formData.value.paceUnit,
            defaultStoppageTime: defaultStoppageTimeInSeconds,
            // New fields (ignored by older backends but used by updated logic)
            paceMode: formData.value.paceMode,
        };
        if (formData.value.paceMode === "time") {
            payload.targetTimeSeconds = targetTimeSeconds;
        }

        if (props.existingPlan) {
            // Update existing plan
            const response = await fetch(
                `/api/courses/${props.courseId}/plans/${props.existingPlan.id}`,
                {
                    method: "PUT",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify(payload),
                },
            );

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            emit("plan-updated", data);
        } else {
            // Create new plan
            const response = await fetch(
                `/api/courses/${props.courseId}/plans`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify(payload),
                },
            );

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            emit("plan-created", data);
        }

        emit("close");
    } catch (err: unknown) {
        console.error("Error saving plan:", err);
        error.value =
            (err as { data?: { message?: string } })?.data?.message ||
            "Failed to save plan";
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
                {{ existingPlan ? "Edit Plan" : "Create New Plan" }}
            </h2>

            <form class="space-y-4" @submit.prevent="handleSubmit">
                <!-- Plan Name -->
                <div>
                    <label
                        for="plan-name"
                        class="block text-sm font-medium text-(--main-color) mb-1"
                    >
                        Plan Name *
                    </label>
                    <input
                        id="plan-name"
                        v-model="formData.name"
                        type="text"
                        required
                        placeholder="e.g., Marathon Race Plan"
                        class="w-full px-3 py-2 border border-(--sub-color) rounded-lg bg-(--bg-color) text-(--main-color) placeholder--(--sub-color) focus:outline-none focus:ring-2 focus:ring-(--main-color) focus:border-transparent"
                        :disabled="isSubmitting"
                    />
                </div>

                <!-- Pacing Method -->
                <div>
                    <label
                        class="block text-sm font-medium text-(--main-color) mb-1"
                    >
                        Pacing Method
                    </label>
                    <div class="flex flex-col gap-2">
                        <label
                            class="flex items-center gap-2 cursor-pointer text-(--main-color)"
                        >
                            <input
                                v-model="formData.paceMode"
                                type="radio"
                                value="pace"
                                class="accent-(--main-color)"
                                :disabled="isSubmitting"
                            />
                            <span>Target average pace</span>
                        </label>
                        <label
                            class="flex items-center gap-2 cursor-pointer text-(--main-color)"
                        >
                            <input
                                v-model="formData.paceMode"
                                type="radio"
                                value="time"
                                class="accent-(--main-color)"
                                :disabled="isSubmitting"
                            />
                            <span>Target finish time</span>
                        </label>
                        <label
                            class="flex items-center gap-2 cursor-pointer text-(--main-color)"
                        >
                            <input
                                v-model="formData.paceMode"
                                type="radio"
                                value="normalized"
                                class="accent-(--main-color)"
                                :disabled="isSubmitting"
                            />
                            <span>Normalized pace (effort-based)</span>
                        </label>
                    </div>
                </div>

                <!-- Pace Input (for 'pace' and 'normalized') -->
                <div v-if="formData.paceMode !== 'time'">
                    <label
                        for="plan-pace"
                        class="block text-sm font-medium text-(--main-color) mb-1"
                    >
                        {{
                            formData.paceMode === "normalized"
                                ? "Normalized Base Pace"
                                : "Target Average Pace"
                        }}
                    </label>
                    <p class="text-xs text-(--sub-color) mb-2">
                        <span v-if="formData.paceMode === 'normalized'">
                            Enter the pace you can comfortably sustain on a
                            normalized (flat-equivalent) course. The plan will
                            adjust segment paces for grade; overall finish time
                            will vary with terrain.
                        </span>
                        <span v-else>
                            Your desired overall average pace for the entire
                            course. The system will automatically adjust your
                            pace at each point based on the terrain grade.
                        </span>
                    </p>
                    <div class="flex gap-2">
                        <input
                            id="plan-pace"
                            v-model="formData.pace"
                            v-time-mask="'mmss'"
                            type="text"
                            inputmode="numeric"
                            placeholder="7:30"
                            pattern="\d{1,2}:\d{2}"
                            class="flex-1 px-3 py-2 border border-(--sub-color) rounded-lg bg-(--bg-color) text-(--main-color) placeholder--(--sub-color) focus:outline-none focus:ring-2 focus:ring-(--main-color) focus:border-transparent"
                            :disabled="isSubmitting"
                        />
                        <select
                            v-model="formData.paceUnit"
                            class="px-3 py-2 border border-(--sub-color) rounded-lg bg-(--bg-color) text-(--main-color) focus:outline-none focus:ring-2 focus:ring-(--main-color) focus:border-transparent"
                            :disabled="isSubmitting"
                        >
                            <option value="min_per_km">min/km</option>
                            <option value="min_per_mi">min/mi</option>
                        </select>
                    </div>
                    <p class="text-xs text-(--sub-color) mt-1">
                        Format: MM:SS (e.g., 7:30 for 7 minutes 30 seconds)
                    </p>
                </div>

                <!-- Target Finish Time (for 'time') -->
                <div v-else>
                    <label
                        for="target-time"
                        class="block text-sm font-medium text-(--main-color) mb-1"
                    >
                        Target Finish Time
                    </label>
                    <p class="text-xs text-(--sub-color) mb-2">
                        Set the total time you’re targeting for this course.
                        We'll compute the equivalent base pace for you using the
                        course distance and selected units.
                    </p>
                    <div class="flex gap-2">
                        <input
                            id="target-time"
                            v-model="formData.targetTime"
                            v-time-mask="'hhmmss'"
                            type="text"
                            inputmode="numeric"
                            placeholder="3:45:00"
                            pattern="\d{1,2}:\d{2}:\d{2}"
                            class="flex-1 px-3 py-2 border border-(--sub-color) rounded-lg bg-(--bg-color) text-(--main-color) placeholder--(--sub-color) focus:outline-none focus:ring-2 focus:ring-(--main-color) focus:border-transparent"
                            :disabled="isSubmitting"
                        />
                    </div>
                    <p class="text-xs text-(--sub-color) mt-1">
                        Format: HH:MM:SS (e.g., 3:45:00)
                    </p>
                    <p
                        v-if="courseTotalDistance"
                        class="text-xs text-(--sub-color) mt-1"
                    >
                        Course distance:
                        {{
                            (
                                courseTotalDistance /
                                (formData.paceUnit === "min_per_km"
                                    ? 1000
                                    : 1609.344)
                            ).toFixed(2)
                        }}
                        {{ formData.paceUnit === "min_per_km" ? "km" : "mi" }}
                    </p>
                </div>

                <!-- Default Stoppage Time -->
                <div>
                    <label
                        for="default-stoppage-time"
                        class="block text-sm font-medium text-(--main-color) mb-1"
                    >
                        Default Stoppage Time per Waypoint
                    </label>
                    <input
                        id="default-stoppage-time"
                        v-model="formData.defaultStoppageTime"
                        v-time-mask="'mmss'"
                        type="text"
                        inputmode="numeric"
                        placeholder="2:00"
                        pattern="\d{1,2}:\d{2}"
                        class="w-full px-3 py-2 border border-(--sub-color) rounded-lg bg-(--bg-color) text-(--main-color) placeholder--(--sub-color) focus:outline-none focus:ring-2 focus:ring-(--main-color) focus:border-transparent"
                        :disabled="isSubmitting"
                    />
                    <p class="text-xs text-(--sub-color) mt-1">
                        Format: MM:SS (e.g., 2:00 for 2 minutes). Applies to
                        intermediate waypoints only.
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
                        :disabled="isSubmitting || !formData.name.trim()"
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
                        <span v-else>
                            {{ existingPlan ? "Update Plan" : "Create Plan" }}
                        </span>
                    </button>
                </div>
            </form>
        </div>
    </ModalWindow>
</template>
