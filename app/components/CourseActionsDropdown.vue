<script setup lang="ts">
interface Course {
    id: string;
    name: string;
    description?: string;
    originalFileName: string;
    fileType: string;
    totalDistance?: number;
    elevationGain?: number;
    elevationLoss?: number;
    raceDate?: string;
    createdAt: string;
}

interface Props {
    course: Course;
}

interface Emits {
    (e: "edit-course"): void;
    (e: "download-file"): void;
    (e: "delete-course"): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const actions = {
    edit: {
        name: "Edit Course",
        action: () => {
            emit("edit-course");
            popupVisible.value = false;
        },
        icon: "heroicons:pencil",
    },
    download: {
        name: "Download GPX",
        action: () => {
            emit("download-file");
            popupVisible.value = false;
        },
        icon: "heroicons:arrow-down-tray",
    },
    delete: {
        name: "Delete Course",
        action: () => {
            emit("delete-course");
            popupVisible.value = false;
        },
        icon: "heroicons:trash",
        destructive: true,
    },
};

const popupVisible = ref(false);
const popupRef = ref<HTMLElement | null>(null);

// Close on escape or outside click
const handleClickOutside = (event: MouseEvent) => {
    if (popupRef.value && !popupRef.value.contains(event.target as Node)) {
        popupVisible.value = false;
    }
};

const handleEscapeKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
        popupVisible.value = false;
    }
};

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
    <div class="relative">
        <div
            class="flex items-center gap-2 cursor-pointer focus-outline rounded px-3 py-2 border border-(--main-color) text-(--main-color) hover:bg-(--main-color) hover:text-(--bg-color) transition-colors"
            tabindex="0"
            @mousedown.stop.prevent="popupVisible = !popupVisible"
            @keydown.enter="
                () => {
                    popupVisible = !popupVisible;
                }
            "
            @keydown.esc.stop.prevent="
                () => {
                    popupVisible = false;
                }
            "
            @keydown.space="
                () => {
                    popupVisible = !popupVisible;
                }
            "
        >
            <div class="flex items-center gap-1">
                <div class="text-sm font-medium">Menu</div>
                <Icon
                    name="lucide:chevron-up"
                    :class="[
                        'cursor-pointer hover:opacity-80 transition-transform',
                        popupVisible ? 'rotate-0' : 'rotate-180',
                    ]"
                />
            </div>
        </div>

        <!-- Dropdown -->
        <div
            v-if="popupVisible"
            ref="popupRef"
            class="absolute top-full mb-2 mt-2 right-0 bg-(--bg-color) border border-(--sub-color) rounded-lg shadow-lg min-w-max max-h-80 z-50 overflow-y-auto"
        >
            <div class="p-2">
                <div
                    v-for="action in actions"
                    :key="action.name"
                    :class="[
                        'grid grid-cols-[20px_1fr] items-center gap-1 px-1 py-3 cursor-pointer rounded-lg transition-colors',
                        action.destructive
                            ? 'hover:bg-(--error-color)/10 text-(--error-color)'
                            : 'hover:bg-(--sub-color)/10 text-(--main-color)',
                    ]"
                    @click="action.action()"
                >
                    <Icon
                        :name="action.icon"
                        :class="[
                            'scale-125',
                            action.destructive
                                ? 'text-(--error-color)'
                                : 'text-(--main-color)',
                        ]"
                    />
                    <div class="flex flex-col overflow-hidden">
                        <div
                            :class="[
                                'font-medium text-sm',
                                action.destructive
                                    ? 'text-(--error-color)'
                                    : 'text-(--main-color)',
                            ]"
                        >
                            {{ action.name }}
                        </div>
                        <div class="text-xs text-(--sub-color) mt-1">
                            {{ action.description }}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>
