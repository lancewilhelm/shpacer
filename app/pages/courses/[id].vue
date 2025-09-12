<script setup lang="ts">
import type {
    SelectCourse,
    SelectPlan,
    SelectWaypointNote,
    SelectWaypointStoppageTime,
} from "~/utils/db/schema";
import { formatDistance, formatElevation } from "~/utils/courseMetrics";
import { clampChartPanelHeight } from "~/utils/uiConstants";
import {
    extractElevationProfile,
    interpolateAtDistance,
} from "~/utils/elevationProfile";
import type { DistanceUnit } from "~/stores/userSettings";

// Define the waypoint type that matches what we get from the API
type Waypoint = {
    id: string;
    name: string;
    description: string | null;
    lat: number;
    lng: number;
    elevation: number | null;
    distance: number;
    tags: string[];
    order: number;
};

// Auth guard removed: this page now supports unified public (read‑only) and member modes.
// Access/security is handled by the unified /api/courses/:id endpoint which supplies
// `mode` ("public" | "member") and a capabilities map for gating UI & mutations.

// Get the course ID from the route parameters
const route = useRoute();
const router = useRouter();
const courseId = route.params.id as string;

// Import necessary stores
const userSettingsStore = useUserSettingsStore();
const uiStore = useUiStore();

// Fetch course data
const {
    data: courseData,
    pending,
    error,
    refresh,
} = await useFetch<{
    mode: "member" | "public";
    capabilities: {
        canEditCourse: boolean;
        canDeleteCourse: boolean;
        canTogglePublic: boolean;
        canToggleShare: boolean;
        canManagePlans: boolean;
        canViewPlans: boolean;
        canEditWaypoints: boolean;
        canMutateNotes: boolean;
        canClone: boolean;
        canDownloadOriginal: boolean;
        canSeeRawFileName: boolean;
    };
    course: (SelectCourse & { role?: string }) | null;
}>(`/api/courses/${courseId}`);

// Waypoints are now embedded in the course response (server/api/courses/[id].get.ts)
// Legacy waypoint fetch removed. Use `course.waypoints` directly.
// Provide a no-op refreshWaypoints for existing handlers; call `refresh()` to refetch.
const refreshWaypoints = () => {};

// Fetch plans data
const {
    data: plansData,
    pending: _plansPending,
    error: _plansError,
    refresh: refreshPlans,
} = await useFetch<{ plans: SelectPlan[] }>(`/api/courses/${courseId}/plans`, {
    default: () => ({ plans: [] }),
    onResponseError(ctx) {
        // Public (unauthenticated) mode will 401 here; swallow & leave plans empty.
        if (ctx.response.status === 401) {
            ctx.error = null as unknown as never;
        }
    },
});

// Plans state
const plans = computed(() => plansData.value?.plans || []);
const currentPlanId = ref<string | null>(null);
const publicSharedPlan = ref<SelectPlan | null>(null); // populated when viewing a publicly shared plan (logged-out)

// Initialize plan from URL query parameter
watchEffect(async () => {
    const planIdFromUrl = route.query.plan as string | undefined;
    if (!planIdFromUrl) {
        currentPlanId.value = null;
        publicSharedPlan.value = null;
        return;
    }
    // Member mode: use existing plans list
    const effectiveMode =
        courseData.value?.mode === "public" ? "public" : "member";
    if (effectiveMode === "member") {
        if (plans.value.some((p) => p.id === planIdFromUrl)) {
            currentPlanId.value = planIdFromUrl;
            return;
        }
        if (plans.value.length > 0) {
            const query = { ...route.query };
            delete query.plan;
            router.replace({ path: route.path, query });
        }
        return;
    }
    // Public mode: fetch plan directly (shared plan)
    try {
        const resp = await $fetch<{
            mode: "member" | "public";
            plan: SelectPlan;
            course: unknown;
            notes: { waypointId: string; notes: string }[];
            stoppageTimes: { waypointId: string; stoppageTime: number }[];
        }>(`/api/plans/${planIdFromUrl}`);
        publicSharedPlan.value = resp.plan;
        currentPlanId.value = resp.plan.id;
        // Populate notes / stoppage times with synthetic objects matching SelectWaypointNote/SelectWaypointStoppageTime
        waypointNotes.value = resp.notes.map(
            (n) =>
                ({
                    id: `${resp.plan.id}:${n.waypointId}`,
                    planId: resp.plan.id,
                    waypointId: n.waypointId,
                    userId: "public",
                    notes: n.notes,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                }) as unknown as SelectWaypointNote,
        );
        waypointStoppageTimes.value = resp.stoppageTimes.map(
            (s) =>
                ({
                    id: `${resp.plan.id}:${s.waypointId}`,
                    planId: resp.plan.id,
                    waypointId: s.waypointId,
                    stoppageTime: s.stoppageTime,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                }) as unknown as SelectWaypointStoppageTime,
        );
    } catch (e) {
        console.warn(
            "Failed to load public shared plan (maybe not shared):",
            e,
        );
    }
});
const waypointNotes = ref<SelectWaypointNote[]>([]);
const waypointStoppageTimes = ref<SelectWaypointStoppageTime[]>([]);
const planSetupModalOpen = ref(false);
const editingPlan = ref<SelectPlan | null>(null);
const editingPlanPayload = computed(() => {
    const ep = editingPlan.value;
    if (!ep) return null;
    return {
        id: ep.id,
        name: ep.name,
        pace: ep.pace ?? undefined,
        paceUnit: ep.paceUnit,
        defaultStoppageTime: ep.defaultStoppageTime ?? undefined,
        paceMode: (ep.paceMode as "pace" | "time" | "normalized") ?? undefined,
        targetTimeSeconds: ep.targetTimeSeconds ?? undefined,
        pacingStrategy: (ep.pacingStrategy as "flat" | "linear") ?? "flat",
        pacingLinearPercent: ep.pacingLinearPercent ?? undefined,
    };
});

// Store the course and waypoints data in computed properties
const course = computed(() => courseData.value?.course);

// Unified mode + capabilities (public vs member)
// Converted from computed() defined after usage to early refs to avoid
// temporal initialization issues during SSR hydration when watchEffect
// logic (plan loading) runs before the previous computed declarations
const mode = ref<"member" | "public">("member");
const capabilities = ref({
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
});
// Keep these derived from courseData reactively
watchEffect(() => {
    // Safe guards: only update when response object present
    if (courseData.value?.mode === "public") {
        mode.value = "public";
    } else {
        mode.value = "member";
    }
    if (courseData.value?.capabilities) {
        capabilities.value = courseData.value
            .capabilities as typeof capabilities.value;
    }
});
const waypoints = computed<Waypoint[]>(() => {
    const w = (course.value as { waypoints?: unknown })?.waypoints;
    return Array.isArray(w) ? (w as Waypoint[]) : [];
});
const currentPlan = computed(() =>
    currentPlanId.value
        ? plans.value.find((p) => p.id === currentPlanId.value) ||
          publicSharedPlan.value
        : null,
);

const distanceUnit = computed<DistanceUnit>(() =>
    userSettingsStore.getDistanceUnitForCourse(
        (course.value as unknown as { defaultDistanceUnit?: DistanceUnit }) ||
            undefined,
    ),
);

// Set the page title dynamically; always discourage SEO indexing for any public (shared) view
useHead({
    title: computed(() => course.value?.name || "Course"),
    meta: computed(() => {
        // Always add noindex,nofollow for shared (public mode) pages
        const tags: { name: string; content: string }[] = [];
        if (mode.value === "public") {
            tags.push({ name: "robots", content: "noindex,nofollow" });
        }
        return tags;
    }),
});

// Course edit modal state
const courseEditModalOpen = ref(false);
const courseInfoModalOpen = ref(false);

