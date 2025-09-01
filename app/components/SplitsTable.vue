<script setup lang="ts">
import { computed, toRefs } from "vue";
import { useUserSettingsStore } from "~/stores/userSettings";
import type { SelectPlan } from "~/utils/db/schema";
import {
    extractElevationProfile,
    calculateGradeAtDistance,
    type ElevationPoint,
} from "~/utils/elevationProfile";
import { formatElevation } from "~/utils/courseMetrics";
import { paceAdjustment } from "~/utils/paceAdjustment";
import { formatElapsedTime } from "~/utils/timeCalculations";

type DistanceUnit = "kilometers" | "miles";

interface Props {
    geoJsonData?: GeoJSON.FeatureCollection[];
    currentPlan?: SelectPlan | null;
    waypoints?: Array<{ id: string; distance: number; order: number }>;
    waypointStoppageTimes?: Array<{ waypointId: string; stoppageTime: number }>;
    getDefaultStoppageTime?: () => number;
}

const _props = withDefaults(defineProps<Props>(), {
    geoJsonData: () => [],
    currentPlan: null,
    waypoints: () => [],
    waypointStoppageTimes: () => [],
    getDefaultStoppageTime: () => 0,
});
const {
    geoJsonData,
    currentPlan,
    waypoints,
    waypointStoppageTimes,
    getDefaultStoppageTime,
} = toRefs(_props);

const userSettingsStore = useUserSettingsStore();
const distanceUnit = computed<DistanceUnit>(
    () => userSettingsStore.settings.units.distance,
);

// Per-course smoothing (defaults when courseId unknown)
const courseIdForSmoothing = computed(
    () => currentPlan.value?.courseId || undefined,
);
const smoothing = computed(() =>
    userSettingsStore.getSmoothingForCourse(courseIdForSmoothing.value),
);
const useGradeAdjustment = computed<boolean>(
    () => userSettingsStore.settings.pacing?.useGradeAdjustment ?? false,
);
const maintainTargetAverage = computed<boolean>(
    () => (currentPlan.value?.paceMode || "pace") !== "normalized",
);

// Build elevation profile from provided GeoJSON
const elevationProfile = computed<ElevationPoint[]>(() => {
    if (!geoJsonData.value || geoJsonData.value.length === 0) return [];
    const combined: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features: geoJsonData.value.flatMap((fc) => fc.features),
    };
    return extractElevationProfile(combined);
});

const totalDistanceMeters = computed<number>(() => {
    // Prefer final waypoint distance to match waypoint-based calculations
    if (waypoints?.value && waypoints.value.length > 0) {
        const sorted = [...waypoints.value].sort((a, b) => a.order - b.order);
        const lastWp = sorted[sorted.length - 1];
        if (
            lastWp &&
            typeof lastWp.distance === "number" &&
            lastWp.distance > 0
        ) {
            return lastWp.distance;
        }
    }

    // Fallback to elevation profile length
    const points = elevationProfile.value;
    if (!points.length) return 0;
    const last = points[points.length - 1]!;
    return last.distance || 0;
});

const splitLengthMeters = computed<number>(() =>
    distanceUnit.value === "miles" ? 1609.344 : 1000,
);

// Helpers
function getPacePerMeter(paceSeconds: number, paceUnit: string): number {
    if (paceUnit === "min_per_mi") return paceSeconds / 1609.344;
    // default and "min_per_km"
    return paceSeconds / 1000;
}

function formatSplitDistance(meters: number): string {
    if (distanceUnit.value === "miles") {
        const mi = meters / 1609.344;
        const s = mi.toFixed(2).replace(/\.?0+$/, "");
        return `${s} mi`;
    } else {
        const km = meters / 1000;
        const s = km.toFixed(2).replace(/\.?0+$/, "");
        return `${s} km`;
    }
}

