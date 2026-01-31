<script setup lang="ts">
import { getDistanceUnitSSR, getElevationUnitSSR } from "~/utils/units";
import type { CourseUnitDefaults } from "~/utils/units";
import { computed, toRefs, ref } from "vue";
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
    selectedSplitIndex?: number | null;
    selectedSplitRange?: { startIndex: number; endIndex: number } | null;
    readOnly?: boolean;
    courseDefaults?: Partial<CourseUnitDefaults> | null;
}

const _props = withDefaults(defineProps<Props>(), {
    geoJsonData: () => [],
    currentPlan: null,
    waypoints: () => [],
    waypointStoppageTimes: () => [],
    getDefaultStoppageTime: () => 0,
    selectedSplitIndex: null,
    selectedSplitRange: null,
    readOnly: false,
    courseDefaults: null,
});
const {
    geoJsonData,
    currentPlan,
    waypoints,
    waypointStoppageTimes,
    getDefaultStoppageTime,
    selectedSplitIndex,
    selectedSplitRange,
    courseDefaults,
} = toRefs(_props);

const emit = defineEmits<{
    "split-click": [payload: { start: number; end: number; index: number }];
    "split-range-click": [
        payload: {
            startIndex: number;
            endIndex: number;
            start: number;
            end: number;
        },
    ];
    "split-cancel": [];
}>();
const userSettingsStore = useUserSettingsStore();
const distanceUnit = computed<DistanceUnit>(
    () =>
        getDistanceUnitSSR(
            (courseDefaults?.value || undefined) as Partial<CourseUnitDefaults>,
        ) as DistanceUnit,
);

