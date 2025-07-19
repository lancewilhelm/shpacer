<script setup lang="ts">
import { STANDARD_WAYPOINT_TAGS } from '~/utils/waypointTags';

interface Props {
  selectedTags?: string[];
}

interface Emits {
  'update:selectedTags': [tags: string[]];
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
  
  emit('update:selectedTags', currentTags);
}

function isTagSelected(tagId: string): boolean {
  return props.selectedTags.includes(tagId);
}
</script>

<template>
  <div class="space-y-3">    
    <div class="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-3 gap-2">
      <button
        v-for="tag in STANDARD_WAYPOINT_TAGS"
        :key="tag.id"
        type="button"
        class="relative w-12 h-12 rounded-lg border-2 transition-all duration-200 flex items-center justify-center group"
        :class="{
          'border-white bg-opacity-100': isTagSelected(tag.id),
          'border-gray-300 bg-opacity-20 hover:bg-opacity-40': !isTagSelected(tag.id)
        }"
        :style="{ 
          backgroundColor: isTagSelected(tag.id) ? tag.color : tag.color + '33',
          borderColor: isTagSelected(tag.id) ? tag.color : 'transparent'
        }"
        :title="tag.label + (tag.description ? ' - ' + tag.description : '')"
        @click="toggleTag(tag.id)"
      >
        <Icon 
          :name="tag.icon" 
          class="w-5 h-5"
          :class="{
            'text-white': isTagSelected(tag.id),
            'opacity-70': !isTagSelected(tag.id)
          }"
          :style="{ color: isTagSelected(tag.id) ? 'white' : tag.color }"
        />
        <Icon 
          v-if="isTagSelected(tag.id)"
          name="lucide:check"
          class="absolute -top-1 -right-1 w-3 h-3 text-white bg-green-500 rounded-full p-0.5"
        />
      </button>
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
          class="inline-flex items-center justify-center w-6 h-6 rounded text-xs font-medium text-white"
          :style="{ backgroundColor: STANDARD_WAYPOINT_TAGS.find(t => t.id === tagId)?.color || '#6b7280' }"
          :title="STANDARD_WAYPOINT_TAGS.find(t => t.id === tagId)?.label || tagId"
        >
          <Icon 
            :name="STANDARD_WAYPOINT_TAGS.find(t => t.id === tagId)?.icon || 'lucide:map-pin'" 
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
