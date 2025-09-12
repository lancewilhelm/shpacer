<script setup lang="ts">
import * as d3 from "d3";
import {
    extractElevationProfile,
    interpolateAtDistance,
    getElevationStats,
    calculateGradeAtDistance,
    type ElevationPoint,
} from "~/utils/elevationProfile";
import { calculateActualPacesForTarget } from "~/utils/paceAdjustment";
import { formatDistance, formatElevation } from "~/utils/courseMetrics";
import { useUserSettingsStore } from "~/stores/userSettings";
import { getWaypointColorFromOrder } from "~/utils/waypoints";
import type { SelectPlan } from "~/utils/db/schema";

interface Props {
    geoJsonData: GeoJSON.FeatureCollection[];
    height?: number;
    mapHoverDistance?: number | null;
    selectedWaypointDistance?: number | null;
    waypoints?: Array<{
        id: string;
        name: string;
        distance: number;
        order: number;
        tags: string[];
    }>;
    creationMode?: boolean;
    plan?: SelectPlan | null;
    showPaceChart?: boolean;
    highlightSegment?: { start: number; end: number } | null;
    highlightColor?: string;
}

interface ElevationHoverEvent {
    lat: number;
    lng: number;
    distance: number;
    elevation: number;
    grade: number;
}

interface PaceHoverEvent {
    lat: number;
    lng: number;
    distance: number;
    elevation: number;
    grade: number;
}

const props = withDefaults(defineProps<Props>(), {
    height: 200,
    mapHoverDistance: null,
    selectedWaypointDistance: null,
    waypoints: () => [],
    creationMode: false,
    plan: null,
    showPaceChart: true,
    highlightSegment: null,
    highlightColor: "#ff0000",
});

const emit = defineEmits<{
    "elevation-hover": [event: ElevationHoverEvent];
    "elevation-leave": [];
    "pace-hover": [event: PaceHoverEvent];
    "pace-leave": [];
    "waypoint-click": [
        waypoint: {
            id: string;
            name: string;
            distance: number;
            order: number;
            tags: string[];
        },
    ];
    "waypoint-create": [
        event: {
            lat: number;
            lng: number;
            distance: number;
            elevation: number;
        },
    ];
}>();

const userSettingsStore = useUserSettingsStore();
const chartContainer = ref<HTMLElement>();
const paceChartContainer = ref<HTMLElement>();
const tooltip = ref<HTMLElement>();

// Tooltip state
const tooltipVisible = ref(false);
const tooltipFromMap = ref(false); // Track if tooltip is from map hover
const tooltipData = ref({
    distance: "",
    elevation: "",
    grade: "",
    actualPace: "",
});

// Shared hover sync state for chart-to-chart hover
const chartHoverDistance = ref<number | null>(null);
const chartHoverSource = ref<"elevation" | "pace" | null>(null);

// Pace chart height factor as fraction of total charts height when pace chart is shown (e.g., 0.45 = 45% of total)
const paceChartHeightFactor = 0.45;

// Shared axis margins and chart padding
const AXIS_MARGIN_LEFT = 60;
const AXIS_MARGIN_RIGHT = 20;

// Elevation chart margins
const ELEVATION_MARGIN_TOP = 20;
const ELEVATION_MARGIN_BOTTOM = 20;

// Pace chart margins
const PACE_MARGIN_TOP = 10;
const PACE_MARGIN_BOTTOM = 20;

// Tooltip padding relative to chart
const TOOLTIP_MARGIN_TOP = 20;

// Consolidated margin objects
const ELEVATION_CHART_MARGIN = {
    top: ELEVATION_MARGIN_TOP,
    right: AXIS_MARGIN_RIGHT,
    bottom: ELEVATION_MARGIN_BOTTOM,
    left: AXIS_MARGIN_LEFT,
};
const PACE_CHART_MARGIN = {
    top: PACE_MARGIN_TOP,
    right: AXIS_MARGIN_RIGHT,
    bottom: PACE_MARGIN_BOTTOM,
    left: AXIS_MARGIN_LEFT,
};
const TOOLTIP_MARGIN = {
    top: TOOLTIP_MARGIN_TOP,
    right: AXIS_MARGIN_RIGHT,
    bottom: 40,
    left: AXIS_MARGIN_LEFT,
};

// Chart state
let svg: d3.Selection<SVGSVGElement, unknown, null, undefined> | null = null;
let xScale: d3.ScaleLinear<number, number> | null = null;
let yScale: d3.ScaleLinear<number, number> | null = null;
let elevationPoints: ElevationPoint[] = [];
let crosshair: d3.Selection<SVGLineElement, unknown, null, undefined> | null =
    null;
let mapHoverCrosshair: d3.Selection<
    SVGLineElement,
    unknown,
    null,
    undefined
> | null = null;
let waypointCrosshair: d3.Selection<
    SVGLineElement,
    unknown,
    null,
    undefined
> | null = null;

// Pace chart state
let paceSvg: d3.Selection<SVGSVGElement, unknown, null, undefined> | null =
    null;
let paceXScale: d3.ScaleLinear<number, number> | null = null;
let paceYScale: d3.ScaleLinear<number, number> | null = null;
let paceCrosshair: d3.Selection<
    SVGLineElement,
    unknown,
    null,
    undefined
> | null = null;
let paceMapHoverCrosshair: d3.Selection<
    SVGLineElement,
    unknown,
    null,
    undefined
> | null = null;

// Sync crosshairs
let elevationSyncCrosshair: d3.Selection<
    SVGLineElement,
    unknown,
    null,
    undefined
> | null = null;
let paceSyncCrosshair: d3.Selection<
    SVGLineElement,
    unknown,
    null,
    undefined
> | null = null;

watch(
    () => [props.highlightSegment, props.highlightColor],
    () => {
        // Reinitialize charts to reflect new highlight segment/color
        if (chartContainer.value) {
            initChart();
        }
        if (props.showPaceChart && paceChartContainer.value) {
            initPaceChart();
        }
    },
    { deep: true },
);

// Computed properties
const hasElevationData = computed(() => {
    return (
        elevationPoints.length > 0 &&
        elevationPoints.some((point) => point.elevation > 0)
    );
});

// Smoothed elevation series (distance-window boxcar) using gradeWindowMeters
const smoothedElevationPoints = computed(() => {
    const window = smoothingConfig.value.gradeWindowMeters;
    const n = elevationPoints.length;
    if (window === 0 || n === 0) return elevationPoints; // No smoothing if 0 or no data

    const half = window / 2;
    const result: ElevationPoint[] = [];

    // Pre-extract distances for speed
    const dist = elevationPoints.map((p) => p.distance);

    let left = 0;
    let right = -1;
    let sumElev = 0;
    let sumLat = 0;
    let sumLng = 0;
    let count = 0;

    for (let i = 0; i < n; i++) {
        const center = dist[i]!;

        // Expand right boundary while within [center - half, center + half]
        while (right + 1 < n && dist[right + 1]! <= center + half) {
            right++;
            const p = elevationPoints[right]!;
            sumElev += p.elevation;
            sumLat += p.lat;
            sumLng += p.lng;
            count++;
        }

        // Shrink left boundary while outside the window on the left
        while (left < n && dist[left]! < center - half) {
            const p = elevationPoints[left]!;
            sumElev -= p.elevation;
            sumLat -= p.lat;
            sumLng -= p.lng;
            count--;
            left++;
        }

        if (count > 0) {
            result.push({
                distance: elevationPoints[i]!.distance,
                elevation: sumElev / count,
                lat: sumLat / count,
                lng: sumLng / count,
                originalIndex: elevationPoints[i]!.originalIndex,
            });
        } else {
            // Fallback: use original point if no neighbors found
            result.push(elevationPoints[i]!);
        }
    }
    return result;
});