async function toggleCoursePublic() {
    if (!course.value) return;
    const originalPublic = course.value.public;
    const nextPublic = !originalPublic;

    // Optimistic UI update so the menu item flips immediately
    // Preserve existing waypoints during optimistic update
    const existingWaypoints = (() => {
        const c = course.value as unknown;
        if (
            c &&
            typeof c === "object" &&
            "waypoints" in (c as Record<string, unknown>)
        ) {
            const w = (c as { waypoints?: unknown }).waypoints;
            return Array.isArray(w) ? (w as Waypoint[]) : [];
        }
        return [] as Waypoint[];
    })();
    courseData.value = {
        mode: courseData.value?.mode || mode.value,
        capabilities: courseData.value?.capabilities || capabilities.value,
        course: {
            ...(course.value as SelectCourse),
            public: nextPublic,
            ...(existingWaypoints ? { waypoints: existingWaypoints } : {}),
        },
    };

    try {
        const response = await $fetch<{ course: SelectCourse }>(
            `/api/courses/${course.value.id}`,
            {
                method: "PUT",
                body: {
                    public: nextPublic,
                },
            },
        );
        // Replace with authoritative server response (includes role)
        // Server response omits waypoints; merge them back in to avoid UI flicker
        courseData.value = {
            mode: courseData.value?.mode || mode.value,
            capabilities: courseData.value?.capabilities || capabilities.value,
            course: {
                ...response.course,
                ...((() => {
                    const c = course.value as unknown;
                    if (
                        c &&
                        typeof c === "object" &&
                        "waypoints" in (c as Record<string, unknown>)
                    ) {
                        const w = (c as { waypoints?: unknown }).waypoints;
                        return Array.isArray(w) && w.length > 0 ? w : null;
                    }
                    return null;
                })()
                    ? {
                          waypoints: (() => {
                              const c = course.value as unknown;
                              if (
                                  c &&
                                  typeof c === "object" &&
                                  "waypoints" in (c as Record<string, unknown>)
                              ) {
                                  const w = (c as { waypoints?: unknown })
                                      .waypoints;
                                  return Array.isArray(w)
                                      ? (w as Waypoint[])
                                      : [];
                              }
                              return [];
                          })(),
                      }
                    : {}),
            },
        };
    } catch (err) {
        // Revert on failure
        courseData.value = {
            mode: courseData.value?.mode || mode.value,
            capabilities: courseData.value?.capabilities || capabilities.value,
            course: {
                ...(course.value as SelectCourse),
                public: originalPublic,
            },
        };
        console.error("Failed to toggle course public flag:", err);
        alert("Failed to update course visibility. Please try again.");
    }
}

async function toggleCourseShare() {
    if (!course.value) return;
    const originalShare = !!course.value.shareEnabled;
    const nextShare = !originalShare;

    // Optimistic update
    // Preserve existing waypoints during optimistic share toggle
    const existingWaypointsShare = (() => {
        const c = course.value as unknown;
        if (
            c &&
            typeof c === "object" &&
            "waypoints" in (c as Record<string, unknown>)
        ) {
            const w = (c as { waypoints?: unknown }).waypoints;
            return Array.isArray(w) ? (w as Waypoint[]) : [];
        }
        return [] as Waypoint[];
    })();
    courseData.value = {
        mode: courseData.value?.mode || mode.value,
        capabilities: courseData.value?.capabilities || capabilities.value,
        course: {
            ...(course.value as SelectCourse),
            shareEnabled: nextShare,
            ...(existingWaypointsShare
                ? { waypoints: existingWaypointsShare }
                : {}),
        },
    };

    try {
        const response = await $fetch<{ course: SelectCourse }>(
            `/api/courses/${course.value.id}`,
            {
                method: "PUT",
                body: {
                    shareEnabled: nextShare,
                },
            },
        );
        // Merge waypoints back after server response
        courseData.value = {
            mode: courseData.value?.mode || mode.value,
            capabilities: courseData.value?.capabilities || capabilities.value,
            course: {
                ...response.course,
                ...((() => {
                    const c = course.value as unknown;
                    if (
                        c &&
                        typeof c === "object" &&
                        "waypoints" in (c as Record<string, unknown>)
                    ) {
                        const w = (c as { waypoints?: unknown }).waypoints;
                        return Array.isArray(w) && w.length > 0 ? w : null;
                    }
                    return null;
                })()
                    ? {
                          waypoints: (() => {
                              const c = course.value as unknown;
                              if (
                                  c &&
                                  typeof c === "object" &&
                                  "waypoints" in (c as Record<string, unknown>)
                              ) {
                                  const w = (c as { waypoints?: unknown })
                                      .waypoints;
                                  return Array.isArray(w)
                                      ? (w as Waypoint[])
                                      : [];
                              }
                              return [];
                          })(),
                      }
                    : {}),
            },
        };
    } catch (err) {
        // Revert
        courseData.value = {
            mode: courseData.value?.mode || mode.value,
            capabilities: courseData.value?.capabilities || capabilities.value,
            course: {
                ...(course.value as SelectCourse),
                shareEnabled: originalShare,
            },
        };
        console.error("Failed to toggle course share link:", err);
        alert("Failed to update sharing status. Please try again.");
    }
}

function handleCopyShareLink() {
    if (!course.value?.id || !course.value?.shareEnabled) return;
    const shareUrl = `${window.location.origin}/courses/${course.value.id}`;
    try {
        if (navigator?.clipboard?.writeText) {
            navigator.clipboard.writeText(shareUrl).then(
                () => {
                    // Optional: toast could be added here
                },
                () => {
                    window.alert("Share URL: " + shareUrl);
                },
            );
        } else {
            window.alert("Share URL: " + shareUrl);
        }
    } catch {
        window.alert("Share URL: " + shareUrl);
    }
}

// Clone (copy) the current course (used when user is non-owner)
async function cloneCourse() {
    if (!course.value) return;
    try {
        const resp = await $fetch<{ course: SelectCourse & { role?: string } }>(
            `/api/courses/${course.value.id}/clone`,
            { method: "POST" },
        );
        if (resp?.course?.id) {
            navigateTo(`/courses/${resp.course.id}`);
        }
    } catch (e) {
        console.error(e);
        if (globalThis.alert) {
            globalThis.alert("Failed to copy course");
        }
    }
}
async function toggleCurrentPlanShare() {
    if (!currentPlan.value) return;
    const targetPlanId = currentPlan.value.id;
    const original = !!currentPlan.value.shareEnabled;
    const next = !original;
    // Optimistic update
    if (plansData.value?.plans) {
        const idx = plansData.value.plans.findIndex(
            (p) => p.id === targetPlanId,
        );
        if (idx !== -1) {
            const updated: SelectPlan = {
                ...plansData.value.plans[idx]!,
                shareEnabled: next,
            };
            plansData.value.plans[idx] = updated;
        }
    }
    try {
        const response = await $fetch<{ plan: SelectPlan }>(
            `/api/plans/${targetPlanId}`,
            {
                method: "PUT",
                body: { shareEnabled: next },
            },
        );
        if (plansData.value?.plans) {
            const idx = plansData.value.plans.findIndex(
                (p) => p.id === targetPlanId,
            );
            if (idx !== -1) {
                plansData.value.plans[idx] = response.plan;
            }
        }
    } catch (e) {
        // Revert
        if (plansData.value?.plans) {
            const idx = plansData.value.plans.findIndex(
                (p) => p.id === targetPlanId,
            );
            if (idx !== -1) {
                const reverted: SelectPlan = {
                    ...plansData.value.plans[idx]!,
                    shareEnabled: original,
                };
                plansData.value.plans[idx] = reverted;
            }
        }
        console.error("Failed to toggle plan shareEnabled", e);
        alert("Failed to update plan sharing status.");
    }
}
function copyPlanShareLink() {
    if (!currentPlan.value?.shareEnabled || !course.value?.id) return;
    const url = `${window.location.origin}/courses/${course.value.id}?plan=${currentPlan.value.id}`;
    if (navigator?.clipboard?.writeText) {
        navigator.clipboard.writeText(url).catch(() => alert(url));
    } else {
        alert(url);
    }
}
// Client-only fetch of waypoint notes & stoppage times to avoid SSR 401 issues
if (import.meta.client && mode.value === "member") {
    const loadPlanAncillary = async (planId: string | null) => {
        if (!planId) {
            waypointNotes.value = [];
            waypointStoppageTimes.value = [];
            return;
        }
        try {
            const [notesResponse, stoppageTimesResponse] = await Promise.all([
                $fetch<{ notes: SelectWaypointNote[] }>(
                    `/api/courses/${courseId}/plans/${planId}/waypoint-notes`,
                ),
                $fetch<{ stoppageTimes: SelectWaypointStoppageTime[] }>(
                    `/api/courses/${courseId}/plans/${planId}/waypoint-stoppage-times`,
                ),
            ]);
            waypointNotes.value = notesResponse.notes;
            waypointStoppageTimes.value = stoppageTimesResponse.stoppageTimes;
        } catch (error) {
            // Ignore 401 silently (likely hydration/session timing); log others
            if (
                !(
                    error &&
                    typeof error === "object" &&
                    "statusCode" in error &&
                    // runtime narrowing (statusCode validated above)
                    error.statusCode === 401
                )
            ) {
                console.error("Error fetching waypoint ancillary data", error);
            }
            waypointNotes.value = [];
            waypointStoppageTimes.value = [];
        }
    };
    watch(
        () => currentPlanId.value,
        (pid) => {
            loadPlanAncillary(pid);
        },
        { immediate: true },
    );
}

