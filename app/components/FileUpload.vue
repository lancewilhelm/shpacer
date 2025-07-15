<script setup lang="ts">
import { useDropZone } from '@vueuse/core'
import * as togeojson from '@tmcw/togeojson'

interface UploadedFile {
  name: string
  geoJson: GeoJSON.FeatureCollection
}

interface ProcessedFile {
  name: string
  originalContent: string
  fileType: 'gpx' | 'tcx'
  geoJson: GeoJSON.FeatureCollection
}

const emit = defineEmits<{
  'files-processed': [files: UploadedFile[]]
  'file-added': [file: UploadedFile]
  'file-removed': [fileName: string]
  'file-processed': [file: ProcessedFile]
}>()

// Refs
const dropZoneRef = ref<HTMLDivElement>()
const fileInputRef = ref<HTMLInputElement>()

// State
const successMessage = ref('')
const errorMessage = ref('')
const uploadedFile = ref<UploadedFile | null>(null)
const processedFile = ref<ProcessedFile | null>(null)
const originalFileContent = ref<string>('')
const showGeoJsonModal = ref(false)

// Drop zone functionality
const { isOverDropZone } = useDropZone(dropZoneRef, {
  onDrop: handleFileDrop,
//   dataTypes: ['application/gpx+xml', 'application/vnd.garmin.tcx+xml', 'text/xml']
})

// File handling functions
function openFileDialog() {
  fileInputRef.value?.click()
}

function handleFileSelect(event: Event) {
  const target = event.target as HTMLInputElement
  if (target.files) {
    handleFiles(Array.from(target.files))
  }
}

function handleFileDrop(files: File[] | null) {
  if (files) {
    handleFiles(files)
  }
}

// Handle the file upload process
const isProcessing = ref(false)
const uploadSuccess = ref(false)
const uploadError = ref(false)

async function handleFiles(files: File[]) {
  // Reset states
  uploadSuccess.value = false
  uploadError.value = false
  isProcessing.value = true
  
  try {
    // Filter for GPX and TCX files
    const validFiles = files.filter(file => {
      const extension = file.name.toLowerCase().split('.').pop()
      return extension === 'gpx' || extension === 'tcx'
    })
    
    if (validFiles.length === 0) {
      throw new Error('No valid GPX or TCX files found')
    }
    
    // Process the first valid file
    const validFile = validFiles[0]
    if (!validFile) {
      throw new Error('No valid file found')
    }
    
    const originalContent = await readFileAsText(validFile)
    const geoJson = await processFile(validFile)
    
    const processedFileData: ProcessedFile = {
      name: validFile.name,
      originalContent,
      fileType: validFile.name.toLowerCase().endsWith('.gpx') ? 'gpx' : 'tcx',
      geoJson
    }
    
    const uploadedFileData: UploadedFile = {
      name: validFile.name,
      geoJson
    }
    
    processedFile.value = processedFileData
    uploadedFile.value = uploadedFileData
    originalFileContent.value = originalContent
    
    // Emit both events for backward compatibility
    emit('file-added', uploadedFileData)
    emit('file-processed', processedFileData)
    emit('files-processed', [uploadedFileData])
    
    // Success state
    uploadSuccess.value = true
    successMessage.value = 'Successfully processed file'
    
    // Reset success message after 3 seconds
    setTimeout(() => {
      uploadSuccess.value = false
      successMessage.value = ''
    }, 3000)
    
  } catch (error) {
    uploadError.value = true
    errorMessage.value = error instanceof Error ? error.message : 'An error occurred'
    
    // Reset error message after 5 seconds
    setTimeout(() => {
      uploadError.value = false
      errorMessage.value = ''
    }, 5000)
  } finally {
    isProcessing.value = false
    // Reset file input
    if (fileInputRef.value) {
      fileInputRef.value.value = ''
    }
  }
}

async function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => resolve(e.target?.result as string)
    reader.onerror = () => reject(new Error(`Error reading ${file.name}`))
    reader.readAsText(file)
  })
}

async function processFile(file: File): Promise<GeoJSON.FeatureCollection> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    
    reader.onload = (e) => {
      try {
        const xmlString = e.target?.result as string
        const parser = new DOMParser()
        const xmlDoc = parser.parseFromString(xmlString, 'text/xml')
        
        // Check for parsing errors
        const parserError = xmlDoc.querySelector('parsererror')
        if (parserError) {
          throw new Error('Invalid XML file')
        }
        
        let geoJson
        const extension = file.name.toLowerCase().split('.').pop()
        
        if (extension === 'gpx') {
          geoJson = togeojson.gpx(xmlDoc)
        } else if (extension === 'tcx') {
          geoJson = togeojson.tcx(xmlDoc)
        } else {
          throw new Error('Unsupported file format')
        }
        
        // Validate GeoJSON
        if (!geoJson || !geoJson.features || geoJson.features.length === 0) {
          throw new Error('No valid track data found in file')
        }
        
        resolve(geoJson)
      } catch (error) {
        reject(new Error(`Error processing ${file.name}: ${error instanceof Error ? error.message : 'Unknown error'}`))
      }
    }
    
    reader.onerror = () => {
      reject(new Error(`Error reading ${file.name}`))
    }
    
    reader.readAsText(file)
  })
}

