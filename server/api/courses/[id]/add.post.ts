import { defineEventHandler, createError, getRouterParam } from "#imports";
import { auth } from "~/utils/auth";
import { cloudDb } from "~~/server/utils/db/cloud";
import { courses, userCourses, users } from "~/utils/db/schema";
import { and, eq } from "drizzle-orm";

/**
 * POST /api/courses/:id/add
 *
 * Adds a public course (or any course the user doesn't already have) to the
 * current user's course memberships with role = 'added'.
 *
 * Rules:
 * - Auth required.
 * - If the user already owns or added the course: return success with flags.
 * - If the course is private and the user is not the owner: 403.
 * - If the course is public and user not yet a member: insert membership row.
 *
 * Response shape:
 * {
 *   success: boolean;
 *   alreadyOwned?: boolean;
 *   alreadyAdded?: boolean;
 *   membership?: {
 *     userId: string;
 *     courseId: string;
 *     role: 'owner' | 'added';
 *   };
 *   course?: {
 *     id: string;
 *     name: string;
 *     description: string | null;
 *     public: boolean;
 *     totalDistance: number | null;
 *     elevationGain: number | null;
 *     elevationLoss: number | null;
 *     raceDate: Date | null;
 *     createdAt: Date;
 *     updatedAt: Date;
 *     ownerId: string;
 *     ownerName: string | null;
 *     role: 'owner' | 'added';
 *   };
 * }
 */
export default defineEventHandler(async (event) => {
  // Auth
  const session = await auth.api.getSession({ headers: event.headers });
  if (!session?.user?.id) {
    throw createError({
      statusCode: 401,
      statusMessage: "Unauthorized",
    });
  }
  const userId = session.user.id;

  // Course ID from route
  const courseId = getRouterParam(event, "id");
  if (!courseId) {
    throw createError({
      statusCode: 400,
      statusMessage: "Course ID is required",
    });
  }

  try {
    // Fetch course (minimal fields)
    const [courseRow] = await cloudDb
      .select({
        id: courses.id,
        name: courses.name,
        description: courses.description,
        public: courses.public,
        totalDistance: courses.totalDistance,
        elevationGain: courses.elevationGain,
        elevationLoss: courses.elevationLoss,
        raceDate: courses.raceDate,
        createdAt: courses.createdAt,
        updatedAt: courses.updatedAt,
        ownerId: courses.userId,
        ownerName: users.name,
      })
      .from(courses)
      .leftJoin(users, eq(users.id, courses.userId))
      .where(eq(courses.id, courseId))
      .limit(1);

    if (!courseRow) {
      throw createError({
        statusCode: 404,
        statusMessage: "Course not found",
      });
    }

    // Owner case
    if (courseRow.ownerId === userId) {
      return {
        success: true,
        alreadyOwned: true,
        course: {
          ...courseRow,
          role: "owner" as const,
        },
        membership: {
          userId,
          courseId,
          role: "owner" as const,
        },
      };
    }

    // Private course and not owner
    if (!courseRow.public) {
      throw createError({
        statusCode: 403,
        statusMessage: "Course is private",
      });
    }

    // Check existing membership
    const [existingMembership] = await cloudDb
      .select({
        userId: userCourses.userId,
        courseId: userCourses.courseId,
        role: userCourses.role,
      })
      .from(userCourses)
      .where(
        and(
          eq(userCourses.userId, userId),
            eq(userCourses.courseId, courseId),
        ),
      )
      .limit(1);

    if (existingMembership) {
      return {
        success: true,
        alreadyAdded: existingMembership.role !== "owner",
        course: {
          ...courseRow,
          role: (existingMembership.role as "owner" | "added") ?? "added",
        },
        membership: {
          userId: existingMembership.userId,
          courseId: existingMembership.courseId,
          role: existingMembership.role as "owner" | "added",
        },
      };
    }

    // Insert new membership
    await cloudDb.insert(userCourses).values({
      userId,
      courseId,
      role: "added",
    });

    return {
      success: true,
      membership: {
        userId,
        courseId,
        role: "added" as const,
      },
      course: {
        ...courseRow,
        role: "added" as const,
      },
    };
  } catch (error) {
    if (error && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error("Error adding public course:", error);
    throw createError({
      statusCode: 500,
      statusMessage: "Failed to add course",
    });
  }
});
