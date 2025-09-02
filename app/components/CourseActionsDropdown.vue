<script setup lang="ts">
interface Course {
    id: string;
    name: string;
    description?: string | null;
    userId: string;
    originalFileName: string;
    originalFileContent: string;
    fileType: string;
    geoJsonData: unknown;
    totalDistance?: number | null;
    elevationGain?: number | null;
    elevationLoss?: number | null;
    raceDate?: Date | null;
    createdAt: Date;
    updatedAt: Date;
}

interface Props {
    course?: Course | null;
}

interface Emits {
    (e: "edit-course" | "download-file" | "delete-course"): void;
}

const _props = defineProps<Props>();
const emit = defineEmits<Emits>();

interface ActionItem {
    name: string;
    action: () => void;
    icon: string;
    destructive?: boolean;
    description?: string;
}

const actions: ActionItem[] = [
    {
        name: "Edit Course",
        action: () => {
            emit("edit-course");
            popupVisible.value = false;
        },
        icon: "lucide:pencil",
    },
    {
        name: "Download GPX",
        action: () => {
            emit("download-file");
            popupVisible.value = false;
        },
        icon: "lucide:download",
    },
    {
        name: "Delete Course",
        action: () => {
            emit("delete-course");
            popupVisible.value = false;
        },
        icon: "lucide:trash-2",
        destructive: true,
    },
];

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
    <div ref="popupRef" class="relative">
        <button
            class="flex items-center gap-2 px-3 py-2 border border-(--main-color) text-(--main-color) rounded-sm hover:bg-(--main-color) hover:text-(--bg-color) transition-colors text-sm font-medium focus-outline"
            @click.stop.prevent="popupVisible = !popupVisible"
            @keydown.enter.prevent="popupVisible = !popupVisible"
            @keydown.esc.stop.prevent="popupVisible = false"
            @keydown.space.prevent="popupVisible = !popupVisible"
        >
            <span>Menu</span>
            <Icon
                name="lucide:chevron-up"
                :class="[
                    'h-4 w-4 scale-150 transition-transform',
                    popupVisible ? 'rotate-0' : 'rotate-180',
                ]"
            />
        </button>

        <!-- Dropdown -->
        <div
            v-if="popupVisible"
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
                        <div
                            v-if="action.description"
                            class="text-xs text-(--sub-color) mt-1"
                        >
                            {{ action.description }}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>
