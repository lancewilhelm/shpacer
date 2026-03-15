<script setup lang="ts">
import type { SelectCourseActivity } from "~/utils/db/schema";
import { formatElapsedTime } from "~/utils/timeCalculations";

interface Props {
    activities: SelectCourseActivity[];
    currentActivityId?: string | null;
    courseId: string;
}

interface Emits {
    (e: "activity-selected", activityId: string): void;
    (e: "activities-changed"): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const dropdownOpen = ref(false);
const dropdownRef = ref<HTMLElement | null>(null);
const fileInputRef = ref<HTMLInputElement | null>(null);
const isUploading = ref(false);

const currentActivity = computed(() => {
    if (!props.currentActivityId) return null;
    return (
        props.activities.find((activity) => activity.id === props.currentActivityId) ||
        null
    );
});

const sortedActivities = computed(() => {
    return [...props.activities].sort(
        (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
});

function selectActivity(activityId: string) {
    emit("activity-selected", activityId);
    dropdownOpen.value = false;
}

function openUpload() {
    fileInputRef.value?.click();
}

function readFileAsText(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
        reader.readAsText(file);
    });
}

async function onFileSelected(event: Event) {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    if (!file) return;

    const extension = file.name.toLowerCase().split(".").pop();
    if (extension !== "gpx" && extension !== "tcx") {
        window.alert("Only GPX and TCX activity files are supported.");
        target.value = "";
        return;
    }

    isUploading.value = true;

    try {
        const originalFileContent = await readFileAsText(file);
        const response = await $fetch<{ activity: SelectCourseActivity }>(
            `/api/courses/${props.courseId}/activities`,
            {
                method: "POST",
                body: {
                    sourceFileName: file.name,
                    originalFileContent,
                    fileType: extension,
                },
            },
        );

        emit("activities-changed");
        emit("activity-selected", response.activity.id);
        dropdownOpen.value = false;
    } catch (error) {
        console.error("Failed to upload activity", error);
        window.alert("Failed to upload activity.");
    } finally {
        isUploading.value = false;
        target.value = "";
    }
}

async function deleteActivity(activityId: string, event: Event) {
    event.stopPropagation();
    if (!window.confirm("Delete this activity?")) {
        return;
    }

    try {
        await $fetch(`/api/courses/${props.courseId}/activities/${activityId}`, {
            method: "DELETE",
        });
        emit("activities-changed");
        if (props.currentActivityId === activityId) {
            emit("activity-selected", "");
        }
    } catch (error) {
        console.error("Failed to delete activity", error);
        window.alert("Failed to delete activity.");
    }

    dropdownOpen.value = false;
}

function formatProvider(provider: string) {
    if (provider === "strava") return "Strava";
    if (provider === "garmin") return "Garmin";
    return "Unknown";
}

function handleClickOutside(event: MouseEvent) {
    if (
        dropdownRef.value &&
        !dropdownRef.value.contains(event.target as Node)
    ) {
        dropdownOpen.value = false;
    }
}

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
        <input
            ref="fileInputRef"
            type="file"
            accept=".gpx,.tcx"
            class="hidden"
            @change="onFileSelected"
        />

        <div ref="dropdownRef" class="relative">
            <button
                class="flex items-center gap-2 px-2 py-1 md:px-3 md:py-2 border border-(--main-color) text-(--main-color) rounded-sm hover:bg-(--main-color) hover:text-(--bg-color) transition-colors text-xs md:text-sm font-medium"
                @click="dropdownOpen = !dropdownOpen"
            >
                <Icon
                    name="lucide:flag"
                    class="h-3 w-3 md:h-4 md:w-4"
                />
                <span class="font-medium">
                    {{
                        currentActivity
                            ? currentActivity.sourceFileName
                            : "Select Activity"
                    }}
                </span>
                <Icon
                    name="lucide:chevron-down"
                    :class="[
                        'h-3 w-3 md:h-4 md:w-4 transition-transform',
                        dropdownOpen ? 'rotate-180' : 'rotate-0',
                    ]"
                />
            </button>

            <div
                v-if="dropdownOpen"
                class="absolute top-full mt-1 left-0 md:left-auto md:right-0 bg-(--bg-color) border border-(--sub-color) rounded-lg shadow-lg min-w-56 md:min-w-72 max-w-[90vw] max-h-80 z-50 overflow-y-auto"
            >
                <div class="p-2 space-y-1">
                    <div
                        :class="[
                            'flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer transition-colors',
                            !currentActivityId
                                ? 'bg-(--main-color) text-(--bg-color)'
                                : 'hover:bg-(--sub-color)/10 text-(--main-color)',
                        ]"
                        @click="selectActivity('')"
                    >
                        <div class="flex items-center gap-2">
                            <Icon name="lucide:eye-off" class="h-4 w-4" />
                            <span class="font-medium">No Activity</span>
                        </div>
                    </div>

                    <div class="h-px bg-(--sub-color)/20 my-1"></div>

                    <div
                        v-for="activity in sortedActivities"
                        :key="activity.id"
                        :class="[
                            'flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer transition-colors',
                            currentActivityId === activity.id
                                ? 'bg-(--main-color) text-(--bg-color)'
                                : 'hover:bg-(--sub-color)/10 text-(--main-color)',
                        ]"
                        @click="selectActivity(activity.id)"
                    >
                        <div class="flex-1 min-w-0">
                            <div class="font-medium truncate">
                                {{ activity.sourceFileName }}
                            </div>
                            <div class="text-xs mt-1 opacity-75">
                                {{ formatProvider(activity.provider) }}
                                <span
                                    v-if="activity.elapsedTimeSeconds != null"
                                >
                                    ·
                                    {{
                                        formatElapsedTime(
                                            activity.elapsedTimeSeconds,
                                        )
                                    }}
                                </span>
                            </div>
                        </div>

                        <button
                            v-tooltip="'Delete activity'"
                            class="p-1 rounded hover:bg-black/10 transition-colors text-(--error-color) ml-2"
                            @click="deleteActivity(activity.id, $event)"
                        >
                            <Icon
                                name="lucide:trash-2"
                                class="h-3 w-3"
                            />
                        </button>
                    </div>

                    <div class="h-px bg-(--sub-color)/20 my-1"></div>

                    <div
                        class="flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer transition-colors hover:bg-(--sub-color)/10 text-(--main-color)"
                        @click="openUpload"
                    >
                        <div class="flex items-center gap-2">
                            <Icon
                                :name="
                                    isUploading
                                        ? 'svg-spinners:6-dots-scale'
                                        : 'lucide:upload'
                                "
                                class="h-4 w-4"
                            />
                            <span class="font-medium">
                                {{ isUploading ? "Uploading..." : "Upload Activity" }}
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>
