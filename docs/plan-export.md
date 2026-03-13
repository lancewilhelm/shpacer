# Plan CSV Export

When a plan is selected on the course page, the `Menu` dropdown now includes an `Export Plan CSV` action.

The export downloads one row per waypoint and includes:

- Waypoint name
- Distance from start
- Time estimate to that waypoint
- Distance to the next waypoint
- Estimated time to the next waypoint
- Elevation gain to the next waypoint
- Elevation loss to the next waypoint
- Tags
- Notes

The exported distance and elevation columns follow the viewer's current unit settings. Timing values follow the active plan timing calculations shown in the waypoint panel, including plan pacing adjustments and waypoint stoppage handling.

Implementation lives in [app/pages/courses/[id].vue](/Users/lancewilhelm/projects/shpacer/app/pages/courses/[id].vue), [app/components/CourseActionsDropdown.vue](/Users/lancewilhelm/projects/shpacer/app/components/CourseActionsDropdown.vue), and [app/utils/planWaypointExport.ts](/Users/lancewilhelm/projects/shpacer/app/utils/planWaypointExport.ts).
