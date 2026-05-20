# Course Activity Comparison

Shpacer can now store uploaded race activities at the course level and compare the same activity against multiple plans for post-hoc analysis.

## What Changed

- Activities are uploaded from the course page activity selector and saved separately from plans.
- Each activity is matched back onto the course route to reduce the impact of GPS drift.
- The course page uses compact plan and activity dropdowns instead of a dedicated activity panel.
- The selected activity persists in the course URL with `?activity=...`, and courses with uploaded activities now default to the explicit no-selection state `?activity=none` until an activity is chosen.
- Course page loads now fetch only lightweight activity summaries up front for the selector; the full uploaded activity payload is fetched only after a specific activity is selected.
- Selecting both an activity and a plan surfaces comparison stats in the header and detailed comparison in the existing waypoint and split views.
- The elevation tooltip now compares hovered plan pace/time against the matched activity pace/time using the same distance-based smoothing window used by the pace chart.
- When an activity is selected, the pace chart overlays a dedicated activity pace line using the same matched-and-smoothed pace series shown in the tooltip.
- Course analysis settings are now loaded with the course itself from a dedicated DB-backed `user_course_settings` record instead of being persisted in `userSettings`.
- The course pacing controls can cap the displayed activity pace on the chart so aid-station stops do not dominate the Y-axis; the default display cap is `30:00 /mi`, and the cap affects chart display only, not tooltip or comparison math.
- Interwaypoint segment comparisons now use the same normalized matched distance-to-elapsed interpolation as the pace chart tooltip, so segment times and deltas stay aligned in overlap and out-and-back sections.
- Waypoint comparison rows expose tooltip labels for planned elapsed time, planned stoppage time, actual elapsed time, and plan delta so the compact stat line stays self-describing.
- Creating or editing a plan after an activity upload immediately makes that plan comparable without re-uploading the activity.

## Supported Inputs

- `.gpx`
- `.tcx`

The current implementation is private/member-only and does not expose activities on shared public course or plan views.

## Matching Notes

- Activity matching uses the course route as the source of truth, not the raw activity distance.
- Overlapping and out-and-back course geometry uses the existing overlap index to choose plausible route-distance candidates.
- Matching now rejects implausible instantaneous forward jumps in route progress so a single bad overlap handoff does not collapse pace fidelity across the rest of the activity.
- Comparison detail is computed from stored matched samples, so plan changes can be recomputed on demand. Legacy repair work now runs when an activity detail/comparison is requested, not during the initial course-page summary load.
- Per-course smoothing and pace-cap values are course-scoped analysis settings, fetched alongside member course data and saved through `/api/courses/:id/settings`.

## Implementation References

- Data model: [app/utils/db/schema.ts](/Users/lancewilhelm/projects/shpacer/app/utils/db/schema.ts)
- Course settings defaults/normalization: [app/utils/courseSettings.ts](/Users/lancewilhelm/projects/shpacer/app/utils/courseSettings.ts)
- Server parsing/matching/comparison: [server/utils/courseActivities.ts](/Users/lancewilhelm/projects/shpacer/server/utils/courseActivities.ts)
- Course settings API: [server/api/courses/[id].get.ts](/Users/lancewilhelm/projects/shpacer/server/api/courses/[id].get.ts), [server/api/courses/[id]/settings.put.ts](/Users/lancewilhelm/projects/shpacer/server/api/courses/[id]/settings.put.ts)
- Course page UI: [app/pages/courses/[id].vue](/Users/lancewilhelm/projects/shpacer/app/pages/courses/[id].vue)
- Activity selector: [app/components/ActivitySelector.vue](/Users/lancewilhelm/projects/shpacer/app/components/ActivitySelector.vue)
- Chart hover comparison: [app/components/ElevationPaceChart.vue](/Users/lancewilhelm/projects/shpacer/app/components/ElevationPaceChart.vue)
