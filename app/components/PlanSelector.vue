<script setup lang="ts">
import type { SelectPlan } from "~/utils/db/schema";

interface Props {
    plans: SelectPlan[];
    currentPlanId?: string | null;
    courseId: string;
}

interface Emits {
    (e: "plan-selected" | "delete-plan", planId: string): void;
    (e: "add-plan"): void;
    (e: "edit-plan", plan: SelectPlan): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const dropdownOpen = ref(false);
const dropdownRef = ref<HTMLElement | null>(null);

const currentPlan = computed(() => {
    if (!props.currentPlanId) return null;
    return props.plans.find((p) => p.id === props.currentPlanId) || null;
});

const sortedPlans = computed(() => {
    return [...props.plans].sort(
        (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
});

function selectPlan(planId: string) {
    emit("plan-selected", planId);
    dropdownOpen.value = false;
}

function addPlan() {
    emit("add-plan");
    dropdownOpen.value = false;
}

function editPlan(plan: SelectPlan, event: Event) {
    event.stopPropagation();
    emit("edit-plan", plan);
    dropdownOpen.value = false;
}

function deletePlan(planId: string, event: Event) {
    event.stopPropagation();
    if (
        confirm(
            "Are you sure you want to delete this plan? This will also delete all waypoint notes for this plan.",
        )
    ) {
        emit("delete-plan", planId);
    }
    dropdownOpen.value = false;
}

function formatPace(pace?: number, paceUnit?: string): string {
    if (!pace) return "";
    const minutes = Math.floor(pace / 60);
    const seconds = pace % 60;
    const unit = paceUnit === "min_per_mi" ? "/mi" : "/km";
    return `${minutes}:${seconds.toString().padStart(2, "0")} ${unit}`;
}

// Close dropdown on outside click
function handleClickOutside(event: MouseEvent) {
    if (
        dropdownRef.value &&
        !dropdownRef.value.contains(event.target as Node)
    ) {
        dropdownOpen.value = false;
    }
}

// Close dropdown on escape
function handleEscapeKey(event: KeyboardEvent) {
    if (event.key === "Escape") {
        dropdownOpen.value = false;
    }
}

onMounted(() => {
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscapeKey);
});

onBeforeUnmount(() => {
    document.removeEventListener("mousedown", handleClickOutside);
    document.removeEventListener("keydown", handleEscapeKey);
});
</script>

<template>
    <div class="flex items-center gap-2">
        <!-- Add Plan Button -->
        <button
            class="flex items-center gap-2 px-3 py-2 border border-(--main-color) text-(--main-color) rounded-sm hover:bg-(--main-color) hover:text-(--bg-color) transition-colors text-sm font-medium"
            @click="addPlan"
        >
            <Icon
                name="lucide:plus"
                class="h-4 w-4 scale-125 -translate-y-0.25"
            />
            Add Plan
        </button>

        <!-- Plan Selector Dropdown (only show if there are plans) -->
        <div v-if="plans.length > 0" ref="dropdownRef" class="relative">
            <button
                class="flex items-center gap-2 px-3 py-2 border border-(--sub-color) rounded-sm bg-(--bg-color) text-(--main-color) hover:bg-(--sub-color)/10 transition-colors text-sm"
                @click="dropdownOpen = !dropdownOpen"
            >
                <Icon
                    name="lucide:clipboard-list"
                    class="h-4 w-4 scale-125 -translate-y-0.25"
                />
                <span class="font-medium">
                    {{ currentPlan ? currentPlan.name : "Select Plan" }}
                </span>
                <Icon
                    name="lucide:chevron-down"
                    :class="[
                        'h-4 w-4 transition-transform',
                        dropdownOpen ? 'rotate-180' : 'rotate-0',
                    ]"
                />
            </button>

            <!-- Dropdown Menu -->
            <div
                v-if="dropdownOpen"
                class="absolute top-full mt-1 right-0 bg-(--bg-color) border border-(--sub-color) rounded-lg shadow-lg min-w-64 max-h-80 z-50 overflow-y-auto"
            >
                <div class="p-2 space-y-1">
                    <!-- No Plan Option -->
                    <div
                        :class="[
                            'flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer transition-colors',
                            !currentPlanId
                                ? 'bg-(--main-color) text-(--bg-color)'
                                : 'hover:bg-(--sub-color)/10 text-(--main-color)',
                        ]"
                        @click="selectPlan('')"
                    >
                        <div class="flex items-center gap-2">
                            <Icon name="lucide:eye-off" class="h-4 w-4" />
                            <span class="font-medium">No Plan</span>
                        </div>
                    </div>

                    <!-- Divider -->
                    <div class="h-px bg-(--sub-color)/20 my-1"></div>

                    <!-- Plan Options -->
                    <div
                        v-for="plan in sortedPlans"
                        :key="plan.id"
                        :class="[
                            'flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer transition-colors',
                            currentPlanId === plan.id
                                ? 'bg-(--main-color) text-(--bg-color)'
                                : 'hover:bg-(--sub-color)/10 text-(--main-color)',
                        ]"
                        @click="selectPlan(plan.id)"
                    >
                        <div class="flex-1 min-w-0">
                            <div class="flex items-center gap-2">
                                <span class="font-medium truncate">{{
                                    plan.name
                                }}</span>
                            </div>
                            <div
                                v-if="plan.pace"
                                class="text-xs mt-1 opacity-75"
                            >
                                {{ formatPace(plan.pace, plan.paceUnit) }}
                            </div>
                        </div>

                        <div class="flex items-center gap-1 ml-2">
                            <!-- Action buttons -->
                            <div class="flex items-center gap-1">
                                <button
                                    v-tooltip="'Edit plan'"
                                    class="p-1 rounded hover:bg-black/10 transition-colors"
                                    @click="editPlan(plan, $event)"
                                >
                                    <Icon
                                        name="lucide:pencil"
                                        class="h-3 w-3"
                                    />
                                </button>
                                <button
                                    v-tooltip="'Delete plan'"
                                    class="p-1 rounded hover:bg-black/10 transition-colors text-(--error-color)"
                                    @click="deletePlan(plan.id, $event)"
                                >
                                    <Icon
                                        name="lucide:trash-2"
                                        class="h-3 w-3"
                                    />
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
.group:hover .group-hover\:opacity-100 {
    opacity: 1;
}
</style>
