/**
 * Calculates pace adjustment factor based on terrain gradient.
 *
 * This function uses a piecewise equation to convert grade (gradient) to a pace factor.
 * The equation consists of:
 * - Linear segments for extreme gradients (< -32.25% and > 32.1%)
 * - A 4th-degree polynomial for moderate gradients (-32.25% to 32.1%)
 *
 * @param gradient The gradient as a percentage (e.g., 10 for 10% grade)
 * @returns The pace adjustment factor (multiplier for base pace)
 */
export function paceAdjustment(gradient: number): number {
  // Constrained 4th-degree polynomial coefficients
  const a4 = -4.3144778100289634e-7;
  const a3 = -2.930257313334705e-6;
  const a2 = 0.0018738529522439088;
  const a1 = 0.03076354335605815;
  const a0 = 1.0;  // Fixed intercept

  // Transition points
  const leftEnd = -32.25;
  const rightEnd = 32.1;

  // Precomputed tangents for continuity
  const slopeLeft = -0.041356411457441594;
  const interceptLeft = 0.25463237016735074;

  const slopeRight = 0.08492425850523927;
  const interceptRight = 0.6372687773774661;

  if (gradient < leftEnd) {
    return slopeLeft * gradient + interceptLeft;
  } else if (gradient > rightEnd) {
    return slopeRight * gradient + interceptRight;
  } else {
    return (
      a4 * Math.pow(gradient, 4) +
      a3 * Math.pow(gradient, 3) +
      a2 * Math.pow(gradient, 2) +
      a1 * gradient +
      a0
    );
  }
}

/**
 * Adjusts a base pace by applying the gradient-based pace factor.
 *
 * @param basePace The base pace in seconds (per km or mile, depending on units)
 * @param gradient The gradient as a percentage
 * @returns The adjusted pace in the same units as the base pace
 */
export function adjustPaceForGrade(basePace: number, gradient: number): number {
  const adjustmentFactor = paceAdjustment(gradient);
  return basePace * adjustmentFactor;
}
