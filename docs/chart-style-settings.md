# Chart Style Settings

Shpacer includes global chart appearance preferences in the Appearance settings page.

Current chart style options:

- `Gradient under lines`: fills the area beneath the elevation and pace traces with a subtle gradient.
- `Fast pace at top`: flips the pace chart Y axis so lower pace values render higher on the chart and slower paces render lower.

These preferences are stored in the user settings store and applied anywhere the shared elevation/pace chart is rendered.

Implementation details:

- User settings store: [app/stores/userSettings.ts](/Users/lancewilhelm/projects/shpacer/app/stores/userSettings.ts)
- Appearance UI: [app/components/Settings/SettingsAppearance.vue](/Users/lancewilhelm/projects/shpacer/app/components/Settings/SettingsAppearance.vue)
- Pace chart rendering: [app/components/ElevationPaceChart.vue](/Users/lancewilhelm/projects/shpacer/app/components/ElevationPaceChart.vue)
- Command palette shortcuts: [app/composables/useCommandPalette.ts](/Users/lancewilhelm/projects/shpacer/app/composables/useCommandPalette.ts)
