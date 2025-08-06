<script setup lang="ts">
import * as d3 from "d3";
import {
    actualPaceFromGradeAdjusted,
    calculateActualPacesForTarget,
} from "~/utils/paceAdjustment";
import {
    extractElevationProfile,
    interpolateAtDistance,
    type ElevationPoint,
    calculateGradeAtDistance,
} from "~/utils/elevationProfile";
import { formatDistance } from "~/utils/courseMetrics";
import { useUserSettingsStore } from "~/stores/userSettings";
import type { SelectPlan } from "~/utils/db/schema";

interface Props {
    geoJsonData: GeoJSON.FeatureCollection[];
    height?: number;
    mapHoverDistance?: number | null;
    selectedWaypointDistance?: number | null;
    plan: SelectPlan | null;
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
});

const emit = defineEmits<{
    "pace-hover": [event: PaceHoverEvent];
    "pace-leave": [];
}>();

const userSettingsStore = useUserSettingsStore();
const chartContainer = ref<HTMLElement>();
const tooltip = ref<HTMLElement>();

// Tooltip state
const tooltipVisible = ref(false);
const tooltipFromMap = ref(false);
const tooltipData = ref({
    distance: "",
    actualPace: "",
    targetPace: "",
    grade: "",
});

// Chart state
let svg: d3.Selection<SVGSVGElement, unknown, null, undefined> | null = null;
let xScale: d3.ScaleLinear<number, number> | null = null;
let yScale: d3.ScaleLinear<number, number> | null = null;
const elevationPoints = ref<ElevationPoint[]>([]);
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

// Computed properties
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
    if (elevationPoints.value.length === 0) return 0;
    return Math.max(...elevationPoints.value.map((p) => p.distance));
});

// Calculate actual paces needed at each point to achieve target average pace
const actualPaceData = computed(() => {
    if (!props.plan || !props.plan.pace || elevationPoints.value.length === 0) {
        return [];
    }

    return calculateActualPacesForTarget(
        elevationPoints.value,
        props.plan.pace,
        200, // Use 200m window for smoother pace calculations
    );
});

// Get min/max actual paces for scale
const paceRange = computed(() => {
    if (actualPaceData.value.length === 0) {
        return { min: 0, max: 0 };
    }

    const paces = actualPaceData.value.map((p) => p.actualPace);
    const min = Math.min(...paces);
    const max = Math.max(...paces);

    return { min, max };
});

// Convert pace from seconds per km/mile to a display format
function formatPace(paceInSeconds: number, paceUnit: string): string {
    const minutes = Math.floor(paceInSeconds / 60);
    const seconds = Math.round(paceInSeconds % 60);
    const unit = paceUnit === "min_per_km" ? "/km" : "/mi";
    return `${minutes}:${seconds.toString().padStart(2, "0")}${unit}`;
}

