export default defineNuxtPlugin(() => {
  const userSettings = useUserSettingsStore();

  function getCurrentThemeHref() {
    const el = document.querySelector<HTMLLinkElement>("#currentTheme");
    return el?.getAttribute("href") || null;
  }

  function resolveHrefForTheme(name?: string) {
    if (!name) return null;
    return `/css/themes/${name}.css`;
  }

  watch(
    () => userSettings.settings.theme,
    (theme) => {
      if (!theme) return;

      const currentHref = getCurrentThemeHref();
      const targetHref = resolveHrefForTheme(theme);

      // If SSR already injected this theme, avoid reloading it on hydration
      if (currentHref && targetHref && currentHref === targetHref) {
        return;
      }

      loadTheme(theme);
    },
    { immediate: true },
  );
});