const elevationStats = computed(() => {
    return getElevationStats(smoothedElevationPoints.value);
});

// Pace chart computed properties
const hasPaceData = computed(() => {
    return (
        props.plan &&
        props.plan.pace &&
        props.plan.pace > 0 &&
        props.geoJsonData &&
        props.geoJsonData.length > 0
    );
});

const totalDistance = computed(() => {
    if (elevationPoints.length === 0) return 0;
    return Math.max(...elevationPoints.map((p) => p.distance));
});

// Per-course smoothing configuration (grade window and pace smoothing)
const route = useRoute();
const courseIdForSmoothing = computed(() => {
    const fromPlan = props.plan?.courseId;
    const fromRoute = (route.params?.id as string) || undefined;
    return fromPlan ?? fromRoute;
});

const smoothingConfig = computed(() => {
    const s = userSettingsStore.getSmoothingForCourse(
        courseIdForSmoothing.value,
    );
    return {
        gradeWindowMeters: s.gradeWindowMeters,
        paceSmoothingMeters: s.paceSmoothingMeters,
    };
});

// Calculate actual paces needed at each point to achieve target average pace
const actualPaceData = computed(() => {
    if (!props.plan || !props.plan.pace || elevationPoints.length === 0) {
        return [];
    }

    // When grade-adjusted pacing is disabled, still compute using pacing strategy (grade factors = 1)
    // Handled by calculateActualPacesForTarget via useGradeAdjustment=false

    const mode = props.plan.paceMode || "pace";
    const maintainTargetAverage = mode !== "normalized";

    return calculateActualPacesForTarget(
        smoothedElevationPoints.value,
        props.plan.pace,
        smoothingConfig.value.gradeWindowMeters,
        smoothingConfig.value.paceSmoothingMeters,
        maintainTargetAverage,
        props.plan.pacingStrategy === "linear" ? "linear" : "flat",
        props.plan.pacingLinearPercent ?? 0,
        props.plan.useGradeAdjustment !== false,
    );
});

const paceRange = computed(() => {
    if (actualPaceData.value.length === 0) {
        return { min: 0, max: 0 };
    }
    const paces = actualPaceData.value.map((d) => d.actualPace);
    return {
        min: Math.min(...paces),
        max: Math.max(...paces),
    };
});

// Format pace for display (converts seconds per mile/km to MM:SS format)
function formatPace(paceInSeconds: number): string {
    const totalSeconds = Math.round(paceInSeconds);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

// Process GeoJSON data to extract elevation profile
function processGeoJsonData() {
    if (!props.geoJsonData || props.geoJsonData.length === 0) {
        elevationPoints = [];
        return;
    }

    // Combine all GeoJSON data
    const combinedFeatures: GeoJSON.Feature[] = [];
    for (const geoJson of props.geoJsonData) {
        combinedFeatures.push(...geoJson.features);
    }

    const combinedGeoJson: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features: combinedFeatures,
    };

    elevationPoints = extractElevationProfile(combinedGeoJson); // Use all points for maximum accuracy
}

// Function to get waypoint display content (S, F, or number)
function getWaypointDisplayContent(
    waypoint: { id: string; order: number },
    waypoints: { id: string; order: number }[],
): string {
    const sortedWaypoints = [...waypoints].sort((a, b) => a.order - b.order);
    const waypointIndex = sortedWaypoints.findIndex(
        (w) => w.id === waypoint.id,
    );

    if (waypointIndex === -1) return "?";

    // First waypoint is Start
    if (waypointIndex === 0) return "S";

    // Last waypoint is Finish
    if (waypointIndex === sortedWaypoints.length - 1) return "F";

    // Middle waypoints are numbered 1, 2, 3, etc.
    return waypointIndex.toString();
}

// Function to get waypoint primary color
function getWaypointPrimaryColor(
    waypoint: { order: number },
    waypoints: { order: number }[],
): string {
    return getWaypointColorFromOrder(waypoint, waypoints);
}

// Add waypoint pins to the elevation chart
function addWaypointPins() {
    if (!svg || !xScale || !yScale || !props.waypoints) return;

    // Remove existing waypoint pins
    svg.selectAll(".waypoint-pin").remove();

    // Create waypoint pins
    const waypointGroup = svg
        .select("g")
        .append("g")
        .attr("class", "waypoint-pins");

    props.waypoints.forEach((waypoint) => {
        // Find elevation at this distance
        const interpolatedPoint = interpolateAtDistance(
            smoothedElevationPoints.value,
            waypoint.distance,
        );
        if (!interpolatedPoint) return;

        const x = xScale!(waypoint.distance);
        const y = yScale!(interpolatedPoint.elevation);
        const color = getWaypointPrimaryColor(waypoint, props.waypoints);
        const isSelected = props.selectedWaypointDistance === waypoint.distance;
        const circleSize = isSelected ? 16 : 12;
        const displayContent = getWaypointDisplayContent(
            waypoint,
            props.waypoints,
        );
        const offsetY = circleSize + 8; // Position circle above the line

        // Create a group for each waypoint pin
        const pinGroup = waypointGroup
            .append("g")
            .attr("class", "waypoint-pin")
            .attr("data-waypoint-id", waypoint.id)
            .attr("transform", `translate(${x}, ${y - offsetY})`) // Position above the line
            .style("cursor", "pointer");

        // Add a connecting line from circle to elevation line
        pinGroup
            .append("line")
            .attr("x1", 0)
            .attr("y1", circleSize)
            .attr("x2", 0)
            .attr("y2", offsetY)
            .style("stroke", color)
            .style("stroke-width", isSelected ? 2 : 1)
            .style("opacity", 0.6)
            .style("pointer-events", "none");

        // Add the circle background
        pinGroup
            .append("circle")
            .attr("r", circleSize)
            .style("fill", color)
            .style("stroke", "#ffffff")
            .style("stroke-width", isSelected ? 3 : 2)
            .style("opacity", 0.7)
            .style("filter", "drop-shadow(0 2px 4px rgba(0,0,0,0.3))");

        // Add the number text
        pinGroup
            .append("text")
            .attr("text-anchor", "middle")
            .attr("dominant-baseline", "middle")
            .attr("font-size", `${circleSize * 0.8}px`)
            .attr("font-weight", "bold")
            .attr("fill", "#ffffff")
            .attr("pointer-events", "none")
            .text(displayContent);

        // Add click handler with proper event binding
        pinGroup
            .on("click", (event) => {
                event.stopPropagation();
                emit("waypoint-click", waypoint);
            })
            .on("mouseenter", function () {
                d3.select(this).style("cursor", "pointer");
            })
            .on("mouseleave", function () {
                d3.select(this).style("cursor", "pointer");
            });

        // Add hover tooltip
        pinGroup
            .append("title")
            .text(
                `${waypoint.name} - ${formatDistance(waypoint.distance, typeof (userSettingsStore as unknown as { getDistanceUnitForCourse?: unknown })?.getDistanceUnitForCourse === "function" ? userSettingsStore.getDistanceUnitForCourse() : "miles")}`,
            );
    });
}