function formatPace(
    secondsPerUnit: number,
    unit: "min_per_km" | "min_per_mi",
): string {
    if (!isFinite(secondsPerUnit) || secondsPerUnit <= 0) return "-";
    const m = Math.floor(secondsPerUnit / 60);
    const s = Math.round(secondsPerUnit % 60);
    const suf = unit === "min_per_mi" ? "/mi" : "/km";
    return `${m}:${s.toString().padStart(2, "0")}${suf}`;
}

function interpElevationAtDistance(
    points: ElevationPoint[],
    d: number,
): number | null {
    if (points.length === 0) return null;
    if (d <= points[0]!.distance) return points[0]!.elevation;
    const last = points[points.length - 1]!;
    if (d >= last.distance) return last.elevation;

    for (let i = 1; i < points.length; i++) {
        const prev = points[i - 1]!;
        const curr = points[i]!;

        if (d >= prev.distance && d <= curr.distance) {
            const span = curr.distance - prev.distance;
            if (span <= 0) return prev.elevation;
            const ratio = (d - prev.distance) / span;
            return prev.elevation + ratio * (curr.elevation - prev.elevation);
        }
    }
    return null;
}

function computeGainLoss(
    points: ElevationPoint[],
    start: number,
    end: number,
): { gain: number; loss: number } {
    if (points.length < 2 || end <= start) return { gain: 0, loss: 0 };
    const acc: Array<{ d: number; e: number }> = [];

    // Ensure we include start and end with interpolated elevations
    const startElev = interpElevationAtDistance(points, start);
    const endElev = interpElevationAtDistance(points, end);
    if (startElev === null || endElev === null) return { gain: 0, loss: 0 };

    acc.push({ d: start, e: startElev });
    for (const p of points) {
        if (p.distance > start && p.distance < end) {
            acc.push({ d: p.distance, e: p.elevation });
        }
    }
    acc.push({ d: end, e: endElev });

    acc.sort((a, b) => a.d - b.d);

    let gain = 0;
    let loss = 0;
    for (let i = 1; i < acc.length; i++) {
        const prev = acc[i - 1]!;
        const curr = acc[i]!;
        const diff = curr.e - prev.e;
        if (diff > 0) gain += diff;
        else loss += -diff;
    }

    return { gain, loss };
}

function calculateGradeAdjustmentFactor(gradePercent: number): number {
    // Clamp grade to reasonable bounds and use shared paceAdjustment mapping
    const clamped = Math.max(-50, Math.min(50, gradePercent));
    const f = paceAdjustment(clamped);
    return Math.max(0.5, Math.min(3.0, f));
}

function getCumulativeStoppageUntil(targetDistance: number): number {
    const wps = waypoints?.value || [];
    if (!wps.length) return 0;

    const times = waypointStoppageTimes?.value || [];
    const defaultStop = (getDefaultStoppageTime?.value || (() => 0))();

    const maxOrder = Math.max(...wps.map((w) => w.order));
    let total = 0;

    for (const wp of wps) {
        if (!wp) continue;
        if (wp.distance > targetDistance) continue;

        // Exclude start (order 0) and finish (highest order)
        if (wp.order === 0) continue;
        if (wp.order === maxOrder && wp.order > 0) continue;

        const custom = times.find((st) => st.waypointId === wp.id);
        total += custom ? custom.stoppageTime : defaultStop;
    }

    return total;
}

