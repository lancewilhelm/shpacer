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
        <div class="w-full h-full p-4 flex flex-col gap-4">
            <div>
                <h2 class="text-2xl font-bold mb-2">shpacer</h2>
            </div>
        </div>
    </div>
</template>