// Initialize the D3 chart
function initChart() {
    if (!chartContainer.value || elevationPoints.length === 0) return;

    // Clear any existing chart
    d3.select(chartContainer.value).selectAll("*").remove();

    const container = chartContainer.value;
    const containerRect = container.getBoundingClientRect();
    const width = containerRect.width;
    const height =
        props.showPaceChart && hasPaceData.value
            ? props.height * (1 - paceChartHeightFactor)
            : props.height;

    // Reduce bottom margin when pace chart is actually shown
    const margin = ELEVATION_CHART_MARGIN; // Increased top margin for waypoint circles
    const innerWidth = width - margin.left - margin.right;
    const mobileFactor =
        window.innerWidth < 768 && !props.showPaceChart ? 35 : 0;
    const innerHeight = height - margin.top - margin.bottom - mobileFactor;

    // Create SVG
    svg = d3
        .select(container)
        .append("svg")
        .attr("width", width)
        .attr("height", height)
        .style("background", "var(--bg-color)");

    const g = svg
        .append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

    // Set up scales
    const stats = elevationStats.value;
    xScale = d3
        .scaleLinear()
        .domain([0, stats.totalDistance])
        .range([0, innerWidth]);

    yScale = d3
        .scaleLinear()
        .domain([stats.minElevation * 0.95, stats.maxElevation * 1.05])
        .range([innerHeight, 0]);

    // Create line generator
    const line = d3
        .line<ElevationPoint>()
        .x((d) => xScale!(d.distance))
        .y((d) => yScale!(d.elevation))
        .curve(d3.curveCardinal);

    // Add gradient definition
    const defs = svg.append("defs");
    const gradient = defs
        .append("linearGradient")
        .attr("id", "elevation-gradient")
        .attr("gradientUnits", "userSpaceOnUse")
        .attr("x1", 0)
        .attr("y1", yScale(stats.maxElevation))
        .attr("x2", 0)
        .attr("y2", yScale(stats.minElevation));

    gradient
        .append("stop")
        .attr("offset", "0%")
        .attr("stop-color", "var(--main-color)")
        .attr("stop-opacity", 0.3);

    gradient
        .append("stop")
        .attr("offset", "100%")
        .attr("stop-color", "var(--main-color)")
        .attr("stop-opacity", 0.05);

    // Add area under curve
    const area = d3
        .area<ElevationPoint>()
        .x((d) => xScale!(d.distance))
        .y0(innerHeight)
        .y1((d) => yScale!(d.elevation))
        .curve(d3.curveCardinal);

    g.append("path")
        .datum(smoothedElevationPoints.value)
        .attr("fill", "url(#elevation-gradient)")
        .attr("d", area);

    // Add elevation line
    g.append("path")
        .datum(smoothedElevationPoints.value)
        .attr("fill", "none")
        .attr("stroke", "var(--main-color)")
        .attr("stroke-width", 2)
        .attr("d", line);

    // Add axes
    const xAxis = d3
        .axisBottom(xScale)
        .ticks(8)
        .tickFormat((d) =>
            formatDistance(
                Number(d),
                typeof (
                    userSettingsStore as unknown as {
                        getDistanceUnitForCourse?: unknown;
                    }
                )?.getDistanceUnitForCourse === "function"
                    ? userSettingsStore.getDistanceUnitForCourse()
                    : "miles",
            ),
        );

    const yAxis = d3
        .axisLeft(yScale)
        .ticks(6)
        .tickFormat((d) =>
            formatElevation(
                Number(d),
                typeof (
                    userSettingsStore as unknown as {
                        getElevationUnitForCourse?: unknown;
                    }
                )?.getElevationUnitForCourse === "function"
                    ? userSettingsStore.getElevationUnitForCourse()
                    : "feet",
            ),
        );

    // Show x-axis when pace chart is not actually displayed
    if (!(props.showPaceChart && hasPaceData.value)) {
        const xAxisG = g
            .append("g")
            .attr("class", "x-axis")
            .attr("transform", `translate(0,${innerHeight})`)
            .call(xAxis);

        xAxisG
            .selectAll("text")
            .style("fill", "var(--sub-color)")
            .style("font-size", "12px");

        if (
            typeof window !== "undefined" &&
            window.matchMedia("(max-width: 767px)").matches
        ) {
            xAxisG
                .selectAll("text")
                .attr("transform", "rotate(-45)")
                .style("text-anchor", "end");
        }
    }

    g.append("g")
        .call(yAxis)
        .selectAll("text")
        .style("fill", "var(--sub-color)")
        .style("font-size", "12px");

    // Style axis lines and ticks
    g.selectAll(".domain, .tick line")
        .style("stroke", "var(--sub-color)")
        .style("opacity", 0.3);

    // Add grid lines
    g.selectAll(".grid-line-x")
        .data(xScale.ticks(8))
        .enter()
        .append("line")
        .attr("class", "grid-line-x")
        .attr("x1", (d) => xScale!(d))
        .attr("x2", (d) => xScale!(d))
        .attr("y1", 0)
        .attr("y2", innerHeight)
        .style("stroke", "var(--sub-color)")
        .style("stroke-width", 0.5)
        .style("opacity", 0.1);

    g.selectAll(".grid-line-y")
        .data(yScale.ticks(6))
        .enter()
        .append("line")
        .attr("class", "grid-line-y")
        .attr("x1", 0)
        .attr("x2", innerWidth)
        .attr("y1", (d) => yScale!(d))
        .attr("y2", (d) => yScale!(d))
        .style("stroke", "var(--sub-color)")
        .style("stroke-width", 0.5)
        .style("opacity", 0.1);

    // Highlight selected elevation segment (if provided)
    if (props.highlightSegment && xScale) {
        const segStart = Math.max(
            0,
            Math.min(stats.totalDistance, props.highlightSegment.start),
        );
        const segEnd = Math.max(
            segStart,
            Math.min(stats.totalDistance, props.highlightSegment.end),
        );
        const x1 = xScale(segStart);
        const x2 = xScale(segEnd);
        if (x2 > x1) {
            g.append("rect")
                .attr("class", "elevation-highlight-segment")
                .attr("x", x1)
                .attr("y", 0)
                .attr("width", x2 - x1)
                .attr("height", innerHeight)
                .style("fill", props.highlightColor || "#ff0000")
                .style("opacity", 0.15)
                .style("pointer-events", "none");
        }
    }

    // Add crosshair line (initially hidden)
    crosshair = g
        .append("line")
        .attr("class", "crosshair")
        .attr("x1", 0)
        .attr("x2", 0)
        .attr("y1", 0)
        .attr("y2", innerHeight)
        .style("stroke", "var(--main-color)")
        .style("stroke-width", 1)
        .style("opacity", 0)
        .style("pointer-events", "none");

    // Add map hover crosshair line (initially hidden)
    mapHoverCrosshair = g
        .append("line")
        .attr("class", "map-hover-crosshair")
        .attr("x1", 0)
        .attr("x2", 0)
        .attr("y1", 0)
        .attr("y2", innerHeight)
        .style("stroke", "var(--main-color)")
        .style("stroke-width", 1)
        .style("opacity", 0)
        .style("pointer-events", "none");

    // Add sync crosshair for hover sync from pace chart
    elevationSyncCrosshair = g
        .append("line")
        .attr("class", "elevation-sync-crosshair")
        .attr("y1", 0)
        .attr("y2", innerHeight)
        .style("stroke", "var(--main-color)")
        .style("stroke-width", 1)
        .style("opacity", 0)
        .style("pointer-events", "none");

    // Add waypoint crosshair line (initially hidden)
    waypointCrosshair = g
        .append("line")
        .attr("class", "waypoint-crosshair")
        .attr("x1", 0)
        .attr("x2", 0)
        .attr("y1", 0)
        .attr("y2", innerHeight)
        .style("stroke", "var(--main-color)")
        .style("stroke-width", 2)
        .style("opacity", 0)
        .style("pointer-events", "none");

    // Add waypoint pins
    nextTick(() => {
        addWaypointPins();
    });

    // Add invisible overlay for mouse interactions
    g.append("rect")
        .attr("class", "overlay")
        .attr("width", innerWidth)
        .attr("height", innerHeight)
        .style("fill", "none")
        .style("pointer-events", "all")
        .style("cursor", props.creationMode ? "crosshair" : "default")
        .on("mousemove", handleMouseMove)
        .on("mouseleave", handleMouseLeave)
        .on("click", handleChartClick);

    // Add axis labels
    g.append("text")
        .attr("transform", "rotate(-90)")
        .attr("y", 0 - margin.left)
        .attr("x", 0 - innerHeight / 2)
        .attr("dy", "1em")
        .style("text-anchor", "middle")
        .style("fill", "var(--sub-color)")
        .style("font-size", "12px")
        .text("Elevation");

    // Show distance label when pace chart is not actually displayed
    if (!(props.showPaceChart && hasPaceData.value)) {
        g.append("text")
            .attr(
                "transform",
                `translate(${innerWidth / 2}, ${innerHeight + margin.bottom})`,
            )
            .style("text-anchor", "middle")
            .style("fill", "var(--sub-color)")
            .style("font-size", "12px")
            .text("");
    }
}

