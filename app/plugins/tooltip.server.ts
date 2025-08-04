export default defineNuxtPlugin((nuxtApp) => {
  // Register a no-op tooltip directive for SSR
  nuxtApp.vueApp.directive("tooltip", {
    getSSRProps() {
      // Return empty props for SSR - tooltips are client-side only
      return {};
    },
  });
});
