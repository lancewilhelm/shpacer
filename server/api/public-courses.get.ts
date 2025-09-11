import { defineEventHandler, getQuery, createError } from "#imports";
import { auth } from "~/utils/auth";
import { cloudDb } from "~~/server/utils/db/cloud";
import { courses, userCourses, users } from "~/utils/db/schema";
import { and, eq, sql, type SQL } from "drizzle-orm";

/**
 * GET /api/public-courses
 *
 * Search & paginate public courses a user has NOT already starred (no membership row).
 *
 * Query Parameters:
 *  - q: (optional) search term (matches course name, case-insensitive, partial)
 *  - page: (optional) page number (1-based, default 1)
 *  - pageSize: (optional) items per page (default 20, max 100)
 *
 * Response:
 * {
 *   success: boolean,
 *   page: number,
 *   pageSize: number,
 *   total: number,
 *   totalPages: number,
 *   courses: Array<{
 *     id: string;
 *     name: string;
 *     description: string | null;
 *     totalDistance: number | null;
 *     elevationGain: number | null;
 *     elevationLoss: number | null;
 *     raceDate: Date | null;
 *     createdAt: Date;
 *     updatedAt: Date;
 *     ownerId: string;
 *     ownerName: string | null;
 *     defaultDistanceUnit: "kilometers" | "miles";
 *     defaultElevationUnit: "meters" | "feet";
 *   }>
 * }
 */
export default defineEventHandler(async (event) => {
  try {
    // Require auth (adjust if anonymous browsing should be allowed)
    const session = await auth.api.getSession({ headers: event.headers });

    if (!session?.user?.id) {
      throw createError({
        statusCode: 401,
        statusMessage: "Unauthorized",
      });
    }

    const query = getQuery(event);
    const rawQ = typeof query.q === "string" ? query.q.trim() : "";
    const page =
      typeof query.page === "string" && !isNaN(Number(query.page))
        ? Math.max(1, parseInt(query.page, 10))
        : 1;
    const pageSizeRaw =
      typeof query.pageSize === "string" && !isNaN(Number(query.pageSize))
        ? parseInt(query.pageSize, 10)
        : 20;
    const pageSize = Math.min(Math.max(1, pageSizeRaw), 100);
    const offset = (page - 1) * pageSize;

    // Dynamic WHERE conditions
    const conditions: SQL[] = [];

    // Only public courses
    conditions.push(eq(courses.public, true));

    // Exclude any course already in user's memberships (owner or starred)
    // We'll do this by LEFT JOIN + IS NULL filter in the select queries
    // (Implemented in join conditions below)

    // Search filter (case-insensitive on name)
    let searchFilter = undefined;
    if (rawQ) {
      const lowered = rawQ.toLowerCase();
      // Using SQL fragment for lower() since SQLite lacks ILIKE
      searchFilter = sql`lower(${courses.name}) like ${"%" + lowered + "%"}`;
      conditions.push(searchFilter);
    }

    // Total count (with membership exclusion)
    const [{ value: total }] = await cloudDb
      .select({
        value: sql<number>`count(*)`,
      })
      .from(courses)
      .leftJoin(
        userCourses,
        and(
          eq(userCourses.courseId, courses.id),
          eq(userCourses.userId, session.user.id),
        ),
      )
      .where(
        and(
          ...conditions,
          // membership row must be null (user not already added / owner)
          sql`(${userCourses.userId} IS NULL)`,
        ),
      );

    const results = await cloudDb
      .select({
        id: courses.id,
        name: courses.name,
        description: courses.description,
        totalDistance: courses.totalDistance,
        elevationGain: courses.elevationGain,
        elevationLoss: courses.elevationLoss,
        raceDate: courses.raceDate,
        createdAt: courses.createdAt,
        updatedAt: courses.updatedAt,
        defaultDistanceUnit: courses.defaultDistanceUnit,
        defaultElevationUnit: courses.defaultElevationUnit,
        ownerId: courses.userId,
        ownerName: users.name,
      })
      .from(courses)
      .leftJoin(
        userCourses,
        and(
          eq(userCourses.courseId, courses.id),
          eq(userCourses.userId, session.user.id),
        ),
      )
      .leftJoin(users, eq(users.id, courses.userId))
      .where(
        and(
          ...conditions,
          // Ensure the user does not already have this course (not owner or added)
          sql`(${userCourses.userId} IS NULL)`,
        ),
      )
      .orderBy(sql`${courses.createdAt} DESC`)
      .limit(pageSize)
      .offset(offset);

    const totalPages = total === 0 ? 1 : Math.ceil(total / pageSize);

    return {
      success: true,
      page,
      pageSize,
      total,
      totalPages,
      courses: results,
    };
  } catch (error) {
    console.error("Error searching public courses:", error);
    throw createError({
      statusCode: 500,
      statusMessage: "Failed to fetch public courses",
    });
  }
});
