# Splits, Units, Chart Zoom, and Route Highlighting

This document explains how split distance units are resolved and how route highlighting behaves when selecting split rows, interwaypoint segments, or a dragged chart range. It covers the interaction between course defaults, user settings, and the UI components that render these views and highlights.

## Overview

- Split distances (mile vs km) follow the system’s standard unit resolution:
  - If the user’s distance unit is set to “follow course,” splits use the course’s default distance unit.
  - If the user overrides the distance unit, splits use the override.
- Splits are generated at even unit boundaries (every 1 mile or every 1 km).
- Clicking a split (or a range of splits) highlights the corresponding route segment on the map and chart and can auto-fit the map view to that segment.
- Clicking an interwaypoint segment in the Waypoints tab highlights that waypoint-to-waypoint route segment using the same map/chart highlight pipeline.
- Dragging across any of the top charts selects a distance range, adds a small padded context window for chart zoom, and fits the map to the raw selected route segment.

## Unit Resolution

The project centralizes unit resolution, so split displays remain consistent with the rest of the system:

- The user settings store exposes `resolveUnitsForCourse` and the convenience accessors `getDistanceUnitForCourse` and `getElevationUnitForCourse`.
- SSR-safe helpers in `utils/units` (`getDistanceUnitSSR`, `getElevationUnitSSR`) fall back to course defaults when the store is unavailable.

Key usage points:
- `SplitsTable.vue`
  - Accepts a new prop `courseDefaults?: Partial<CourseUnitDefaults> | null`.
  - Uses `getDistanceUnitSSR(courseDefaults)` to determine the distance unit for:
    - Split size (`splitLengthMeters`)
    - Distance labeling (“Mile Splits” vs “Kilometer Splits”)
- `pages/courses/[id].vue`
  - Computes `distanceUnit` using `userSettingsStore.getDistanceUnitForCourse(course)`.
  - Generates synthetic per-split waypoints using the resolved `distanceUnit` (not raw store values).
  - Passes `:course-defaults="course || null"` to `SplitsTable` so the table uses the same unit context.

Result:
- If a course’s default distance unit is kilometers and the user’s distance setting is “follow course,” the Splits tab renders kilometer splits.
- If the user overrides to miles, the Splits tab renders mile splits even for a kilometer-default course.

## Split Generation and Display

- Waypoints for the Splits tab are generated at each unit boundary:
  - Start waypoint “S” at distance 0
  - Numeric waypoints 1..N at each 1 mi or 1 km
  - Finish waypoint “F”
- `MapLibreCourseMap.vue` respects `displayMarkersAsSplits`:
  - Start is labeled “S”
  - Finish is labeled “F”
  - Intermediate waypoints are numbered 1..N
- `SplitsTable.vue`:
  - Header shows “Mile Splits” or “Kilometer Splits” based on resolved unit.
  - Dist column formats distances using the resolved split unit.
  - The split boundary size is:
    - 1609.344 meters for miles
    - 1000 meters for kilometers

Notes on pacing:
- The “Pace” column uses the plan’s `paceUnit` (`min_per_mi` or `min_per_km`) for display. This is independent from the course/user distance unit choice for split sizes.

## Route Selection and Highlighting

- `SplitsTable.vue` emits:
  - `split-click` with `{ start, end, index }` for single-row selection.
  - `split-range-click` with `{ startIndex, endIndex, start, end }` for shift-click range selection.
  - `split-cancel` to clear selection.

- `WaypointList.vue` emits:
  - `segment-click` with `{ fromWaypointId, toWaypointId, start, end }` for single interwaypoint segment selection.
  - `segment-cancel` when the selected segment row is clicked again.

- `ElevationPaceChart.vue` emits:
  - `range-select` with `{ start, end }` for drag-selected chart ranges from the elevation, pace, or activity-delta overlays.
  - `zoom-reset` when the user clicks any chart background while a chart zoom is active.

- `pages/courses/[id].vue`:
  - Maintains split row selection state, waypoint-segment selection state, chart zoom state, and a shared route highlight model with a `source` of `split`, `waypoint-segment`, or `chart-range`.
  - Computes `stableHighlightSegment` (start/end only) for the map and chart, while passing a separate padded `zoomRange` into the chart component.
  - Passes `:highlight-segment="stableHighlightSegment"` to the map and chart and sets `:fit-highlight="shouldFitHighlightSegment"` so auto-fit applies to either source when that detail view is active.
  - Clears waypoint selection when a waypoint segment is selected, and clears waypoint-segment selection when a waypoint is selected.
  - Clears split/segment selection and selected waypoint when a drag-selected chart zoom becomes active.
  - Treats chart-range highlighting as globally active, while split and waypoint-segment highlighting still follow the active detail tab.
  - Deselecting a split or waypoint segment clears the highlight and remounts the map to re-fit to the full track.
  - Resetting the chart zoom clears the chart-range highlight and remounts the map to re-fit to the full track.
  - Keeps `waypointPanelTab` synchronized with the mobile Waypoints/Splits buttons so map/chart stay aligned with the last selected detail view on mobile.

- `MapLibreCourseMap.vue`:
  - Draws the highlighted segment as a polyline between the provided `highlightSegment.start` and `highlightSegment.end` distance offsets (meters).
  - If `fitHighlight` is true, fits the map bounds to the highlighted segment. The component tracks previous fits to avoid repeated automatic zooms unless the highlighted segment changes.
  - Adds a reset-view button directly below the built-in zoom buttons that re-fits the map to the full course bounds whenever route geometry is available.