// Show crosshair and tooltip on elevation chart from pace chart hover
function showElevationChartHover(distance: number) {
    if (
        !xScale ||
        !elevationSyncCrosshair ||
        !hasElevationData.value ||
        !tooltip.value
    )
        return;

    const x = xScale(distance);
    // Ensure crosshair is within bounds
    if (x >= 0 && x <= (xScale?.range?.()[1] || 0)) {
        elevationSyncCrosshair
            .attr("x1", x)
            .attr("x2", x)
            .style("opacity", 0.8);
    }

    // Show tooltip for elevation chart
    const interpolatedPoint = interpolateAtDistance(
        smoothedElevationPoints.value,
        distance,
    );
    if (interpolatedPoint) {
        const grade = calculateGradeAtDistance(
            smoothedElevationPoints.value,
            interpolatedPoint.distance,
            smoothingConfig.value.gradeWindowMeters,
        );
        const gradeFormatted =
            grade >= 0 ? `+${grade.toFixed(1)}%` : `${grade.toFixed(1)}%`;

        // Find closest pace data point if available
        let actualPace = "";
        if (hasPaceData.value && actualPaceData.value.length > 0) {
            const closestPacePoint = actualPaceData.value.reduce(
                (prev, curr) =>
                    Math.abs(curr.distance - distance) <
                    Math.abs(prev.distance - distance)
                        ? curr
                        : prev,
            );
            if (closestPacePoint) {
                const isMiles =
                    (typeof (
                        userSettingsStore as unknown as {
                            getDistanceUnitForCourse?: unknown;
                        }
                    )?.getDistanceUnitForCourse === "function"
                        ? userSettingsStore.getDistanceUnitForCourse()
                        : "miles") === "miles";
                const paceWithUnits =
                    formatPace(closestPacePoint.actualPace) +
                    (isMiles ? "/mi" : "/km");
                actualPace = paceWithUnits;
            }
        }

        tooltipData.value = {
            distance: formatDistance(
                interpolatedPoint.distance,
                typeof (
                    userSettingsStore as unknown as {
                        getDistanceUnitForCourse?: unknown;
                    }
                )?.getDistanceUnitForCourse === "function"
                    ? userSettingsStore.getDistanceUnitForCourse()
                    : "miles",
            ),
            elevation: formatElevation(
                interpolatedPoint.elevation,
                typeof (
                    userSettingsStore as unknown as {
                        getElevationUnitForCourse?: unknown;
                    }
                )?.getElevationUnitForCourse === "function"
                    ? userSettingsStore.getElevationUnitForCourse()
                    : "feet",
            ),
            grade: gradeFormatted,
            actualPace: actualPace,
        };

        // Position tooltip
        const containerRect = chartContainer.value!.getBoundingClientRect();
        const tooltipEl = tooltip.value;
        const margin = TOOLTIP_MARGIN;

        const chartX = x + margin.left;
        const chartY = margin.top + 10;

        const tooltipWidth = tooltipEl.offsetWidth;
        const finalX = Math.min(
            chartX,
            containerRect.width - tooltipWidth - 10,
        );

        tooltipEl.style.left = `${finalX}px`;
        tooltipEl.style.top = `${chartY}px`;

        tooltipVisible.value = true;
        tooltipFromMap.value = false;
    }
}

// Show crosshair and tooltip on pace chart from elevation chart hover
function showPaceChartHover(distance: number) {
    if (!paceXScale || !paceSyncCrosshair || !hasPaceData.value) return;

    const x = paceXScale(distance);
    // Ensure crosshair is within bounds
    if (x >= 0 && x <= (paceXScale?.range?.()[1] || 0)) {
        paceSyncCrosshair.attr("x1", x).attr("x2", x).style("opacity", 0.8);
    }
}

// Hide chart hover sync
function hideChartHoverSync() {
    if (elevationSyncCrosshair) {
        elevationSyncCrosshair.style("opacity", 0);
    }
    if (paceSyncCrosshair) {
        paceSyncCrosshair.style("opacity", 0);
    }

    // Only hide elevation tooltip if not from map hover and not from direct chart hover
    if (!props.mapHoverDistance) {
        // Check if elevation tooltip should be hidden
        if (!crosshair || crosshair.style("opacity") === "0") {
            tooltipVisible.value = false;
        }
    }
}

