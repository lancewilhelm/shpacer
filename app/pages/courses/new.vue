<script setup lang="ts">
import type { SelectCourse } from '~/utils/db/schema';

definePageMeta({
  auth: {
    only: "user",
    redirectGuestTo: "/login",
  },
});

useHead({
  title: "New Course",
});

interface ProcessedFile {
  name: string;
  originalContent: string;
  fileType: 'gpx' | 'tcx';
  geoJson: GeoJSON.FeatureCollection;
}

const processedFile = ref<ProcessedFile | null>(null);
const courseName = ref('');
const courseDescription = ref('');
const raceDate = ref('');
const startTime = ref('');
const isCreating = ref(false);
const createError = ref('');

function onFileProcessed(file: ProcessedFile) {
  processedFile.value = file;
  // Auto-fill course name from filename (without extension)
  if (!courseName.value) {
    courseName.value = file.name.replace(/\.(gpx|tcx)$/i, '');
  }
}

function onFileRemoved() {
  processedFile.value = null;
  courseName.value = '';
  courseDescription.value = '';
  raceDate.value = '';
  startTime.value = '';
}

async function createCourse() {
  if (!processedFile.value || !courseName.value.trim()) {
    return;
  }

  isCreating.value = true;
  createError.value = '';

  try {
    let raceDateTime = null;
    if (raceDate.value) {
      // Combine date and time into a single datetime value
      const time = startTime.value || "00:00";
      raceDateTime = `${raceDate.value}T${time}:00`;
    }

    const response = await $fetch<{ course: SelectCourse }>('/api/courses', {
      method: 'POST',
      body: {
        name: courseName.value.trim(),
        description: courseDescription.value.trim() || undefined,
        originalFileName: processedFile.value.name,
        originalFileContent: processedFile.value.originalContent,
        fileType: processedFile.value.fileType,
        geoJsonData: processedFile.value.geoJson,
        raceDate: raceDateTime,
      },
    });

    // Redirect to the new course page
    await navigateTo(`/courses/${response.course.id}`);
  } catch (error) {
    console.error('Error creating course:', error);
    createError.value = 'Failed to create course. Please try again.';
  } finally {
    isCreating.value = false;
  }
}

const canCreate = computed(() => {
  return processedFile.value && courseName.value.trim() && !isCreating.value;
});
</script>

<template>
  <div class="flex flex-col w-full h-full overflow-hidden">
    <AppHeader class="w-full" />
    
    <div class="w-full h-full p-4 flex flex-col gap-6 overflow-auto">
      <div class="flex items-center gap-4">
        <NuxtLink
          to="/courses"
          class="p-2 text-(--sub-color) hover:text-(--main-color) transition-colors"
        >
          <Icon name="heroicons:arrow-left" class="h-5 w-5" />
        </NuxtLink>
        <div>
          <h1 class="text-3xl font-bold text-(--main-color)">New Course</h1>
          <p class="text-(--sub-color) mt-1">Upload a GPX or TCX file and create a course</p>
        </div>
      </div>

      <div class="max-w-2xl mx-auto w-full space-y-6">
        <!-- File Upload Section -->
        <div>
          <h2 class="text-xl font-semibold text-(--main-color) mb-4">Upload File</h2>
          <FileUpload
            @file-processed="onFileProcessed"
            @file-removed="onFileRemoved"
          />
        </div>

        <!-- Course Details Section -->
        <div v-if="processedFile" class="space-y-4">
          <h2 class="text-xl font-semibold text-(--main-color)">Course Details</h2>
          
          <div>
            <label class="block text-sm font-medium text-(--main-color) mb-2">
              Course Name *
            </label>
            <input
              v-model="courseName"
              type="text"
              required
              placeholder="Enter course name"
              class="w-full px-3 py-2 border border-(--sub-color) rounded-lg bg-(--bg-color) text-(--main-color) placeholder-(--sub-color) focus:outline-none focus:border-(--main-color)"
            />
          </div>

          <div>
            <label class="block text-sm font-medium text-(--main-color) mb-2">
              Description
            </label>
            <textarea
              v-model="courseDescription"
              placeholder="Enter course description (optional)"
              rows="3"
              class="w-full px-3 py-2 border border-(--sub-color) rounded-lg bg-(--bg-color) text-(--main-color) placeholder-(--sub-color) focus:outline-none focus:border-(--main-color)"
            />
          </div>

          <div>
            <label class="block text-sm font-medium text-(--main-color) mb-2">
              Race Date
            </label>
            <input
              v-model="raceDate"
              type="date"
              class="w-full px-3 py-2 border border-(--sub-color) rounded-lg bg-(--bg-color) text-(--main-color) focus:outline-none focus:border-(--main-color)"
            />
          </div>

          <div>
            <label class="block text-sm font-medium text-(--main-color) mb-2">
              Start Time
            </label>
            <input
              v-model="startTime"
              type="time"
              class="w-full px-3 py-2 border border-(--sub-color) rounded-lg bg-(--bg-color) text-(--main-color) focus:outline-none focus:border-(--main-color)"
            />
            <p class="text-xs text-(--sub-color) mt-1">Optional: Set a start time if this course is for a specific race</p>
          </div>

          <div v-if="createError" class="p-4 bg-(--error-color) bg-opacity-10 border border-(--error-color) rounded-lg">
            <p class="text-(--error-color) text-sm">{{ createError }}</p>
          </div>

          <div class="flex items-center gap-4 pt-4">
            <button
              class="px-6 py-2 bg-(--main-color) text-(--bg-color) rounded-lg hover:opacity-80 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              :disabled="!canCreate"
              @click="createCourse"
            >
              <Icon
                v-if="isCreating"
                name="svg-spinners:6-dots-scale"
                class="h-4 w-4"
              />
              <Icon
                v-else
                name="heroicons:plus"
                class="h-4 w-4"
              />
              {{ isCreating ? 'Creating...' : 'Create Course' }}
            </button>
            
            <NuxtLink
              to="/courses"
              class="px-6 py-2 border border-(--sub-color) text-(--main-color) rounded-lg hover:bg-(--sub-alt-color) transition-colors"
            >
              Cancel
            </NuxtLink>
          </div>
        </div>

        <!-- File Preview Section -->
        <div v-if="processedFile" class="mt-8">
          <h2 class="text-xl font-semibold text-(--main-color) mb-4">Preview</h2>
          <div class="bg-(--sub-alt-color) border border-(--sub-color) rounded-lg p-4">
            <div class="flex items-center gap-3 mb-4">
              <Icon name="heroicons:document" class="h-5 w-5 text-(--main-color)" />
              <span class="text-(--main-color) font-medium">{{ processedFile.name }}</span>
              <span class="text-xs text-(--sub-color) uppercase bg-(--bg-color) px-2 py-1 rounded">
                {{ processedFile.fileType }}
              </span>
            </div>
            
            <div class="h-64 rounded-lg overflow-hidden">
              <ClientOnly>
                <LeafletMap
                  :geo-json-data="[processedFile.geoJson]"
                  :center="[0, 0]"
                  :zoom="10"
                />
                <template #fallback>
                  <div class="w-full h-full bg-(--sub-alt-color) rounded-lg flex items-center justify-center">
                    <div class="text-center">
                      <Icon name="svg-spinners:6-dots-scale" class="text-(--main-color) scale-200 mb-2" />
                      <p class="text-(--sub-color)">Loading map...</p>
                    </div>
                  </div>
                </template>
              </ClientOnly>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
