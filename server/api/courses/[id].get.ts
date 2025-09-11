import { courses, userCourses, waypoints } from "~/utils/db/schema";
import { cloudDb } from "~~/server/utils/db/cloud";
import { eq, and } from "drizzle-orm";
import { auth } from "~/utils/auth";

/**
 * Unified Course Endpoint
 *
 * Behaviors:
 * - Authenticated (member) request:
 *    * Returns full member course (including originalFileName/content) + role + embedded waypoints.
 *    * mode = "member"
 * - Unauthenticated (guest) request:
 *    * If course.shareEnabled = true => returns sanitized public projection (no userId, no original file fields, no provenance).
 *    * mode = "public"
 *    * Otherwise returns 404 (no existence disclosure beyond that).
 *
 * Response Shape:
 * {
 *   mode: "member" | "public",
 *   capabilities: { ... },
 *   course: { ... , waypoints: [...] }
 * }
 *
 * NOTE: Plan data, waypoint notes, and stoppage times are intentionally excluded in public mode.
 */
export default defineEventHandler(async (event) => {
  try {
    const courseId = getRouterParam(event, "id");
    if (!courseId) {
      throw createError({
        statusCode: 400,
        statusMessage: "Course ID is required",
      });
    }

    const session = await auth.api.getSession({
      headers: event.headers,
    });

    const isMemberRequest = !!session?.user?.id;

    // Helper: derive capabilities
    function deriveCapabilities(input: {
      mode: "member" | "public";
      role?: "owner" | "starred";
    }) {
      if (input.mode === "public") {
        return {
          canEditCourse: false,
          canDeleteCourse: false,
          canTogglePublic: false,
          canToggleShare: false,
          canManagePlans: false,
          canViewPlans: false,
          canEditWaypoints: false,
          canMutateNotes: false,
          canClone: false,
          canDownloadOriginal: false,
          canSeeRawFileName: false,
        };
      }
      const isOwner = input.role === "owner";
      return {
        canEditCourse: isOwner,
        canDeleteCourse: isOwner,
        canTogglePublic: isOwner,
        canToggleShare: isOwner,
        canManagePlans: isOwner,
        canViewPlans: true,
        canEditWaypoints: isOwner,
        canMutateNotes: isOwner,
        canClone: true,
        canDownloadOriginal: true,
        canSeeRawFileName: isOwner,
      };
    }

    // MEMBER MODE
    if (isMemberRequest) {
      const [course] = await cloudDb
        .select({
          id: courses.id,
          name: courses.name,
          description: courses.description,
          originalFileName: courses.originalFileName,
          originalFileContent: courses.originalFileContent,
          fileType: courses.fileType,
          geoJsonData: courses.geoJsonData,
          totalDistance: courses.totalDistance,
          elevationGain: courses.elevationGain,
          elevationLoss: courses.elevationLoss,
          raceDate: courses.raceDate,
          createdAt: courses.createdAt,
          updatedAt: courses.updatedAt,
          userId: courses.userId,
          public: courses.public,
          forkedFromCourseId: courses.forkedFromCourseId,
          shareEnabled: courses.shareEnabled,
          role: userCourses.role,
        })
        .from(userCourses)
        .innerJoin(courses, eq(userCourses.courseId, courses.id))
        .where(
          and(
            eq(userCourses.courseId, courseId),
            eq(userCourses.userId, session!.user!.id),
          ),
        )
        .limit(1);

      if (!course) {
        throw createError({
          statusCode: 404,
          statusMessage: "Course not found",
        });
      }

      const courseWaypoints = await cloudDb
        .select()
        .from(waypoints)
        .where(eq(waypoints.courseId, courseId))
        .orderBy(waypoints.order);

      const formattedWaypoints = courseWaypoints.map((w) => ({
        id: w.id,
        name: w.name,
        description: w.description,
        lat: parseFloat(w.lat),
        lng: parseFloat(w.lng),
        elevation: w.elevation,
        distance: w.distance,
        tags: JSON.parse(w.tags as string),
        order: w.order,
        icon: w.icon,
      }));

      const capabilities = deriveCapabilities({
        mode: "member",
        role: course.role as "owner" | "starred" | undefined,
      });

      return {
        mode: "member" as const,
        capabilities,
        course: {
          ...course,
          waypoints: formattedWaypoints,
        },
      };
    }

    // PUBLIC (GUEST) MODE
    // Fetch raw course directly (no membership join)
    const [publicCourse] = await cloudDb
      .select({
        id: courses.id,
        name: courses.name,
        description: courses.description,
        geoJsonData: courses.geoJsonData,
        totalDistance: courses.totalDistance,
        elevationGain: courses.elevationGain,
        elevationLoss: courses.elevationLoss,
        raceDate: courses.raceDate,
        createdAt: courses.createdAt,
        updatedAt: courses.updatedAt,
        public: courses.public,
        shareEnabled: courses.shareEnabled,
      })
      .from(courses)
      .where(eq(courses.id, courseId))
      .limit(1);

    if (!publicCourse || !publicCourse.shareEnabled) {
      // Uniform "not found" to avoid revealing private existence
      throw createError({
        statusCode: 404,
        statusMessage: "Course not found",
      });
    }

    const publicWaypoints = await cloudDb
      .select()
      .from(waypoints)
      .where(eq(waypoints.courseId, courseId))
      .orderBy(waypoints.order);

    const sanitizedWaypoints = publicWaypoints.map((w) => ({
      id: w.id,
      name: w.name,
      description: w.description,
      lat: parseFloat(w.lat),
      lng: parseFloat(w.lng),
      elevation: w.elevation,
      distance: w.distance,
      order: w.order,
      tags: JSON.parse(w.tags as string),
      icon: w.icon,
    }));

    const capabilities = deriveCapabilities({ mode: "public" });

    return {
      mode: "public" as const,
      capabilities,
      course: {
        ...publicCourse,
        waypoints: sanitizedWaypoints,
        _omitted: [
          "userId",
          "originalFileContent",
          "originalFileName",
          "forkedFromCourseId",
          "role",
          "plans",
          "waypointNotes",
          "waypointStoppageTimes",
        ],
      },
    };
  } catch (error) {
    // If it's already a handled error (createError), rethrow
    if (error && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error("Error fetching course:", error);
    throw createError({
      statusCode: 500,
      statusMessage: "Failed to fetch course",
    });
  }
});
