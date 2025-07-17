<script setup lang="ts">
const props = defineProps<{
  open: boolean;
  width?: string; // e.g., "80vw", "800px", "90%"
  height?: string; // e.g., "80vh", "600px", "90%"
  maxWidth?: string;
  maxHeight?: string;
}>();

const emit = defineEmits(["close"]);

// Compute modal styles based on props
const modalStyles = computed(() => {
  const styles: Record<string, string> = {};
  
  if (props.width) styles.width = props.width;
  if (props.height) styles.height = props.height;
  if (props.maxWidth) styles.maxWidth = props.maxWidth;
  if (props.maxHeight) styles.maxHeight = props.maxHeight;
  
  return styles;
});

// Add event listener for escape key to close the modal
onMounted(() => {
  const handleKeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      emit("close");
    }
  };

  window.addEventListener("keydown", handleKeydown);

  // Cleanup the event listener on component unmount
  onBeforeUnmount(() => {
    window.removeEventListener("keydown", handleKeydown);
  });
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed top-0 left-0 w-full h-full bg-black/50 flex items-center justify-center z-50"
      @click="emit('close')"
    >
      <div
        class="bg-(--bg-color) border border-(--main-color) m-4 max-w-[80%] p-4 rounded-lg shadow-lg"
        :style="modalStyles"
        @click.stop
      >
        <slot />
      </div>
    </div>
  </Teleport>
</template>