// Compute global normalization scale to maintain target average pace across the whole course
const normalizationScale = computed<number>(() => {
    if (
        !useGradeAdjustment.value ||
        !maintainTargetAverage.value ||
        !currentPlan.value?.pace ||
        elevationProfile.value.length < 2
    ) {
        return 1.0;
    }

    const points = elevationProfile.value;
    const totalDist = totalDistanceMeters.value;
    if (totalDist <= 0) return 1.0;

    const sampleStep =
        smoothing.value.sampleStepMeters === 0
            ? 50
            : Math.max(1, smoothing.value.sampleStepMeters ?? 50);
    const gradeWindow = smoothing.value.gradeWindowMeters ?? 100;

    let equivalentDistanceSum = 0;
    let pos = 0;
    while (pos < totalDist) {
        const next = Math.min(pos + sampleStep, totalDist);
        const mid = (pos + next) / 2;
        const grade = calculateGradeAtDistance(points, mid, gradeWindow);
        const factor = calculateGradeAdjustmentFactor(grade);
        const dL = next - pos;
        equivalentDistanceSum += factor * dL;
        pos = next;
    }

    if (equivalentDistanceSum <= 0) return 1.0;
    return totalDist / equivalentDistanceSum;
});

type SplitRow = {
    index: number; // 1-based
    start: number; // meters
    end: number; // meters
    dist: number; // meters
    gain: number; // meters
    loss: number; // meters
    avgGrade: number; // percent
    paceSecPerUnit: number | null; // seconds per plan unit (unit based on plan)
    elapsedSec: number | null; // cumulative seconds from start (no stoppage)
};

