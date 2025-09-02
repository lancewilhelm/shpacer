/**
 * Shared UI constants for panel sizing and clamp helpers.
 * Keep all pixel-based clamp values centralized here so we can
 * change them easily without hunting through multiple files.
 */

/**
 * Waypoint panel (right side) width constraints, in pixels.
 */
export const WAYPOINT_PANEL_MIN_WIDTH = 240;
export const WAYPOINT_PANEL_MAX_WIDTH = 1000;

/**
 * Chart panel (top section) height constraints, in pixels.
 * Applies to both course and plan view modes.
 */
export const CHART_PANEL_MIN_HEIGHT = 150;
export const CHART_PANEL_MAX_HEIGHT = 1000;

/**
 * Clamp a width value to the waypoint panel's allowed range.
 */
export function clampWaypointPanelWidth(width: number): number {
  return Math.max(
    WAYPOINT_PANEL_MIN_WIDTH,
    Math.min(WAYPOINT_PANEL_MAX_WIDTH, width),
  );
}

/**
 * Clamp a height value to the chart panel's allowed range.
 */
export function clampChartPanelHeight(height: number): number {
  return Math.max(
    CHART_PANEL_MIN_HEIGHT,
    Math.min(CHART_PANEL_MAX_HEIGHT, height),
  );
}
