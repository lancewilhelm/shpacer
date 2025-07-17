<script setup lang="ts">
import type { SelectCourse } from '~/utils/db/schema';
import type { Waypoint } from '~/utils/waypoints';
import { getWaypointColor } from '~/utils/waypoints';
import { formatDistance } from '~/utils/courseMetrics';

interface Props {
  open: boolean;
  course: SelectCourse | null;
  waypoints: Waypoint[];
  geoJsonData: GeoJSON.FeatureCollection[];
}

interface Emits {
  'close': [];
  'course-updated': [course: SelectCourse];
  'waypoint-updated': [waypoint: Waypoint];
  'waypoint-deleted': [waypointId: string];
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const userSettingsStore = useUserSettingsStore();

// Tab state
const activeTab = ref<'course' | 'waypoints'>('course');

// Course edit state
const editName = ref('');
const editDescription = ref('');
const editRaceDate = ref('');
const editStartTime = ref('');
const isUpdating = ref(false);
const updateError = ref('');

// Waypoint edit state
const editableWaypoints = ref<Waypoint[]>([]);
const selectedWaypointForEdit = ref<Waypoint | null>(null);
const originalWaypointState = ref<Waypoint | null>(null); // Store original state for reset
const editingWaypointDistance = ref<string>('');
const editingStepSize = ref<number>(0.1); // Default step size in user's preferred units
const preventMapCentering = ref<boolean>(false);
const stableMapCenter = ref<[number, number] | null>(null); // Stable center during edits
const waypointUpdateError = ref('');
const updatingWaypointIds = ref<Set<string>>(new Set());
const deletingWaypointIds = ref<Set<string>>(new Set());

// Initialize form data when course changes
watchEffect(() => {
  if (props.course) {
    editName.value = props.course.name;
    editDescription.value = props.course.description || '';
    
    const raceDate = props.course.raceDate;
    if (raceDate) {
      const dateObj = new Date(raceDate);
      const year = dateObj.getUTCFullYear();
      const month = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
      const day = String(dateObj.getUTCDate()).padStart(2, '0');
      editRaceDate.value = `${year}-${month}-${day}`;
      
      const hours = String(dateObj.getUTCHours()).padStart(2, '0');
      const minutes = String(dateObj.getUTCMinutes()).padStart(2, '0');
      editStartTime.value = `${hours}:${minutes}`;
    } else {
      editRaceDate.value = '';
      editStartTime.value = '';
    }
  }
});

// Initialize waypoints when they change
watchEffect(() => {
  editableWaypoints.value = [...props.waypoints];
});

// Initialize distance input when waypoint selection changes
watch(selectedWaypointForEdit, (newWaypoint) => {
  if (newWaypoint) {
    // Convert from meters to user's preferred units
    const distanceInUserUnits = userSettingsStore.settings.units.distance === 'miles' 
      ? newWaypoint.distance * 0.000621371 // Convert meters to miles
      : newWaypoint.distance; // Keep in meters
    editingWaypointDistance.value = distanceInUserUnits.toFixed(userSettingsStore.settings.units.distance === 'miles' ? 3 : 0);
  } else {
    editingWaypointDistance.value = '';
  }
});

// Watch for tab changes to invalidate map size
watch(activeTab, (newTab) => {
  if (newTab === 'waypoints') {
    // Give the DOM time to render the waypoints tab
    nextTick(() => {
      // Force Leaflet to recalculate map size after tab switch
      setTimeout(() => {
        if (import.meta.client) {
          // Try to find the map instance and invalidate its size
          const mapElement = document.querySelector('.leaflet-container') as HTMLElement & { _leaflet_map?: { invalidateSize: () => void } };
          if (mapElement && mapElement._leaflet_map) {
            mapElement._leaflet_map.invalidateSize();
          }
        }
      }, 100);
    });
  }
});

// Watch for modal opening to ensure map size is correct
watch(() => props.open, (isOpen) => {
  if (isOpen) {
    // Give time for modal to fully open and render
    nextTick(() => {
      setTimeout(() => {
        if (import.meta.client && activeTab.value === 'waypoints') {
          const mapElement = document.querySelector('.leaflet-container') as HTMLElement & { _leaflet_map?: { invalidateSize: () => void } };
          if (mapElement && mapElement._leaflet_map) {
            mapElement._leaflet_map.invalidateSize();
          }
        }
      }, 200);
    });
  }
});

// Computed properties for map display
const mapCenter = computed((): [number, number] => {
  // Use stable center during waypoint editing to prevent map jumping
  if (stableMapCenter.value) {
    return stableMapCenter.value;
  }
  
  if (selectedWaypointForEdit.value && !preventMapCentering.value) {
    return [selectedWaypointForEdit.value.lat, selectedWaypointForEdit.value.lng];
  }
  
  // Default to first waypoint or course center
  if (editableWaypoints.value.length > 0) {
    const firstWaypoint = editableWaypoints.value[0];
    if (firstWaypoint && firstWaypoint.lat !== 0 && firstWaypoint.lng !== 0) {
      return [firstWaypoint.lat, firstWaypoint.lng];
    }
  }
  
  // If we have geo data, try to extract center from it
  if (props.geoJsonData.length > 0) {
    const geoJson = props.geoJsonData[0];
    if (geoJson && geoJson.features.length > 0) {
      const firstFeature = geoJson.features[0];
      if (firstFeature && firstFeature.geometry.type === 'LineString') {
        const coords = firstFeature.geometry.coordinates[0];
        if (coords && coords.length >= 2 && typeof coords[0] === 'number' && typeof coords[1] === 'number') {
          return [coords[1], coords[0]]; // Note: GeoJSON is [lng, lat], Leaflet expects [lat, lng]
        }
      } else if (firstFeature && firstFeature.geometry.type === 'Point') {
        const coords = firstFeature.geometry.coordinates;
        if (coords && coords.length >= 2 && typeof coords[0] === 'number' && typeof coords[1] === 'number') {
          return [coords[1], coords[0]];
        }
      }
    }
  }
  
  // Fallback center - California coordinates since this appears to be a trail race
  return [39.1612, -120.7401]; // Nevada City, CA area
});

const mapZoom = computed((): number => {
  if (selectedWaypointForEdit.value) {
    return 15; // Closer zoom when a waypoint is selected (regardless of preventMapCentering)
  }
  return 10; // Default zoom to show course overview
});

function closeModal() {
  updateError.value = '';
  waypointUpdateError.value = '';
  updatingWaypointIds.value.clear();
  deletingWaypointIds.value.clear();
  
  // Reset waypoint editing state
  if (originalWaypointState.value && selectedWaypointForEdit.value) {
    const index = editableWaypoints.value.findIndex(w => w.id === selectedWaypointForEdit.value?.id);
    if (index !== -1) {
      editableWaypoints.value[index] = { ...originalWaypointState.value };
    }
  }
  
  selectedWaypointForEdit.value = null;
  originalWaypointState.value = null;
  stableMapCenter.value = null;
  preventMapCentering.value = false;
  activeTab.value = 'course';
  emit('close');
}

async function saveCourseChanges() {
  if (!props.course || !editName.value.trim()) {
    return;
  }

  isUpdating.value = true;
  updateError.value = '';

  try {
    let raceDateTime = null;
    if (editRaceDate.value) {
      const time = editStartTime.value || '00:00';
      raceDateTime = `${editRaceDate.value}T${time}:00`;
    }

    const response = await $fetch<{ course: SelectCourse }>(`/api/courses/${props.course.id}`, {
      method: 'PUT',
      body: {
        name: editName.value.trim(),
        description: editDescription.value.trim() || undefined,
        raceDate: raceDateTime,
      },
    });

    emit('course-updated', response.course);
  } catch (error) {
    console.error('Error updating course:', error);
    updateError.value = 'Failed to update course. Please try again.';
  } finally {
    isUpdating.value = false;
  }
}

async function updateWaypoint(waypoint: Waypoint) {
  if (!props.course) return;

  updatingWaypointIds.value.add(waypoint.id);
  waypointUpdateError.value = '';

  try {
    const response = await $fetch<{ waypoint: Waypoint }>(`/api/courses/${props.course.id}/waypoints`, {
      method: 'PUT',
      body: {
        id: waypoint.id,
        name: waypoint.name,
        distance: waypoint.distance,
        lat: waypoint.lat,
        lng: waypoint.lng,
      },
    });

    // Update the local waypoint
    const index = editableWaypoints.value.findIndex(w => w.id === waypoint.id);
    if (index !== -1) {
      editableWaypoints.value[index] = response.waypoint;
    }

    emit('waypoint-updated', response.waypoint);
  } catch (error) {
    console.error('Error updating waypoint:', error);
    waypointUpdateError.value = `Failed to update waypoint "${waypoint.name}". Please try again.`;
  } finally {
    updatingWaypointIds.value.delete(waypoint.id);
  }
}

async function deleteWaypoint(waypoint: Waypoint) {
  if (!props.course) return;
  
  // Don't allow deleting start/finish waypoints
  if (waypoint.type === 'start' || waypoint.type === 'finish') {
    waypointUpdateError.value = 'Cannot delete start or finish waypoints.';
    return;
  }

  const confirmed = confirm(`Are you sure you want to delete waypoint "${waypoint.name}"?`);
  if (!confirmed) return;

  deletingWaypointIds.value.add(waypoint.id);
  waypointUpdateError.value = '';

  try {
    await $fetch(`/api/courses/${props.course.id}/waypoints/${waypoint.id}`, {
      method: 'DELETE',
    });

    // Remove from local array
    const index = editableWaypoints.value.findIndex(w => w.id === waypoint.id);
    if (index !== -1) {
      editableWaypoints.value.splice(index, 1);
    }

    // Clear selection if this waypoint was selected
    if (selectedWaypointForEdit.value?.id === waypoint.id) {
      selectedWaypointForEdit.value = null;
    }

    emit('waypoint-deleted', waypoint.id);
  } catch (error) {
    console.error('Error deleting waypoint:', error);
    waypointUpdateError.value = `Failed to delete waypoint "${waypoint.name}". Please try again.`;
  } finally {
    deletingWaypointIds.value.delete(waypoint.id);
  }
}

function selectWaypointForEdit(waypoint: Waypoint) {
  // Store the original state for potential reset
  originalWaypointState.value = { ...waypoint };
  
  // Set stable map center to current view to prevent jumping
  if (!stableMapCenter.value) {
    stableMapCenter.value = [waypoint.lat, waypoint.lng];
  }
  
  selectedWaypointForEdit.value = waypoint;
}

function clearWaypointSelection() {
  // Reset waypoint to original state if it wasn't saved
  if (originalWaypointState.value && selectedWaypointForEdit.value) {
    const index = editableWaypoints.value.findIndex(w => w.id === selectedWaypointForEdit.value?.id);
    if (index !== -1) {
      // Reset to original position
      editableWaypoints.value[index] = { ...originalWaypointState.value };
    }
  }
  
  // Clear state
  selectedWaypointForEdit.value = null;
  originalWaypointState.value = null;
  stableMapCenter.value = null;
  preventMapCentering.value = false;
}

function handleMapWaypointClick(waypoint: Waypoint) {
  selectWaypointForEdit(waypoint);
}

function handleMapLineClick(coords: { lat: number; lng: number }) {
  if (!selectedWaypointForEdit.value) return;
  
  // Set stable map center if not already set
  if (!stableMapCenter.value) {
    stableMapCenter.value = [selectedWaypointForEdit.value.lat, selectedWaypointForEdit.value.lng];
  }
  
  // Set flag to prevent map centering during line click placement
  preventMapCentering.value = true;
  
  // Calculate the distance along the route for the clicked position
  const distanceAtClick = calculateDistanceFromPosition(coords.lat, coords.lng);
  if (distanceAtClick !== null) {
    // Update the waypoint to this position
    selectedWaypointForEdit.value.lat = coords.lat;
    selectedWaypointForEdit.value.lng = coords.lng;
    selectedWaypointForEdit.value.distance = distanceAtClick;
    selectedWaypointForEdit.value.order = Math.floor(distanceAtClick);
    
    // Update the distance input field in user's preferred units
    const distanceInUserUnits = userSettingsStore.settings.units.distance === 'miles' 
      ? distanceAtClick * 0.000621371 // Convert meters to miles
      : distanceAtClick; // Keep in meters
    editingWaypointDistance.value = distanceInUserUnits.toFixed(userSettingsStore.settings.units.distance === 'miles' ? 3 : 0);
  }
  
  // Reset the flag after a short delay to allow normal centering again
  setTimeout(() => {
    preventMapCentering.value = false;
  }, 100);
}

function calculateDistanceFromPosition(lat: number, lng: number): number | null {
  if (!props.geoJsonData.length) return null;
  
  const geoJson = props.geoJsonData[0];
  if (!geoJson?.features?.length) return null;
  
  const feature = geoJson.features.find(f => f.geometry.type === 'LineString');
  if (!feature || feature.geometry.type !== 'LineString') return null;
  
  const coordinates = feature.geometry.coordinates;
  if (!coordinates.length) return null;
  
  let totalDistance = 0;
  let closestDistance = 0;
  let minDistanceToPoint = Infinity;
  
  for (let i = 0; i < coordinates.length - 1; i++) {
    const coord1 = coordinates[i];
    const coord2 = coordinates[i + 1];
    
    if (!coord1 || !coord2 || coord1.length < 2 || coord2.length < 2) continue;
    
    // Calculate distance from clicked point to this segment
    const distanceToSegment = distanceFromPointToLineSegment(
      lat, lng,
      coord1[1] as number, coord1[0] as number,
      coord2[1] as number, coord2[0] as number
    );
    
    if (distanceToSegment.distance < minDistanceToPoint) {
      minDistanceToPoint = distanceToSegment.distance;
      closestDistance = totalDistance + distanceToSegment.distanceAlongSegment;
    }
    
    // Add segment distance to total
    const segmentDistance = calculateDistanceBetweenPoints(
      coord1[1] as number, coord1[0] as number,
      coord2[1] as number, coord2[0] as number
    );
    totalDistance += segmentDistance;
  }
  
  return closestDistance;
}

function distanceFromPointToLineSegment(
  px: number, py: number,
  x1: number, y1: number,
  x2: number, y2: number
): { distance: number; distanceAlongSegment: number } {
  // Convert to a simple 2D distance calculation for simplicity
  // This is approximate but should work for small segments
  
  const A = px - x1;
  const B = py - y1;
  const C = x2 - x1;
  const D = y2 - y1;
  
  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  
  if (lenSq === 0) {
    // The segment is actually a point
    const distance = calculateDistanceBetweenPoints(px, py, x1, y1);
    return { distance, distanceAlongSegment: 0 };
  }
  
  let param = dot / lenSq;
  
  let xx: number, yy: number;
  
  if (param < 0) {
    xx = x1;
    yy = y1;
    param = 0;
  } else if (param > 1) {
    xx = x2;
    yy = y2;
    param = 1;
  } else {
    xx = x1 + param * C;
    yy = y1 + param * D;
  }
  
  const distance = calculateDistanceBetweenPoints(px, py, xx, yy);
  const segmentLength = calculateDistanceBetweenPoints(x1, y1, x2, y2);
  const distanceAlongSegment = param * segmentLength;
  
  return { distance, distanceAlongSegment };
}

function calculatePositionFromDistance(distance: number): { lat: number; lng: number } | null {
  if (!props.geoJsonData.length) return null;
  
  const geoJson = props.geoJsonData[0];
  if (!geoJson?.features?.length) return null;
  
  const feature = geoJson.features.find(f => f.geometry.type === 'LineString');
  if (!feature || feature.geometry.type !== 'LineString') return null;
  
  const coordinates = feature.geometry.coordinates;
  if (!coordinates.length) return null;
  
  // If distance is 0 or negative, return first point
  if (distance <= 0) {
    const firstCoord = coordinates[0];
    if (!firstCoord || firstCoord.length < 2) return null;
    return { lat: firstCoord[1] as number, lng: firstCoord[0] as number };
  }
  
  let totalDistance = 0;
  let previousCoord = coordinates[0];
  if (!previousCoord || previousCoord.length < 2) return null;
  
  for (let i = 1; i < coordinates.length; i++) {
    const currentCoord = coordinates[i];
    if (!currentCoord || currentCoord.length < 2) continue;
    
    // Calculate distance between points using Haversine formula
    const segmentDistance = calculateDistanceBetweenPoints(
      previousCoord[1] as number, previousCoord[0] as number, // lat, lng of previous point
      currentCoord[1] as number, currentCoord[0] as number    // lat, lng of current point
    );
    
    if (totalDistance + segmentDistance >= distance) {
      // The target distance falls within this segment
      const remainingDistance = distance - totalDistance;
      const ratio = remainingDistance / segmentDistance;
      
      // Interpolate between the two points
      const lat = (previousCoord[1] as number) + ((currentCoord[1] as number) - (previousCoord[1] as number)) * ratio;
      const lng = (previousCoord[0] as number) + ((currentCoord[0] as number) - (previousCoord[0] as number)) * ratio;
      
      return { lat, lng };
    }
    
    totalDistance += segmentDistance;
    previousCoord = currentCoord;
  }
  
  // If distance exceeds route length, return last point
  const lastCoord = coordinates[coordinates.length - 1];
  if (!lastCoord || lastCoord.length < 2) return null;
  return { lat: lastCoord[1] as number, lng: lastCoord[0] as number };
}

function calculateDistanceBetweenPoints(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000; // Earth's radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng/2) * Math.sin(dLng/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

function adjustWaypointDistance(waypoint: Waypoint, direction: 'up' | 'down') {
  // Set stable map center if not already set
  if (!stableMapCenter.value && waypoint) {
    stableMapCenter.value = [waypoint.lat, waypoint.lng];
  }
  
  // Set flag to prevent map centering during nudge
  preventMapCentering.value = true;
  
  // Convert step size from user units to meters
  const stepSizeInMeters = userSettingsStore.settings.units.distance === 'miles'
    ? editingStepSize.value * 1609.34 // Convert miles to meters
    : editingStepSize.value; // Already in meters
  
  const adjustment = direction === 'up' ? -stepSizeInMeters : stepSizeInMeters;
  const newDistance = Math.max(0, waypoint.distance + adjustment);
  
  // Calculate new position based on distance
  const newPosition = calculatePositionFromDistance(newDistance);
  if (newPosition) {
    // Update the waypoint locally (this will affect the map display)
    waypoint.distance = newDistance;
    waypoint.order = Math.floor(newDistance);
    waypoint.lat = newPosition.lat;
    waypoint.lng = newPosition.lng;
    
    // Update the distance input field in user's preferred units
    const distanceInUserUnits = userSettingsStore.settings.units.distance === 'miles' 
      ? newDistance * 0.000621371 // Convert meters to miles
      : newDistance; // Keep in meters
    editingWaypointDistance.value = distanceInUserUnits.toFixed(userSettingsStore.settings.units.distance === 'miles' ? 3 : 0);
  }
  
  // Reset the flag after a short delay to allow normal centering again
  setTimeout(() => {
    preventMapCentering.value = false;
  }, 100);
}

function updateWaypointFromDistanceInput() {
  if (!selectedWaypointForEdit.value) return;
  
  // Set stable map center if not already set
  if (!stableMapCenter.value) {
    stableMapCenter.value = [selectedWaypointForEdit.value.lat, selectedWaypointForEdit.value.lng];
  }
  
  // Set flag to prevent map centering during distance input update
  preventMapCentering.value = true;
  
  const inputDistance = parseFloat(editingWaypointDistance.value);
  if (isNaN(inputDistance) || inputDistance < 0) {
    // Reset to current distance if invalid
    const distanceInUserUnits = userSettingsStore.settings.units.distance === 'miles' 
      ? selectedWaypointForEdit.value.distance * 0.000621371 // Convert meters to miles
      : selectedWaypointForEdit.value.distance; // Keep in meters
    editingWaypointDistance.value = distanceInUserUnits.toFixed(userSettingsStore.settings.units.distance === 'miles' ? 3 : 0);
    
    // Reset the flag
    setTimeout(() => {
      preventMapCentering.value = false;
    }, 100);
    return;
  }
  
  // Convert from user units to meters
  const newDistanceInMeters = userSettingsStore.settings.units.distance === 'miles'
    ? inputDistance * 1609.34 // Convert miles to meters
    : inputDistance; // Already in meters
  
  // Calculate new position based on distance
  const newPosition = calculatePositionFromDistance(newDistanceInMeters);
  if (newPosition) {
    // Update the waypoint locally
    selectedWaypointForEdit.value.distance = newDistanceInMeters;
    selectedWaypointForEdit.value.order = Math.floor(newDistanceInMeters);
    selectedWaypointForEdit.value.lat = newPosition.lat;
    selectedWaypointForEdit.value.lng = newPosition.lng;
  }
  
  // Reset the flag after a short delay to allow normal centering again
  setTimeout(() => {
    preventMapCentering.value = false;
  }, 100);
}

function saveWaypointChanges() {
  if (!selectedWaypointForEdit.value) return;
  
  // Clear original state since we're saving
  originalWaypointState.value = null;
  
  updateWaypoint(selectedWaypointForEdit.value);
}

function canMoveUp(waypoint: Waypoint): boolean {
  if (waypoint.type === 'start') return false;
  return waypoint.distance > 100; // Minimum distance from start
}

function canMoveDown(waypoint: Waypoint): boolean {
  if (waypoint.type === 'finish') return false;
  const course = props.course;
  if (!course?.totalDistance) return true;
  return waypoint.distance < (course.totalDistance - 100); // Minimum distance from finish
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
  <ModalWindow 
    :open="open" 
    width="95vw"
    height="90vh"
    @close="closeModal"
  >
    <div class="w-full h-full flex flex-col">
      <!-- Header -->
      <div class="flex items-center justify-between mb-6">
        <h2 class="text-2xl font-bold text-(--main-color)">Edit Course</h2>
        <button
          class="p-2 text-(--sub-color) hover:text-(--main-color) transition-colors"
          @click="closeModal"
        >
          <Icon name="heroicons:x-mark" class="h-6 w-6" />
        </button>
      </div>

      <!-- Tabs -->
      <div class="flex border-b border-(--sub-color) mb-6">
        <button
          class="px-4 py-2 font-medium transition-colors border-b-2"
          :class="activeTab === 'course' 
            ? 'text-(--main-color) border-(--main-color)' 
            : 'text-(--sub-color) border-transparent hover:text-(--main-color)'"
          @click="activeTab = 'course'"
        >
          Course Details
        </button>
        <button
          class="px-4 py-2 font-medium transition-colors border-b-2"
          :class="activeTab === 'waypoints' 
            ? 'text-(--main-color) border-(--main-color)' 
            : 'text-(--sub-color) border-transparent hover:text-(--main-color)'"
          @click="activeTab = 'waypoints'"
        >
          Waypoints
        </button>
      </div>

      <!-- Course Details Tab -->
      <div v-if="activeTab === 'course'" class="flex-1 overflow-hidden">
        <div v-if="updateError" class="mb-4 p-3 bg-(--error-color) bg-opacity-10 border border-(--error-color) rounded-lg">
          <p class="text-(--error-color) text-sm">{{ updateError }}</p>
        </div>

        <div class="space-y-4 max-h-96 overflow-y-auto">
          <div>
            <label class="block text-sm font-medium text-(--main-color) mb-2">
              Course Name *
            </label>
            <input
              v-model="editName"
              type="text"
              required
              class="w-full px-3 py-2 border border-(--sub-color) rounded-lg bg-(--bg-color) text-(--main-color) focus:border-(--main-color)"
              placeholder="Enter course name"
            />
          </div>

          <div>
            <label class="block text-sm font-medium text-(--main-color) mb-2">
              Description
            </label>
            <textarea
              v-model="editDescription"
              rows="3"
              class="w-full px-3 py-2 border border-(--sub-color) rounded-lg bg-(--bg-color) text-(--main-color) focus:border-(--main-color)"
              placeholder="Enter course description (optional)"
            />
          </div>

          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-(--main-color) mb-2">
                Race Date
              </label>
              <input
                v-model="editRaceDate"
                type="date"
                class="w-full px-3 py-2 border border-(--sub-color) rounded-lg bg-(--bg-color) text-(--main-color) focus:border-(--main-color)"
              />
            </div>
            <div>
              <label class="block text-sm font-medium text-(--main-color) mb-2">
                Start Time
              </label>
              <input
                v-model="editStartTime"
                type="time"
                class="w-full px-3 py-2 border border-(--sub-color) rounded-lg bg-(--bg-color) text-(--main-color) focus:border-(--main-color)"
              />
            </div>
          </div>

          <div class="flex justify-end pt-4">
            <button
              class="px-4 py-2 bg-(--main-color) text-(--bg-color) rounded-lg hover:opacity-80 transition-opacity disabled:opacity-50"
              :disabled="isUpdating"
              @click="saveCourseChanges"
            >
              {{ isUpdating ? 'Saving...' : 'Save Course Changes' }}
            </button>
          </div>
        </div>
      </div>

      <!-- Waypoints Tab -->
      <div v-if="activeTab === 'waypoints'" class="flex-1 overflow-hidden flex gap-4 h-full">
        <!-- Left Panel: Map -->
          <div class="h-full w-full rounded-lg overflow-hidden border border-(--sub-color) bg-gray-100">
            <ClientOnly>
              <LeafletMap
                :geo-json-data="geoJsonData"
                :center="mapCenter"
                :zoom="mapZoom"
                :waypoints="editableWaypoints"
                :selected-waypoint="selectedWaypointForEdit"
                :auto-zoom-to-waypoint="!preventMapCentering"
                @waypoint-click="handleMapWaypointClick"
                @line-click="handleMapLineClick"
              />
              <template #fallback>
                <div class="w-full h-full bg-red-200 rounded-lg flex items-center justify-center">
                  <div class="text-center">
                    <Icon name="svg-spinners:6-dots-scale" class="text-(--main-color) scale-200 mb-2" />
                    <p class="text-(--sub-color)">Loading map...</p>
                  </div>
                </div>
              </template>
            </ClientOnly>
          </div>

        <!-- Right Panel: Waypoint List or Edit -->
        <div class="w-80 flex flex-col">
          <div v-if="waypointUpdateError" class="mb-4 p-3 bg-(--error-color) bg-opacity-10 border border-(--error-color) rounded-lg">
            <p class="text-(--error-color) text-sm">{{ waypointUpdateError }}</p>
          </div>

          <!-- Waypoint Edit Panel -->
          <div v-if="selectedWaypointForEdit" class="flex-1 overflow-hidden">
            <div class="flex items-center justify-between mb-4">
              <h3 class="text-lg font-semibold text-(--main-color)">Edit Waypoint</h3>
              <button
                class="p-1 text-(--sub-color) hover:text-(--main-color) transition-colors"
                @click="clearWaypointSelection"
              >
                <Icon name="heroicons:x-mark" class="h-5 w-5" />
              </button>
            </div>

            <div class="space-y-4">
              <!-- Waypoint Type Badge -->
              <div class="flex items-center gap-3">
                <div
                  class="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white"
                  :style="{ backgroundColor: getWaypointColor(selectedWaypointForEdit.type) }"
                >
                  {{ editableWaypoints.findIndex(w => w.id === selectedWaypointForEdit?.id) + 1 }}
                </div>
                <span
                  class="text-xs px-2 py-1 rounded-full text-(--bg-color) font-medium"
                  :style="{ backgroundColor: getWaypointColor(selectedWaypointForEdit.type) }"
                >
                  {{ getWaypointTypeLabel(selectedWaypointForEdit.type) }}
                </span>
              </div>

              <!-- Name -->
              <div>
                <label class="block text-sm font-medium text-(--main-color) mb-2">
                  Waypoint Name
                </label>
                <input
                  v-model="selectedWaypointForEdit.name"
                  type="text"
                  class="w-full px-3 py-2 border border-(--sub-color) rounded-lg bg-(--bg-color) text-(--main-color) focus:border-(--main-color)"
                  @blur="updateWaypoint(selectedWaypointForEdit)"
                />
              </div>

              <!-- Distance -->
              <div>
                <label class="block text-sm font-medium text-(--main-color) mb-2">
                  Distance on Course
                </label>
                
                <!-- Current Distance Display -->
                <div class="mb-2 text-sm text-(--sub-color) bg-(--sub-alt-color) px-3 py-2 rounded-lg">
                  Current: {{ formatDistance(selectedWaypointForEdit.distance, userSettingsStore.settings.units.distance) }}
                </div>
                
                <!-- Distance Input -->
                <div class="flex items-center gap-2 mb-2">
                  <input
                    v-model="editingWaypointDistance"
                    type="number"
                    min="0"
                    :step="userSettingsStore.settings.units.distance === 'miles' ? '0.001' : '1'"
                    class="flex-1 px-3 py-2 border border-(--sub-color) rounded-lg bg-(--bg-color) text-(--main-color) focus:border-(--main-color)"
                    :placeholder="`Enter distance in ${userSettingsStore.settings.units.distance}`"
                    @blur="updateWaypointFromDistanceInput"
                    @keyup.enter="updateWaypointFromDistanceInput"
                  />
                  <button
                    class="px-3 py-2 bg-(--main-color) text-(--bg-color) rounded-lg hover:opacity-80 transition-opacity text-sm"
                    @click="updateWaypointFromDistanceInput"
                  >
                    Update
                  </button>
                </div>
                
                <!-- Step Size Control -->
                <div class="flex items-center gap-2 mb-2">
                  <label class="text-xs text-(--sub-color) whitespace-nowrap">Step size:</label>
                  <input
                    v-model.number="editingStepSize"
                    type="number"
                    min="0.001"
                    :step="userSettingsStore.settings.units.distance === 'miles' ? '0.001' : '1'"
                    class="w-20 px-2 py-1 text-xs border border-(--sub-color) rounded bg-(--bg-color) text-(--main-color) focus:border-(--main-color)"
                  />
                  <span class="text-xs text-(--sub-color)">{{ userSettingsStore.settings.units.distance }}</span>
                </div>
                
                <!-- Quick Adjustment Buttons -->
                <div class="flex items-center gap-1 mb-2">
                  <button
                    class="p-2 text-(--sub-color) hover:text-(--main-color) transition-colors disabled:opacity-50 disabled:cursor-not-allowed border border-(--sub-color) rounded"
                    :disabled="!canMoveUp(selectedWaypointForEdit) || updatingWaypointIds.has(selectedWaypointForEdit.id)"
                    :title="`Move waypoint up ${editingStepSize} ${userSettingsStore.settings.units.distance}`"
                    @click="adjustWaypointDistance(selectedWaypointForEdit, 'up')"
                  >
                    <Icon name="heroicons:arrow-up" />
                  </button>
                  <button
                    class="p-2 text-(--sub-color) hover:text-(--main-color) transition-colors disabled:opacity-50 disabled:cursor-not-allowed border border-(--sub-color) rounded"
                    :disabled="!canMoveDown(selectedWaypointForEdit) || updatingWaypointIds.has(selectedWaypointForEdit.id)"
                    :title="`Move waypoint down ${editingStepSize} ${userSettingsStore.settings.units.distance}`"
                    @click="adjustWaypointDistance(selectedWaypointForEdit, 'down')"
                  >
                    <Icon name="heroicons:arrow-down" />
                  </button>
                  <span class="text-xs text-(--sub-color) ml-2">±{{ editingStepSize }} {{ userSettingsStore.settings.units.distance }}</span>
                </div>
                
                <!-- Save Button -->
                <button
                  class="w-full px-3 py-2 bg-(--main-color) text-(--bg-color) rounded-lg hover:opacity-80 transition-opacity disabled:opacity-50"
                  :disabled="updatingWaypointIds.has(selectedWaypointForEdit.id)"
                  @click="saveWaypointChanges"
                >
                  {{ updatingWaypointIds.has(selectedWaypointForEdit.id) ? 'Saving...' : 'Save Changes' }}
                </button>
                
                <p class="text-xs text-(--sub-color) mt-2">
                  Enter a distance, use arrow buttons for quick adjustments, or click on the route line to place the waypoint
                </p>
              </div>

              <!-- Delete Button -->
              <div v-if="selectedWaypointForEdit.type === 'waypoint' || selectedWaypointForEdit.type === 'poi'" class="pt-4 border-t border-(--sub-color)">
                <button
                  class="w-full px-3 py-2 border border-(--error-color) text-(--error-color) rounded-lg hover:bg-(--error-color) hover:text-(--bg-color) transition-colors disabled:opacity-50"
                  :disabled="deletingWaypointIds.has(selectedWaypointForEdit.id)"
                  @click="deleteWaypoint(selectedWaypointForEdit)"
                >
                  <Icon name="heroicons:trash" class="h-4 w-4 mr-2" />
                  {{ deletingWaypointIds.has(selectedWaypointForEdit.id) ? 'Deleting...' : 'Delete Waypoint' }}
                </button>
              </div>

              <!-- Update Status -->
              <div v-if="updatingWaypointIds.has(selectedWaypointForEdit.id)" class="flex items-center gap-2 text-xs text-(--sub-color)">
                <Icon name="svg-spinners:6-dots-scale" class="h-3 w-3" />
                <span>Updating...</span>
              </div>
            </div>
          </div>

          <!-- Waypoint List -->
          <div v-else class="h-full max-h-full flex-col flex-1 overflow-hidden">
            <div class="h-full overflow-y-auto">
              <div
                v-for="(waypoint, index) in editableWaypoints"
                :key="waypoint.id"
                class="p-1 rounded-lg cursor-pointer border border-(--bg-color) hover:border-(--main-color) transition-colors"
                @click="selectWaypointForEdit(waypoint)"
              >
                <div class="flex items-center gap-2">
                  <!-- Number -->
                  <div
                    class="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white"
                    :style="{ backgroundColor: getWaypointColor(waypoint.type) }"
                  >
                    {{ index + 1 }}
                  </div>

                  <!-- Info -->
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center justify-between">
                      <h6 class="font-medium text-(--main-color) truncate">{{ waypoint.name }}</h6>
                      <button
                        v-if="waypoint.type === 'waypoint' || waypoint.type === 'poi'"
                        class="p-1! text-(--error-color) hover:bg-(--error-color) hover:text-(--bg-color) rounded transition-colors"
                        :disabled="deletingWaypointIds.has(waypoint.id)"
                        title="Delete waypoint"
                        @click.stop="deleteWaypoint(waypoint)"
                      >
                        <Icon name="heroicons:trash" class="h-3 w-3" />
                      </button>
                    </div>
                    <div class="text-xs text-(--sub-color)">
                      {{ formatDistance(waypoint.distance, userSettingsStore.settings.units.distance) }}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </ModalWindow>
</template>