function initPaceChart() {
    if (
        !paceChartContainer.value ||
        !hasPaceData.value ||
        actualPaceData.value.length === 0
    )
        return;

    // Clear any existing chart
    d3.select(paceChartContainer.value).selectAll("*").remove();

    const container = paceChartContainer.value;
    const containerRect = container.getBoundingClientRect();
    const width = containerRect.width;
    const height = props.height * paceChartHeightFactor;

    const margin = PACE_CHART_MARGIN;
    const innerWidth = width - margin.left - margin.right;
    const mobileFactor =
        window.innerWidth < 768 && props.showPaceChart ? 25 : 0;
    const innerHeight = height - margin.top - margin.bottom - mobileFactor;

    // Create SVG
    paceSvg = d3
        .select(container)
        .append("svg")
        .attr("width", width)
        .attr("height", height)
        .style("background", "var(--bg-color)");

    const g = paceSvg
        .append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

    // Set up scales
    paceXScale = d3
        .scaleLinear()
        .domain([0, totalDistance.value])
        .range([0, innerWidth]);

    paceYScale = d3
        .scaleLinear()
        .domain([paceRange.value.min * 0.95, paceRange.value.max * 1.05])
        .range([innerHeight, 0]);

    // Highlight selected pace segment (if provided)
    if (props.highlightSegment && paceXScale) {
        const segStart = Math.max(
            0,
            Math.min(totalDistance.value, props.highlightSegment.start),
        );
        const segEnd = Math.max(
            segStart,
            Math.min(totalDistance.value, props.highlightSegment.end),
        );
        const px1 = paceXScale(segStart);
        const px2 = paceXScale(segEnd);
        if (px2 > px1) {
            // Assume the primary pace chart group is the last appended group
            const pg = paceSvg!.select("g");
            pg.append("rect")
                .attr("class", "pace-highlight-segment")
                .attr("x", px1)
                .attr("y", 0)
                .attr("width", px2 - px1)
                .attr("height", innerHeight)
                .style("fill", props.highlightColor || "#ff0000")
                .style("opacity", 0.15)
                .style("pointer-events", "none");
        }
    }

    // Create line generator for actual pace
    const actualPaceLine = d3
        .line<{ distance: number; actualPace: number }>()
        .x((d) => paceXScale!(d.distance))
        .y((d) => paceYScale!(d.actualPace))
        .curve(d3.curveCardinal);

    // Add actual pace line
    g.append("path")
        .datum(actualPaceData.value)
        .attr("fill", "none")
        .attr("stroke", "var(--main-color)")
        .attr("stroke-width", 2)
        .attr("d", actualPaceLine);

    // Add target pace line (horizontal)
    if (props.plan && props.plan.pace) {
        g.append("line")
            .attr("x1", 0)
            .attr("y1", paceYScale!(props.plan.pace))
            .attr("x2", innerWidth)
            .attr("y2", paceYScale!(props.plan.pace))
            .style("stroke", "var(--sub-color)")
            .style("stroke-width", 1)
            .style("stroke-dasharray", "5,5")
            .style("opacity", 0.7);
    }

    // Create crosshair
    paceCrosshair = g
        .append("line")
        .attr("y1", 0)
        .attr("y2", innerHeight)
        .style("stroke", "var(--main-color)")
        .style("stroke-width", 1)
        .style("opacity", 0)
        .style("pointer-events", "none");

    // Create map hover crosshair
    paceMapHoverCrosshair = g
        .append("line")
        .attr("y1", 0)
        .attr("y2", innerHeight)
        .style("stroke", "var(--main-color)")
        .style("stroke-width", 1)
        .style("opacity", 0)
        .style("pointer-events", "none");

    // Add sync crosshair for hover sync from elevation chart
    paceSyncCrosshair = g
        .append("line")
        .attr("class", "pace-sync-crosshair")
        .attr("y1", 0)
        .attr("y2", innerHeight)
        .style("stroke", "var(--main-color)")
        .style("stroke-width", 1)
        .style("opacity", 0)
        .style("pointer-events", "none");

    // Create axes
    const xAxis = d3.axisBottom(paceXScale).tickFormat((d) =>
        formatDistance(
            d as number,
            typeof (
                userSettingsStore as unknown as {
                    getDistanceUnitForCourse?: unknown;
                }
            )?.getDistanceUnitForCourse === "function"
                ? userSettingsStore.getDistanceUnitForCourse()
                : "miles",
        ),
    );

    const yAxis = d3
        .axisLeft(paceYScale)
        .tickFormat((d) => formatPace(d as number));

    const paceXAxisG = g
        .append("g")
        .attr("class", "x-axis")
        .attr("transform", `translate(0,${innerHeight})`)
        .call(xAxis);

    paceXAxisG.selectAll("text").style("fill", "var(--sub-color)");

    if (
        typeof window !== "undefined" &&
        window.matchMedia("(max-width: 767px)").matches
    ) {
        paceXAxisG
            .selectAll("text")
            .attr("transform", "rotate(-45)")
            .style("text-anchor", "end");
    }

    g.append("g")
        .call(yAxis)
        .selectAll("text")
        .style("fill", "var(--sub-color)");

    // Style axis lines
    g.selectAll(".domain").style("stroke", "var(--sub-color)");
    g.selectAll(".tick line").style("stroke", "var(--sub-color)");

    // Add invisible overlay for mouse interactions
    g.append("rect")
        .attr("class", "pace-overlay")
        .attr("width", innerWidth)
        .attr("height", innerHeight)
        .style("fill", "none")
        .style("pointer-events", "all")
        .on("mousemove", handlePaceMouseMove)
        .on("mouseleave", handlePaceMouseLeave);

    // Add axis labels
    g.append("text")
        .attr("transform", "rotate(-90)")
        .attr("y", 0 - margin.left)
        .attr("x", 0 - innerHeight / 2)
        .attr("dy", "1em")
        .style("text-anchor", "middle")
        .style("fill", "var(--sub-color)")
        .style("font-size", "12px")
        .text("Pace");
}

// Handle mouse movement over the chart
function handleMouseMove(event: MouseEvent) {
    if (!xScale || !crosshair || !tooltip.value) return;

    const [mouseX] = d3.pointer(event);
    const distance = xScale.invert(mouseX);

    // Show crosshair
    crosshair.attr("x1", mouseX).attr("x2", mouseX).style("opacity", 0.8);

    // Update chart hover sync state
    chartHoverDistance.value = distance;
    chartHoverSource.value = "elevation";

    // Interpolate elevation and coordinates at this distance
    const interpolatedPoint = interpolateAtDistance(
        smoothedElevationPoints.value,
        distance,
    );

    if (interpolatedPoint) {
        // Calculate grade at this distance
        const grade = calculateGradeAtDistance(
            smoothedElevationPoints.value,
            interpolatedPoint.distance,
            smoothingConfig.value.gradeWindowMeters,
        );
        const gradeFormatted =
            grade >= 0 ? `+${grade.toFixed(1)}%` : `${grade.toFixed(1)}%`;

        // Find closest pace data point if available
        let actualPace = "";
        if (hasPaceData.value && actualPaceData.value.length > 0) {
            const closestPacePoint = actualPaceData.value.reduce(
                (prev, curr) =>
                    Math.abs(curr.distance - distance) <
                    Math.abs(prev.distance - distance)
                        ? curr
                        : prev,
            );
            if (closestPacePoint) {
                const isMiles =
                    (typeof (
                        userSettingsStore as unknown as {
                            getDistanceUnitForCourse?: unknown;
                        }
                    )?.getDistanceUnitForCourse === "function"
                        ? userSettingsStore.getDistanceUnitForCourse()
                        : "miles") === "miles";
                const paceWithUnits =
                    formatPace(closestPacePoint.actualPace) +
                    (isMiles ? "/mi" : "/km");
                actualPace = paceWithUnits;
            }
        }

        // Update tooltip data
        tooltipData.value = {
            distance: formatDistance(
                interpolatedPoint.distance,
                typeof (
                    userSettingsStore as unknown as {
                        getDistanceUnitForCourse?: unknown;
                    }
                )?.getDistanceUnitForCourse === "function"
                    ? userSettingsStore.getDistanceUnitForCourse()
                    : "miles",
            ),
            elevation: formatElevation(
                interpolatedPoint.elevation,
                typeof (
                    userSettingsStore as unknown as {
                        getElevationUnitForCourse?: unknown;
                    }
                )?.getElevationUnitForCourse === "function"
                    ? userSettingsStore.getElevationUnitForCourse()
                    : "feet",
            ),
            grade: gradeFormatted,
            actualPace: actualPace,
        };

        // Position tooltip
        const containerRect = chartContainer.value!.getBoundingClientRect();
        const tooltipEl = tooltip.value;
        const margin = TOOLTIP_MARGIN;

        // Calculate position relative to chart area
        const chartX = mouseX + margin.left;
        const chartY = margin.top + 10; // Fixed position near the top

        // Ensure tooltip doesn't go off-screen
        const tooltipWidth = tooltipEl.offsetWidth;
        const finalX = Math.min(
            chartX,
            containerRect.width - tooltipWidth - 10,
        );

        tooltipEl.style.left = `${finalX}px`;
        tooltipEl.style.top = `${chartY}px`;

        // Show tooltip
        tooltipVisible.value = true;
        tooltipFromMap.value = false; // This is from chart hover

        emit("elevation-hover", {
            lat: interpolatedPoint.lat,
            lng: interpolatedPoint.lng,
            distance: interpolatedPoint.distance,
            elevation: interpolatedPoint.elevation,
            grade: grade,
        });
    }
}

