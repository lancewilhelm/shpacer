<script setup lang="ts">
import type { Waypoint } from '~/utils/waypoints';
import { formatDistance, formatElevation } from '~/utils/courseMetrics';
import { getWaypointIcon, getWaypointColor } from '~/utils/waypoints';

interface Props {
  waypoints?: Waypoint[];
  selectedWaypoint?: Waypoint | null;
}

interface Emits {
  'waypoint-select': [waypoint: Waypoint];
  'waypoint-hover': [waypoint: Waypoint];
  'waypoint-leave': [];
}

const _props = withDefaults(defineProps<Props>(), {
  waypoints: () => [],
  selectedWaypoint: null,
});

const { waypoints, selectedWaypoint } = toRefs(_props);

const emit = defineEmits<Emits>();

const userSettingsStore = useUserSettingsStore();

function handleWaypointClick(waypoint: Waypoint) {
  emit('waypoint-select', waypoint);
}

function handleWaypointHover(waypoint: Waypoint) {
  emit('waypoint-hover', waypoint);
}

function handleWaypointLeave() {
  emit('waypoint-leave');
}

function formatWaypointDistance(meters: number) {
  return formatDistance(meters, userSettingsStore.settings.units.distance);
}

function formatWaypointElevation(meters: number) {
  return formatElevation(meters, userSettingsStore.settings.units.elevation);
}

function getWaypointTypeLabel(type: Waypoint['type']): string {
  switch (type) {
    case 'start':
      return 'Start';
    case 'finish':
      return 'Finish';
    case 'waypoint':
      return 'Waypoint';
    case 'poi':
      return 'Point of Interest';
    default:
      return 'Unknown';
  }
}
</script>

<template>
  <div class="h-full flex flex-col">
    <div class="flex-1 overflow-y-auto">
      <div v-if="(waypoints?.length || 0) === 0" class="p-4 text-center text-(--sub-color)">
        <Icon name="heroicons:map-pin" class="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p class="text-sm">No waypoints found</p>
      </div>
      
      <div v-else class="space-y-1 p-1">
        <div
          v-for="waypoint in waypoints"
          :key="waypoint.id"
          class="p-1 rounded-lg cursor-pointer transition-all duration-200 hover:bg-(--sub-alt-color) border"
          :class="{
            'bg-(--sub-alt-color) border-(--main-color)': selectedWaypoint?.id === waypoint.id,
            'border-transparent': selectedWaypoint?.id !== waypoint.id
          }"
          @click="handleWaypointClick(waypoint)"
          @mouseenter="handleWaypointHover(waypoint)"
          @mouseleave="handleWaypointLeave"
        >
          <div class="flex items-start gap-2">
            <!-- Waypoint Icon -->
            <div
              class="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center"
              :style="{ backgroundColor: getWaypointColor(waypoint.type) + '20' }"
            >
              <Icon
                :name="getWaypointIcon(waypoint.type)"
                class="h-4 w-4"
                :style="{ color: getWaypointColor(waypoint.type) }"
              />
            </div>
            
            <!-- Waypoint Info -->
            <div class="flex-1 min-w-0">
              <div class="flex items-center justify-between gap-2">
                <h6 class="font-medium text-(--main-color) truncate">
                  {{ waypoint.name }}
                </h6>
                <span
                  class="text-xs px-2 py-1 rounded-full text-(--bg-color) font-medium"
                  :style="{ backgroundColor: getWaypointColor(waypoint.type) }"
                >
                  {{ getWaypointTypeLabel(waypoint.type) }}
                </span>
              </div>
              
              <p
                v-if="waypoint.description"
                class="text-sm text-(--sub-color) mt-1 line-clamp-2"
              >
                {{ waypoint.description }}
              </p>
              
              <!-- Distance and Elevation -->
              <div class="flex items-center gap-4 mt-2 text-xs text-(--sub-color)">
                <span class="flex items-center gap-1">
                  <Icon name="heroicons:map" class="h-3 w-3" />
                  {{ formatWaypointDistance(waypoint.distance) }}
                </span>
                
                <span
                  v-if="waypoint.elevation !== undefined"
                  class="flex items-center gap-1"
                >
                  <Icon name="heroicons:arrow-trending-up" class="h-3 w-3" />
                  {{ formatWaypointElevation(waypoint.elevation) }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
