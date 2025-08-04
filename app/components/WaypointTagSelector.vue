<script setup lang="ts">
import { STANDARD_WAYPOINT_TAGS } from "~/utils/waypointTags";

interface Props {
    selectedTags?: string[];
}

interface Emits {
    "update:selectedTags": [tags: string[]];
}

const props = withDefaults(defineProps<Props>(), {
    selectedTags: () => [],
});

const emit = defineEmits<Emits>();

function toggleTag(tagId: string) {
    const currentTags = [...props.selectedTags];
    const index = currentTags.indexOf(tagId);

    if (index > -1) {
        // Remove tag
        currentTags.splice(index, 1);
    } else {
        // Add tag
        currentTags.push(tagId);
    }

    emit("update:selectedTags", currentTags);
}

function isTagSelected(tagId: string): boolean {
    return props.selectedTags.includes(tagId);
}
</script>

<template>
    <div class="space-y-3">
        <div class="grid gap-1">
            <div
                v-for="tag in STANDARD_WAYPOINT_TAGS"
                :key="tag.id"
                v-tooltip="{
                    content: tag.description,
                    placement: 'left',
                    showArrow: true,
                }"
                class="w-full text-center relative rounded-lg border-2 transition-all duration-200 flex items-center justify-between group p-0! px-1! cursor-pointer"
                :style="{
                    backgroundColor: isTagSelected(tag.id)
                        ? tag.color
                        : tag.color + '15',
                    borderColor: isTagSelected(tag.id)
                        ? tag.color
                        : 'transparent',
                }"
                @click.prevent.stop="toggleTag(tag.id)"
            >
                <Icon
                    :name="tag.icon"
                    :style="{
                        color: isTagSelected(tag.id) ? 'white' : tag.color,
                    }"
                />
                {{ tag.label }}
                <Icon
                    name="lucide:check"
                    :style="{
                        color: isTagSelected(tag.id) ? 'white' : 'transparent',
                    }"
                />
            </div>
        </div>

        <!-- Selected tags summary -->
        <div
            v-if="props.selectedTags.length > 0"
            class="p-2 bg-(--sub-alt-color) rounded-md"
        >
            <div class="text-xs font-medium text-(--main-color) mb-2">
                Selected ({{ props.selectedTags.length }})
            </div>
            <div class="flex flex-wrap gap-1">
                <span
                    v-for="tagId in props.selectedTags"
                    :key="tagId"
                    v-tooltip="
                        STANDARD_WAYPOINT_TAGS.find((t) => t.id === tagId)
                            ?.label || tagId
                    "
                    class="inline-flex items-center justify-center w-6 h-6 rounded text-xs font-medium text-white"
                    :style="{
                        backgroundColor:
                            STANDARD_WAYPOINT_TAGS.find((t) => t.id === tagId)
                                ?.color || '#6b7280',
                    }"
                >
                    <Icon
                        :name="
                            STANDARD_WAYPOINT_TAGS.find((t) => t.id === tagId)
                                ?.icon || 'lucide:map-pin'
                        "
                        class="h-3 w-3"
                    />
                </span>
            </div>
        </div>
    </div>
</template>

<style scoped>
.line-clamp-1 {
    display: -webkit-box;
    -webkit-line-clamp: 1;
    line-clamp: 1;
    -webkit-box-orient: vertical;
    overflow: hidden;
}
</style>