// Panel resizing state
const isResizing = ref(false);
const resizeStartX = ref(0);
const resizeStartWidth = ref(0);

// Waypoint panel resizing functions
/**
 * Start resizing the waypoint panel
 * @param event MouseEvent
 */
function startResize(event: MouseEvent) {
    isResizing.value = true;
    resizeStartX.value = event.clientX;
    resizeStartWidth.value = uiStore.waypointPanelWidth;

    document.addEventListener("mousemove", handleResize);
    document.addEventListener("mouseup", stopResize);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
}

/**
 * Handle the resizing of the waypoint panel
 * @param event MouseEvent
 */
function handleResize(event: MouseEvent) {
    if (!isResizing.value) return;

    const deltaX = resizeStartX.value - event.clientX; // Subtract because we're resizing from the left
    const newWidth = resizeStartWidth.value + deltaX;
    uiStore.setWaypointPanelWidth(newWidth);
}

/**
 * Stop resizing the waypoint panel
 */
function stopResize() {
    isResizing.value = false;
    document.removeEventListener("mousemove", handleResize);
    document.removeEventListener("mouseup", stopResize);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
}

// Chart panel resizing state (simple 1:1 like waypoint panel)
const chartIsResizing = ref(false);
const chartResizeStartY = ref(0);
const chartResizeStartHeight = ref(320);

// Computed chart height for current mode (course vs plan) stored in UI store
const chartPanelHeight = computed<number>({
    get() {
        return currentPlan.value
            ? uiStore.chartPanelHeightPlan
            : uiStore.chartPanelHeightCourse;
    },
    set(val: number) {
        const clamped = clampChartHeight(val);
        if (currentPlan.value) {
            uiStore.setChartPanelHeightPlan(clamped);
        } else {
            uiStore.setChartPanelHeightCourse(clamped);
        }
    },
});

// Clamp helper for height
function clampChartHeight(h: number) {
    return clampChartPanelHeight(h);
}

// Start resizing the chart panel
function startChartResize(event: MouseEvent | TouchEvent) {
    chartIsResizing.value = true;

    const clientY =
        (event as TouchEvent)?.touches && (event as TouchEvent).touches.length
            ? (event as TouchEvent).touches[0]!.clientY
            : (event as MouseEvent).clientY;

    chartResizeStartY.value = clientY;
    chartResizeStartHeight.value = chartPanelHeight.value;

    document.addEventListener("mousemove", handleChartResize as EventListener);
    document.addEventListener("mouseup", stopChartResize as EventListener);
    document.addEventListener("touchmove", handleChartResize as EventListener, {
        passive: false,
    });
    document.addEventListener("touchend", stopChartResize as EventListener, {
        passive: false,
    });

    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
}

// Handle chart panel resize
function handleChartResize(event: MouseEvent | TouchEvent) {
    if (!chartIsResizing.value) return;

    if ("preventDefault" in event) {
        event.preventDefault();
    }

    const clientY =
        (event as TouchEvent)?.touches && (event as TouchEvent).touches.length
            ? (event as TouchEvent).touches[0]!.clientY
            : (event as MouseEvent).clientY;

    const deltaY = clientY - chartResizeStartY.value; // dragging down increases height
    const next = clampChartHeight(chartResizeStartHeight.value + deltaY);
    chartPanelHeight.value = next;
}

// Stop resizing the chart panel
function stopChartResize() {
    chartIsResizing.value = false;
    document.removeEventListener(
        "mousemove",
        handleChartResize as EventListener,
    );
    document.removeEventListener("mouseup", stopChartResize as EventListener);
    document.removeEventListener(
        "touchmove",
        handleChartResize as EventListener,
    );
    document.removeEventListener("touchend", stopChartResize as EventListener);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
}

/**
 * Download the original course file (GPX or TCX)
 */
async function downloadOriginalFile() {
    if (!course.value) return;

    try {
        const response = await fetch(`/api/courses/${courseId}/download`);
        if (!response.ok) throw new Error("Download failed");

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = course.value.originalFileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
    } catch (error) {
        console.error("Error downloading file:", error);
        alert("Failed to download file");
    }
}

/**
 * Delete the course (owner) OR unstar (remove membership for starred user).
 * When un-starring, also deletes the user's plans / notes / stoppage times (handled server-side).
 */
async function deleteCourse() {
    if (!course.value) return;

    const role = (course.value as { role?: string }).role;
    const isOwner = role === "owner";

    const message = isOwner
        ? `Are you sure you want to delete "${course.value.name}"? This action cannot be undone.`
        : `Remove "${course.value.name}" from My Courses?\n\nAll of your plans, waypoint notes, and stoppage times for this course will be deleted.`;

    if (!confirm(message)) return;

    try {
        if (isOwner) {
            await $fetch(`/api/courses/${courseId}`, {
                method: "DELETE",
            });
        } else {
            await $fetch(`/api/courses/${courseId}/remove`, {
                method: "DELETE",
            });
        }
        await navigateTo("/courses");
    } catch (error) {
        console.error("Error removing course or membership:", error);
        alert(isOwner ? "Failed to delete course" : "Failed to remove course");
    }
}

/**
 * Format a race date for display
 * @param date Date | string | number | null
 */
function formatRaceDate(date: Date | string | number | null) {
    if (!date) return null;
    // Use UTC methods to avoid timezone conversion
    const dateObj = new Date(date);
    const year = dateObj.getUTCFullYear();
    const month = dateObj.getUTCMonth();
    const day = dateObj.getUTCDate();
    const hours = dateObj.getUTCHours();
    const minutes = dateObj.getUTCMinutes();

    const dateStr = new Date(year, month, day).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
    });

    // Add time if it's not midnight
    if (hours !== 0 || minutes !== 0) {
        const timeStr = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
        return `${dateStr} at ${timeStr}`;
    }

    return dateStr;
}

// Compute GeoJSON data for the map. This is used to render the course on the map.
const geoJsonData = computed(() => {
    if (!course.value?.geoJsonData) return [];
    return [course.value.geoJsonData as GeoJSON.FeatureCollection];
});

// Build elevation points and per-unit split waypoints for display switching
const elevationPointsForDisplay = computed(() => {
    if (!geoJsonData.value?.length) return [];
    const combined: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features: geoJsonData.value.flatMap((fc) => fc.features),
    };
    return extractElevationProfile(combined);
});

const totalCourseDistanceMeters = computed(() => {
    const pts = elevationPointsForDisplay.value;
    if (!pts.length) return 0;
    return Math.max(...pts.map((p) => p.distance));
});

