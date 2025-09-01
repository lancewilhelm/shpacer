# Grade-Adjusted Arrival Times Feature

## Overview

The Grade-Adjusted Arrival Times feature enhances Shpacer's pacing calculations by incorporating elevation changes into arrival time predictions. Instead of using simple distance/pace calculations, this feature adjusts pace for each segment based on the terrain's grade, providing more realistic and accurate time estimates for races with elevation changes.

## How It Works

### Grade Adjustment Algorithm

The feature uses a research-based 4th-degree polynomial to calculate pace adjustment factors based on grade:

```
factor = 0.033×g⁴ + 1.65×g² + 1.0×g + 1.0
```

Where `g` is the grade as a decimal (e.g., 0.05 for 5% grade).

### Example Adjustments

| Grade | Pace Adjustment | Effect |
|-------|----------------|--------|
| -10%  | -8.3% (faster) | Significant downhill boost |
| -5%   | -4.6% (faster) | Moderate downhill boost |
| -2%   | -1.9% (faster) | Slight downhill boost |
| 0%    | 0.0% (no change) | Flat terrain |
| +2%   | +2.1% (slower) | Slight uphill penalty |
| +5%   | +5.4% (slower) | Moderate uphill penalty |
| +10%  | +11.7% (slower) | Significant uphill penalty |
| +15%  | +18.7% (slower) | Steep uphill penalty |

### Segment-by-Segment Calculation

1. **Segment Grade Calculation**: For each waypoint segment, the feature calculates the average grade using the elevation profile
2. **Pace Adjustment**: Applies the grade adjustment factor to the base pace for that segment
3. **Time Accumulation**: Sums the adjusted travel times plus stoppage times to get cumulative arrival times

## Enabling the Feature

### User Settings

1. Go to **Settings → General**
2. Find the **Pacing** section
3. Toggle **"Grade-adjusted arrival times"** to **Enabled**
4. The setting description: *"Calculate more realistic arrival times based on elevation changes"*

### Requirements

The feature requires:
- Elevation data in the route's GeoJSON
- At least 2 waypoints to create segments
- A configured pacing plan with base pace

## UI Enhancements

When grade adjustment is enabled, the waypoint list displays additional information for each segment:

### Segment Information Display
- **Segment Time**: Estimated time to complete the segment (e.g., "8:45")
- **Segment Pace**: Adjusted pace for the segment (e.g., "6:15/km")
- **Grade** (when enabled): Simple grade display with +/- sign (e.g., "+3.2%", "-1.8%", "0%")
- **Visual Indicators**:
  - Clock icon for segment time
  - Activity icon for segment pace
  - Trending icon for grade

## Technical Implementation

### Core Components

1. **`gradeAdjustedTimeCalculations.ts`**: Main calculation engine
   - `calculateGradeAdjustedElapsedTime()`: Calculate arrival time for a specific waypoint
   - `calculateAllGradeAdjustedElapsedTimes()`: Calculate for all waypoints
   - `getSegmentGradeAdjustment()`: Get grade info for a specific segment
   - `getSegmentPacingInfo()`: Comprehensive segment pacing data for UI

2. **`timeCalculations.ts`**: Updated to support grade adjustment
   - Added optional parameters for elevation profile and segments
   - Falls back to simple calculation when grade adjustment is disabled

3. **User Settings**: Added `pacing.useGradeAdjustment` boolean setting

### Integration Points

- **WaypointList.vue**: Displays grade information and uses adjusted times
- **Settings/SettingsGeneral.vue**: Toggle for enabling/disabling the feature
- **Elevation Profile**: Uses existing elevation extraction utilities
- **Waypoint Segments**: Uses existing segment calculation utilities

## Mile/Kilometer Splits and Back-Scaling

Shpacer also computes per-unit splits (kilometers or miles, based on your distance unit) using the same grade-aware methodology and ensures the final split exactly matches your total target time when applicable.

### How split boundaries are defined
- Boundaries are placed every 1 km (if using kilometers) or every 1 mile (if using miles) from distance 0 to the course end.
- The final split may be a partial unit if the course doesn’t end exactly on a whole km/mi boundary.

### What each split shows
- Distance marker (cumulative course distance at the split end).
- Elevation gain/loss within the split (computed by interpolating elevations at split boundaries and summing within-split changes).
- Average grade for the split (net rise over run across the split).
- Pace per unit for the split (seconds per km or per mile), normalized consistently with your plan’s mode.
- Elapsed time at the end of the split (cumulative travel + stoppages up to that boundary).