const splits = computed<SplitRow[]>(() => {
    const points = elevationProfile.value;
    const total = totalDistanceMeters.value;
    const plan = currentPlan.value;

    if (total <= 0) return [];

    const length = splitLengthMeters.value;
    const boundaries: number[] = [0];
    let pos = length;
    while (pos < total - 1e-6) {
        boundaries.push(pos);
        pos += length;
    }
    if (boundaries[boundaries.length - 1] !== total) {
        boundaries.push(total);
    }

    const useGA =
        useGradeAdjustment.value && !!plan?.pace && points.length >= 2;
    const sampleStep =
        smoothing.value.sampleStepMeters === 0
            ? 50
            : Math.max(1, smoothing.value.sampleStepMeters ?? 50);
    const gradeWindow = smoothing.value.gradeWindowMeters ?? 100;
    const normScale = normalizationScale.value;

    const basePacePerMeter =
        plan?.pace && plan?.paceUnit
            ? getPacePerMeter(plan.pace, plan.paceUnit)
            : null;

    // Compute per-course time scaling for 'time' mode to match targetTimeSeconds
    // Use final waypoint distance (when available) to integrate travel time across exact course length
    const wpsArr = waypoints.value ?? [];
    const courseEnd =
        wpsArr.length > 0
            ? (() => {
                  const sorted = [...wpsArr].sort((a, b) => a.order - b.order);
                  const last = sorted[sorted.length - 1]!;
                  return last.distance;
              })()
            : total;

    let timeScale = 1;
    if (plan?.pace && basePacePerMeter && courseEnd > 0) {
        if ((plan.paceMode || "pace") === "time" && plan.targetTimeSeconds) {
            let travelBase = 0;
            let tp = 0;
            while (tp < courseEnd) {
                const tn = Math.min(tp + sampleStep, courseEnd);
                const tm = (tp + tn) / 2;
                const tg = calculateGradeAtDistance(points, tm, gradeWindow);
                const tf = useGA ? calculateGradeAdjustmentFactor(tg) : 1.0;
                const adjPpm = basePacePerMeter * tf * normScale;
                travelBase += (tn - tp) * adjPpm;
                tp = tn;
            }
            const stoppageTotal = getCumulativeStoppageUntil(courseEnd);
            const desiredTravel = Math.max(
                0,
                plan.targetTimeSeconds - stoppageTotal,
            );
            if (travelBase > 0) {
                timeScale = desiredTravel / travelBase;
            }
        }
    }

    let cumulativeTravel = 0;
    const rows: SplitRow[] = [];
    for (let i = 0; i < boundaries.length - 1; i++) {
        const start = boundaries[i]!;
        const end = boundaries[i + 1]!;
        const dist = Math.max(0, end - start);

        const { gain, loss } = computeGainLoss(points, start, end);

        // Average grade over the split as net rise/run
        const startElev = interpElevationAtDistance(points, start);
        const endElev = interpElevationAtDistance(points, end);
        const avgGrade =
            startElev !== null && endElev !== null && dist > 0
                ? ((endElev - startElev) / dist) * 100
                : 0;

        // Pace / time calculations
        let paceSecPerUnit: number | null = null;
        let segmentSeconds = 0;

        if (plan?.pace && basePacePerMeter && dist > 0) {
            if (useGA) {
                // Integrate grade factor across this split
                let weightedFactorSum = 0;
                let p = start;
                while (p < end) {
                    const n = Math.min(p + sampleStep, end);
                    const m = (p + n) / 2;
                    const g = calculateGradeAtDistance(points, m, gradeWindow);
                    const gradeFactor = calculateGradeAdjustmentFactor(g);
                    let pacingFactor = 1.0;
                    if (
                        (currentPlan.value?.pacingStrategy || "flat") ===
                            "linear" &&
                        courseEnd > 0
                    ) {
                        const t = Math.max(0, Math.min(1, m / courseEnd));
                        const P =
                            Math.max(
                                -50,
                                Math.min(
                                    50,
                                    currentPlan.value?.pacingLinearPercent ?? 0,
                                ),
                            ) / 100;
                        pacingFactor = 1 + (t - 0.5) * P;
                    }
                    const combinedFactor = gradeFactor * pacingFactor;
                    weightedFactorSum += combinedFactor * (n - p);
                    p = n;
                }
                const meanFactor = dist > 0 ? weightedFactorSum / dist : 1.0;
                const adjustedPacePerMeter =
                    basePacePerMeter * meanFactor * normScale;
                segmentSeconds = dist * adjustedPacePerMeter * timeScale;
                const unitMeters =
                    plan.paceUnit === "min_per_mi" ? 1609.344 : 1000;
                paceSecPerUnit = adjustedPacePerMeter * unitMeters * timeScale;
            } else {
                // Flat/course-based pace
                segmentSeconds = dist * basePacePerMeter * timeScale;
                const unitMeters =
                    plan.paceUnit === "min_per_mi" ? 1609.344 : 1000;
                paceSecPerUnit = basePacePerMeter * unitMeters * timeScale;
            }
            cumulativeTravel += segmentSeconds;
        } else {
            paceSecPerUnit = null;
        }

        rows.push({
            index: i + 1,
            start,
            end,
            dist,
            gain,
            loss,
            avgGrade,
            paceSecPerUnit,
            elapsedSec: plan?.pace
                ? cumulativeTravel + getCumulativeStoppageUntil(end)
                : null,
        });
    }

    // Back-calculate elapsed times to ensure the last split matches the target total exactly
    if (plan?.pace && rows.length > 0) {
        const lastIdx = rows.length - 1;
        const lastBoundary = boundaries[boundaries.length - 1]!;
        const stoppageLast = getCumulativeStoppageUntil(lastBoundary);
        const rawLast = rows[lastIdx]!.elapsedSec ?? 0;

        // Determine desired final elapsed time
        let desiredLast = rawLast;
        if ((plan.paceMode || "pace") === "time" && plan.targetTimeSeconds) {
            // In target time mode, snap the last elapsed to the exact target time (seconds)
            desiredLast = plan.targetTimeSeconds;
        } else {
            // In pace/normalized modes, use the computed total but snap to a whole second for display consistency
            desiredLast = Math.round(rawLast);
        }

        // Compute a scale for the travel-only component so the last split matches exactly
        const rawTravelLast = Math.max(0, rawLast - stoppageLast);
        const desiredTravelLast = Math.max(0, desiredLast - stoppageLast);
        const extraScale =
            rawTravelLast > 0 ? desiredTravelLast / rawTravelLast : 1.0;

        // Apply scaling to each split's cumulative travel, then add cumulative stoppage
        if (isFinite(extraScale) && extraScale > 0) {
            for (let i = 0; i < rows.length; i++) {
                const r = rows[i]!;
                const stopI = getCumulativeStoppageUntil(r.end);
                const rawTravelI = Math.max(0, (r.elapsedSec ?? 0) - stopI);
                r.elapsedSec = rawTravelI * extraScale + stopI;
            }
            // Enforce exact last value to avoid tiny floating point drift
            rows[lastIdx]!.elapsedSec = desiredLast;
        }
    }

    return rows;
});
</script>

