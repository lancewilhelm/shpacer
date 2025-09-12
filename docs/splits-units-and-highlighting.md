# Splits, Units, and Map Highlighting

This document explains how split distance units are resolved and how map highlighting behaves when selecting splits. It covers the interaction between course defaults, user settings, and the UI components that render splits and highlights.

## Overview

- Split distances (mile vs km) follow the system’s standard unit resolution:
  - If the user’s distance unit is set to “follow course,” splits use the course’s default distance unit.
  - If the user overrides the distance unit, splits use the override.
- Splits are generated at even unit boundaries (every 1 mile or every 1 km).
- Clicking a split (or a range of splits) highlights the corresponding segment on the map and can auto-fit the map view to that segment.

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
- `LeafletMap.vue` respects `displayMarkersAsSplits`:
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

## Split Selection and Map Highlighting

- `SplitsTable.vue` emits:
  - `split-click` with `{ start, end, index }` for single-row selection.
  - `split-range-click` with `{ startIndex, endIndex, start, end }` for shift-click range selection.
  - `split-cancel` to clear selection.

- `pages/courses/[id].vue`:
  - Maintains `selectedSplitIndex`, `selectedSplitRange`, and `splitHighlight` (`{ start, end, mid }`).
  - Computes `stableHighlightSegment` (start/end only) for the map.
  - Passes `:highlight-segment="stableHighlightSegment"` to the map and sets `:fit-highlight="waypointPanelTab === 'splits' && !!splitHighlight"` so auto-fit only happens when the Splits tab is active and a split is selected.
  - Deselecting a split clears the highlight and remounts the map to re-fit to the full track.

- `LeafletMap.vue`:
  - Draws the highlighted segment as a polyline between the provided `highlightSegment.start` and `highlightSegment.end` distance offsets (meters).
  - If `fitHighlight` is true, fits the map bounds to the highlighted segment. The component tracks previous fits to avoid repeated automatic zooms unless the highlighted segment changes.

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

- With no selection:
  - The map shows the full track (no highlight).
  - Selecting and then re-clicking the same split clears the selection and restores the full track view.

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
5. Switch between tabs (Waypoints/Splits) and verify:
   - Auto-fit to highlighted segment only occurs when the Splits tab is active.
   - Waypoint labels use “S” / numbers / “F” when `displayMarkersAsSplits` is active.

## Troubleshooting

- Splits still show miles when the course is set to kilometers:
  - Ensure the user’s Distance Unit setting is “follow course,” not “miles.”
  - Confirm `SplitsTable` receives `:course-defaults="course || null"` so SSR-safe unit helpers resolve correctly.

- Map does not auto-fit on selection:
  - Auto-fit happens only when the Splits tab is active and a split is selected (`fitHighlight` passed true). Check that `waypointPanelTab` is “splits.”

- Highlight doesn’t change on click:
  - Verify that `SplitsTable` emits `split-click` and the page updates `splitHighlight`.
  - Check that `LeafletMap` receives `:highlight-segment` and that `geoJsonData` is present.

## Relevant Components

- `components/SplitsTable.vue`
  - Resolves and renders split units; emits selection events.

- `pages/courses/[id].vue`
  - Coordinates unit resolution for splits, generates synthetic split waypoints, manages selection state, passes highlight info to the map.

- `components/LeafletMap.vue`
  - Renders split-style waypoint markers and draws highlighted segments with optional auto-fit.

- `utils/units.ts`
  - SSR-safe helpers to resolve units using course defaults and user settings.