// Generate synthetic per-mile/km "waypoints" for the splits tab
const splitWaypoints = computed<Waypoint[]>(() => {
    const pts = elevationPointsForDisplay.value;
    const total = totalCourseDistanceMeters.value;
    if (!pts.length || total <= 0) return [];

    const isMiles = userSettingsStore.settings.units.distance === "miles";
    const unitMeters = isMiles ? 1609.344 : 1000;

    const result: Waypoint[] = [];

    // Include a start marker so chart numbering for subsequent markers is numeric (avoids first being "S")
    const start = pts[0];
    if (start) {
        result.push({
            id: "split-start",
            name: "S",
            description: null,
            lat: start.lat,
            lng: start.lng,
            elevation: start.elevation,
            distance: 0,
            tags: [],
            order: 0,
        });
    }

    let i = 1;
    for (let d = unitMeters; d < total - 1e-6; d += unitMeters, i++) {
        const ip = interpolateAtDistance(pts, d);
        if (!ip) continue;
        result.push({
            id: `split-${i}`,
            name: isMiles ? `Mile ${i}` : `Km ${i}`,
            description: null,
            lat: ip.lat,
            lng: ip.lng,
            elevation: ip.elevation,
            distance: d,
            tags: [],
            order: i,
        });
    }

    // Include finish so users can still see the end of course
    const finish = pts[pts.length - 1];
    if (finish) {
        result.push({
            id: "split-finish",
            name: "F",
            description: null,
            lat: finish.lat,
            lng: finish.lng,
            elevation: finish.elevation,
            distance: finish.distance,
            tags: [],
            order: Number.MAX_SAFE_INTEGER,
        });
    }

    return result;
});

// Waypoints to display on map and chart based on selected tab
const displayWaypoints = computed<Waypoint[]>(() => {
    return waypointPanelTab.value === "splits"
        ? splitWaypoints.value
        : waypoints.value;
});

// Split highlight state and helpers
const splitHighlight = ref<{ start: number; end: number; mid: number } | null>(
    null,
);
const selectedSplitIndex = ref<number | null>(null);
const selectedSplitRange = ref<{ startIndex: number; endIndex: number } | null>(
    null,
);
const mapResetKey = ref(0);

const stableHighlightSegment = computed(() => {
    if (waypointPanelTab.value !== "splits" || !splitHighlight.value)
        return null;
    return { start: splitHighlight.value.start, end: splitHighlight.value.end };
});
/* Removed highlight-controlled center/zoom to avoid snapping map view during other interactions */

function handleSplitClick(payload: {
    start: number;
    end: number;
    index: number;
}) {
    // Toggle selection: deselect if clicking the same row
    if (selectedSplitIndex.value === payload.index) {
        selectedSplitIndex.value = null;
        selectedSplitRange.value = null;
        splitHighlight.value = null;
        elevationHoverPoint.value = null; // do not pin cursor on deselect
        mapResetKey.value++; // remount map to refit to full track
        return;
    }

    // Select this single split and highlight segment; clear any range selection
    selectedSplitRange.value = null;
    selectedSplitIndex.value = payload.index;
    const mid = (payload.start + payload.end) / 2;
    splitHighlight.value = { start: payload.start, end: payload.end, mid };
}

function handleSplitRangeClick(payload: {
    startIndex: number;
    endIndex: number;
    start: number;
    end: number;
}) {
    selectedSplitIndex.value = null;
    selectedSplitRange.value = {
        startIndex: Math.min(payload.startIndex, payload.endIndex),
        endIndex: Math.max(payload.startIndex, payload.endIndex),
    };
    const mid = (payload.start + payload.end) / 2;
    splitHighlight.value = { start: payload.start, end: payload.end, mid };
}

function handleSplitCancel() {
    selectedSplitIndex.value = null;
    selectedSplitRange.value = null;
    splitHighlight.value = null;
    elevationHoverPoint.value = null;
    mapResetKey.value++;
}

// -------- Plan Stats (header) helpers --------
function formatHMS(totalSeconds: number): string {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = Math.round(totalSeconds % 60);
    return `${h.toString()}:${m.toString().padStart(2, "0")}:${s
        .toString()
        .padStart(2, "0")}`;
}

const planPaceDisplay = computed(() => {
    const p = currentPlan.value;
    if (!p?.pace) return "-";

    let paceSeconds = p.pace;
    const originalUnit = p.paceUnit;
    const desiredUnit =
        distanceUnit.value === "miles" ? "min_per_mi" : "min_per_km";
    if (originalUnit !== desiredUnit) {
        const conversionFactor = 1609.344 / 1000; // miles per kilometer
        paceSeconds =
            originalUnit === "min_per_km"
                ? paceSeconds * conversionFactor
                : paceSeconds / conversionFactor;
    }

    const total = Math.round(paceSeconds);
    const mm = Math.floor(total / 60);
    const ss = total % 60;
    const unit = desiredUnit === "min_per_mi" ? "/mi" : "/km";
    return `${mm}:${ss.toString().padStart(2, "0")}${unit}`;
});

const planStrategyDisplay = computed(() => {
    const p = currentPlan.value;
    if (!p) return "-";
    if (p.pacingStrategy === "linear") {
        const pct = p.pacingLinearPercent ?? 0;
        const sign = pct > 0 ? "+" : "";
        return `Linear (${sign}${pct}%)`;
    }
    return "Flat";
});

const planEstimatedElapsedDisplay = computed(() => {
    const p = currentPlan.value;
    if (!p) return "-";

    // In target time mode, display the exact target finish time
    if (
        p.paceMode === "time" &&
        typeof p.targetTimeSeconds === "number" &&
        p.targetTimeSeconds > 0
    ) {
        return formatHMS(p.targetTimeSeconds);
    }

    // For pace/normalized modes, estimate from distance and stoppages
    if (!p.pace || !course.value?.totalDistance) return "-";

    const unitMeters = p.paceUnit === "min_per_mi" ? 1609.344 : 1000;
    const distanceUnits = course.value.totalDistance / unitMeters;
    const travel = p.pace * distanceUnits;

    // Sum stoppages for intermediate waypoints (exclude start and finish)
    let stoppage = 0;
    const wps = waypoints.value || [];
    if (wps.length > 0) {
        const maxOrder = Math.max(...wps.map((w) => w.order));
        for (const w of wps) {
            if (w.order === 0) continue;
            if (w.order === maxOrder && maxOrder > 0) continue;
            const custom = waypointStoppageTimes.value.find(
                (st) => st.waypointId === w.id,
            );
            stoppage += custom
                ? custom.stoppageTime
                : getDefaultStoppageTime?.() || 0;
        }
    }

    return formatHMS(Math.round(travel + stoppage));
});

// Elevation chart interaction state
const elevationHoverPoint = ref<{
    lat: number;
    lng: number;
    distance: number;
    elevation: number;
    grade: number;
} | null>(null);

// Stores the distance for mouse hover on the map course
const mapHoverDistance = ref<number | null>(null);

// Handle elevation chart hover events
function handleElevationHover(event: {
    lat: number;
    lng: number;
    distance: number;
    elevation: number;
    grade: number;
}) {
    elevationHoverPoint.value = event;
}

// Reset elevation hover point when leaving the chart
function handleElevationLeave() {
    elevationHoverPoint.value = null;
}

// Handle pace chart hover events (reuse elevation hover point state)
function handlePaceHover(event: {
    lat: number;
    lng: number;
    distance: number;
    elevation: number;
    grade: number;
}) {
    elevationHoverPoint.value = event;
}

// Reset pace hover point when leaving the chart
function handlePaceLeave() {
    elevationHoverPoint.value = null;
}

// Handle map hover events
function handleMapHover(event: { lat: number; lng: number; distance: number }) {
    mapHoverDistance.value = event.distance;
}

function handleMapLeave() {
    mapHoverDistance.value = null;
}

// Waypoint interaction state
const selectedWaypoint = ref<Waypoint | null>(null);
const waypointPanelTab = ref<"waypoints" | "splits">("waypoints");
const mobilePanelTab = ref<"course" | "waypoints" | "splits">("course");

// Handle waypoint events
function handleWaypointSelect(waypoint: Waypoint) {
    // Toggle selection: if the same waypoint is clicked, deselect it
    if (selectedWaypoint.value?.id === waypoint.id) {
        selectedWaypoint.value = null;
    } else {
        selectedWaypoint.value = waypoint;
    }
}

