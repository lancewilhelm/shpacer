# Course Activity Comparison

Shpacer can now store uploaded race activities at the course level and compare the same activity against multiple plans for post-hoc analysis.

## What Changed

- Activities are uploaded from the course page activity selector and saved separately from plans.
- Each activity is matched back onto the course route to reduce the impact of GPS drift.
- The course page uses compact plan and activity dropdowns instead of a dedicated activity panel.
- Selecting both an activity and a plan surfaces comparison stats in the header and detailed comparison in the existing waypoint and split views.
- The elevation tooltip now compares hovered plan pace/time against the matched activity pace/time using the same distance-based smoothing window used by the pace chart.
- Creating or editing a plan after an activity upload immediately makes that plan comparable without re-uploading the activity.

## Supported Inputs

- `.gpx`
- `.tcx`

The current implementation is private/member-only and does not expose activities on shared public course or plan views.

## Matching Notes

- Activity matching uses the course route as the source of truth, not the raw activity distance.
- Overlapping and out-and-back course geometry uses the existing overlap index to choose plausible route-distance candidates.
- Comparison detail is computed from stored matched samples, so plan changes can be recomputed on demand.

## Implementation References

- Data model: [app/utils/db/schema.ts](/Users/lancewilhelm/projects/shpacer/app/utils/db/schema.ts)
- Server parsing/matching/comparison: [server/utils/courseActivities.ts](/Users/lancewilhelm/projects/shpacer/server/utils/courseActivities.ts)
- Course page UI: [app/pages/courses/[id].vue](/Users/lancewilhelm/projects/shpacer/app/pages/courses/[id].vue)
- Activity selector: [app/components/ActivitySelector.vue](/Users/lancewilhelm/projects/shpacer/app/components/ActivitySelector.vue)
- Chart hover comparison: [app/components/ElevationPaceChart.vue](/Users/lancewilhelm/projects/shpacer/app/components/ElevationPaceChart.vue)