// Process GeoJSON data to extract elevation profile for distance calculation
function processGeoJsonData() {
    if (!props.geoJsonData || props.geoJsonData.length === 0) {
        elevationPoints.value = [];
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

    elevationPoints.value = extractElevationProfile(combinedGeoJson);
}

// Initialize the D3 chart
function initChart() {
    if (
        !chartContainer.value ||
        !props.plan ||
        !props.plan.pace ||
        props.plan.pace <= 0 ||
        elevationPoints.value.length === 0
    )
        return;

    // Clear any existing chart
    d3.select(chartContainer.value).selectAll("*").remove();

    const container = chartContainer.value;
    const containerRect = container.getBoundingClientRect();
    const width = containerRect.width;
    const height = props.height;

    const margin = { top: 20, right: 30, bottom: 40, left: 60 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

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
    xScale = d3
        .scaleLinear()
        .domain([0, totalDistance.value])
        .range([0, innerWidth]);

    // For pace chart, we want to show the range of actual paces needed
    const { min: minPace, max: maxPace } = paceRange.value;
    const paceBuffer = Math.max((maxPace - minPace) * 0.1, minPace * 0.05); // Dynamic buffer
    yScale = d3
        .scaleLinear()
        .domain([minPace - paceBuffer, maxPace + paceBuffer])
        .range([innerHeight, 0]);

    // Create axes
    const xAxis = d3.axisBottom(xScale).tickFormat((d) => {
        const distance = d as number;
        return formatDistance(
            distance,
            userSettingsStore.settings.units.distance,
        );
    });

    const yAxis = d3.axisLeft(yScale).tickFormat((d) => {
        const pace = d as number;
        return formatPace(pace, props.plan!.paceUnit);
    });

    g.append("g")
        .attr("transform", `translate(0,${innerHeight})`)
        .call(xAxis)
        .style("color", "var(--main-color)");

    g.append("g").call(yAxis).style("color", "var(--main-color)");

    // Add axis labels
    g.append("text")
        .attr("transform", "rotate(-90)")
        .attr("y", 0 - margin.left)
        .attr("x", 0 - innerHeight / 2)
        .attr("dy", "1em")
        .style("text-anchor", "middle")
        .style("fill", "var(--main-color)")
        .style("font-size", "12px")
        .text("Pace");

    g.append("text")
        .attr(
            "transform",
            `translate(${innerWidth / 2}, ${innerHeight + margin.bottom})`,
        )
        .style("text-anchor", "middle")
        .style("fill", "var(--main-color)")
        .style("font-size", "12px")
        .text("Distance");

    // Create pace line showing actual paces needed at each point
    const paceLine = d3
        .line<{ distance: number; actualPace: number }>()
        .x((d) => xScale!(d.distance))
        .y((d) => yScale!(d.actualPace))
        .curve(d3.curveCardinal);

    // Use the calculated actual pace data
    const paceData = actualPaceData.value;

    if (paceData.length > 0) {
        // Add the pace line
        g.append("path")
            .datum(paceData)
            .attr("fill", "none")
            .attr("stroke", "var(--main-color)")
            .attr("stroke-width", 2)
            .attr("d", paceLine);
    }

    // Add interactive overlay
    const _overlay = g
        .append("rect")
        .attr("class", "overlay")
        .attr("width", innerWidth)
        .attr("height", innerHeight)
        .style("fill", "none")
        .style("pointer-events", "all")
        .style("cursor", "default")
        .on("mousemove", handleMouseMove)
        .on("mouseleave", handleMouseLeave);

    // Add crosshair lines
    crosshair = g
        .append("line")
        .attr("class", "crosshair")
        .style("stroke", "var(--main-color)")
        .style("stroke-width", 1)
        .style("stroke-dasharray", "3,3")
        .style("opacity", 0)
        .attr("y1", 0)
        .attr("y2", innerHeight)
        .style("pointer-events", "none");

    // Add map hover crosshair line (initially hidden)
    mapHoverCrosshair = g
        .append("line")
        .attr("class", "map-hover-crosshair")
        .style("stroke", "var(--main-color)")
        .style("stroke-width", 1)
        .style("stroke-dasharray", "5,5")
        .style("opacity", 0)
        .attr("y1", 0)
        .attr("y2", innerHeight)
        .style("pointer-events", "none");

    waypointCrosshair = g
        .append("line")
        .attr("class", "waypoint-crosshair")
        .style("stroke", "var(--accent-color)")
        .style("stroke-width", 3)
        .style("opacity", 0)
        .attr("y1", 0)
        .attr("y2", innerHeight)
        .style("pointer-events", "none");
}

// Handle mouse move on chart
function handleMouseMove(event: MouseEvent) {
    if (!xScale || !crosshair || !tooltip.value) return;

    const [mouseX] = d3.pointer(event);
    const distance = xScale.invert(mouseX);

    // Show crosshair
    crosshair.attr("x1", mouseX).attr("x2", mouseX).style("opacity", 1);

    // Interpolate elevation and coordinates at this distance
    const interpolatedPoint = interpolateAtDistance(
        elevationPoints.value,
        distance,
    );
    if (!interpolatedPoint) return;

    // Calculate actual pace needed at this distance
    const grade = calculateGradeAtDistance(
        elevationPoints.value,
        distance,
        200,
    );
    const actualPace = actualPaceFromGradeAdjusted(props.plan!.pace!, grade);

    // Update tooltip data
    tooltipData.value = {
        distance: formatDistance(
            distance,
            userSettingsStore.settings.units.distance,
        ),
        actualPace: formatPace(actualPace, props.plan!.paceUnit),
        targetPace: formatPace(props.plan!.pace!, props.plan!.paceUnit),
        grade: `${grade >= 0 ? "+" : ""}${grade.toFixed(1)}%`,
    };

    // Position tooltip
    const containerRect = chartContainer.value!.getBoundingClientRect();
    const tooltipEl = tooltip.value;
    const tooltipRect = tooltipEl.getBoundingClientRect();

    let chartX = mouseX + 60; // margin.left
    let chartY = 20 - tooltipRect.height - 10; // margin.top - tooltip height - offset

    // Keep tooltip within horizontal bounds
    if (chartX + tooltipRect.width > containerRect.width) {
        chartX = containerRect.width - tooltipRect.width - 10;
    }
    if (chartX < 0) {
        chartX = 10;
    }

    // Keep tooltip within vertical bounds
    if (chartY < 0) {
        chartY = 60; // Below the chart margin.top
    }

    tooltipEl.style.left = `${chartX}px`;
    tooltipEl.style.top = `${chartY}px`;

    // Show tooltip
    tooltipVisible.value = true;
    tooltipFromMap.value = false; // This is from chart hover

    emit("pace-hover", {
        lat: interpolatedPoint.lat,
        lng: interpolatedPoint.lng,
        distance,
        elevation: interpolatedPoint.elevation,
        grade: 0, // Pace chart doesn't show grade
    });
}

function handleMouseLeave() {
    if (!crosshair) return;

    // Hide chart crosshair
    crosshair.style("opacity", 0);

    // Only hide tooltip if map crosshair is also not visible
    if (!mapHoverCrosshair || mapHoverCrosshair.style("opacity") === "0") {
        tooltipVisible.value = false;
        tooltipFromMap.value = false;
    } else {
        // Map crosshair is still visible, so keep tooltip but mark as from map
        tooltipFromMap.value = true;
    }

    emit("pace-leave");
}

// Update map hover crosshair position
function updateMapHoverCrosshair() {
    if (!mapHoverCrosshair || !xScale || !tooltip.value) return;

    if (
        props.mapHoverDistance !== null &&
        props.mapHoverDistance !== undefined &&
        props.mapHoverDistance >= 0 &&
        props.mapHoverDistance <= totalDistance.value
    ) {
        const x = xScale(props.mapHoverDistance);
        mapHoverCrosshair.attr("x1", x).attr("x2", x).style("opacity", 0.7); // Slightly less opacity to distinguish from chart hover

        // Show tooltip for map hover as well
        const interpolatedPoint = interpolateAtDistance(
            elevationPoints.value,
            props.mapHoverDistance,
        );
        if (interpolatedPoint) {
            // Calculate actual pace needed at this distance
            const grade = calculateGradeAtDistance(
                elevationPoints.value,
                props.mapHoverDistance,
                200,
            );
            const actualPace = actualPaceFromGradeAdjusted(
                props.plan!.pace!,
                grade,
            );

            tooltipData.value = {
                distance: formatDistance(
                    props.mapHoverDistance,
                    userSettingsStore.settings.units.distance,
                ),
                actualPace: formatPace(actualPace, props.plan!.paceUnit),
                targetPace: formatPace(props.plan!.pace!, props.plan!.paceUnit),
                grade: `${grade >= 0 ? "+" : ""}${grade.toFixed(1)}%`,
            };

            // Position tooltip at the map hover crosshair
            const containerRect = chartContainer.value!.getBoundingClientRect();
            const tooltipEl = tooltip.value;
            const tooltipRect = tooltipEl.getBoundingClientRect();

            let chartX = x + 60; // x position + margin.left
            let chartY = 20 - tooltipRect.height - 10; // margin.top - tooltip height - offset

            // Keep tooltip within horizontal bounds
            if (chartX + tooltipRect.width > containerRect.width) {
                chartX = containerRect.width - tooltipRect.width - 10;
            }
            if (chartX < 0) {
                chartX = 10;
            }

            // Keep tooltip within vertical bounds
            if (chartY < 0) {
                chartY = 60; // Below the chart margin.top
            }

            tooltipEl.style.left = `${chartX}px`;
            tooltipEl.style.top = `${chartY}px`;

            // Show tooltip with slightly less opacity to distinguish from chart hover
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

// Watch for map hover distance changes
watch(
    () => props.mapHoverDistance,
    () => {
        updateMapHoverCrosshair();
    },
);

// Update chart when selected waypoint distance changes
watch(
    () => props.selectedWaypointDistance,
    (newDistance) => {
        if (!svg || !xScale || !waypointCrosshair) return;

        if (
            newDistance !== null &&
            newDistance >= 0 &&
            newDistance <= totalDistance.value
        ) {
            const x = xScale(newDistance);
            waypointCrosshair.attr("x1", x).attr("x2", x).style("opacity", 1);
        } else {
            waypointCrosshair.style("opacity", 0);
        }
    },
);

// Initialize chart when component mounts or data changes
onMounted(() => {
    processGeoJsonData();
    nextTick(() => {
        initChart();
    });
});

// Watch for changes in props that require chart reinitialization
watch(
    [() => props.geoJsonData, () => props.plan],
    () => {
        processGeoJsonData();
        nextTick(() => {
            initChart();
        });
    },
    { deep: true },
);

// Watch for elevation points to be processed
watch(
    () => elevationPoints.value.length,
    (newLength) => {
        if (
            newLength > 0 &&
            props.plan &&
            props.plan.pace &&
            props.plan.pace > 0
        ) {
            nextTick(() => {
                initChart();
            });
        }
    },
);

// Handle window resize
function handleResize() {
    nextTick(() => {
        initChart();
    });
}

onMounted(() => {
    window.addEventListener("resize", handleResize);
});

onUnmounted(() => {
    window.removeEventListener("resize", handleResize);
});
</script>

<template>
    <div class="pace-chart-container">
        <div v-if="!hasPaceData" class="no-pace-data">
            <div class="text-center text-(--sub-color)">
                <Icon name="mdi:speedometer" class="text-2xl mb-2" />
                <p>No target average pace set</p>
                <p class="text-sm">
                    Set a target average pace for this plan to see the
                    grade-adjusted actual pace at each point along the course
                </p>
            </div>
        </div>
        <div v-else ref="chartContainer" class="pace-chart" />
        <div
            ref="tooltip"
            class="pace-tooltip"
            :class="{
                'tooltip-visible': tooltipVisible,
                'tooltip-from-map': tooltipFromMap,
            }"
        >
            <div class="tooltip-distance">{{ tooltipData.distance }}</div>
            <div class="tooltip-actual-pace">{{ tooltipData.actualPace }}</div>
            <div class="tooltip-target-pace">
                {{ tooltipData.targetPace }} avg
            </div>
            <div class="tooltip-grade">{{ tooltipData.grade }}</div>
        </div>
    </div>
</template>

<style scoped>
.pace-chart-container {
    width: 100%;
    position: relative;
}

.no-pace-data {
    width: 100%;
    height: 200px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-color);
    border: 1px dashed var(--sub-color);
    border-radius: 8px;
}

.pace-chart {
    width: 100%;
    min-height: 200px;
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

.tooltip-distance {
    font-weight: 600;
    color: var(--main-color);
    margin-bottom: 2px;
}

.tooltip-actual-pace {
    color: var(--main-color);
    font-size: 0.7rem;
    font-weight: 500;
}

.tooltip-target-pace {
    color: var(--sub-color);
    font-size: 0.65rem;
    font-style: italic;
}

.tooltip-grade {
    color: var(--main-color);
    font-size: 0.65rem;
    font-weight: 500;
}
</style>