function handleWaypointHover(_waypoint: Waypoint) {
    // Could add hover effects here if needed
}

function handleWaypointLeave() {
    // Could clear hover effects here if needed
}

function handleWaypointClick(waypoint: Waypoint) {
    // Toggle selection: if the same waypoint is clicked, deselect it
    if (selectedWaypoint.value?.id === waypoint.id) {
        selectedWaypoint.value = null;
    } else {
        selectedWaypoint.value = waypoint;
    }
}

function handleElevationWaypointClick(chartWaypoint: {
    id: string;
    name: string;
    distance: number;
    order: number;
    tags: string[];
}) {
    // Find the full waypoint object from the waypoints array
    const fullWaypoint = waypoints.value.find(
        (wp) => wp.id === chartWaypoint.id,
    );
    if (fullWaypoint) {
        handleWaypointClick(fullWaypoint);
    }
}

// Course edit modal handlers
function openCourseEditModal() {
    // Only allow owners to open the edit modal
    if (!course.value || (course.value as { role?: string }).role !== "owner")
        return;
    courseEditModalOpen.value = true;
}

function closeCourseEditModal() {
    courseEditModalOpen.value = false;
}

function openCourseInfoModal() {
    courseInfoModalOpen.value = true;
}

function closeCourseInfoModal() {
    courseInfoModalOpen.value = false;
}

function handleCourseUpdated(updatedCourse: SelectCourse) {
    if (courseData.value) {
        courseData.value.course = updatedCourse;
    }
    refresh(); // Refresh to get the latest data
}

function handleWaypointUpdated(_updatedWaypoint: Waypoint) {
    // Refresh waypoints to get the latest data
    refreshWaypoints();
}

// Plan management functions
function handlePlanSelected(planId: string) {
    currentPlanId.value = planId || null;

    // Update URL with plan query parameter
    const query = { ...route.query };
    if (planId) {
        query.plan = planId;
    } else {
        delete query.plan;
    }

    router.replace({
        path: route.path,
        query,
    });
}

function openPlanSetupModal() {
    editingPlan.value = null;
    planSetupModalOpen.value = true;
}

function openEditPlanModal(plan: SelectPlan) {
    editingPlan.value = plan;
    planSetupModalOpen.value = true;
}

function closePlanSetupModal() {
    planSetupModalOpen.value = false;
    editingPlan.value = null;
}

async function handlePlanCreated(plan: unknown) {
    await refreshPlans();
    const planId = (plan as SelectPlan).id;
    currentPlanId.value = planId;

    // Update URL with new plan
    const query = { ...route.query };
    query.plan = planId;
    router.replace({
        path: route.path,
        query,
    });
}

async function handlePlanUpdated(plan: unknown) {
    const typedPlan = plan as SelectPlan;
    await refreshPlans();
    if (currentPlanId.value === typedPlan.id) {
        // Refresh waypoint notes and stoppage times in case plan details changed
        try {
            const [notesResponse, stoppageTimesResponse] = await Promise.all([
                $fetch<{ notes: SelectWaypointNote[] }>(
                    `/api/courses/${courseId}/plans/${typedPlan.id}/waypoint-notes`,
                ),
                $fetch<{ stoppageTimes: SelectWaypointStoppageTime[] }>(
                    `/api/courses/${courseId}/plans/${typedPlan.id}/waypoint-stoppage-times`,
                ),
            ]);
            waypointNotes.value = notesResponse.notes;
            waypointStoppageTimes.value = stoppageTimesResponse.stoppageTimes;
        } catch (error) {
            console.error("Error refreshing waypoint data:", error);
        }
    }
}

async function handlePlanDeleted(planId: string) {
    try {
        await $fetch(`/api/courses/${courseId}/plans/${planId}`, {
            method: "DELETE",
        });

        await refreshPlans();

        if (currentPlanId.value === planId) {
            currentPlanId.value = null;
            waypointNotes.value = [];
            waypointStoppageTimes.value = [];

            // Remove plan from URL
            const query = { ...route.query };
            delete query.plan;
            router.replace({
                path: route.path,
                query,
            });
        }
    } catch (error) {
        console.error("Error deleting plan:", error);
    }
}

// Waypoint notes functions
function getWaypointNote(waypointId: string): string {
    const note = waypointNotes.value.find((n) => n.waypointId === waypointId);
    return note?.notes || "";
}

function getWaypointStoppageTime(waypointId: string): number {
    const stoppageTime = waypointStoppageTimes.value.find(
        (st) => st.waypointId === waypointId,
    );
    return stoppageTime?.stoppageTime || 0;
}

function getDefaultStoppageTime(): number {
    const currentPlan = plans.value.find((p) => p.id === currentPlanId.value);
    return currentPlan?.defaultStoppageTime || 0;
}

async function saveWaypointNote(waypointId: string, notes: string) {
    if (!currentPlanId.value) return;

    try {
        const response = await fetch(
            `/api/courses/${courseId}/plans/${currentPlanId.value}/waypoint-notes`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    waypointId,
                    notes: notes.trim(),
                }),
            },
        );

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        // Refresh waypoint notes
        const notesResponse = await $fetch<{ notes: SelectWaypointNote[] }>(
            `/api/courses/${courseId}/plans/${currentPlanId.value}/waypoint-notes`,
        );
        waypointNotes.value = notesResponse.notes;
    } catch (error) {
        console.error("Error saving waypoint note:", error);
    }
}

async function deleteWaypointNote(waypointId: string) {
    if (!currentPlanId.value) return;

    try {
        await $fetch(
            `/api/courses/${courseId}/plans/${currentPlanId.value}/waypoint-notes/${waypointId}`,
            {
                method: "DELETE",
            },
        );

        // Refresh waypoint notes
        const response = await $fetch<{ notes: SelectWaypointNote[] }>(
            `/api/courses/${courseId}/plans/${currentPlanId.value}/waypoint-notes`,
        );
        waypointNotes.value = response.notes;
    } catch (error) {
        console.error("Error deleting waypoint note:", error);
    }
}

async function saveWaypointStoppageTime(
    waypointId: string,
    stoppageTime: number,
) {
    if (!currentPlanId.value) return;

    try {
        await fetch(
            `/api/courses/${courseId}/plans/${currentPlanId.value}/waypoint-stoppage-times`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    waypointId,
                    stoppageTime,
                }),
            },
        );

        // Refresh waypoint stoppage times
        const response = await $fetch<{
            stoppageTimes: SelectWaypointStoppageTime[];
        }>(
            `/api/courses/${courseId}/plans/${currentPlanId.value}/waypoint-stoppage-times`,
        );
        waypointStoppageTimes.value = response.stoppageTimes;
    } catch (error) {
        console.error("Error saving waypoint stoppage time:", error);
    }
}

async function deleteWaypointStoppageTime(waypointId: string) {
    if (!currentPlanId.value) return;

    try {
        await $fetch(
            `/api/courses/${courseId}/plans/${currentPlanId.value}/waypoint-stoppage-times/${waypointId}`,
            {
                method: "DELETE",
            },
        );

        // Refresh waypoint stoppage times
        const response = await $fetch<{
            stoppageTimes: SelectWaypointStoppageTime[];
        }>(
            `/api/courses/${courseId}/plans/${currentPlanId.value}/waypoint-stoppage-times`,
        );
        waypointStoppageTimes.value = response.stoppageTimes;
    } catch (error) {
        console.error("Error deleting waypoint stoppage time:", error);
    }
}

function handleWaypointDeleted(_waypointId: string) {
    // Refresh waypoints to get the latest data after deletion
    refreshWaypoints();
}

function handleWaypointCreated(_createdWaypoint: Waypoint) {
    // Refresh waypoints to get the latest data after creation
    refreshWaypoints();
}

// Cleanup resize listeners on unmount
onUnmounted(() => {
    if (isResizing.value) {
        stopResize();
    }
    if (chartIsResizing.value) {
        stopChartResize();
    }
});
</script>

