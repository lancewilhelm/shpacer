# Smoothing Parameters

This document explains how Shpacer smooths elevation, grade, and pace, and how you can customize the behavior per course. It covers what each parameter does, defaults, how 0 disables smoothing, and where each parameter is applied.

## Overview

Shpacer uses three smoothing-related parameters:

- Grade smoothing window (meters) — Wg
- Pace smoothing window (meters) — Wp
- Integration sample step (meters) — Δ

You can set per-course overrides that take precedence over system defaults. Setting a smoothing parameter to 0 disables smoothing for that parameter (details below).

## Quick reference

- Wg (grade window, meters)
  - Purpose: Smooth grade estimation and the elevation chart
  - Applies to: Elevation chart (elevation series), grade calculations (tooltips, pace), grade-adjusted timing
  - Default: 100
  - Special: 0 = no smoothing (use raw data)
- Wp (pace smoothing window, meters)
  - Purpose: Smooths only the pace chart’s visual series
  - Applies to: Pace chart visualization (not arrival-time calculations)
  - Default: 300
  - Special: 0 = no smoothing (raw pointwise pace)
- Δ (integration sample step, meters)
  - Purpose: Sampling step for grade-adjusted arrival time calculations (segment integrals)
  - Applies to: Grade-adjusted elapsed times, segment pacing calculations
  - Default: 50
  - Special: 0 = falls back internally to 50 (safe default), ensuring robust integration

## Precedence and storage

- System defaults (Wg=100, Δ=50, Wp=300) are used for all courses unless overridden.
- Per-course overrides are stored per course and merged with defaults.
- Clearing a course’s overrides restores behavior to system defaults.

## Detailed behavior

### 1) Grade smoothing window (Wg)

- Elevation chart
  - If Wg > 0: The elevation series is smoothed using a distance-window (boxcar/moving average) kernel with half-window Wg/2.
  - If Wg = 0: The elevation chart shows the raw elevation series (no smoothing).

- Grade calculations (tooltips and pace)
  - If Wg > 0: Grade is estimated by comparing elevations at the edges of a distance window centered at the target distance, using interpolation to find window edges.
  - If Wg = 0: Grade is computed from the adjacent raw points bracketing the target distance (local, unsmoothed slope).

- Grade-adjusted timing (segment integrals)
  - Uses the same grade estimation approach as above (Wg governs how grade is computed at each sampled position).
  - Wg = 0 disables smoothing for grade estimation during integration.

Recommended range: 50–200 meters. Smaller windows respond to terrain detail but may be noisy; larger windows reduce noise but can oversmooth steep, short features.

### 2) Pace smoothing window (Wp)

- Pace chart visualization only
  - If Wp > 0: The raw pointwise “actual pace needed” series (normalized to your target) is smoothed using a distance-window average with half-window Wp/2.
  - If Wp = 0: No pace smoothing; the chart shows the raw, normalized pace values.

Note: Wp does not affect cumulative arrival times; it changes only the chart’s visual smoothness.

Recommended range: 0–500 meters. If you want a crisp pace trace, set 0. For a smoother visual, 200–400 is typical.

### 3) Integration sample step (Δ)

- Grade-adjusted elapsed times and segment pacing
  - The integral (distance-weighted mean of the grade→pace factor over segments) is sampled along the course using step Δ (meters).
  - If Δ = 0, the system falls back to Δ = 50 internally to ensure stable sampling.
  - For Δ > 0, Δ is clamped to at least 1 meter in calculations.

Recommended range: 10–100 meters. Smaller steps increase accuracy at a performance cost; larger steps are faster but may miss fine detail.

## “0 means no smoothing”

- Wg = 0
  - Elevation chart: raw elevation
  - Grade calculation: local slope from adjacent raw points
  - Grade-adjusted timing: uses raw (unsmoothed) grade during integration

- Wp = 0
  - Pace chart: no smoothing of the pace series

- Δ = 0
  - Internally falls back to 50 meters (safe default) to avoid degenerate sampling

## Where parameters are used

- Elevation chart: Wg only (smooths elevation series)
- Grade for tooltips: Wg
- Pace chart series: Wg (for grade estimation) + Wp (for pace visual smoothing)
- Grade-adjusted elapsed times (waypoint list, segments): Wg + Δ

## Performance notes

- Elevation and pace smoothing currently use a simple distance-window average with naive O(N²) behavior in the worst case. Typical track sizes perform well; for very dense tracks, consider smaller windows or future optimized builds.
- Integration cost scales roughly with total distance / Δ. Smaller Δ values yield more accurate integrals at higher compute cost.

## Practical guidance

- If your elevation data is noisy (common in GPS tracks):
  - Wg: 100–150
  - Wp: 200–400
  - Δ: 50
- If you want fully raw behavior for analysis:
  - Wg: 0
  - Wp: 0
  - Δ: 50 (set 0 if you prefer; internally it becomes 50)
- For rolling, smooth terrain:
  - Wg: 50–100
  - Wp: 100–300
  - Δ: 25–50

## Troubleshooting

- “Setting 0 keeps resetting to defaults”
  - Per-course smoothing values of 0 persist and are interpreted as “no smoothing” (Wg/Wp) or “use safe default” (Δ).
- “Grades look jagged”
  - Increase Wg (e.g., 100–150). If you specifically need raw slope, keep Wg = 0.
- “Pace chart is too spiky”
  - Increase Wp (e.g., 200–400). This won’t affect timing calculations, only visuals.
- “Timing seems off vs expectations”
  - Reduce Δ for finer sampling (e.g., from 100 to 50 or 25).
  - If Wg is very large, grade may be too smoothed to reflect short steep sections; try reducing Wg.

## Notes

- Units are meters for all three parameters (Wg, Wp, Δ).
- Per-course overrides take precedence; resetting a course’s smoothing reverts to system defaults.
- Grade→pace factor normalization for pace charts and segment times ensures totals match the target travel time; see REVERSE_NORMALIZATION.md for details.