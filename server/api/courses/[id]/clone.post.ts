import { and, eq } from "drizzle-orm";
import { auth } from "~/utils/auth";
import { courses, waypoints, userCourses } from "~/utils/db/schema";
import type {
  InsertCourse,
  InsertUserCourse,
  InsertWaypoint,
} from "~/utils/db/schema";
import { cloudDb } from "~~/server/utils/db/cloud";

/**
 * POST /api/courses/:id/clone
 *
 * Clones an existing course (and its waypoints) into a brand new private course
 * owned by the requesting user.
 *
 * Rules:
 *  - Source course must be public OR the requester must be the owner.
 *  - Added (non-owner) membership to a private course is insufficient.
 *  - The cloned course is always created as private (public = false) initially.
 *  - Provenance is stored in forkedFromCourseId on the new course.
 *
 * Response:
 * {
 *   success: true,
 *   course: { ...newCourse, role: "owner" },
 *   provenance: {
 *     forkedFromCourseId: string;
 *     sourceName: string;
 *     sourceOwnerId: string;
 *   },
 *   waypointCount: number
 * }
 */
export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({
    headers: event.headers,
  });

  if (!session?.user?.id) {
    throw createError({
      statusCode: 401,
      statusMessage: "Unauthorized",
    });
  }

  const sourceCourseId = getRouterParam(event, "id");

  if (!sourceCourseId) {
    throw createError({
      statusCode: 400,
      statusMessage: "Course ID is required",
    });
  }

  try {
    // 1. Fetch the source course
    const [sourceCourse] = await cloudDb
      .select()
      .from(courses)
      .where(eq(courses.id, sourceCourseId))
      .limit(1);

    if (!sourceCourse) {
      throw createError({
        statusCode: 404,
        statusMessage: "Source course not found",
      });
    }

    // 2. Permission check
    if (!sourceCourse.public) {
      // Must be the owner (membership role = owner)
      const [ownerMembership] = await cloudDb
        .select({ role: userCourses.role })
        .from(userCourses)
        .where(
          and(
            eq(userCourses.courseId, sourceCourseId),
            eq(userCourses.userId, session.user.id),
            eq(userCourses.role, "owner"),
          ),
        )
        .limit(1);

      if (!ownerMembership) {
        throw createError({
          statusCode: 403,
          statusMessage:
            "You do not have permission to clone this private course",
        });
      }
    }

    // 3. Retrieve source waypoints
    const sourceWaypoints = await cloudDb
      .select()
      .from(waypoints)
      .where(eq(waypoints.courseId, sourceCourseId))
      .orderBy(waypoints.order);

    // 4. Create the new course (private by default)
    const newCourseValues: InsertCourse = {
      name: `Copy of ${sourceCourse.name}`,
      description: sourceCourse.description,
      userId: session.user.id,
      originalFileName: sourceCourse.originalFileName,
      originalFileContent: sourceCourse.originalFileContent,
      fileType: sourceCourse.fileType,
      geoJsonData: sourceCourse.geoJsonData,
      totalDistance: sourceCourse.totalDistance,
      elevationGain: sourceCourse.elevationGain,
      elevationLoss: sourceCourse.elevationLoss,
      raceDate: sourceCourse.raceDate,
      public: false, // always start private
      forkedFromCourseId: sourceCourse.id,
      defaultDistanceUnit: sourceCourse.defaultDistanceUnit,
      defaultElevationUnit: sourceCourse.defaultElevationUnit,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const [newCourse] = await cloudDb
      .insert(courses)
      .values(newCourseValues)
      .returning();

    if (!newCourse?.id) {
      throw createError({
        statusCode: 500,
        statusMessage: "Failed to insert cloned course",
      });
    }

    // 5. Insert owner membership for the new course
    const ownerMembershipInsert: InsertUserCourse = {
      userId: session.user.id,
      courseId: newCourse.id,
      role: "owner",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    try {
      await cloudDb.insert(userCourses).values(ownerMembershipInsert);
    } catch (e) {
      // Not fatal—log for observability
      console.warn(
        "Failed to create user_courses owner row for cloned course",
        e,
      );
    }

    // 6. Clone waypoints (if any)
    if (sourceWaypoints.length > 0) {
      const waypointInserts: InsertWaypoint[] = sourceWaypoints.map((wp) => ({
        courseId: newCourse.id,
        name: wp.name,
        description: wp.description,
        lat: wp.lat,
        lng: wp.lng,
        elevation: wp.elevation,
        distance: wp.distance,
        order: wp.order,
        tags: wp.tags,
        icon: wp.icon,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));

      // Bulk insert
      await cloudDb.insert(waypoints).values(waypointInserts);
    }

    return {
      success: true,
      course: {
        ...newCourse,
        // Explicitly surface provenance for frontend consumers
        forkedFromCourseId: sourceCourse.id,
        role: "owner" as const,
      },
      provenance: {
        forkedFromCourseId: sourceCourse.id,
        sourceName: sourceCourse.name,
        sourceOwnerId: sourceCourse.userId,
      },
      waypointCount: sourceWaypoints.length,
    };
  } catch (error) {
    console.error("Error cloning course:", error);
    if (error && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    throw createError({
      statusCode: 500,
      statusMessage: "Failed to clone course",
    });
  }
});

/**
 * NOTE (Next Step):
 * To fully enforce "only owners can create plans" (as discussed),
 * update POST /api/courses/:id/plans to require membership.role === 'owner'
 * instead of allowing added members. That change is separate from this endpoint.
 */
