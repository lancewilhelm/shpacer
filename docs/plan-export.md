# Plan Exports

When a plan is selected on the course page, the `Menu` dropdown now includes `Export Plan CSV` and `Export Plan PDF` actions.

The CSV export downloads one row per waypoint and includes:

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

The PDF export opens a print-ready document. The first page is a quick-reference overview table. The second page shows a whole-course overview map. Each following page renders a single waypoint section with the same export fields broken out for easier reading and printing.

The current PDF map snapshot spike uses `leaflet.bigimage` with an export-only hidden Leaflet map:

- OpenStreetMap tiles only
- Route polyline overlay
- Simplified highlighted waypoint marker
- Sequential image capture before the print document opens

If a waypoint image cannot be captured, the PDF shows a placeholder message for that waypoint instead of failing the whole export.

Implementation lives in [app/pages/courses/[id].vue](/Users/lancewilhelm/projects/shpacer/app/pages/courses/[id].vue), [app/components/CourseActionsDropdown.vue](/Users/lancewilhelm/projects/shpacer/app/components/CourseActionsDropdown.vue), [app/utils/planWaypointExport.ts](/Users/lancewilhelm/projects/shpacer/app/utils/planWaypointExport.ts), [app/utils/planWaypointPrint.ts](/Users/lancewilhelm/projects/shpacer/app/utils/planWaypointPrint.ts), and [app/utils/leafletBigImageExport.ts](/Users/lancewilhelm/projects/shpacer/app/utils/leafletBigImageExport.ts).
