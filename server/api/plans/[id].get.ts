import {
  plans,
  courses,
  waypoints,
  waypointNotes,
  waypointStoppageTimes,
} from "~/utils/db/schema";
import { auth } from "~/utils/auth";
import { cloudDb } from "~~/server/utils/db/cloud";
import { eq, and } from "drizzle-orm";

/**
 * Unified Plan Endpoint
 *
 * GET /api/plans/:id
 *
 * Behaviors:
 *  - Authenticated request where session.user.id === plan.userId:
 *      mode = "member"
 *      Returns full plan (owner/member projection) + embedded minimal course + waypoints +
 *      full waypoint notes & stoppage times (same shapes as existing member endpoints).
 *
 *  - Authenticated (non-owner) or Unauthenticated request:
 *      * If plan.shareEnabled = true:
 *          mode = "public"
 *          Returns sanitized public projection (no userId, no internal IDs beyond waypoint/plan/course IDs,
 *          no provenance, no raw course file fields, notes & stoppage times stripped of userId/planId).
 *        (Capabilities all false; read-only.)
 *      * Else 404 (do not disclose existence).
 *
 * Response Shape (member):
 * {
 *   mode: "member",
 *   capabilities: { ... },
 *   plan: { ...full plan fields... },
 *   course: { ...sanitized minimal course..., waypoints: [...] },
 *   notes: [... full waypointNotes rows ...],
 *   stoppageTimes: [... full waypointStoppageTimes rows ...]
 * }
 *
 * Response Shape (public):
 * {
 *   mode: "public",
 *   capabilities: { ... all false ... },
 *   plan: { id, courseId, name, pace, paceUnit, paceMode, targetTimeSeconds, defaultStoppageTime,
 *           useGradeAdjustment, pacingStrategy, pacingLinearPercent, shareEnabled,
 *           createdAt, updatedAt, _omitted: [...] },
 *   course: { id, name, description, totalDistance, elevationGain, elevationLoss,
 *             raceDate, geoJsonData, waypoints: [...], _omitted: [...] },
 *   notes: [ { waypointId, notes } ],
 *   stoppageTimes: [ { waypointId, stoppageTime } ]
 * }
 *
 * (Public mode intentionally excludes: plan.userId, course.userId, course.originalFileName/content,
 *  forkedFromCourseId, internal note/stoppage record IDs, userId fields.)
 */

