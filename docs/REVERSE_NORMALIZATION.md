# Reverse Normalization for Grade-Adjusted Pacing

This document explains the reverse-normalization method implemented in Shpacer to produce grade-aware segment paces and arrival times that exactly meet a user’s target time/average pace. It also covers the math, implementation details, and future improvements.

## Why reverse normalization?

A simple “apply a grade factor to base pace” approach yields more realistic times on hilly terrain, but the total time no longer equals the user’s target (because uphill penalties outweigh downhill benefits nonlinearly). Reverse normalization solves this by scaling all grade-influenced paces so the total matches the target time/pace exactly, while preserving the relative difficulty between segments.

In short:
- We compute a grade-equivalent cost (via integration) for each segment.
- We compute a single global scale so the sum of segment times equals the target travel time.
- We present normalized per-segment paces and times consistent with that target.

## Notation

- Course is divided into N route segments between waypoints.
- For segment i:
  - `Li` = distance of segment i (meters)
  - `g(x)` = grade at position x along the segment (percent)
  - `f(g)` = grade-adjustment factor (dimensionless multiplier on pace)
  - `Fi` = equivalent factor for segment i (mean of `f(g(x))` over the segment, distance-weighted)
- Global quantities:
  - `D = Σ Li` (total course distance)
  - `E = Σ Li·Fi = Σ ∫_segment f(g(x)) dx` (total “equivalent distance”)
  - `Pbase` = base plan pace (seconds per km or per mile)
  - `pbm` = base plan pace per meter (seconds per meter)
  - `S` = normalization scale (dimensionless)

## Grade-adjustment model f(g)

The adjustment function `f(g)` converts grade (in %) to a multiplicative factor on pace. We use the shared piecewise-polynomial implementation `paceAdjustment(gradient)`:

- For extreme gradients (< -32.25% and > 32.1%): linear segments chosen to keep continuity of value and slope.
- For moderate gradients (-32.25% to 32.1%): 4th-degree polynomial:
  - `f(g) = a4·g^4 + a3·g^3 + a2·g^2 + a1·g + a0`
- We clamp the input grade and the output factor to reasonable bounds:
  - Grade clamp: `g ∈ [-50, 50]` (percent)
  - Factor clamp: `f(g) ∈ [0.5, 3.0]`

This function is implemented in:
- `utils/paceAdjustment.ts` → `paceAdjustment(gradient)`
- Wrapped for safety in:
  - `utils/gradeAdjustedTimeCalculations.ts` → `calculateGradeAdjustmentFactor(grade)` (delegates to `paceAdjustment`, then clamps)

## Segment-level integral factor Fi

Because `f` is nonlinear, `f(mean(g)) ≠ mean(f(g))`. We therefore compute the distance-weighted mean of `f(g)` over each segment:

- Continuous definition:
  - `Fi = (1/Li) · ∫_{segment i} f(g(x)) dx`
- Numerical approximation via sampling:
  - Partition the segment by distance (default step: Δ = 50 m).
  - For each subsegment `[xk, xk+1]`, let `mk = (xk + xk+1)/2`.
  - Compute a smoothed grade `gk = g(mk)` using a windowed estimator (default window: Wg = 100 m) via `calculateGradeAtDistance(...)`.
  - Compute `fk = f(gk)`.
  - Accumulate distance-weighted factor:
    - `∫ f(g(x)) dx ≈ Σ fk · ΔLk`
  - Then `Fi ≈ (1/Li) · Σ fk · ΔLk`.

We reuse the course’s elevation profile and `calculateGradeAtDistance(...)` for grade smoothing. This reduces grade estimation noise without over-smoothing the underlying elevation data.

## Course-wide normalization

Define:
- Total distance: `D = Σ Li`
- Equivalent distance: `E = Σ Li·Fi = Σ ∫_segment f(g(x)) dx`

We choose a single scale `S` so that the travel time matches the target implied by the base pace:

- Base plan pace per meter: `pbm = Pbase / unit_length` (1,000 m for km, 1,609.344 m for mile)
- Target travel time (no stoppages): `Ttarget = pbm · D`
- Raw (unnormalized) travel time would be: `Traw = pbm · E`
- Normalization scale:
  - `S = D / E`
  - So that normalized travel time is `pbm · E · S = pbm · D = Ttarget`

Interpretation: We preserve the relative difficulty between segments (via `Fi`) but uniformly scale all segments so the total time matches the target.

## Segment paces and times

For segment i:

- Pace per meter:
  - `pbm_i = pbm · Fi · S`
- Segment time:
  - `ti = Li · pbm_i = Li · pbm · Fi · S`
- Pace for display (seconds per km or mile):
  - `Pi = Pbase · Fi · S`

Cumulative elapsed times add stoppage times at each waypoint:
- Travel times are accumulated between waypoints.
- Stoppage times (user-specified per waypoint or default) are added at waypoints.
- Start/finish stoppage time behavior is handled by `getWaypointStoppageTime(...)`.

Guarantee:
- `Σ ti = pbm · D` by construction (i.e., travel time equals the target time implied by `Pbase`). Adding stoppages yields the final arrival times.

## Pace chart (pointwise series)

We render a continuous “actual pace needed” series along the route with consistent normalization:

