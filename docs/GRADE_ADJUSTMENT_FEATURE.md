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
  - 🕐 Clock icon for segment time
  - 📈 Activity icon for segment pace  
  - 📊 Trending icon for grade

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