export default defineEventHandler(async (event) => {
  try {
    const planId = getRouterParam(event, "id");
    if (!planId) {
      throw createError({
        statusCode: 400,
        statusMessage: "Plan ID is required",
      });
    }

    const session = await auth.api.getSession({
      headers: event.headers,
    });
    const requesterId = session?.user?.id || null;

    // Fetch the plan first
    const [rawPlan] = await cloudDb
      .select()
      .from(plans)
      .where(eq(plans.id, planId))
      .limit(1);

    if (!rawPlan) {
      throw createError({
        statusCode: 404,
        statusMessage: "Plan not found",
      });
    }

    const isOwner = requesterId === rawPlan.userId;
    const shareEnabled = !!rawPlan.shareEnabled;

    // If not owner and not share enabled => 404 (no existence disclosure)
    if (!isOwner && !shareEnabled) {
      throw createError({
        statusCode: 404,
        statusMessage: "Plan not found",
      });
    }

    // Fetch minimal course context (always needed for display)
    const [courseRow] = await cloudDb
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
        userId: courses.userId,
        public: courses.public,
        shareEnabled: courses.shareEnabled,
        forkedFromCourseId: courses.forkedFromCourseId,
        originalFileName: courses.originalFileName,
        originalFileContent: courses.originalFileContent,
      })
      .from(courses)
      .where(eq(courses.id, rawPlan.courseId))
      .limit(1);

    if (!courseRow) {
      // If underlying course disappeared
      throw createError({
        statusCode: 404,
        statusMessage: "Parent course not found",
      });
    }

    // Fetch waypoints for the course
    const courseWaypoints = await cloudDb
      .select()
      .from(waypoints)
      .where(eq(waypoints.courseId, rawPlan.courseId))
      .orderBy(waypoints.order);

    const formattedWaypoints = courseWaypoints.map((w) => ({
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

    // Helper: derive capabilities
    function deriveCapabilities(mode: "member" | "public") {
      if (mode === "public") {
        return {
          canEditPlan: false,
          canDeletePlan: false,
          canTogglePlanShare: false,
          canMutateNotes: false,
          canViewCourse: true,
        };
      }
      return {
        canEditPlan: true,
        canDeletePlan: true,
        canTogglePlanShare: true,
        canMutateNotes: true,
        canViewCourse: true,
      };
    }

    // MEMBER MODE
    if (isOwner) {
      const notes = await cloudDb
        .select()
        .from(waypointNotes)
        .where(
          and(
            eq(waypointNotes.planId, planId),
            eq(waypointNotes.userId, rawPlan.userId),
          ),
        );

      const stoppageTimes = await cloudDb
        .select()
        .from(waypointStoppageTimes)
        .where(eq(waypointStoppageTimes.planId, planId));

      const capabilities = deriveCapabilities("member");

      const memberPlan = {
        ...rawPlan,
      };

      const sanitizedCourse = {
        id: courseRow.id,
        name: courseRow.name,
        description: courseRow.description,
        geoJsonData: courseRow.geoJsonData,
        totalDistance: courseRow.totalDistance,
        elevationGain: courseRow.elevationGain,
        elevationLoss: courseRow.elevationLoss,
        raceDate: courseRow.raceDate,
        public: courseRow.public,
        shareEnabled: courseRow.shareEnabled,
        createdAt: courseRow.createdAt,
        updatedAt: courseRow.updatedAt,
        waypoints: formattedWaypoints,
      };

      return {
        mode: "member" as const,
        capabilities,
        plan: memberPlan,
        course: sanitizedCourse,
        notes,
        stoppageTimes,
      };
    }

    // PUBLIC MODE
    // sanitize plan
    const publicPlan = {
      id: rawPlan.id,
      courseId: rawPlan.courseId,
      name: rawPlan.name,
      pace: rawPlan.pace,
      paceUnit: rawPlan.paceUnit,
      paceMode: rawPlan.paceMode,
      targetTimeSeconds: rawPlan.targetTimeSeconds,
      defaultStoppageTime: rawPlan.defaultStoppageTime,
      useGradeAdjustment: rawPlan.useGradeAdjustment,
      pacingStrategy: rawPlan.pacingStrategy,
      pacingLinearPercent: rawPlan.pacingLinearPercent,
      shareEnabled: rawPlan.shareEnabled,
      createdAt: rawPlan.createdAt,
      updatedAt: rawPlan.updatedAt,
      _omitted: ["userId"],
    };

    const publicCourse = {
      id: courseRow.id,
      name: courseRow.name,
      description: courseRow.description,
      geoJsonData: courseRow.geoJsonData,
      totalDistance: courseRow.totalDistance,
      elevationGain: courseRow.elevationGain,
      elevationLoss: courseRow.elevationLoss,
      raceDate: courseRow.raceDate,
      createdAt: courseRow.createdAt,
      updatedAt: courseRow.updatedAt,
      waypoints: formattedWaypoints,
      _omitted: [
        "userId",
        "originalFileName",
        "originalFileContent",
        "forkedFromCourseId",
      ],
    };

    // Public notes (strip internal identifiers)
    const rawNotes = await cloudDb
      .select({
        waypointId: waypointNotes.waypointId,
        notes: waypointNotes.notes,
      })
      .from(waypointNotes)
      .where(eq(waypointNotes.planId, planId));

    const rawStoppage = await cloudDb
      .select({
        waypointId: waypointStoppageTimes.waypointId,
        stoppageTime: waypointStoppageTimes.stoppageTime,
      })
      .from(waypointStoppageTimes)
      .where(eq(waypointStoppageTimes.planId, planId));

    const capabilities = deriveCapabilities("public");

    return {
      mode: "public" as const,
      capabilities,
      plan: publicPlan,
      course: publicCourse,
      notes: rawNotes,
      stoppageTimes: rawStoppage,
    };
  } catch (error) {
    if (error && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error("Error fetching plan:", error);
    throw createError({
      statusCode: 500,
      statusMessage: "Failed to fetch plan",
    });
  }
});
