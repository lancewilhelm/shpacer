<script setup lang="ts">
import type { SelectCourse } from "~/utils/db/schema";
import { formatDistance, formatElevation } from "~/utils/courseMetrics";

interface Props {
    open: boolean;
    course:
        | (SelectCourse & {
              role?: string;
              forkedFromCourseId?: string | null;
          })
        | null;
    waypointCount?: number | null;
    sourceCourseName?: string | null; // optional friendly name of fork origin
    sourceOwnerId?: string | null;
}

interface Emits {
    (e: "close"): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

/**
 * Close the modal
 */
function close() {
    emit("close");
}

function copyToClipboard(label: string, val: unknown) {
    if (val == null) return;
    const text = String(val);
    navigator.clipboard
        .writeText(text)
        .catch((e) => console.warn("Clipboard write failed:", e));
}

/**
 * Copy the entire course object (raw JSON) to the clipboard.
 */
function copyAllJson() {
    if (!props.course) return;
    try {
        // Omit large/raw track or file content style fields
        const { originalFileContent, geoJsonData, ...rest } =
            props.course as Record<string, unknown>;

        // You can add more exclusions here if needed later
        const exportObject = {
            ...rest,
            _omitted: [
                originalFileContent ? "originalFileContent" : null,
                geoJsonData ? "geoJsonData" : null,
            ].filter(Boolean),
        };

        navigator.clipboard.writeText(JSON.stringify(exportObject, null, 2));
    } catch (e) {
        console.warn("Failed to copy JSON:", e);
    }
}

const formattedCreatedAt = computed(() =>
    props.course?.createdAt ? formatDateTime(props.course.createdAt) : "—",
);
const formattedUpdatedAt = computed(() =>
    props.course?.updatedAt ? formatDateTime(props.course.updatedAt) : "—",
);
const formattedRaceDate = computed(() =>
    props.course?.raceDate ? formatDateTime(props.course.raceDate) : "—",
);

const visibilityLabel = computed(() =>
    props.course?.public ? "Public" : "Private",
);

const roleLabel = computed(() => {
    if (!props.course?.role) return "—";
    if (props.course.role === "owner") return "Owner";
    if (props.course.role === "added") return "Starred (legacy)";
    if (props.course.role === "starred") return "Starred";
    return props.course.role;
});

const provenance = computed(() => {
    if (!props.course?.forkedFromCourseId) return null;
    return {
        id: props.course.forkedFromCourseId,
        name: props.sourceCourseName || null,
        ownerId: props.sourceOwnerId || null,
    };
});

const distanceDisplay = computed(() =>
    props.course?.totalDistance != null
        ? formatDistance(
              props.course.totalDistance,
              useUserSettingsStore().settings.units.distance,
          )
        : "—",
);

const elevationGainDisplay = computed(() =>
    props.course?.elevationGain != null
        ? formatElevation(
              props.course.elevationGain,
              useUserSettingsStore().settings.units.elevation,
          )
        : "—",
);
const elevationLossDisplay = computed(() =>
    props.course?.elevationLoss != null
        ? formatElevation(
              props.course.elevationLoss,
              useUserSettingsStore().settings.units.elevation,
          )
        : "—",
);

const fileName = computed(() => props.course?.originalFileName || "—");
const fileType = computed(() => props.course?.fileType || "—");

const fileSize = computed(() => {
    if (!props.course?.originalFileContent) return "—";
    // Rough byte size based on string length (UTF-16 in JS) - approximate actual file may differ
    const bytes = new Blob([props.course.originalFileContent]).size;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
});

const waypointCountDisplay = computed(() =>
    props.waypointCount != null ? String(props.waypointCount) : "—",
);

function formatDateTime(dt: Date | string | number) {
    const d = new Date(dt);
    if (Number.isNaN(d.getTime())) return "Invalid Date";
    return (
        d.toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
        }) +
        " " +
        d.toLocaleTimeString(undefined, {
            hour: "2-digit",
            minute: "2-digit",
        })
    );
}

