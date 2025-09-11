/**
 * SSR-safe unit helper utilities to consolidate unit resolution and formatting.
 *
 * These helpers attempt to use the Pinia user settings store when it's fully
 * available, but gracefully fall back to course defaults (or sensible global
 * defaults) during SSR or other cases where store actions may not be attached.
 */

import type { DistanceUnit, ElevationUnit } from "~/stores/userSettings";
import { formatDistance, formatElevation } from "~/utils/courseMetrics";
import { useUserSettingsStore } from "~/stores/userSettings";

/**
 * Course-provided defaults that may come with a course entity.
 */
export interface CourseUnitDefaults {
  defaultDistanceUnit?: DistanceUnit; // "kilometers" | "miles"
  defaultElevationUnit?: ElevationUnit; // "meters" | "feet"
}

/**
 * Try to obtain a usable user settings store instance.
 * Returns null if the instance is missing or does not expose the expected methods at runtime.
 */
function tryGetUserSettingsStore():
  | (ReturnType<typeof useUserSettingsStore> & {
      resolveUnitsForCourse?: (course?: Partial<CourseUnitDefaults>) => {
        distance: DistanceUnit;
        elevation: ElevationUnit;
      };
    })
  | null {
  // Acquire the store. In Nuxt + Pinia this is safe at runtime, but
  // we still check that expected methods exist before using them.
  const store: unknown = (() => {
    try {
      return useUserSettingsStore();
    } catch {
      return null;
    }
  })();

  if (
    store &&
    typeof store === "object" &&
    "resolveUnitsForCourse" in store &&
    typeof (store as { resolveUnitsForCourse: unknown })
      .resolveUnitsForCourse === "function"
  ) {
    return store as ReturnType<typeof useUserSettingsStore> & {
      resolveUnitsForCourse: (course?: Partial<CourseUnitDefaults>) => {
        distance: DistanceUnit;
        elevation: ElevationUnit;
      };
    };
  }

  return null;
}

/**
 * Resolve the distance/elevation units to use for a given course in an SSR-safe way.
 * Prefers user settings (via Pinia) when available, else falls back to course defaults,
 * else to global sensible defaults: distance="miles", elevation="feet".
 */
export function resolveUnitsForCourseSSR(
  course?: Partial<CourseUnitDefaults>,
): {
  distance: DistanceUnit;
  elevation: ElevationUnit;
} {
  const store = tryGetUserSettingsStore();
  if (store?.resolveUnitsForCourse) {
    return store.resolveUnitsForCourse(course);
  }

  return {
    distance: (course?.defaultDistanceUnit ?? "miles") as DistanceUnit,
    elevation: (course?.defaultElevationUnit ?? "feet") as ElevationUnit,
  };
}

/**
 * Resolve distance unit for a course, SSR-safe.
 */
export function getDistanceUnitSSR(
  course?: Partial<Pick<CourseUnitDefaults, "defaultDistanceUnit">>,
): DistanceUnit {
  return resolveUnitsForCourseSSR(course as Partial<CourseUnitDefaults>)
    .distance;
}

/**
 * Resolve elevation unit for a course, SSR-safe.
 */
export function getElevationUnitSSR(
  course?: Partial<Pick<CourseUnitDefaults, "defaultElevationUnit">>,
): ElevationUnit {
  return resolveUnitsForCourseSSR(course as Partial<CourseUnitDefaults>)
    .elevation;
}

/**
 * Format a distance using resolved (SSR-safe) units.
 * Returns an empty string for nullish meters for convenience in templates.
 */
export function formatCourseDistanceSSR(
  meters?: number | null,
  course?: Partial<CourseUnitDefaults>,
): string {
  if (meters == null) return "";
  const unit = getDistanceUnitSSR(course);
  return formatDistance(meters, unit);
}

/**
 * Format an elevation using resolved (SSR-safe) units.
 * Returns an empty string for nullish meters for convenience in templates.
 */
export function formatCourseElevationSSR(
  meters?: number | null,
  course?: Partial<CourseUnitDefaults>,
): string {
  if (meters == null) return "";
  const unit = getElevationUnitSSR(course);
  return formatElevation(meters, unit);
}