// Per-course smoothing (defaults when courseId unknown)
const courseIdForSmoothing = computed(
    () => currentPlan.value?.courseId || undefined,
);
const smoothing = computed(() =>
    userSettingsStore.getSmoothingForCourse(courseIdForSmoothing.value),
);
const useGradeAdjustment = computed<boolean>(
    () => currentPlan.value?.useGradeAdjustment ?? true,
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
    const __isDev = import.meta.dev;
    const __start =
        __isDev && typeof performance !== "undefined" ? performance.now() : 0;
    if (__isDev) console.time("SplitsTable: extractElevationProfile");
    const result = extractElevationProfile(combined);
    if (__isDev) {
        console.timeEnd("SplitsTable: extractElevationProfile");
        console.log("[SplitsTable] elevationProfile computed", {
            points: result.length,
            ms:
                typeof performance !== "undefined"
                    ? performance.now() - __start
                    : 0,
        });
    }
    return result;
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

    // Determine course end for pacing strategy normalization
    const wpsArr = waypoints.value ?? [];
    const courseEnd =
        wpsArr.length > 0
            ? (() => {
                  const sorted = [...wpsArr].sort((a, b) => a.order - b.order);
                  const last = sorted[sorted.length - 1]!;
                  return last.distance;
              })()
            : totalDist;

    const __isDev = import.meta.dev;
    const __isClient = typeof window !== "undefined";
    const __t =
        __isClient && typeof performance !== "undefined"
            ? performance.now()
            : 0;
    if (__isClient && __isDev) {
        console.time("SplitsTable: normalizationScale");
        console.log("[SplitsTable] normalizationScale start", {
            totalDist,
            sampleStep,
            gradeWindow,
            courseEnd,
            useGradeAdjustment: useGradeAdjustment.value,
            strategy: currentPlan.value?.pacingStrategy ?? "flat",
            linearPercent: currentPlan.value?.pacingLinearPercent ?? 0,
        });
    }

    let equivalentDistanceSum = 0;
    let pos = 0;
    let iters = 0;
    while (pos < totalDist) {
        const next = Math.min(pos + sampleStep, totalDist);
        const mid = (pos + next) / 2;
        const grade = calculateGradeAtDistance(points, mid, gradeWindow);
        const gradeFactor = useGradeAdjustment.value
            ? calculateGradeAdjustmentFactor(grade)
            : 1.0;
        let pacingFactor = 1.0;
        if (
            (currentPlan.value?.pacingStrategy || "flat") === "linear" &&
            courseEnd > 0
        ) {
            const t = Math.max(0, Math.min(1, mid / courseEnd));
            const P =
                Math.max(
                    -50,
                    Math.min(50, currentPlan.value?.pacingLinearPercent ?? 0),
                ) / 100;
            pacingFactor = 1 + (t - 0.5) * P;
        }
        const dL = next - pos;
        equivalentDistanceSum += gradeFactor * pacingFactor * dL;
        pos = next;
        iters++;
    }

    if (equivalentDistanceSum <= 0) {
        if (__isClient && __isDev) {
            console.timeEnd("SplitsTable: normalizationScale");
            console.log("[SplitsTable] normalizationScale result", {
                ms:
                    typeof performance !== "undefined"
                        ? performance.now() - __t
                        : 0,
                scale: 1.0,
                iterations: iters,
            });
        }
        return 1.0;
    }
    const scale = totalDist / equivalentDistanceSum;

    if (__isClient && __isDev) {
        console.timeEnd("SplitsTable: normalizationScale");
        console.log("[SplitsTable] normalizationScale result", {
            ms:
                typeof performance !== "undefined"
                    ? performance.now() - __t
                    : 0,
            scale,
            iterations: iters,
        });
    }
    return scale;
});
// normalizationScale: removed duplicate leftover block

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
    const __isClient = typeof window !== "undefined";
    const __isDev = import.meta.dev;
    const __tAll =
        __isClient && typeof performance !== "undefined"
            ? performance.now()
            : 0;
    if (__isClient && __isDev) {
        console.time("SplitsTable: splits compute");
    }

    const points = elevationProfile.value;
    const total = totalDistanceMeters.value;
    const plan = currentPlan.value;

    if (__isClient && __isDev) {
        console.log("[SplitsTable] splits compute start", { total });
    }

    if (total <= 0) {
        if (__isClient && __isDev)
            console.timeEnd("SplitsTable: splits compute");
        return [];
    }

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
    if (__isClient && __isDev) {
        console.log("[SplitsTable] boundaries built", {
            lengthMeters: length,
            count: boundaries.length,
        });
    }

    const useGA = !!plan?.pace && points.length >= 2;
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
            const __tTS =
                __isClient && typeof performance !== "undefined"
                    ? performance.now()
                    : 0;
            if (__isClient && __isDev) {
                console.time("SplitsTable: timeScale integrate");
            }
            let travelBase = 0;
            let tp = 0;
            let iters = 0;
            while (tp < courseEnd) {
                const tn = Math.min(tp + sampleStep, courseEnd);
                const tm = (tp + tn) / 2;
                const tg = calculateGradeAtDistance(points, tm, gradeWindow);
                const gradeFactor = useGradeAdjustment.value
                    ? calculateGradeAdjustmentFactor(tg)
                    : 1.0;
                let pacingFactor = 1.0;
                if (
                    (currentPlan.value?.pacingStrategy || "flat") ===
                        "linear" &&
                    courseEnd > 0
                ) {
                    const t = Math.max(0, Math.min(1, tm / courseEnd));
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
                const adjPpm =
                    basePacePerMeter * gradeFactor * pacingFactor * normScale;
                travelBase += (tn - tp) * adjPpm;
                tp = tn;
                iters++;
            }
            const includeStops = plan.targetIncludesStoppages === true;
            const stoppageTotal = includeStops
                ? getCumulativeStoppageUntil(courseEnd)
                : 0;
            const desiredTravel = includeStops
                ? Math.max(0, plan.targetTimeSeconds - stoppageTotal)
                : plan.targetTimeSeconds;
            if (travelBase > 0) {
                timeScale = desiredTravel / travelBase;
            }
            if (__isClient && __isDev) {
                console.timeEnd("SplitsTable: timeScale integrate");
                console.log("[SplitsTable] timeScale computed", {
                    ms:
                        typeof performance !== "undefined"
                            ? performance.now() - __tTS
                            : 0,
                    travelBase,
                    stoppageTotal,
                    desiredTravel,
                    timeScale,
                    includeStops,
                    sampleStep,
                    gradeWindow,
                    iterations: iters,
                });
            }
        }
    }

    let cumulativeTravel = 0;
    const rows: SplitRow[] = [];
    const __tRows =
        __isClient && typeof performance !== "undefined"
            ? performance.now()
            : 0;
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
                    const gradeFactor = useGradeAdjustment.value
                        ? calculateGradeAdjustmentFactor(g)
                        : 1.0;
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
    if (__isClient && __isDev) {
        console.log("[SplitsTable] rows built", {
            ms:
                typeof performance !== "undefined"
                    ? performance.now() - __tRows
                    : 0,
            rows: rows.length,
            cumulativeTravel,
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
            // In target time mode, interpret targetTimeSeconds as either:
            // - total elapsed (includes stoppages), or
            // - travel-only time (stoppages added on top)
            desiredLast =
                plan.targetTimeSeconds +
                (plan.targetIncludesStoppages === true ? 0 : stoppageLast);
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

        if (__isClient && __isDev) {
            console.log("[SplitsTable] elapsed back-calc", {
                lastBoundary,
                stoppageLast,
                rawLast,
                desiredLast,
                extraScale,
            });
        }
    }

    if (__isClient && __isDev) {
        console.timeEnd("SplitsTable: splits compute");
        console.log("[SplitsTable] splits compute summary", {
            total,
            lengthMeters: length,
            boundaries: boundaries.length,
            rows: rows.length,
            sampleStep,
            gradeWindow,
            normScale,
            useGradeAdjustment: useGradeAdjustment.value,
            strategy: currentPlan.value?.pacingStrategy ?? "flat",
            linearPercent: currentPlan.value?.pacingLinearPercent ?? 0,
        });
    }

    return rows;
});