function removeFile(fileName: string) {
  if (uploadedFile.value && uploadedFile.value.name === fileName) {
    uploadedFile.value = null
    processedFile.value = null
    originalFileContent.value = ''
    emit('file-removed', fileName)
  }
}

function viewGeoJson() {
  showGeoJsonModal.value = true
}

function closeGeoJsonModal() {
  showGeoJsonModal.value = false
}

function copyGeoJsonToClipboard() {
  if (uploadedFile.value) {
    const jsonString = JSON.stringify(uploadedFile.value.geoJson, null, 2)
    navigator.clipboard.writeText(jsonString).then(() => {
      // Could add a toast notification here
      console.log('GeoJSON copied to clipboard')
    }).catch(err => {
      console.error('Failed to copy GeoJSON:', err)
    })
  }
}

// Expose methods for parent component
defineExpose({
  clearFiles: () => {
    uploadedFile.value = null
    processedFile.value = null
    originalFileContent.value = ''
    uploadSuccess.value = false
    uploadError.value = false
  }
})
</script>

<template>
  <div class="w-full">
    <div
      v-if="!uploadedFile"
      ref="dropZoneRef"
      class="border-2 border-dashed border-(--sub-color) rounded-lg p-8 text-center transition-colors duration-200 cursor-pointer"
      :class="{
        'border-(--main-color)! bg-(--sub-alt-color)': isOverDropZone,
        'border-(--main-color)!': uploadSuccess,
        'border-(--error-color)!': uploadError
      }"
      @click="openFileDialog"
    >
      <input
        ref="fileInputRef"
        type="file"
        accept=".gpx,.tcx"
        class="hidden"
        @change="handleFileSelect"
      />
      
      <div class="flex flex-col items-center gap-4">
        <Icon name="heroicons:cloud-arrow-up" class="h-12 w-12 text-(--main-color) scale-200" />
        
        <div v-if="!isProcessing">
          <p class="text-lg font-medium text-(--main-color)">
            Drop your GPX or TCX file here
          </p>
          <p class="text-sm text-(--sub-color) mt-1">
            or click to select file
          </p>
        </div>
        
        <div v-else class="flex items-center gap-4">
          <Icon name="svg-spinners:6-dots-scale" class="text-(--main-color) scale-200"/>
          <p class="text-sm text-(--main-color)">Processing files...</p>
        </div>
        
        <div v-if="uploadError" class="text-(--error-color)">
          <p class="text-sm font-medium">{{ errorMessage }}</p>
        </div>
      </div>
    </div>
    
    <div v-if="uploadedFile" class="mt-4">
      <h3 class="text-sm font-medium text-(--main-color) mb-2">Uploaded File:</h3>
      <div class="flex items-center justify-between p-2 bg-(--sub-alt-color) rounded-lg border border-(--sub-color)">
        <div class="flex items-center gap-2">
          <Icon name="heroicons:document" class="h-4 w-4 text-(--main-color)" />
          <span class="text-sm text-(--main-color)">{{ uploadedFile.name }}</span>
        </div>
        <div class="flex items-center gap-2">
          <button
            class="text-(--main-color) hover:text-(--main-color) opacity-70 hover:opacity-100 transition-opacity p-1"
            title="View GeoJSON"
            @click="viewGeoJson"
          >
            <Icon name="heroicons:eye" class="h-4 w-4" />
          </button>
          <button
            class="text-(--error-color) hover:text-(--error-color) opacity-70 hover:opacity-100 transition-opacity p-1"
            title="Remove file"
            @click="removeFile(uploadedFile.name)"
          >
            <Icon name="heroicons:x-mark" class="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>

    <!-- GeoJSON Modal -->
    <ModalWindow :open="showGeoJsonModal" @close="closeGeoJsonModal">
      <div class="max-w-4xl w-full">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-lg font-semibold text-(--main-color)">
            GeoJSON Data - {{ uploadedFile?.name }}
          </h2>
          <div class="flex items-center gap-2">
            <button
              class="px-3 py-1 bg-(--main-color) text-(--bg-color) rounded hover:opacity-80 transition-opacity text-sm"
              @click="copyGeoJsonToClipboard"
            >
              <Icon name="heroicons:clipboard-document" class="h-4 w-4 inline mr-1" />
              Copy
            </button>
            <button
              class="text-(--sub-color) hover:text-(--main-color) transition-colors"
              @click="closeGeoJsonModal"
            >
              <Icon name="heroicons:x-mark" class="h-5 w-5" />
            </button>
          </div>
        </div>
        
        <div class="bg-(--bg-color) border border-(--sub-color) rounded-lg p-4 max-h-96 overflow-auto">
          <pre class="text-sm text-(--main-color) whitespace-pre-wrap">{{ uploadedFile ? JSON.stringify(uploadedFile.geoJson, null, 2) : '' }}</pre>
        </div>
      </div>
    </ModalWindow>
  </div>
</template>
