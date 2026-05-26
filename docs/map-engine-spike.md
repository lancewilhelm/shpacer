# MapLibre Migration

Shpacer now uses MapLibre for all interactive course maps.

Deprecated note: old course URLs that still include `?mapEngine=maplibre` are normalized back to the standard course URL on load because MapLibre is now the default engine rather than an opt-in mode.

## Current scope

- Course page viewer maps use [app/components/MapLibreCourseMap.vue](/Users/lancewilhelm/projects/shpacer/app/components/MapLibreCourseMap.vue)
- Course editor waypoint maps use the same MapLibre component
- New-course preview maps use the same MapLibre component
- Route hover, waypoint selection, track-click editing flows, highlighted-segment fitting, and reset-view controls all run on the MapLibre stack
- Interactive maps include a basemap picker with `OpenStreetMap`, `OpenStreetMap.HOT`, `OpenTopoMap`, and `Esri Satellite`

## Basemap

- Interactive maps use OpenStreetMap raster tiles through a minimal MapLibre style
- The current implementation keeps the raster basemap intentionally simple while separating renderer migration from any later production-style redesign

## Export path

- Plan PDF map snapshots no longer rely on a hidden Leaflet map
- Export rendering now lives in [app/utils/mapImageExport.ts](/Users/lancewilhelm/projects/shpacer/app/utils/mapImageExport.ts)
- The export utility stitches OpenStreetMap raster tiles onto a canvas and draws the route plus waypoint markers directly before the print document opens

## Follow-up considerations

- If a richer production basemap is needed later, that should be scoped as a style decision rather than another renderer migration
- If export fidelity needs to match the interactive map more closely, extend the canvas renderer in [app/utils/mapImageExport.ts](/Users/lancewilhelm/projects/shpacer/app/utils/mapImageExport.ts) instead of reintroducing a separate map engine
