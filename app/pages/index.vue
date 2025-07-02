<script setup lang="ts">
definePageMeta({
  auth: {
    only: "user",
    redirectGuestTo: "/login",
  },
});

// Page metadata
useHead({
  title: "Home",
});
</script>

<template>
  <div class="flex flex-col w-full h-full overflow-hidden">
    <AppHeader class="w-full" />
    <div class="w-full h-full p-4">
      <h2>shpacer</h2>
      <p>
        This is a basic shpacer for your Nuxt 4 application, with Drizzle ORM,
        and Better Auth. You can start building your app from here.
      </p>
    </div>
  </div>
</template>