const lastClickedIndex = ref<number | null>(null);

function onRowClick(row: SplitRow, e: MouseEvent) {
    const shift = e.shiftKey;
    const index = row.index;

    if (shift) {
        if (lastClickedIndex.value != null) {
            const startIndex = Math.min(lastClickedIndex.value, index);
            const endIndex = Math.max(lastClickedIndex.value, index);

            if (
                selectedSplitRange?.value &&
                selectedSplitRange.value.startIndex === startIndex &&
                selectedSplitRange.value.endIndex === endIndex
            ) {
                emit("split-cancel");
            } else {
                const first = splits.value[startIndex - 1];
                const last = splits.value[endIndex - 1];
                if (first && last) {
                    emit("split-range-click", {
                        startIndex,
                        endIndex,
                        start: first.start,
                        end: last.end,
                    });
                }
            }
        } else {
            // Anchor the first index for range selection; no emit yet
            lastClickedIndex.value = index;
        }
        return;
    }

    // Normal click path
    lastClickedIndex.value = index;

    // If currently a range is selected and clicked inside it, cancel selection
    if (
        selectedSplitRange?.value &&
        index >= selectedSplitRange.value.startIndex &&
        index <= selectedSplitRange.value.endIndex
    ) {
        emit("split-cancel");
        return;
    }

    // If single selection is active and clicked again, cancel selection
    if (selectedSplitIndex?.value === index && !selectedSplitRange?.value) {
        emit("split-cancel");
        return;
    }

    // Otherwise select this single split
    emit("split-click", { start: row.start, end: row.end, index });
}
</script>

<template>
    <div class="h-full w-full overflow-hidden flex flex-col">
        <div class="flex-1 overflow-auto">
            <table class="min-w-full text-sm whitespace-nowrap">
                <thead
                    class="sticky top-0 bg-(--bg-color) z-0 border-b border-(--sub-color)"
                >
                    <tr class="text-(--sub-color) text-xs uppercase">
                        <th class="text-left p-x-1! py-2 whitespace-nowrap">
                            Dist
                        </th>
                        <th class="text-right p-x-1! py-1! whitespace-nowrap">
                            Gain
                        </th>
                        <th class="text-right p-x-1! py-1! whitespace-nowrap">
                            Loss
                        </th>
                        <th class="text-right p-x-1! py-1! whitespace-nowrap">
                            Grade
                        </th>
                        <th
                            v-if="currentPlan"
                            class="text-right p-x-1! py-1! whitespace-nowrap"
                        >
                            Pace
                        </th>
                        <th
                            v-if="currentPlan"
                            class="text-right p-x-1! py-1! whitespace-nowrap"
                        >
                            Elapsed
                        </th>
                    </tr>
                </thead>
                <tbody>
                    <tr
                        v-for="row in splits"
                        :key="row.index"
                        class="border-b border-(--sub-color)/50 hover:bg-(--sub-alt-color) transition-colors cursor-pointer"
                        :class="{
                            'bg-(--main-color)/15':
                                selectedSplitIndex === row.index ||
                                (selectedSplitRange &&
                                    row.index >=
                                        selectedSplitRange.startIndex &&
                                    row.index <= selectedSplitRange.endIndex),
                        }"
                        @mousedown.prevent
                        @click="onRowClick(row, $event)"
                    >
                        <td
                            class="p-x-1! py-1! text-(--main-color) whitespace-nowrap"
                        >
                            {{ formatSplitDistance(row.end) }}
                        </td>
                        <td
                            class="p-x-1! py-1! text-(--main-color) text-right whitespace-nowrap"
                        >
                            {{
                                formatElevation(row.gain, getElevationUnitSSR())
                            }}
                        </td>
                        <td
                            class="p-x-1! py-1! text-(--main-color) text-right whitespace-nowrap"
                        >
                            {{
                                formatElevation(row.loss, getElevationUnitSSR())
                            }}
                        </td>
                        <td
                            class="p-x-1! py-1! text-(--main-color) text-right whitespace-nowrap"
                        >
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
                            class="p-x-1! py-1! text-(--main-color) text-right whitespace-nowrap"
                        >
                            <span
                                v-if="row.paceSecPerUnit !== null"
                                class="whitespace-nowrap"
                            >
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
                            class="p-x-1! py-1! text-(--main-color) text-right whitespace-nowrap"
                        >
                            <span v-if="row.elapsedSec !== null">{{
                                formatElapsedTime(Math.round(row.elapsedSec!))
                            }}</span>
                            <span v-else>—</span>
                        </td>
                    </tr>

                    <tr v-if="splits.length === 0">
                        <td
                            class="p-x-1! py-6 text-center text-(--sub-color) whitespace-nowrap"
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