<template>
    <div class="h-full w-full overflow-hidden flex flex-col">
        <div class="px-3 py-2 border-b border-(--sub-color)">
            <div class="text-(--main-color) font-semibold">
                {{
                    distanceUnit === "miles"
                        ? "Mile Splits"
                        : "Kilometer Splits"
                }}
            </div>
        </div>

        <div class="flex-1 overflow-auto">
            <table class="min-w-full text-sm">
                <thead
                    class="sticky top-0 bg-(--bg-color) z-0 border-b border-(--sub-color)"
                >
                    <tr class="text-(--sub-color) text-xs uppercase">
                        <th class="text-left p-x-1! py-2">Dist</th>
                        <th class="text-right p-x-1! py-1!">Gain</th>
                        <th class="text-right p-x-1! py-1!">Loss</th>
                        <th class="text-right p-x-1! py-1!">Grade</th>
                        <th v-if="currentPlan" class="text-right p-x-1! py-1!">
                            Pace
                        </th>
                        <th v-if="currentPlan" class="text-right p-x-1! py-1!">
                            Elapsed
                        </th>
                    </tr>
                </thead>
                <tbody>
                    <tr
                        v-for="row in splits"
                        :key="row.index"
                        class="border-b border-(--sub-color)/50 hover:bg-(--sub-alt-color) transition-colors"
                    >
                        <td class="p-x-1! py-1! text-(--main-color)">
                            {{ formatSplitDistance(row.end) }}
                        </td>
                        <td class="p-x-1! py-1! text-(--main-color) text-right">
                            {{
                                formatElevation(
                                    row.gain,
                                    userSettingsStore.settings.units.elevation,
                                )
                            }}
                        </td>
                        <td class="p-x-1! py-1! text-(--main-color) text-right">
                            {{
                                formatElevation(
                                    row.loss,
                                    userSettingsStore.settings.units.elevation,
                                )
                            }}
                        </td>
                        <td class="p-x-1! py-1! text-(--main-color) text-right">
                            <span v-if="isFinite(row.avgGrade)"
                                >{{
                                    (row.avgGrade >= 0 ? "+" : "") +
                                    row.avgGrade.toFixed(1)
                                }}%</span
                            >
                            <span v-else>-</span>
                        </td>
                        <td
                            v-if="currentPlan"
                            class="p-x-1! py-1! text-(--main-color) text-right"
                        >
                            <span v-if="row.paceSecPerUnit !== null">
                                {{
                                    formatPace(
                                        row.paceSecPerUnit!,
                                        (currentPlan?.paceUnit ||
                                            "min_per_km") as
                                            | "min_per_km"
                                            | "min_per_mi",
                                    )
                                }}
                            </span>
                            <span v-else>-</span>
                        </td>
                        <td
                            v-if="currentPlan"
                            class="p-x-1! py-1! text-(--main-color) text-right"
                        >
                            <span v-if="row.elapsedSec !== null">{{
                                formatElapsedTime(Math.round(row.elapsedSec!))
                            }}</span>
                            <span v-else>—</span>
                        </td>
                    </tr>

                    <tr v-if="splits.length === 0">
                        <td
                            class="p-x-1! py-6 text-center text-(--sub-color)"
                            :colspan="currentPlan ? 6 : 4"
                        >
                            No splits available.
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    </div>
</template>