// Handle mouse leaving the chart
function handleMouseLeave() {
    if (!crosshair) return;

    // Hide chart crosshair
    crosshair.style("opacity", 0);

    // Clear chart hover sync state if this chart was the source
    if (chartHoverSource.value === "elevation") {
        chartHoverDistance.value = null;
        chartHoverSource.value = null;
    }

    // Only hide tooltip if map crosshair is not visible and we're not syncing from pace chart
    if (
        (!mapHoverCrosshair || mapHoverCrosshair.style("opacity") === "0") &&
        chartHoverSource.value !== "pace"
    ) {
        tooltipVisible.value = false;
        tooltipFromMap.value = false;
    } else if (
        mapHoverCrosshair &&
        mapHoverCrosshair.style("opacity") !== "0"
    ) {
        // If map crosshair is still visible, mark tooltip as from map
        tooltipFromMap.value = true;
    }

    emit("elevation-leave");
}

// Handle chart click for waypoint creation
function handleChartClick(event: MouseEvent) {
    if (!props.creationMode || !xScale) return;

    const [mouseX] = d3.pointer(event);
    const distance = xScale.invert(mouseX);

    // Interpolate elevation and coordinates at this distance
    const interpolatedPoint = interpolateAtDistance(elevationPoints, distance);

    if (interpolatedPoint) {
        emit("waypoint-create", {
            lat: interpolatedPoint.lat,
            lng: interpolatedPoint.lng,
            distance: interpolatedPoint.distance,
            elevation: interpolatedPoint.elevation,
        });
    }
}

// Update map hover crosshair position
function updateMapHoverCrosshair() {
    if (!mapHoverCrosshair || !xScale || !tooltip.value) return;

    if (
        props.mapHoverDistance !== null &&
        props.mapHoverDistance !== undefined
    ) {
        const x = xScale(props.mapHoverDistance);
        mapHoverCrosshair.attr("x1", x).attr("x2", x).style("opacity", 0.8);

        // Show tooltip for map hover as well
        const interpolatedPoint = interpolateAtDistance(
            smoothedElevationPoints.value,
            props.mapHoverDistance,
        );

        if (interpolatedPoint) {
            // Calculate grade at this distance
            const grade = calculateGradeAtDistance(
                smoothedElevationPoints.value,
                interpolatedPoint.distance,
                smoothingConfig.value.gradeWindowMeters,
            );
            const gradeFormatted =
                grade >= 0 ? `+${grade.toFixed(1)}%` : `${grade.toFixed(1)}%`;

            // Update tooltip data
            tooltipData.value = {
                distance: formatDistance(
                    interpolatedPoint.distance,
                    typeof (
                        userSettingsStore as unknown as {
                            getDistanceUnitForCourse?: unknown;
                        }
                    )?.getDistanceUnitForCourse === "function"
                        ? userSettingsStore.getDistanceUnitForCourse()
                        : "miles",
                ),
                elevation: formatElevation(
                    interpolatedPoint.elevation,
                    typeof (
                        userSettingsStore as unknown as {
                            getElevationUnitForCourse?: unknown;
                        }
                    )?.getElevationUnitForCourse === "function"
                        ? userSettingsStore.getElevationUnitForCourse()
                        : "feet",
                ),
                grade: gradeFormatted,
                actualPace: "",
            };

            // Find closest pace data point if available
            let actualPace = "";
            if (hasPaceData.value && actualPaceData.value.length > 0) {
                const closestPacePoint = actualPaceData.value.reduce(
                    (prev, curr) =>
                        Math.abs(curr.distance - props.mapHoverDistance!) <
                        Math.abs(prev.distance - props.mapHoverDistance!)
                            ? curr
                            : prev,
                );
                if (closestPacePoint) {
                    const isMiles =
                        (typeof (
                            userSettingsStore as unknown as {
                                getDistanceUnitForCourse?: unknown;
                            }
                        )?.getDistanceUnitForCourse === "function"
                            ? userSettingsStore.getDistanceUnitForCourse()
                            : "miles") === "miles";
                    const paceWithUnits =
                        formatPace(closestPacePoint.actualPace) +
                        (isMiles ? "/mi" : "/km");
                    actualPace = paceWithUnits;
                }
            }

            tooltipData.value.actualPace = actualPace;

            // Position tooltip
            const containerRect = chartContainer.value!.getBoundingClientRect();
            const tooltipEl = tooltip.value;
            const margin = TOOLTIP_MARGIN;

            // Calculate position relative to chart area
            const chartX = x + margin.left;
            const chartY = margin.top + 10; // Fixed position near the top

            // Ensure tooltip doesn't go off-screen
            const tooltipWidth = tooltipEl.offsetWidth;
            const finalX = Math.min(
                chartX,
                containerRect.width - tooltipWidth - 10,
            );

            tooltipEl.style.left = `${finalX}px`;
            tooltipEl.style.top = `${chartY}px`;

            // Show tooltip
            tooltipVisible.value = true;
            tooltipFromMap.value = true; // This is from map hover
        }
    } else {
        mapHoverCrosshair.style("opacity", 0);

        // Hide tooltip when not hovering over map
        // Only hide if we're not currently hovering over the chart itself
        if (!crosshair || crosshair.style("opacity") === "0") {
            tooltipVisible.value = false;
            tooltipFromMap.value = false;
        }
    }
}

// Handle mouse movement over the pace chart
function handlePaceMouseMove(event: MouseEvent) {
    if (!paceXScale || !paceCrosshair) return;

    const [mouseX] = d3.pointer(event);
    const distance = paceXScale.invert(mouseX);

    // Show crosshair
    paceCrosshair.attr("x1", mouseX).attr("x2", mouseX).style("opacity", 0.8);

    // Update chart hover sync state
    chartHoverDistance.value = distance;
    chartHoverSource.value = "pace";

    // Emit hover event
    const interpolatedPoint = interpolateAtDistance(
        smoothedElevationPoints.value,
        distance,
    );
    if (interpolatedPoint) {
        const grade = calculateGradeAtDistance(
            smoothedElevationPoints.value,
            distance,
            smoothingConfig.value.gradeWindowMeters,
        );
        emit("pace-hover", {
            lat: interpolatedPoint.lat,
            lng: interpolatedPoint.lng,
            distance,
            elevation: interpolatedPoint.elevation,
            grade,
        });
    }
}