<template>
    <div class="flex flex-col w-full h-full overflow-hidden">
        <AppHeader class="w-full" />

        <div class="w-full h-full flex flex-col overflow-hidden">
            <div v-if="pending" class="flex items-center justify-center h-full">
                <Icon
                    name="svg-spinners:6-dots-scale"
                    class="text-(--main-color) scale-200"
                />
            </div>

            <div
                v-else-if="error"
                class="flex items-center justify-center h-full"
            >
                <div class="text-center">
                    <Icon
                        name="lucide:triangle-alert"
                        class="h-16 w-16 text-(--error-color) mx-auto mb-4"
                    />
                    <h2 class="text-xl font-semibold text-(--main-color) mb-2">
                        Course Not Found
                    </h2>
                    <p class="text-(--sub-color) mb-4">
                        The course you're looking for doesn't exist or you don't
                        have access to it.
                    </p>
                    <NuxtLink
                        to="/courses"
                        class="px-4 py-2 bg-(--main-color) text-(--bg-color) rounded-lg hover:opacity-80 transition-opacity"
                    >
                        Back to Courses
                    </NuxtLink>
                </div>
            </div>

            <div v-else-if="course" class="flex flex-col h-full">
                <!-- Header Section -->
                <div
                    class="pb-2 pt-0 px-2 md:px-4 md:p-2 border-b border-(--sub-color) bg-(--bg-color)"
                >
                    <div
                        class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between mb-1"
                    >
                        <div class="flex-1">
                            <div
                                class="text-2xl md:text-4xl font-bold text-(--main-color)"
                            >
                                <span class="inline-flex items-center gap-2">
                                    <span>{{ course.name }}</span>
                                    <Icon
                                        v-tooltip="
                                            course.public
                                                ? 'Public course'
                                                : 'Private course'
                                        "
                                        :name="
                                            course.public
                                                ? 'lucide:globe'
                                                : 'lucide:lock'
                                        "
                                        class="h-4 w-4 scale-70 text-(--sub-color)"
                                    />
                                </span>
                            </div>
                            <div v-if="course.description" class="mt-2">
                                <p class="text-(--sub-color)">
                                    {{ course.description }}
                                </p>
                            </div>
                        </div>
                        <div
                            class="flex items-center gap-2 flex-wrap justify-start md:justify-end mt-1 md:mt-0 w-full md:w-auto"
                        >
                            <PlanSelector
                                v-if="
                                    mode === 'member' &&
                                    capabilities.canManagePlans
                                "
                                :plans="plans"
                                :current-plan-id="currentPlanId"
                                :course-id="courseId"
                                @plan-selected="handlePlanSelected"
                                @add-plan="openPlanSetupModal"
                                @edit-plan="openEditPlanModal"
                                @delete-plan="handlePlanDeleted"
                            />

                            <CourseActionsDropdown
                                v-if="course && mode === 'member'"
                                :course="course"
                                :current-plan="currentPlan"
                                @edit-course="openCourseEditModal"
                                @download-file="downloadOriginalFile"
                                @delete-course="deleteCourse"
                                @toggle-public="toggleCoursePublic"
                                @toggle-share="toggleCourseShare"
                                @toggle-plan-share="toggleCurrentPlanShare"
                                @copy-share-link="handleCopyShareLink"
                                @copy-plan-share-link="copyPlanShareLink"
                                @info-course="openCourseInfoModal"
                                @copy-course="cloneCourse"
                            />
                        </div>
                    </div>

                    <div class="flex flex-col gap-4">
                        <!-- Course Metrics -->
                        <div class="flex items-center gap-6 text-sm">
                            <div
                                v-if="course.totalDistance != null"
                                class="flex items-center gap-2 text-(--main-color)"
                            >
                                <Icon
                                    name="lucide:map-pin"
                                    class="h-5 w-5 scale-150 -translate-y-0.5"
                                />
                                <div class="flex flex-col">
                                    <span class="font-medium">{{
                                        formatDistance(
                                            course.totalDistance,
                                            userSettingsStore.getDistanceUnitForCourse
                                                ? userSettingsStore.getDistanceUnitForCourse(
                                                      course || undefined,
                                                  )
                                                : (course?.defaultDistanceUnit ??
                                                      "miles"),
                                        )
                                    }}</span>
                                    <span class="text-xs text-(--sub-color)"
                                        >Distance</span
                                    >
                                </div>
                            </div>
                            <div
                                v-if="course.elevationGain != null"
                                class="flex items-center gap-2 text-(--main-color)"
                            >
                                <Icon
                                    name="lucide:arrow-up"
                                    class="h-5 w-5 scale-150 -translate-y-0.5"
                                />
                                <div class="flex flex-col">
                                    <span class="font-medium">{{
                                        formatElevation(
                                            course.elevationGain,
                                            userSettingsStore.getElevationUnitForCourse
                                                ? userSettingsStore.getElevationUnitForCourse(
                                                      course || undefined,
                                                  )
                                                : (course?.defaultElevationUnit ??
                                                      "feet"),
                                        )
                                    }}</span>
                                    <span class="text-xs text-(--sub-color)"
                                        >Elevation Gain</span
                                    >
                                </div>
                            </div>
                            <div
                                v-if="course.elevationLoss != null"
                                class="flex items-center gap-2 text-(--main-color)"
                            >
                                <Icon
                                    name="lucide:arrow-down"
                                    class="h-5 w-5 scale-150 -translate-y-0.5"
                                />
                                <div class="flex flex-col">
                                    <span class="font-medium">{{
                                        formatElevation(
                                            course.elevationLoss,
                                            userSettingsStore.getElevationUnitForCourse
                                                ? userSettingsStore.getElevationUnitForCourse(
                                                      course || undefined,
                                                  )
                                                : (course?.defaultElevationUnit ??
                                                      "feet"),
                                        )
                                    }}</span>
                                    <span class="text-xs text-(--sub-color)"
                                        >Elevation Loss</span
                                    >
                                </div>
                            </div>
                            <div
                                v-if="formatRaceDate(course.raceDate)"
                                class="flex items-center gap-2 text-(--main-color)"
                            >
                                <Icon
                                    name="lucide:calendar-clock"
                                    class="h-5 w-5 scale-150 -translate-y-0.5"
                                />
                                <div class="flex flex-col">
                                    <span class="font-medium">{{
                                        formatRaceDate(course.raceDate)
                                    }}</span>
                                    <span class="text-xs text-(--sub-color)"
                                        >Race Date</span
                                    >
                                </div>
                            </div>

                            <div
                                v-if="
                                    currentPlan &&
                                    (capabilities.canViewPlans ||
                                        (mode === 'public' && publicSharedPlan))
                                "
                                class="w-px h-8 bg-(--sub-color) opacity-60"
                            ></div>

                            <div
                                v-if="
                                    currentPlan &&
                                    (capabilities.canViewPlans ||
                                        (mode === 'public' && publicSharedPlan))
                                "
                                class="flex items-center gap-6 text-sm"
                            >
                                <div
                                    class="flex items-center gap-2 text-(--main-color)"
                                >
                                    <Icon
                                        name="lucide:timer"
                                        class="h-5 w-5 scale-150 -translate-y-0.5"
                                    />
                                    <div class="flex flex-col">
                                        <span class="font-medium">{{
                                            planPaceDisplay
                                        }}</span>
                                        <span class="text-xs text-(--sub-color)"
                                            >Target Pace</span
                                        >
                                    </div>
                                </div>

                                <div
                                    class="flex items-center gap-2 text-(--main-color)"
                                >
                                    <Icon
                                        name="lucide:clock-3"
                                        class="h-5 w-5 scale-150 -translate-y-0.5"
                                    />
                                    <div class="flex flex-col">
                                        <span class="font-medium">{{
                                            planEstimatedElapsedDisplay
                                        }}</span>
                                        <span class="text-xs text-(--sub-color)"
                                            >Est. Elapsed</span
                                        >
                                    </div>
                                </div>

                                <div
                                    class="flex items-center gap-2 text-(--main-color)"
                                >
                                    <Icon
                                        name="lucide:sliders"
                                        class="h-5 w-5 scale-150 -translate-y-0.5"
                                    />
                                    <div class="flex flex-col">
                                        <span class="font-medium">{{
                                            planStrategyDisplay
                                        }}</span>
                                        <span class="text-xs text-(--sub-color)"
                                            >Strategy</span
                                        >
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- File Info -->
                        <!-- <div
                            class="flex items-center gap-4 text-sm text-(--sub-color)"
                        >
                            <span class="flex items-center gap-1">
                                <Icon
                                    name="lucide:file"
                                    class="h-4 w-4"
                                />
                                {{ course.originalFileName }}
                            </span>
                            <span class="flex items-center gap-1">
                                <Icon
                                    name="lucide:calendar"
                                    class="h-4 w-4"
                                />
                                {{ formatDate(course.createdAt || new Date()) }}
                            </span>
                            <span class="flex items-center gap-1 uppercase">
                                <Icon name="lucide:tag" class="h-4 w-4" />
                                {{ course.fileType }}
                            </span>
                        </div> -->
                    </div>
                </div>

                <!-- Content Section -->
                <!-- Mobile tabs -->
                <div
                    class="md:hidden flex flex-col gap-2 border-b border-(--sub-color)"
                >
                    <div class="flex items-center">
                        <button
                            class="px-3 py-1 rounded-none! transition-colors m-0! outline-none!"
                            :class="{
                                'bg-(--main-color) text-(--bg-color)':
                                    mobilePanelTab === 'course',
                                'text-(--sub-color) hover:text-(--main-color)':
                                    mobilePanelTab !== 'course',
                            }"
                            @click="mobilePanelTab = 'course'"
                        >
                            Course
                        </button>
                        <button
                            class="px-3 py-1 rounded-none! transition-colors m-0! outline-none!"
                            :class="{
                                'bg-(--main-color) text-(--bg-color)':
                                    mobilePanelTab === 'waypoints',
                                'text-(--sub-color) hover:text-(--main-color)':
                                    mobilePanelTab !== 'waypoints',
                            }"
                            @click="mobilePanelTab = 'waypoints'"
                        >
                            Waypoints
                        </button>
                        <button
                            class="px-3 py-1 rounded-none! transition-colors m-0! outline-none!"
                            :class="{
                                'bg-(--main-color) text-(--bg-color)':
                                    mobilePanelTab === 'splits',
                                'text-(--sub-color) hover:text-(--main-color)':
                                    mobilePanelTab !== 'splits',
                            }"
                            @click="mobilePanelTab = 'splits'"
                        >
                            Splits
                        </button>
                    </div>
                </div>

                <!-- Mobile panels -->
                <div class="md:hidden flex-1 flex flex-col overflow-hidden">
                    <div
                        v-if="mobilePanelTab === 'course'"
                        class="flex-1 flex flex-col overflow-hidden"
                    >
                        <div
                            class="border-b border-(--sub-color) relative overflow-hidden"
                            :style="{ height: `${chartPanelHeight}px` }"
                        >
                            <div class="h-full p-2">
                                <ElevationPaceChart
                                    :geo-json-data="geoJsonData"
                                    :height="Math.max(0, chartPanelHeight - 16)"
                                    :map-hover-distance="mapHoverDistance"
                                    :selected-waypoint-distance="
                                        waypointPanelTab === 'waypoints'
                                            ? selectedWaypoint?.distance || null
                                            : null
                                    "
                                    :waypoints="displayWaypoints"
                                    :plan="currentPlan"
                                    :show-pace-chart="!!currentPlan"
                                    @elevation-hover="handleElevationHover"
                                    @elevation-leave="handleElevationLeave"
                                    @pace-hover="handlePaceHover"
                                    @pace-leave="handlePaceLeave"
                                    @waypoint-click="
                                        handleElevationWaypointClick
                                    "
                                />
                                <div
                                    class="absolute left-0 bottom-0 w-full h-1 cursor-row-resize transition-all duration-200 z-10 hover:h-[3px] hover:bg-(--main-color)"
                                    :class="{
                                        'h-2 bg-(--main-color)':
                                            chartIsResizing,
                                        'bg-transparent hover:bg-(--main-color)':
                                            !chartIsResizing,
                                    }"
                                    @mousedown="startChartResize"
                                    @touchstart.stop.prevent="startChartResize"
                                />
                            </div>
                        </div>
                        <div class="flex-1 p-4">
                            <div class="h-full rounded-lg overflow-hidden">
                                <ClientOnly>
                                    <LeafletMap
                                        :key="mapResetKey"
                                        :geo-json-data="geoJsonData"
                                        :waypoints="displayWaypoints"
                                        :display-markers-as-splits="
                                            waypointPanelTab === 'splits'
                                        "
                                        :selected-waypoint="selectedWaypoint"
                                        :elevation-hover-point="
                                            elevationHoverPoint
                                        "
                                        :highlight-segment="
                                            stableHighlightSegment
                                        "
                                        highlight-color="#ff0000"
                                        :fit-highlight="
                                            waypointPanelTab === 'splits' &&
                                            !!splitHighlight
                                        "
                                        @map-hover="handleMapHover"
                                        @map-leave="handleMapLeave"
                                        @waypoint-click="handleWaypointClick"
                                    />
                                    <template #fallback>
                                        <div
                                            class="w-full h-full bg-(--sub-alt-color) rounded-lg flex items-center justify-center"
                                        >
                                            <div class="text-center">
                                                <Icon
                                                    name="svg-spinners:6-dots-scale"
                                                    class="text-(--main-color) scale-200 mb-2"
                                                />
                                                <p class="text-(--sub-color)">
                                                    Loading map...
                                                </p>
                                            </div>
                                        </div>
                                    </template>
                                </ClientOnly>
                            </div>
                        </div>
                    </div>

                    <div
                        v-else-if="mobilePanelTab === 'waypoints'"
                        class="flex-1 overflow-hidden"
                    >
                        <WaypointList
                            :read-only="
                                mode === 'public' ||
                                !capabilities.canEditWaypoints
                            "
                            :waypoints="waypoints"
                            :selected-waypoint="selectedWaypoint"
                            :current-plan-id="currentPlanId"
                            :current-plan="currentPlan"
                            :waypoint-stoppage-times="waypointStoppageTimes"
                            :get-waypoint-note="getWaypointNote"
                            :get-waypoint-stoppage-time="
                                getWaypointStoppageTime
                            "
                            :get-default-stoppage-time="getDefaultStoppageTime"
                            :geo-json-data="geoJsonData"
                            @waypoint-select="handleWaypointSelect"
                            @waypoint-hover="handleWaypointHover"
                            @waypoint-leave="handleWaypointLeave"
                            @save-waypoint-note="saveWaypointNote"
                            @delete-waypoint-note="deleteWaypointNote"
                            @save-waypoint-stoppage-time="
                                saveWaypointStoppageTime
                            "
                            @delete-waypoint-stoppage-time="
                                deleteWaypointStoppageTime
                            "
                        />
                    </div>

                    <div v-else class="flex-1 overflow-hidden">
                        <SplitsTable
                            :read-only="mode === 'public'"
                            :geo-json-data="geoJsonData"
                            :current-plan="currentPlan"
                            :waypoints="
                                waypoints.map((w) => ({
                                    id: w.id,
                                    distance: w.distance,
                                    order: w.order,
                                }))
                            "
                            :waypoint-stoppage-times="waypointStoppageTimes"
                            :get-default-stoppage-time="getDefaultStoppageTime"
                            :selected-split-index="selectedSplitIndex"
                            :selected-split-range="selectedSplitRange"
                            @split-click="handleSplitClick"
                            @split-range-click="handleSplitRangeClick"
                            @split-cancel="handleSplitCancel"
                        />
                    </div>
                </div>

                <!-- Desktop layout -->
                <div class="hidden md:flex md:flex-1 md:overflow-hidden">
                    <!-- Left Panel: Charts and Map -->
                    <div class="flex-1 flex flex-col overflow-hidden">
                        <!-- Combined Charts Section -->
                        <div
                            class="border-b border-(--sub-color) relative overflow-hidden"
                            :style="{ height: `${chartPanelHeight}px` }"
                        >
                            <div class="h-full px-2 pt-2 pb-4">
                                <ElevationPaceChart
                                    :geo-json-data="geoJsonData"
                                    :height="Math.max(0, chartPanelHeight - 24)"
                                    :map-hover-distance="mapHoverDistance"
                                    :selected-waypoint-distance="
                                        waypointPanelTab === 'waypoints'
                                            ? selectedWaypoint?.distance || null
                                            : null
                                    "
                                    :waypoints="displayWaypoints"
                                    :plan="currentPlan"
                                    :show-pace-chart="!!currentPlan"
                                    @elevation-hover="handleElevationHover"
                                    @elevation-leave="handleElevationLeave"
                                    @pace-hover="handlePaceHover"
                                    @pace-leave="handlePaceLeave"
                                    @waypoint-click="
                                        handleElevationWaypointClick
                                    "
                                />
                                <div
                                    class="absolute left-0 bottom-0 w-full h-1 cursor-row-resize transition-all duration-200 z-10 hover:h-[3px] hover:bg-(--main-color)"
                                    :class="{
                                        'h-2 bg-(--main-color)':
                                            chartIsResizing,
                                        'bg-transparent hover:bg-(--main-color)':
                                            !chartIsResizing,
                                    }"
                                    @mousedown="startChartResize"
                                    @touchstart.stop.prevent="startChartResize"
                                />
                            </div>
                        </div>

                        <!-- Map Section -->
                        <div class="flex-1 p-4">
                            <div class="h-full rounded-lg overflow-hidden">
                                <ClientOnly>
                                    <LeafletMap
                                        :key="mapResetKey"
                                        :geo-json-data="geoJsonData"
                                        :waypoints="displayWaypoints"
                                        :display-markers-as-splits="
                                            waypointPanelTab === 'splits'
                                        "
                                        :selected-waypoint="selectedWaypoint"
                                        :elevation-hover-point="
                                            elevationHoverPoint
                                        "
                                        :highlight-segment="
                                            stableHighlightSegment
                                        "
                                        highlight-color="#ff0000"
                                        :fit-highlight="
                                            waypointPanelTab === 'splits' &&
                                            !!splitHighlight
                                        "
                                        @map-hover="handleMapHover"
                                        @map-leave="handleMapLeave"
                                        @waypoint-click="handleWaypointClick"
                                    />
                                    <template #fallback>
                                        <div
                                            class="w-full h-full bg-(--sub-alt-color) rounded-lg flex items-center justify-center"
                                        >
                                            <div class="text-center">
                                                <Icon
                                                    name="svg-spinners:6-dots-scale"
                                                    class="text-(--main-color) scale-200 mb-2"
                                                />
                                                <p class="text-(--sub-color)">
                                                    Loading map...
                                                </p>
                                            </div>
                                        </div>
                                    </template>
                                </ClientOnly>
                            </div>
                        </div>
                    </div>

                    <!-- Right Panel: Waypoints List -->
                    <div
                        class="border-l border-(--sub-color) flex flex-col relative"
                        :style="{ width: `${uiStore.waypointPanelWidth}px` }"
                    >
                        <!-- Resize handle -->
                        <div
                            class="absolute left-0 top-0 w-1 h-full cursor-col-resize transition-all duration-200 z-10 hover:w-[3px] hover:bg-(--main-color)"
                            :class="{
                                'w-2 bg-(--main-color)': isResizing,
                                'bg-transparent hover:bg-(--main-color)':
                                    !isResizing,
                            }"
                            @mousedown="startResize"
                        />

                        <div
                            class="hidden md:block border-b border-(--sub-color)"
                        >
                            <div class="flex items-center">
                                <button
                                    class="px-3 py-1 rounded-none! transition-colors m-0! outline-none!"
                                    :class="{
                                        'bg-(--main-color) text-(--bg-color)':
                                            waypointPanelTab === 'waypoints',
                                        'text-(--sub-color) hover:text-(--main-color)':
                                            waypointPanelTab !== 'waypoints',
                                    }"
                                    @click="waypointPanelTab = 'waypoints'"
                                >
                                    Waypoints
                                </button>
                                <button
                                    class="px-3 py-1 rounded-none! transition-colors m-0! outline-none!"
                                    :class="{
                                        'bg-(--main-color) text-(--bg-color)':
                                            waypointPanelTab === 'splits',
                                        'text-(--sub-color) hover:text-(--main-color)':
                                            waypointPanelTab !== 'splits',
                                    }"
                                    @click="waypointPanelTab = 'splits'"
                                >
                                    Splits
                                </button>
                            </div>
                        </div>
                        <div class="flex-1 overflow-hidden">
                            <div
                                v-if="waypointPanelTab === 'waypoints'"
                                class="h-full"
                            >
                                <WaypointList
                                    :read-only="
                                        mode === 'public' ||
                                        !capabilities.canEditWaypoints
                                    "
                                    :waypoints="waypoints"
                                    :selected-waypoint="selectedWaypoint"
                                    :current-plan-id="currentPlanId"
                                    :current-plan="currentPlan"
                                    :waypoint-stoppage-times="
                                        waypointStoppageTimes
                                    "
                                    :get-waypoint-note="getWaypointNote"
                                    :get-waypoint-stoppage-time="
                                        getWaypointStoppageTime
                                    "
                                    :get-default-stoppage-time="
                                        getDefaultStoppageTime
                                    "
                                    :geo-json-data="geoJsonData"
                                    @waypoint-select="handleWaypointSelect"
                                    @waypoint-hover="handleWaypointHover"
                                    @waypoint-leave="handleWaypointLeave"
                                    @save-waypoint-note="saveWaypointNote"
                                    @delete-waypoint-note="deleteWaypointNote"
                                    @save-waypoint-stoppage-time="
                                        saveWaypointStoppageTime
                                    "
                                    @delete-waypoint-stoppage-time="
                                        deleteWaypointStoppageTime
                                    "
                                />
                            </div>
                            <div v-else class="h-full">
                                <SplitsTable
                                    :read-only="mode === 'public'"
                                    :geo-json-data="geoJsonData"
                                    :current-plan="currentPlan"
                                    :waypoints="
                                        waypoints.map((w) => ({
                                            id: w.id,
                                            distance: w.distance,
                                            order: w.order,
                                        }))
                                    "
                                    :waypoint-stoppage-times="
                                        waypointStoppageTimes
                                    "
                                    :get-default-stoppage-time="
                                        getDefaultStoppageTime
                                    "
                                    :selected-split-index="selectedSplitIndex"
                                    :selected-split-range="selectedSplitRange"
                                    @split-click="handleSplitClick"
                                    @split-range-click="handleSplitRangeClick"
                                    @split-cancel="handleSplitCancel"
                                />
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Course Edit Modal -->
        <CourseEditModal
            :open="courseEditModalOpen"
            :course="course || null"
            :waypoints="waypoints"
            :geo-json-data="geoJsonData"
            @close="closeCourseEditModal"
            @course-updated="handleCourseUpdated"
            @waypoint-updated="handleWaypointUpdated"
            @waypoint-deleted="handleWaypointDeleted"
            @waypoint-created="handleWaypointCreated"
        />

        <!-- Plan Setup Modal -->
        <PlanSetupModal
            v-if="mode === 'member' && capabilities.canManagePlans"
            :is-open="planSetupModalOpen"
            :course-id="courseId"
            :course-total-distance="course?.totalDistance || null"
            :course-default-distance-unit="
                course?.defaultDistanceUnit || undefined
            "
            :existing-plan="editingPlanPayload"
            @close="closePlanSetupModal"
            @plan-created="handlePlanCreated"
            @plan-updated="handlePlanUpdated"
        />
        <CourseInfoModal
            :open="courseInfoModalOpen"
            :course="course || null"
            :waypoint-count="waypoints.length"
            @close="closeCourseInfoModal"
        />
    </div>
</template>