interface MetaItem {
    label: string;
    value: unknown;
    multiline?: boolean;
}
interface MetaGroup {
    section: string;
    items: MetaItem[];
}
const allMeta = computed<MetaGroup[]>(() => {
    if (!props.course) return [];
    return [
        {
            section: "Identity",
            items: [
                { label: "Course ID", value: props.course.id },
                { label: "Owner User ID", value: props.course.userId },
                { label: "Role", value: roleLabel.value },
                { label: "Visibility", value: visibilityLabel.value },
            ],
        },
        {
            section: "Provenance",
            items: provenance.value
                ? [
                      {
                          label: "Forked From Course ID",
                          value: provenance.value.id,
                      },
                      {
                          label: "Forked From Name",
                          value: provenance.value.name || "—",
                      },
                      {
                          label: "Forked From Owner ID",
                          value: provenance.value.ownerId || "—",
                      },
                  ]
                : [{ label: "Forked From", value: "Original (no parent)" }],
        },
        {
            section: "Timestamps",
            items: [
                { label: "Created At", value: formattedCreatedAt.value },
                { label: "Updated At", value: formattedUpdatedAt.value },
                { label: "Race Date", value: formattedRaceDate.value },
            ],
        },
        {
            section: "File",
            items: [
                { label: "Original File Name", value: fileName.value },
                { label: "File Type", value: fileType.value },
                { label: "Approx. File Size", value: fileSize.value },
            ],
        },
        {
            section: "Metrics",
            items: [
                { label: "Total Distance", value: distanceDisplay.value },
                { label: "Elevation Gain", value: elevationGainDisplay.value },
                { label: "Elevation Loss", value: elevationLossDisplay.value },
                { label: "Waypoint Count", value: waypointCountDisplay.value },
            ],
        },
        {
            section: "Content Snapshot",
            items: [
                {
                    label: "Description",
                    value: props.course.description || "(none)",
                    multiline: true,
                },
            ],
        },
    ];
});

/**
 * Accessibility: trap focus (lightweight)
 */
const firstFocusable = ref<HTMLElement | null>(null);
onMounted(() => {
    watch(
        () => props.open,
        (open) => {
            if (open) {
                nextTick(() => {
                    firstFocusable.value?.focus();
                });
            }
        },
        { immediate: true },
    );
});
</script>

<template>
    <ModalWindow
        :open="open"
        max-width="900px"
        max-height="80vh"
        width="100%"
        @close="close"
    >
        <div
            class="flex items-center justify-between mb-4 pb-2 border-b border-(--sub-color)"
        >
            <div class="flex items-center gap-3">
                <Icon
                    name="lucide:info"
                    class="h-5 w-5 text-(--main-color) scale-150"
                />
                <h2 class="text-xl font-semibold text-(--main-color)">
                    Course Information
                </h2>
            </div>
            <div class="flex items-center gap-2">
                <button
                    v-tooltip="'Copy raw JSON'"
                    class="flex items-center gap-1 px-2 py-1 rounded border border-(--sub-color) text-(--sub-color) hover:text-(--main-color) hover:border-(--main-color) text-xs transition-colors"
                    @click="copyAllJson"
                >
                    <Icon name="lucide:code-2" class="h-3 w-3" />
                    <span>Copy JSON</span>
                </button>
                <Icon
                    name="lucide:x"
                    class="h-5 w-5 text-(--main-color) scale-150 cursor-pointer"
                    @click="close"
                />
            </div>
        </div>

        <div
            v-if="!course"
            class="p-6 text-center text-(--sub-color) text-sm italic"
        >
            No course data available.
        </div>

        <div
            v-else
            class="flex flex-col gap-2 overflow-y-auto pr-1 custom-scrollbar"
            style="max-height: calc(80vh - 120px)"
        >
            <div
                v-for="group in allMeta"
                :key="group.section"
                class="border border-(--sub-color)/40 rounded-md"
            >
                <div
                    class="px-3 py-2 bg-(--sub-alt-color) border-b border-(--sub-color)/30 flex items-center justify-between"
                >
                    <h6 class="text-sm font-semibold text-(--main-color)">
                        {{ group.section }}
                    </h6>
                </div>
                <div class="divide-y divide-(--sub-color)/20">
                    <div
                        v-for="item in group.items"
                        :key="item.label"
                        class="flex flex-col md:flex-row md:items-start gap-2 md:gap-4 px-3 py-3"
                    >
                        <div
                            class="w-40 shrink-0 text-xs font-medium uppercase tracking-wide text-(--sub-color)"
                        >
                            {{ item.label }}
                        </div>
                        <div class="flex-1 min-w-0">
                            <pre
                                v-if="item.multiline"
                                class="whitespace-pre-wrap text-sm text-(--main-color) font-sans break-words"
                                >{{ item.value }}</pre
                            >
                            <span
                                v-else
                                class="text-sm text-(--main-color) break-words select-text"
                            >
                                {{ item.value }}
                            </span>
                        </div>
                        <div class="flex items-center gap-2">
                            <Icon
                                v-if="item.value && item.value !== '—'"
                                v-tooltip="'Copy value'"
                                name="lucide:copy"
                                class="h-3 w-2 text-(--sub-color) cursor-pointer"
                                @click="copyToClipboard(item.label, item.value)"
                            />
                        </div>
                    </div>
                </div>
            </div>

            <!-- Raw JSON section removed; use Copy JSON button in header -->
        </div>
    </ModalWindow>
</template>