- `ElevationPaceChart.vue`:
  - Limits the elevation, pace, and activity-delta x-domains to the shared padded zoom range when present.
  - Recomputes each chart's y-domain from only the currently visible data so the zoom behaves like a true chart zoom, not just a horizontal crop.
  - Allows the elevation, pace, and activity-delta overlays to all start the same drag-select interaction.
  - Lets a plain chart-background click reset the shared chart zoom.

## Expected Behavior

- With course default set to kilometers and the user setting “follow course”:
  - Splits use kilometer boundaries.
  - The Splits table header reads “Kilometer Splits.”
  - The map shows numbered markers at every kilometer when the Splits tab is selected.
  - Clicking a row highlights that kilometer on the map and auto-fits to the segment.

- With the user overriding to miles:
  - Splits use mile boundaries with “Mile Splits” header.
  - Synthetic split waypoints land every 1 mile.
  - Map highlighting behaves identically.

- In the Waypoints tab:
  - Clicking a waypoint-to-waypoint segment row highlights that exact route segment on both map and chart.
  - Clicking the same segment row again clears the highlight and restores the full-track fit.
  - Clicking a waypoint clears any active waypoint-segment highlight.

- With chart zoom:
  - Dragging across any top chart selects a route segment and adds 5% padding on each side for the chart zoom window.
  - The map fits to the raw dragged range, while the elevation, pace, and activity-delta charts all zoom to the same padded range.
  - Clicking any chart background resets the zoom and returns the map to the full course.
  - Selecting a split or waypoint-segment after chart zoom replaces the chart-range focus with the newly selected segment.

- With no selection:
  - The map shows the full track (no highlight).
  - The reset-view button below the zoom controls returns the map to the full track after any manual pan or zoom.
  - Selecting and then re-clicking the same split or waypoint segment clears the selection and restores the full track view.

- On mobile:
  - Selecting a split or waypoint segment in its list view persists the corresponding highlight when switching to Map or Charts.
  - The map marker style follows the last active detail tab (`waypoints` vs `splits`).

## How to Test

1. Open a course and switch to the Splits tab.
2. In Course Settings, set Default Distance Unit to “kilometers.”
3. In User Settings:
   - Set Distance Units to “follow course” and confirm:
     - The Splits tab shows “Kilometer Splits.”
     - Split markers appear every kilometer.
     - Clicking a split highlights that kilometer on the map and auto-fits the map.
   - Set Distance Units to “miles” (override) and confirm:
     - The Splits tab shows “Mile Splits.”
     - Split markers appear every mile.
4. Click on different split rows and:
   - Ensure the correct segment is highlighted on the map.
   - Shift-click two rows to create a range selection; verify the entire combined segment is highlighted.
   - Click the selected row again to clear the highlight and return to the full-track view.
5. Switch to the Waypoints tab and:
   - Click an interwaypoint segment row and verify the correct route section is highlighted on the map and chart.
   - Click the same segment again and verify the highlight clears and the map returns to the full track.
   - Click a waypoint after selecting a segment and verify the segment highlight clears.
6. Drag across each of the top charts and:
   - Verify the map fits to the selected course section.
   - Verify the elevation, pace, and activity-delta charts zoom to the same padded range.
   - Verify a tiny drag does not activate zoom.
   - Verify clicking any chart background resets the zoom and restores the full track.
7. On mobile:
   - Select a split, switch to Map, and verify the highlight and split markers are preserved.
   - Select an interwaypoint segment, switch to Map or Charts, and verify the same segment remains highlighted.
   - Drag-select in Charts, switch to Map, and verify the same zoomed section remains the active highlight until reset.

## Troubleshooting

- Splits still show miles when the course is set to kilometers:
  - Ensure the user’s Distance Unit setting is “follow course,” not “miles.”
  - Confirm `SplitsTable` receives `:course-defaults="course || null"` so SSR-safe unit helpers resolve correctly.

- Map does not auto-fit on selection:
  - Auto-fit happens when the highlighted route source matches the active detail view, except for chart-range selection which is always active. Check that `waypointPanelTab` matches the selected detail source (`splits` or `waypoints`) when the highlight did not come from the chart.

- Highlight doesn’t change on click:
  - Verify that `SplitsTable` emits `split-click` and the page updates the shared route highlight state.
  - Verify that `WaypointList` emits `segment-click` for interwaypoint rows.
  - Verify that `ElevationPaceChart` emits `range-select` after a real drag, not just a click.
  - Check that `MapLibreCourseMap` receives `:highlight-segment` and that `geoJsonData` is present.

## Relevant Components

- `components/SplitsTable.vue`
  - Resolves and renders split units; emits selection events.

- `pages/courses/[id].vue`
  - Coordinates unit resolution for splits, generates synthetic split waypoints, manages split/segment/chart-zoom state, and passes highlight plus zoom info to the map and chart.

- `components/WaypointList.vue`
  - Renders interwaypoint segment rows and emits waypoint-segment selection events.

- `components/ElevationPaceChart.vue`
  - Handles drag-selection, shared chart zoom, hover syncing, and chart reset clicks.

- `components/MapLibreCourseMap.vue`
  - Renders split-style waypoint markers when appropriate and draws highlighted route segments with optional auto-fit.

- `utils/units.ts`
  - SSR-safe helpers to resolve units using course defaults and user settings.
