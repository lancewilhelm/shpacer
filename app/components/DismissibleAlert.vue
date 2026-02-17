<script setup lang="ts">
interface Props {
  message: string;
  tone?: "error" | "info" | "success" | "warning";
}

const props = withDefaults(defineProps<Props>(), {
  tone: "error",
});

const emit = defineEmits<{
  dismiss: [];
}>();

const containerClass = computed(() => {
  switch (props.tone) {
    case "success":
      return "bg-(--main-color)/10 border-(--main-color) text-(--main-color)";
    case "warning":
      return "bg-(--sub-alt-color) border-(--sub-color) text-(--main-color)";
    case "info":
      return "bg-(--sub-alt-color) border-(--sub-color) text-(--main-color)";
    case "error":
    default:
      return "bg-(--error-color)/10 border-(--error-color) text-(--text-color)";
  }
});
</script>

<template>
  <div
    class="p-3 border rounded-lg flex items-start gap-2"
    :class="containerClass"
    role="alert"
  >
    <p class="text-sm grow leading-5">{{ message }}</p>
    <button
      type="button"
      class="shrink-0 p-1 rounded transition-colors hover:bg-black/10"
      aria-label="Dismiss message"
      @click="emit('dismiss')"
    >
      <Icon name="lucide:x" class="h-4 w-4" />
    </button>
  </div>
</template>
