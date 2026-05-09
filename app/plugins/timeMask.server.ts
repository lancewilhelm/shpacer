export default defineNuxtPlugin((nuxtApp) => {
  // Register a no-op time-mask directive for SSR so hydration does not warn.
  nuxtApp.vueApp.directive("time-mask", {
    getSSRProps() {
      return {};
    },
  });
});