// Handle mouse leave from pace chart
function handlePaceMouseLeave() {
    if (paceCrosshair) {
        paceCrosshair.style("opacity", 0);
    }

    // Clear chart hover sync state if this chart was the source
    if (chartHoverSource.value === "pace") {
        chartHoverDistance.value = null;
        chartHoverSource.value = null;
    }

    // Pace chart no longer shows tooltips - they're handled by elevation chart

    // Emit leave event
    emit("pace-leave");
}

// Update pace chart map hover crosshair
function updatePaceMapHoverCrosshair() {
    if (!paceMapHoverCrosshair || !paceXScale || !hasPaceData.value) return;

    if (props.mapHoverDistance !== null) {
        const x = paceXScale(props.mapHoverDistance);
        // Show crosshair at hover position
        paceMapHoverCrosshair.attr("x1", x).attr("x2", x).style("opacity", 0.8);
    } else {
        // Hide crosshair when not hovering
        paceMapHoverCrosshair.style("opacity", 0);
    }
}

// Update waypoint crosshair position
function updateWaypointCrosshair() {
    if (!waypointCrosshair || !xScale || !tooltip.value) return;

    if (
        props.selectedWaypointDistance !== null &&
        props.selectedWaypointDistance !== undefined
    ) {
        const x = xScale(props.selectedWaypointDistance);
        waypointCrosshair.attr("x1", x).attr("x2", x).style("opacity", 0.9); // High opacity for selected waypoint

        // Show tooltip for selected waypoint
        const interpolatedPoint = interpolateAtDistance(
            smoothedElevationPoints.value,
            props.selectedWaypointDistance,
        );

        if (interpolatedPoint) {
            // Calculate grade at this distance
            const grade = calculateGradeAtDistance(
                smoothedElevationPoints.value,
                interpolatedPoint.distance,
                smoothingConfig.value.gradeWindowMeters,
            );
            const gradeFormatted =
                grade >= 0 ? `+${grade.toFixed(1)}%` : `${grade.toFixed(1)}%`;

            // Find closest pace data point if available
            let actualPace = "";
            if (hasPaceData.value && actualPaceData.value.length > 0) {
                const closestPacePoint = actualPaceData.value.reduce(
                    (prev, curr) =>
                        Math.abs(
                            curr.distance - props.selectedWaypointDistance!,
                        ) <
                        Math.abs(
                            prev.distance - props.selectedWaypointDistance!,
                        )
                            ? curr
                            : prev,
                );
                if (closestPacePoint) {
                    const isMiles =
                        (typeof (
                            userSettingsStore as unknown as {
                                getDistanceUnitForCourse?: unknown;
                            }
                        )?.getDistanceUnitForCourse === "function"
                            ? userSettingsStore.getDistanceUnitForCourse()
                            : "miles") === "miles";
                    const paceWithUnits =
                        formatPace(closestPacePoint.actualPace) +
                        (isMiles ? "/mi" : "/km");
                    actualPace = paceWithUnits;
                }
            }

            // Update tooltip data
            tooltipData.value = {
                distance: formatDistance(
                    interpolatedPoint.distance,
                    typeof (
                        userSettingsStore as unknown as {
                            getDistanceUnitForCourse?: unknown;
                        }
                    )?.getDistanceUnitForCourse === "function"
                        ? userSettingsStore.getDistanceUnitForCourse()
                        : "miles",
                ),
                elevation: formatElevation(
                    interpolatedPoint.elevation,
                    typeof (
                        userSettingsStore as unknown as {
                            getElevationUnitForCourse?: unknown;
                        }
                    )?.getElevationUnitForCourse === "function"
                        ? userSettingsStore.getElevationUnitForCourse()
                        : "feet",
                ),
                grade: gradeFormatted,
                actualPace: actualPace,
            };

            // Position tooltip at the waypoint crosshair
            const containerRect = chartContainer.value!.getBoundingClientRect();
            const tooltipEl = tooltip.value;
            const margin = TOOLTIP_MARGIN;

            // Calculate position relative to chart area
            const chartX = x + margin.left;
            const chartY = margin.top + 10; // Fixed position near the top

            // Ensure tooltip doesn't go off-screen
            const tooltipWidth = tooltipEl.offsetWidth;
            const finalX = Math.min(
                chartX,
                containerRect.width - tooltipWidth - 10,
            );

            tooltipEl.style.left = `${finalX}px`;
            tooltipEl.style.top = `${chartY}px`;

            // Show tooltip for selected waypoint
            tooltipVisible.value = true;
            tooltipFromMap.value = true;
        }
    } else {
        waypointCrosshair.style("opacity", 0);
    }
}

// Resize handler
function handleResize() {
    if (hasElevationData.value) {
        initChart();
    }
    if (hasPaceData.value && props.showPaceChart) {
        initPaceChart();
    }
}

// Watch for data changes
watch(
    () => props.geoJsonData,
    () => {
        processGeoJsonData();
        if (hasElevationData.value) {
            nextTick(() => {
                initChart();
            });
        }
        if (hasPaceData.value && props.showPaceChart) {
            nextTick(() => {
                initPaceChart();
            });
        }
    },
    { immediate: true, deep: true },
);

// Watch for unit changes and reinitialize chart
watch(
    () => userSettingsStore.settings.units,
    () => {
        if (hasElevationData.value) {
            nextTick(() => {
                initChart();
            });
        }
        if (hasPaceData.value && props.showPaceChart) {
            nextTick(() => {
                initPaceChart();
            });
        }
    },
    { deep: true },
);

// Watch for smoothing changes and reinitialize charts
watch(
    () => userSettingsStore.settings.smoothing,
    () => {
        if (hasElevationData.value) {
            nextTick(() => {
                initChart();
            });
        }
        if (hasPaceData.value && props.showPaceChart) {
            nextTick(() => {
                initPaceChart();
            });
        }
    },
    { deep: true },
);

// Watch for plan changes and reinitialize charts
watch(
    () => props.plan,
    () => {
        // Re-initialize elevation chart to show/hide x-axis based on plan
        if (hasElevationData.value) {
            nextTick(() => {
                initChart();
            });
        }
        // Re-initialize pace chart if needed
        if (hasPaceData.value && props.showPaceChart) {
            nextTick(() => {
                initPaceChart();
            });
        }
    },
    { deep: true },
);

// Watch for showPaceChart prop changes
watch(
    () => props.showPaceChart,
    () => {
        // Re-initialize elevation chart to show/hide x-axis based on showPaceChart
        if (hasElevationData.value) {
            nextTick(() => {
                initChart();
            });
        }
        // Re-initialize pace chart if needed
        if (hasPaceData.value && props.showPaceChart) {
            nextTick(() => {
                initPaceChart();
            });
        }
    },
);

// Watch for chart hover sync changes
watch([chartHoverDistance, chartHoverSource], ([distance, source]) => {
    if (distance === null || source === null) {
        // Hide chart hover sync
        hideChartHoverSync();
        return;
    }

    // Show crosshairs and tooltips on the opposite chart
    if (source === "elevation" && hasPaceData.value && props.showPaceChart) {
        showPaceChartHover(distance);
    } else if (source === "pace" && hasElevationData.value) {
        showElevationChartHover(distance);
    }
});