### Travel-time calculation per split
- Base speed:
  - Convert plan pace to seconds-per-meter (`basePacePerMeter`) using the plan’s pace unit (min/km or min/mi).
- Grade adjustment:
  - If grade adjustment is enabled, each split’s travel time integrates the grade-adjustment factor across the split using:
    - Grade smoothing window Wg (meters) to estimate grade at sampled midpoints.
    - Integration sample step Δ (meters) to sample within the split.
  - The distance-weighted mean factor over the split multiplies `basePacePerMeter`.
- Normalization to maintain overall goals:
  - Maintain target average (pace mode):
    - A global normalization scale S is computed over the whole course so the sum of all split travel times matches the target average pace implied time.
  - Target time mode:
    - A per-course time scale is computed so total travel time equals `targetTimeSeconds` minus total stoppage time. This preserves grade-based relative difficulty while meeting the exact finish-time goal.
- Stoppages:
  - Cumulative stoppage time up to each split boundary is added to the cumulative travel time to produce the elapsed time shown.
  - By convention, default stoppage does not apply to Start or Finish waypoints; intermediate waypoints get default or custom stoppage as configured.

### Back-scaling to match the exact final total
Even with normalization, small rounding/float artifacts can cause the final split’s elapsed time to miss the target by a second. To guarantee correctness:

1. Determine the desired final elapsed time:
   - If the plan is in “time” mode, set the last split’s desired elapsed time to exactly `targetTimeSeconds`.
   - Otherwise, round the computed total to the nearest second for a clean display.
2. Separate travel from stoppage at the final boundary:
   - Compute cumulative stoppage at the course end.
   - Compute the travel-only portion at the end (total elapsed minus stoppage).
3. Compute an extra scaling factor for travel:
   - `extraScale = desiredTravelFinal / rawTravelFinal` (safe-guarded against zero/NaN).
4. Apply extraScale to travel-only cumulative totals for every split:
   - For each split end, recompute `elapsed = (rawTravelAtSplit * extraScale) + cumulativeStoppageAtSplit`.
5. Snap the last split exactly to the desired total:
   - Set the last split’s elapsed equal to `targetTimeSeconds` (time mode) or the rounded total (pace/normalized modes).

This preserves all relative per-split difficulties (they scale uniformly), respects stoppages (only travel is scaled), and guarantees the final elapsed equals the set total.

### Consistency with waypoint arrival times
- Waypoint arrival-time calculations use the same grade-adjusted integration and course-wide normalization (see “Reverse Normalization”).
- In target-time mode, both waypoints and splits align to the desired finish time.
- Splits add a final back-scaling pass (travel-only) to eliminate any residual rounding drift and ensure the last split exactly matches the target.

For the underlying theory and math (equivalent distance via integrated grade factors and course-wide normalization), see reverse-normalization.md.

## Example Impact

For a 5km course with mixed elevation:
- **Simple calculation**: 30:00 (6 min/km pace)
- **Grade-adjusted**: 30:40 (2.2% slower overall)
- **Time difference**: +40 seconds due to elevation

Segment breakdown:
- 1km at 5% grade: +19 seconds (uphill penalty)
- 1km at -2% grade: -7 seconds (downhill boost)
- Overall: More realistic pacing expectations

## Benefits

1. **Realistic Expectations**: More accurate arrival times for hilly races
2. **Better Pacing Strategy**: Understand where to push/conserve energy
3. **Race Planning**: Better crew/support timing at waypoints
4. **Training Insights**: Understand terrain impact on performance

## Future Enhancements

This implementation represents **Phase 1** of the pacing optimization strategy. Future phases may include:

- Environmental factors (temperature, altitude)
- Fatigue modeling over distance
- Dynamic re-planning during races
- Multiple pacing strategies (conservative, aggressive, negative split)
- Integration with wearable devices for real-time adjustments

## Validation

The grade adjustment factors are based on running physiology research and produce realistic results:
- Uphill segments appropriately slow pace
- Downhill segments provide modest speed boosts
- Extreme grades are clamped to reasonable bounds
- Overall impact matches real-world race experiences

## Troubleshooting

### Common Issues

1. **No grade information showing**: Ensure elevation data exists in route GeoJSON
2. **Times seem unchanged**: Verify grade adjustment is enabled in settings
3. **Unrealistic adjustments**: Check elevation data quality and waypoint placement

### Data Requirements

- High-resolution elevation data (recommended: ≤50m intervals)
- Accurate waypoint snapping to route
- Clean elevation profile without excessive noise