- At each elevation point (distance `di`):
  - Compute smoothed grade `gi` via `calculateGradeAtDistance(...)` (default Wg = 100 m).
  - Compute raw factor `fi = f(gi)`.
- Compute the global scale `S` using trapezoidal integration over the full distance:
  - `E = ∫ f(g(x)) dx ≈ Σ 0.5 · (fi-1 + fi) · (di - di-1)`
  - `S = D / E`
- Normalized actual pace at each distance:
  - `P(di) = Pbase · fi · S`
- Optional pace smoothing (separate from grade smoothing) to reduce spikes in the chart:
  - Apply a distance-based moving average with window `Wp` (default: 300 m):
    - `P_smooth(di) = mean{ P(dj) | |dj - di| ≤ Wp / 2 }`

This yields a smooth, normalized pace curve that still sums (in time) to the target.

## Implementation summary (key locations)

- Segment arrivals and normalization:
  - `app/utils/gradeAdjustedTimeCalculations.ts`:
    - `calculateAllGradeAdjustedElapsedTimes(...)`: integral factors per segment, normalization scale, cumulative arrivals with stoppages.
    - `getSegmentGradeAdjustment(...)`: normalized per-segment pace for UI.
- Grade and elevation utilities:
  - `app/utils/elevationProfile.ts`:
    - `calculateGradeAtDistance(...)`: grade estimation with a smoothing window.
- Pace adjustment primitives:
  - `app/utils/paceAdjustment.ts`:
    - `paceAdjustment(gradient)`: piecewise-polynomial grade→factor.
    - `calculateActualPacesForTarget(...)`: continuous normalized pace series with smoothing for the chart.

## Defaults and bounds

- Grade integration sample step (segments): Δ = 50 m.
- Grade smoothing window (segments and chart): Wg = 100 m.
- Pace smoothing window (chart only): Wp = 300 m (moving average).
- Grade clamp: `g ∈ [-50, 50]` (%).
- Factor clamp: `f(g) ∈ [0.5, 3.0]`.

## Performance considerations

- The integral method samples each segment; runtime scales roughly with total points ~ (total_distance / Δ).
- The pace chart moving average is currently a naive distance-window average (O(N²) worst-case). This is acceptable for typical track sizes but can be optimized (see Improvements).

## Validation checklist

- Finish time (travel only) should equal `pbm · D`. Arrivals = travel + stoppages.
- Segment paces change with grade and appear consistent with segment times.
- Pace chart is smoother (fewer spikes), still reflecting terrain changes.
- Sensible behavior on flat courses: `Fi ≈ 1`, `S ≈ 1`, per-segment paces ≈ `Pbase`.

## Potential improvements

1. User-tunable smoothing
   - Expose UI controls for:
     - Grade smoothing window `Wg` (e.g., 50–200 m)
     - Pace smoothing window `Wp` (e.g., 0–500 m)
   - Apply the same `Wg` in both segment Fi computation and chart series for consistency.

2. Better smoothing kernels
   - Use Gaussian or triangular kernels (distance-weighted) instead of a flat boxcar to reduce edge effects.
   - Savitzky–Golay or LOWESS for robust smoothing that preserves local features.

3. Adaptive sampling
   - Use finer steps in highly variable terrain; coarser steps on flat sections.
   - Cache grade/factor arrays and reuse across views (segments and chart) to avoid duplicate work.

4. Downhill saturation and asymmetry
   - Cap downhill benefit (e.g., enforce `f(g) ≥ 0.85`) or apply a “downhill sensitivity” control.
   - Allow an alternate polynomial (or blended model) for negative grades.

5. Constraint-aware redistribution (water-filling)
   - Impose min/max per-segment pace bounds (safety, terrain limits).
   - Clamp violating segments, recompute `S` for the remaining degrees of freedom iteratively until target time is met.

6. Multi-factor model (future phases)
   - Add fatigue, heat, altitude, and surface modifiers as multiplicative (or additive in speed-space) factors.
   - Continue to use the same reverse-normalization to match the target.

7. Numerical and UX polish
   - Switch pace chart smoothing to O(N) with a sliding window or cumulative-sum technique in distance-space.
   - Provide tooltips explaining that paces are normalized to the target time.
   - Offer “equivalent distance” diagnostics per segment: `Leq_i = Li·Fi`.

## Example (conceptual)

- Suppose `Pbase = 8:00 / mi`, `D = 10 mi`.
- Two segments: 5 mi at moderate uphill (Fi ≈ 1.10), 5 mi at moderate downhill (Fi ≈ 0.95).
- Equivalent distance: `E = 5·1.10 + 5·0.95 = 10.25 mi`.
- Scale: `S = D / E = 10 / 10.25 ≈ 0.9756`.
- Per-segment pace:
  - Uphill: `P = 8:00 × 1.10 × 0.9756 ≈ 8:35 / mi`
  - Downhill: `P = 8:00 × 0.95 × 0.9756 ≈ 7:25 / mi`
- Total time matches `Pbase × D = 80 minutes` (travel only), by construction.

---

This reverse-normalization makes per-segment pacing actionable while honoring a user’s target. The integral factor improves accuracy in mixed-gradient segments, and smoothing produces stable, realistic pace curves without over-smoothing the elevation data. The Improvements section outlines next steps to further enhance realism and user control.