// Watch for map hover distance changes
watch(
    () => props.mapHoverDistance,
    () => {
        updateMapHoverCrosshair();
        updatePaceMapHoverCrosshair();
    },
);

// Watch for selected waypoint distance changes
watch(
    () => props.selectedWaypointDistance,
    () => {
        updateWaypointCrosshair();
    },
);

// Watch for waypoints changes
watch(
    () => props.waypoints,
    () => {
        if (hasElevationData.value && svg) {
            nextTick(() => {
                addWaypointPins();
            });
        }
    },
    { deep: true, immediate: true },
);

// Watch for waypoints selection changes (to update pin appearance)
watch(
    () => props.selectedWaypointDistance,
    () => {
        if (hasElevationData.value && svg) {
            nextTick(() => {
                addWaypointPins();
            });
        }
    },
);

// Watch for creation mode changes to update cursor
watch(
    () => props.creationMode,
    () => {
        if (svg) {
            svg.select(".overlay").style(
                "cursor",
                props.creationMode ? "crosshair" : "default",
            );
        }
    },
);

// Re-render when height changes
watch(
    () => props.height,
    () => {
        if (hasElevationData.value) {
            nextTick(() => {
                initChart();
            });
        }
        if (hasPaceData.value && props.showPaceChart) {
            nextTick(() => {
                initPaceChart();
            });
        }
    },
);
// Setup resize observer
// Handle component resize
let resizeObserver: ResizeObserver | null = null;
let paceResizeObserver: ResizeObserver | null = null;

onMounted(() => {
    if (chartContainer.value) {
        resizeObserver = new ResizeObserver(() => {
            handleResize();
        });
        resizeObserver.observe(chartContainer.value);
    }

    if (paceChartContainer.value) {
        paceResizeObserver = new ResizeObserver(() => {
            if (hasPaceData.value && props.showPaceChart) {
                nextTick(() => {
                    initPaceChart();
                });
            }
        });
        paceResizeObserver.observe(paceChartContainer.value);
    }
});

onUnmounted(() => {
    if (resizeObserver) {
        resizeObserver.disconnect();
        resizeObserver = null;
    }
    if (paceResizeObserver) {
        paceResizeObserver.disconnect();
        paceResizeObserver = null;
    }
});
</script>

<template>
    <div class="charts-container">
        <!-- Elevation Chart -->
        <div class="elevation-chart-container">
            <div
                ref="chartContainer"
                class="elevation-chart"
                :class="{ 'creation-mode': creationMode }"
            />

            <!-- Creation mode indicator -->
            <div v-if="creationMode" class="creation-mode-indicator">
                <Icon name="lucide:circle-plus" class="h-4 w-4" />
                <span>Click on the elevation profile to add a waypoint</span>
            </div>

            <!-- Elevation tooltip -->
            <div
                ref="tooltip"
                class="elevation-tooltip"
                :class="{
                    'tooltip-visible': tooltipVisible,
                    'tooltip-from-map': tooltipFromMap,
                }"
            >
                <div class="tooltip-distance">{{ tooltipData.distance }}</div>
                <div class="tooltip-elevation">{{ tooltipData.elevation }}</div>
                <div class="tooltip-grade">{{ tooltipData.grade }}</div>
                <div v-if="tooltipData.actualPace" class="tooltip-pace">
                    {{ tooltipData.actualPace }}
                </div>
            </div>

            <div v-if="!hasElevationData" class="no-elevation-warning">
                <Icon name="lucide:triangle-alert" class="h-4 w-4" />
                <span>No elevation data available for this course</span>
            </div>
        </div>

        <!-- Pace Chart -->
        <div v-if="showPaceChart" class="pace-chart-container">
            <div v-if="!hasPaceData" class="no-pace-data">
                <div class="text-center text-(--sub-color)">
                    <Icon name="mdi:speedometer" class="text-2xl mb-2" />
                    <p>No target average pace set</p>
                    <p class="text-sm">
                        Set a target average pace for this plan to see the
                        grade-adjusted actual pace at each point along the
                        course
                    </p>
                </div>
            </div>
            <div v-else ref="paceChartContainer" class="pace-chart" />
        </div>
    </div>
</template>

<style scoped>
.charts-container {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    overflow: hidden;
}

.elevation-chart-container {
    width: 100%;
    position: relative;
    box-sizing: border-box;
    overflow: hidden;
}

.elevation-chart {
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    overflow: hidden;
}

.pace-chart-container {
    width: 100%;
    position: relative;
    box-sizing: border-box;
    overflow: hidden;
}

.no-pace-data {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    border: 1px solid var(--sub-color);
    border-radius: 8px;
    opacity: 0.7;
    box-sizing: border-box;
    overflow: hidden;
}

.pace-chart {
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    overflow: hidden;
}

/* Ensure embedded SVGs fill their containers without overflowing */
.elevation-chart > svg,
.pace-chart > svg {
    display: block;
    width: 100%;
    height: 100%;
    box-sizing: border-box;
}

.elevation-tooltip {
    position: absolute;
    background: var(--bg-color);
    border: 1px solid var(--main-color);
    border-radius: 6px;
    padding: 4px 8px;
    font-size: 0.75rem;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.2s ease;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    z-index: 10;
    min-width: 120px;
}

.elevation-tooltip.tooltip-visible {
    opacity: 0.9;
}

.elevation-tooltip.tooltip-from-map {
    opacity: 0.8;
    border-style: dashed;
}

.tooltip-distance {
    font-weight: 600;
    color: var(--main-color);
    margin-bottom: 2px;
}

.tooltip-elevation {
    color: var(--sub-color);
    font-size: 0.7rem;
}

.tooltip-grade {
    color: var(--sub-color);
    font-size: 11px;
    font-weight: 500;
}

.tooltip-pace {
    color: var(--main-color);
    font-size: 11px;
    font-weight: 500;
}

.pace-tooltip {
    position: absolute;
    background: var(--bg-color);
    border: 1px solid var(--main-color);
    border-radius: 6px;
    padding: 4px 8px;
    font-size: 0.75rem;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.2s ease;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    z-index: 10;
    min-width: 120px;
}

.pace-tooltip.tooltip-visible {
    opacity: 0.9;
}

.pace-tooltip.tooltip-from-map {
    opacity: 0.8;
    border-style: dashed;
}

.tooltip-actual-pace {
    color: var(--main-color);
    font-size: 0.7rem;
    font-weight: 600;
}

.tooltip-target-pace {
    color: var(--sub-color);
    font-size: 0.7rem;
}

.no-elevation-warning {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.875rem;
    padding: 1rem;
    border: 1px solid;
    border-radius: 0.5rem;
    gap: 0.5rem;
    color: var(--sub-color);
    background-color: var(--bg-color);
    border-color: var(--sub-color);
    opacity: 0.7;
}

.creation-mode {
    border: 2px dashed var(--main-color);
    border-radius: 8px;
}

.creation-mode-indicator {
    position: absolute;
    top: 8px;
    left: 8px;
    background: var(--main-color);
    color: var(--bg-color);
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 0.75rem;
    display: flex;
    align-items: center;
    gap: 4px;
    z-index: 20;
    animation: pulse 2s infinite;
}

@keyframes pulse {
    0%,
    100% {
        opacity: 1;
    }
    50% {
        opacity: 0.7;
    }
}
</style>
