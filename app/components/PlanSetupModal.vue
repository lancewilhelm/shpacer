<script setup lang="ts">
/**
 * Refactored PlanSetupModal:
 * - Replaces single masked time inputs with explicit numeric fields:
 *   * Pace: MM SS
 *   * Target Finish Time: HH MM SS
 *   * Default Stoppage Time: MM SS
 * - Removes any time mask directives (v-time-mask) to avoid formatting issues.
 * - Adds robust validation of numeric ranges (seconds/minutes < 60).
 * - Maintains original emitted events and API payload structure.
 */

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
        pacingStrategy?: "flat" | "linear";
        pacingLinearPercent?: number;
    } | null;
}

interface Emits {
    (e: "close"): void;
    (e: "plan-created" | "plan-updated", plan: unknown): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const userSettingsStore = useUserSettingsStore();

interface PlanFormState {
    name: string;
    paceMode: "pace" | "time" | "normalized";
    paceMinutes: string;
    paceSeconds: string;
    targetHours: string;
    targetMinutes: string;
    targetSeconds: string;
    paceUnit: "min_per_km" | "min_per_mi";
    defaultStopMinutes: string;
    defaultStopSeconds: string;
    pacingStrategy: "flat" | "linear";
    pacingLinearPercent: string;
}

const formData = ref<PlanFormState>({
    name: "",
    paceMode: "pace",
    paceMinutes: "",
    paceSeconds: "",
    targetHours: "",
    targetMinutes: "",
    targetSeconds: "",
    paceUnit: "min_per_km",
    defaultStopMinutes: "",
    defaultStopSeconds: "",
    pacingStrategy: "flat",
    pacingLinearPercent: "0",
});

const isSubmitting = ref(false);
const error = ref("");
const courseTotalDistance = computed(() => props.courseTotalDistance ?? null);

function resetForm() {
    formData.value.name = "";
    formData.value.paceMode = "pace";
    formData.value.paceMinutes = "";
    formData.value.paceSeconds = "";
    formData.value.targetHours = "";
    formData.value.targetMinutes = "";
    formData.value.targetSeconds = "";
    formData.value.paceUnit =
        userSettingsStore.settings.units.distance === "kilometers"
            ? "min_per_km"
            : "min_per_mi";
    formData.value.defaultStopMinutes = "";
    formData.value.defaultStopSeconds = "";
    formData.value.pacingStrategy = "flat";
    formData.value.pacingLinearPercent = "0";
    error.value = "";
}

watch(
    [() => props.isOpen, () => props.existingPlan],
    () => {
        if (!props.isOpen) return;
        if (props.existingPlan) {
            const p = props.existingPlan;
            formData.value.name = p.name;
            formData.value.paceMode =
                (p.paceMode as "pace" | "time" | "normalized") || "pace";

            // Pace
            if (p.pace != null) {
                const paceRounded = Math.round(p.pace);
                formData.value.paceMinutes = Math.floor(
                    paceRounded / 60,
                ).toString();
                formData.value.paceSeconds = (paceRounded % 60)
                    .toString()
                    .padStart(2, "0");
            } else {
                formData.value.paceMinutes = "";
                formData.value.paceSeconds = "";
            }

            // Target finish time (only if paceMode === time)
            if (
                formData.value.paceMode === "time" &&
                typeof p.targetTimeSeconds === "number"
            ) {
                const total = p.targetTimeSeconds;
                const hours = Math.floor(total / 3600);
                const minutes = Math.floor((total % 3600) / 60);
                const seconds = total % 60;
                formData.value.targetHours = hours.toString();
                formData.value.targetMinutes = minutes
                    .toString()
                    .padStart(2, "0");
                formData.value.targetSeconds = seconds
                    .toString()
                    .padStart(2, "0");
            } else {
                formData.value.targetHours = "";
                formData.value.targetMinutes = "";
                formData.value.targetSeconds = "";
            }

            // Pace unit
            formData.value.paceUnit = p.paceUnit as "min_per_km" | "min_per_mi";

            // Default stoppage
            if (p.defaultStoppageTime && p.defaultStoppageTime > 0) {
                const m = Math.floor(p.defaultStoppageTime / 60);
                const s = p.defaultStoppageTime % 60;
                formData.value.defaultStopMinutes = m.toString();
                formData.value.defaultStopSeconds = s
                    .toString()
                    .padStart(2, "0");
            } else {
                formData.value.defaultStopMinutes = "";
                formData.value.defaultStopSeconds = "";
            }

            // Initialize pacing strategy from existing plan
            formData.value.pacingStrategy =
                (p.pacingStrategy as "flat" | "linear") || "flat";
            if (formData.value.pacingStrategy === "linear") {
                const lp =
                    typeof p.pacingLinearPercent === "number"
                        ? p.pacingLinearPercent
                        : 0;
                formData.value.pacingLinearPercent = lp.toString();
            } else {
                formData.value.pacingLinearPercent = "0";
            }
        } else {
            resetForm();
        }
        error.value = "";
    },
    { immediate: false },
);

// ---------- Validation Helpers ----------

function isBlank(v: string) {
    return v.trim() === "";
}

function parseIntSafe(v: string): number | null {
    if (isBlank(v)) return null;
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n >= 0 ? n : null;
}

function validatePaceFields(): {
    ok: boolean;
    message?: string;
    seconds: number | null;
} {
    // Only relevant if paceMode !== time
    if (formData.value.paceMode === "time") {
        return { ok: true, seconds: null };
    }
    const mRaw = formData.value.paceMinutes;
    const sRaw = formData.value.paceSeconds;

    // Optional overall. If both empty => null pace.
    if (isBlank(mRaw) && isBlank(sRaw)) {
        return { ok: true, seconds: null };
    }
    // Require both if one filled
    if (isBlank(mRaw) || isBlank(sRaw)) {
        return {
            ok: false,
            message:
                "Please fill both pace minutes and seconds or leave both blank.",
            seconds: null,
        };
    }
    const m = parseIntSafe(mRaw);
    const s = parseIntSafe(sRaw);
    if (m == null || s == null) {
        return { ok: false, message: "Pace must be numeric.", seconds: null };
    }
    if (s >= 60) {
        return {
            ok: false,
            message: "Pace seconds must be < 60.",
            seconds: null,
        };
    }
    if (m === 0 && s === 0) {
        // Treat 0:00 as no pace (null) to mimic optional nature
        return { ok: true, seconds: null };
    }
    return { ok: true, seconds: m * 60 + s };
}

function validateTargetTime(): {
    ok: boolean;
    message?: string;
    seconds: number | undefined;
} {
    if (formData.value.paceMode !== "time") {
        return { ok: true, seconds: undefined };
    }
    const h = parseIntSafe(formData.value.targetHours);
    const m = parseIntSafe(formData.value.targetMinutes);
    const s = parseIntSafe(formData.value.targetSeconds);

    if (h == null || m == null || s == null) {
        return {
            ok: false,
            message: "Target finish time requires hours, minutes, and seconds.",
            seconds: undefined,
        };
    }
    if (m >= 60 || s >= 60) {
        return {
            ok: false,
            message: "Minutes and seconds in target time must be < 60.",
            seconds: undefined,
        };
    }
    if (h === 0 && m === 0 && s === 0) {
        return {
            ok: false,
            message: "Target finish time cannot be 0:00:00.",
            seconds: undefined,
        };
    }
    return { ok: true, seconds: h * 3600 + m * 60 + s };
}

function validateDefaultStoppage(): {
    ok: boolean;
    message?: string;
    seconds: number;
} {
    const mRaw = formData.value.defaultStopMinutes;
    const sRaw = formData.value.defaultStopSeconds;

    if (isBlank(mRaw) && isBlank(sRaw)) {
        return { ok: true, seconds: 0 };
    }
    if (isBlank(mRaw) || isBlank(sRaw)) {
        return {
            ok: false,
            message:
                "Please fill both stoppage minutes and seconds or leave both blank.",
            seconds: 0,
        };
    }
    const m = parseIntSafe(mRaw);
    const s = parseIntSafe(sRaw);
    if (m == null || s == null) {
        return {
            ok: false,
            message: "Stoppage time must be numeric.",
            seconds: 0,
        };
    }
    if (s >= 60) {
        return {
            ok: false,
            message: "Stoppage seconds must be < 60.",
            seconds: 0,
        };
    }
    // 0:00 allowed = no stoppage
    return { ok: true, seconds: m * 60 + s };
}

function clampSeconds(
    field: "paceSeconds" | "targetSeconds" | "defaultStopSeconds",
) {
    const v = formData.value[field];
    if (isBlank(v)) return;
    let n = parseInt(v, 10);
    if (!Number.isFinite(n) || n < 0) n = 0;
    if (n > 59) n = 59;
    formData.value[field] = n.toString().padStart(2, "0");
}

function clampMinutes(
    field: "paceMinutes" | "targetMinutes" | "defaultStopMinutes",
) {
    const v = formData.value[field];
    if (isBlank(v)) return;
    let n = parseInt(v, 10);
    if (!Number.isFinite(n) || n < 0) n = 0;
    if (n > 599) n = 599; // Arbitrary upper bound to avoid absurd inputs
    formData.value[field] = n.toString();
}

function clampHours() {
    const v = formData.value.targetHours;
    if (isBlank(v)) return;
    let n = parseInt(v, 10);
    if (!Number.isFinite(n) || n < 0) n = 0;
    if (n > 99) n = 99;
    formData.value.targetHours = n.toString();
}

/* Increment / Decrement helpers for stacked controls (strongly typed) */
function inc<K extends keyof PlanFormState>(field: K, max: number) {
    const raw = formData.value[field];
    const n = parseInt(raw, 10);
    const next = Math.min((Number.isFinite(n) ? n : 0) + 1, max);
    (formData.value as Record<string, string>)[field] =
        field.endsWith("Seconds") || field.endsWith("Minutes")
            ? next.toString().padStart(2, "0")
            : next.toString();
}

function dec<K extends keyof PlanFormState>(field: K) {
    const raw = formData.value[field];
    const n = parseInt(raw, 10);
    const next = Math.max((Number.isFinite(n) ? n : 0) - 1, 0);
    (formData.value as Record<string, string>)[field] =
        field.endsWith("Seconds") || field.endsWith("Minutes")
            ? next.toString().padStart(2, "0")
            : next.toString();
}

/* Specialized second incrementers with rollover behavior */
function incPaceSeconds() {
    let s = parseInt(formData.value.paceSeconds || "0", 10);
    let m = parseInt(formData.value.paceMinutes || "0", 10);
    if (s >= 59) {
        s = 0;
        if (m < 599) m++;
    } else s++;
    formData.value.paceMinutes = m.toString();
    formData.value.paceSeconds = s.toString().padStart(2, "0");
}
function decPaceSeconds() {
    let s = parseInt(formData.value.paceSeconds || "0", 10);
    let m = parseInt(formData.value.paceMinutes || "0", 10);
    if (s <= 0) {
        if (m > 0) {
            m--;
            s = 59;
        } else {
            s = 0;
        }
    } else s--;
    formData.value.paceMinutes = m.toString();
    formData.value.paceSeconds = s.toString().padStart(2, "0");
}

function incStopSeconds() {
    let s = parseInt(formData.value.defaultStopSeconds || "0", 10);
    let m = parseInt(formData.value.defaultStopMinutes || "0", 10);
    if (s >= 59) {
        s = 0;
        if (m < 599) m++;
    } else s++;
    formData.value.defaultStopMinutes = m.toString();
    formData.value.defaultStopSeconds = s.toString().padStart(2, "0");
}
function decStopSeconds() {
    let s = parseInt(formData.value.defaultStopSeconds || "0", 10);
    let m = parseInt(formData.value.defaultStopMinutes || "0", 10);
    if (s <= 0) {
        if (m > 0) {
            m--;
            s = 59;
        } else s = 0;
    } else s--;
    formData.value.defaultStopMinutes = m.toString();
    formData.value.defaultStopSeconds = s.toString().padStart(2, "0");
}

function incTargetSeconds() {
    let s = parseInt(formData.value.targetSeconds || "0", 10);
    let m = parseInt(formData.value.targetMinutes || "0", 10);
    let h = parseInt(formData.value.targetHours || "0", 10);
    if (s >= 59) {
        s = 0;
        if (m >= 59) {
            m = 0;
            if (h < 99) h++;
        } else m++;
    } else s++;
    formData.value.targetHours = h.toString();
    formData.value.targetMinutes = m.toString().padStart(2, "0");
    formData.value.targetSeconds = s.toString().padStart(2, "0");
}
function decTargetSeconds() {
    let s = parseInt(formData.value.targetSeconds || "0", 10);
    let m = parseInt(formData.value.targetMinutes || "0", 10);
    let h = parseInt(formData.value.targetHours || "0", 10);
    if (s <= 0) {
        if (m <= 0) {
            if (h > 0) {
                h--;
                m = 59;
                s = 59;
            } else {
                s = 0;
            }
        } else {
            m--;
            s = 59;
        }
    } else s--;
    formData.value.targetHours = h.toString();
    formData.value.targetMinutes = m.toString().padStart(2, "0");
    formData.value.targetSeconds = s.toString().padStart(2, "0");
}

// ---------- Submission ----------

async function handleSubmit() {
    if (!formData.value.name.trim()) {
        error.value = "Plan name is required.";
        return;
    }

    // Validate target time if needed
    const targetVal = validateTargetTime();
    if (!targetVal.ok) {
        error.value = targetVal.message || "Invalid target time.";
        return;
    }
    if (formData.value.paceMode === "time") {
        if (!courseTotalDistance.value || courseTotalDistance.value <= 0) {
            error.value =
                "Course distance is unavailable. Please reload and try again.";
            return;
        }
    }

    // Validate pace (only for pace / normalized)
    const paceVal = validatePaceFields();
    if (!paceVal.ok) {
        error.value = paceVal.message || "Invalid pace.";
        return;
    }

    // Validate default stoppage
    const stopVal = validateDefaultStoppage();
    if (!stopVal.ok) {
        error.value = stopVal.message || "Invalid default stoppage time.";
        return;
    }

    // Validate pacing strategy linear percent
    if (formData.value.pacingStrategy === "linear") {
        const p = parseInt(formData.value.pacingLinearPercent || "0", 10);
        if (!Number.isFinite(p) || p < -50 || p > 50) {
            error.value =
                "Linear change percent must be a number between -50 and 50.";
            return;
        }
    }

    isSubmitting.value = true;
    error.value = "";

    try {
        let paceInSeconds: number | null = null;
        let targetTimeSeconds: number | undefined = undefined;

        if (formData.value.paceMode === "time") {
            targetTimeSeconds = targetVal.seconds!;
            // Derive a base average pace from target time and distance (still used in downstream logic)
            const distanceUnits =
                formData.value.paceUnit === "min_per_km"
                    ? courseTotalDistance.value! / 1000
                    : courseTotalDistance.value! / 1609.344;
            if (distanceUnits <= 0) {
                throw new Error("Invalid course distance");
            }
            paceInSeconds = targetTimeSeconds / distanceUnits;
        } else {
            paceInSeconds = paceVal.seconds;
        }

        // Pacing strategy fields
        const pacingStrategy = formData.value.pacingStrategy || "flat";
        let pacingLinearPercentValue = 0;
        if (pacingStrategy === "linear") {
            const p = parseInt(formData.value.pacingLinearPercent || "0", 10);
            pacingLinearPercentValue = Number.isFinite(p)
                ? Math.max(-50, Math.min(50, p))
                : 0;
        }

        const payload: Record<string, unknown> = {
            name: formData.value.name.trim(),
            pace: paceInSeconds,
            paceUnit: formData.value.paceUnit,
            defaultStoppageTime: stopVal.seconds,
            paceMode: formData.value.paceMode,
            pacingStrategy,
            pacingLinearPercent: pacingLinearPercentValue,
        };
        if (formData.value.paceMode === "time") {
            payload.targetTimeSeconds = targetTimeSeconds;
        }

        if (props.existingPlan) {
            const response = await fetch(
                `/api/courses/${props.courseId}/plans/${props.existingPlan.id}`,
                {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload),
                },
            );
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();
            emit("plan-updated", data);
        } else {
            const response = await fetch(
                `/api/courses/${props.courseId}/plans`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
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

// Keyboard: Esc closes
function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") handleClose();
}

onMounted(() => document.addEventListener("keydown", handleKeydown));
onBeforeUnmount(() => document.removeEventListener("keydown", handleKeydown));
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
                            class="flex items-center gap-2 cursor-pointer text-(--main-color) shrink-0"
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
                            class="flex items-center gap-2 cursor-pointer text-(--main-color) shrink-0"
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
                            class="flex items-center gap-2 cursor-pointer text-(--main-color) shrink-0"
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

                <!-- Pacing Strategy -->
                <div>
                    <label
                        class="block text-sm font-medium text-(--main-color) mb-1"
                    >
                        Pacing Strategy
                    </label>
                    <div class="flex flex-col gap-2">
                        <label
                            class="flex items-center gap-2 cursor-pointer text-(--main-color) shrink-0"
                        >
                            <input
                                v-model="formData.pacingStrategy"
                                type="radio"
                                value="flat"
                                class="accent-(--main-color)"
                                :disabled="isSubmitting"
                            />
                            <span
                                >Flat pacing (uniform from start to
                                finish)</span
                            >
                        </label>
                        <label
                            class="flex items-center gap-2 cursor-pointer text-(--main-color) shrink-0"
                        >
                            <input
                                v-model="formData.pacingStrategy"
                                type="radio"
                                value="linear"
                                class="accent-(--main-color)"
                                :disabled="isSubmitting"
                            />
                            <span
                                >Linear pacing (gradual change across the
                                course)</span
                            >
                        </label>
                    </div>

                    <div
                        v-if="formData.pacingStrategy === 'linear'"
                        class="mt-2"
                    >
                        <label
                            class="block text-sm font-medium text-(--main-color) mb-1"
                        >
                            Linear change percent (−50 to 50)
                        </label>
                        <div class="flex items-center gap-2">
                            <input
                                v-model="formData.pacingLinearPercent"
                                type="number"
                                min="-50"
                                max="50"
                                step="1"
                                class="w-24 px-3 py-2 border border-(--sub-color) rounded-lg bg-(--bg-color) text-(--main-color) focus:border-(--main-color)"
                                :disabled="isSubmitting"
                            />
                            <span class="text-(--main-color)">%</span>
                        </div>
                        <p class="text-xs text-(--sub-color) mt-1">
                            Positive values start slightly faster and finish
                            slightly slower. For example, 10% varies the effort
                            factor from 0.95 at the start to 1.05 at the finish.
                            Negative values produce negative splits.
                        </p>
                    </div>
                </div>

                <!-- Pace Inputs -->
                <div v-if="formData.paceMode !== 'time'">
                    <label
                        class="block text-sm font-medium text-(--main-color) mb-1"
                        :for="'pace-minutes'"
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
                            normalized (flat-equivalent) course. Segment paces
                            adjust for grade.
                        </span>
                        <span v-else>
                            Desired overall average pace; segment paces adjust
                            for grade.
                        </span>
                    </p>
                    <div class="flex items-center gap-2">
                        <!-- Pace Minutes -->
                        <div class="flex flex-col items-center">
                            <button
                                type="button"
                                :disabled="isSubmitting"
                                class="w-12 h-7 flex items-center justify-center border border-(--sub-color) rounded bg-(--bg-color) text-(--main-color) hover:bg-(--sub-color)/10 transition-colors disabled:opacity-50"
                                @click="inc('paceMinutes', 599)"
                            >
                                +
                            </button>
                            <input
                                id="pace-minutes"
                                v-model="formData.paceMinutes"
                                type="text"
                                inputmode="numeric"
                                placeholder="MM"
                                class="w-12 px-1 py-1 mt-0.5 mb-0.5 text-center border border-(--sub-color) rounded bg-(--bg-color) text-(--main-color) focus:outline-none focus:ring-2 focus:ring-(--main-color)"
                                :disabled="isSubmitting"
                                @blur="clampMinutes('paceMinutes')"
                            />
                            <button
                                type="button"
                                :disabled="isSubmitting"
                                class="w-12 h-7 flex items-center justify-center border border-(--sub-color) rounded bg-(--bg-color) text-(--main-color) hover:bg-(--sub-color)/10 transition-colors disabled:opacity-50"
                                @click="dec('paceMinutes')"
                            >
                                -
                            </button>
                            <span class="text-xs text-(--sub-color) mt-1"
                                >min</span
                            >
                        </div>
                        <div class="-translate-y-2.5 text-(--main-color)">
                            :
                        </div>
                        <!-- Pace Seconds -->
                        <div class="flex flex-col items-center">
                            <button
                                type="button"
                                :disabled="isSubmitting"
                                class="w-12 h-7 flex items-center justify-center border border-(--sub-color) rounded bg-(--bg-color) text-(--main-color) hover:bg-(--sub-color)/10 transition-colors disabled:opacity-50"
                                @click="incPaceSeconds"
                            >
                                +
                            </button>
                            <input
                                v-model="formData.paceSeconds"
                                type="text"
                                inputmode="numeric"
                                placeholder="SS"
                                class="w-12 px-1 py-1 mt-0.5 mb-0.5 text-center border border-(--sub-color) rounded bg-(--bg-color) text-(--main-color) focus:outline-none focus:ring-2 focus:ring-(--main-color)"
                                :disabled="isSubmitting"
                                @blur="clampSeconds('paceSeconds')"
                            />
                            <button
                                type="button"
                                :disabled="isSubmitting"
                                class="w-12 h-7 flex items-center justify-center border border-(--sub-color) rounded bg-(--bg-color) text-(--main-color) hover:bg-(--sub-color)/10 transition-colors disabled:opacity-50"
                                @click="decPaceSeconds"
                            >
                                -
                            </button>
                            <span class="text-xs text-(--sub-color) mt-1"
                                >sec</span
                            >
                        </div>
                        <!-- Pace Unit -->
                        <div
                            class="flex flex-col justify-center -translate-y-2.5"
                        >
                            <select
                                v-model="formData.paceUnit"
                                class="px-3 py-2 border border-(--sub-color) rounded bg-(--bg-color) text-(--main-color) focus:outline-none focus:ring-2 focus:ring-(--main-color)"
                                :disabled="isSubmitting"
                            >
                                <option value="min_per_km">min/km</option>
                                <option value="min_per_mi">min/mi</option>
                            </select>
                        </div>
                    </div>
                    <p class="text-xs text-(--sub-color) mt-1">
                        Leave both fields blank for no explicit pace (optional).
                        Seconds must be &lt; 60.
                    </p>
                </div>

                <!-- Target Finish Time -->
                <div v-else>
                    <label
                        class="block text-sm font-medium text-(--main-color) mb-1"
                        for="target-hours"
                    >
                        Target Finish Time
                    </label>
                    <p class="text-xs text-(--sub-color) mb-2">
                        Set the total time you’re targeting. We'll derive an
                        average base pace.
                    </p>
                    <div class="flex items-center gap-2">
                        <!-- Hours -->
                        <div class="flex flex-col items-center">
                            <button
                                type="button"
                                :disabled="isSubmitting"
                                class="w-12 h-7 flex items-center justify-center border border-(--sub-color) rounded bg-(--bg-color) text-(--main-color) hover:bg-(--sub-color)/10 transition-colors disabled:opacity-50"
                                @click="inc('targetHours', 99)"
                            >
                                +
                            </button>
                            <input
                                id="target-hours"
                                v-model="formData.targetHours"
                                type="text"
                                inputmode="numeric"
                                placeholder="HH"
                                class="w-12 px-1 py-1 mt-0.5 mb-0.5 text-center border border-(--sub-color) rounded bg-(--bg-color) text-(--main-color) focus:outline-none focus:ring-2 focus:ring-(--main-color)"
                                :disabled="isSubmitting"
                                @blur="clampHours"
                            />
                            <button
                                type="button"
                                :disabled="isSubmitting"
                                class="w-12 h-7 flex items-center justify-center border border-(--sub-color) rounded bg-(--bg-color) text-(--main-color) hover:bg-(--sub-color)/10 transition-colors disabled:opacity-50"
                                @click="dec('targetHours')"
                            >
                                -
                            </button>
                            <span class="text-xs text-(--sub-color) mt-1"
                                >hr</span
                            >
                        </div>
                        <div class="-translate-y-2.5 text-(--main-color)">
                            :
                        </div>
                        <!-- Minutes -->
                        <div class="flex flex-col items-center">
                            <button
                                type="button"
                                :disabled="isSubmitting"
                                class="w-12 h-7 flex items-center justify-center border border-(--sub-color) rounded bg-(--bg-color) text-(--main-color) hover:bg-(--sub-color)/10 transition-colors disabled:opacity-50"
                                @click="inc('targetMinutes', 59)"
                            >
                                +
                            </button>
                            <input
                                v-model="formData.targetMinutes"
                                type="text"
                                inputmode="numeric"
                                placeholder="MM"
                                class="w-12 px-1 py-1 mt-0.5 mb-0.5 text-center border border-(--sub-color) rounded bg-(--bg-color) text-(--main-color) focus:outline-none focus:ring-2 focus:ring-(--main-color)"
                                :disabled="isSubmitting"
                                @blur="clampMinutes('targetMinutes')"
                            />
                            <button
                                type="button"
                                :disabled="isSubmitting"
                                class="w-12 h-7 flex items-center justify-center border border-(--sub-color) rounded bg-(--bg-color) text-(--main-color) hover:bg-(--sub-color)/10 transition-colors disabled:opacity-50"
                                @click="dec('targetMinutes')"
                            >
                                -
                            </button>
                            <span class="text-xs text-(--sub-color) mt-1"
                                >min</span
                            >
                        </div>
                        <div class="-translate-y-2.5 text-(--main-color)">
                            :
                        </div>
                        <!-- Seconds -->
                        <div class="flex flex-col items-center">
                            <button
                                type="button"
                                :disabled="isSubmitting"
                                class="w-12 h-7 flex items-center justify-center border border-(--sub-color) rounded bg-(--bg-color) text-(--main-color) hover:bg-(--sub-color)/10 transition-colors disabled:opacity-50"
                                @click="incTargetSeconds"
                            >
                                +
                            </button>
                            <input
                                v-model="formData.targetSeconds"
                                type="text"
                                inputmode="numeric"
                                placeholder="SS"
                                class="w-12 px-1 py-1 mt-0.5 mb-0.5 text-center border border-(--sub-color) rounded bg-(--bg-color) text-(--main-color) focus:outline-none focus:ring-2 focus:ring-(--main-color)"
                                :disabled="isSubmitting"
                                @blur="clampSeconds('targetSeconds')"
                            />
                            <button
                                type="button"
                                :disabled="isSubmitting"
                                class="w-12 h-7 flex items-center justify-center border border-(--sub-color) rounded bg-(--bg-color) text-(--main-color) hover:bg-(--sub-color)/10 transition-colors disabled:opacity-50"
                                @click="decTargetSeconds"
                            >
                                -
                            </button>
                            <span class="text-xs text-(--sub-color) mt-1"
                                >sec</span
                            >
                        </div>
                    </div>
                    <p class="text-xs text-(--sub-color) mt-1">
                        Provide all three fields. Minutes & seconds must be &lt;
                        60; cannot be all zeros.
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
                        class="block text-sm font-medium text-(--main-color) mb-1"
                        for="stop-minutes"
                    >
                        Default Stoppage Time per Waypoint
                    </label>
                    <div class="flex items-center gap-2">
                        <!-- Stoppage Minutes -->
                        <div class="flex flex-col items-center">
                            <button
                                type="button"
                                :disabled="isSubmitting"
                                class="w-12 h-7 flex items-center justify-center border border-(--sub-color) rounded bg-(--bg-color) text-(--main-color) hover:bg-(--sub-color)/10 transition-colors disabled:opacity-50"
                                @click="inc('defaultStopMinutes', 599)"
                            >
                                +
                            </button>
                            <input
                                id="stop-minutes"
                                v-model="formData.defaultStopMinutes"
                                type="text"
                                inputmode="numeric"
                                placeholder="MM"
                                class="w-12 px-1 py-1 mt-0.5 mb-0.5 text-center border border-(--sub-color) rounded bg-(--bg-color) text-(--main-color) focus:outline-none focus:ring-2 focus:ring-(--main-color)"
                                :disabled="isSubmitting"
                                @blur="clampMinutes('defaultStopMinutes')"
                            />
                            <button
                                type="button"
                                :disabled="isSubmitting"
                                class="w-12 h-7 flex items-center justify-center border border-(--sub-color) rounded bg-(--bg-color) text-(--main-color) hover:bg-(--sub-color)/10 transition-colors disabled:opacity-50"
                                @click="dec('defaultStopMinutes')"
                            >
                                -
                            </button>
                            <span class="text-xs text-(--sub-color) mt-1"
                                >min</span
                            >
                        </div>
                        <div class="-translate-y-2.5 text-(--main-color)">
                            :
                        </div>
                        <!-- Stoppage Seconds -->
                        <div class="flex flex-col items-center">
                            <button
                                type="button"
                                :disabled="isSubmitting"
                                class="w-12 h-7 flex items-center justify-center border border-(--sub-color) rounded bg-(--bg-color) text-(--main-color) hover:bg-(--sub-color)/10 transition-colors disabled:opacity-50"
                                @click="incStopSeconds"
                            >
                                +
                            </button>
                            <input
                                v-model="formData.defaultStopSeconds"
                                type="text"
                                inputmode="numeric"
                                placeholder="SS"
                                class="w-12 px-1 py-1 mt-0.5 mb-0.5 text-center border border-(--sub-color) rounded bg-(--bg-color) text-(--main-color) focus:outline-none focus:ring-2 focus:ring-(--main-color)"
                                :disabled="isSubmitting"
                                @blur="clampSeconds('defaultStopSeconds')"
                            />
                            <button
                                type="button"
                                :disabled="isSubmitting"
                                class="w-12 h-7 flex items-center justify-center border border-(--sub-color) rounded bg-(--bg-color) text-(--main-color) hover:bg-(--sub-color)/10 transition-colors disabled:opacity-50"
                                @click="decStopSeconds"
                            >
                                -
                            </button>
                            <span class="text-xs text-(--sub-color) mt-1"
                                >sec</span
                            >
                        </div>
                    </div>
                    <p class="text-xs text-(--sub-color) mt-1">
                        Optional. Applies only to intermediate waypoints. Leave
                        both blank for none.
                    </p>
                </div>

                <!-- Error -->
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
