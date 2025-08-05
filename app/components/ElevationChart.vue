<script setup lang="ts">
import * as d3 from "d3";
import {
    extractElevationProfile,
    interpolateAtDistance,
    getElevationStats,
    calculateGradeAtDistance,
    type ElevationPoint,
} from "~/utils/elevationProfile";
import { formatDistance, formatElevation } from "~/utils/courseMetrics";
import { useUserSettingsStore } from "~/stores/userSettings";
import { getWaypointColorFromOrder } from "~/utils/waypoints";

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
}

interface ElevationHoverEvent {
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
});

const emit = defineEmits<{
    "elevation-hover": [event: ElevationHoverEvent];
    "elevation-leave": [];
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
const tooltip = ref<HTMLElement>();

// Tooltip state
const tooltipVisible = ref(false);
const tooltipFromMap = ref(false); // Track if tooltip is from map hover
const tooltipData = ref({
    distance: "",
    elevation: "",
    grade: "",
});

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

// Computed properties
const hasElevationData = computed(() => {
    return (
        elevationPoints.length > 0 &&
        elevationPoints.some((point) => point.elevation > 0)
    );
});

const elevationStats = computed(() => {
    return getElevationStats(elevationPoints);
});

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
            elevationPoints,
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
                `${waypoint.name} - ${formatDistance(waypoint.distance, userSettingsStore.settings.units.distance)}`,
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
    const height = props.height;

    const margin = { top: 40, right: 30, bottom: 40, left: 60 }; // Increased top margin for waypoint circles
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
        .datum(elevationPoints)
        .attr("fill", "url(#elevation-gradient)")
        .attr("d", area);

    // Add elevation line
    g.append("path")
        .datum(elevationPoints)
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
                userSettingsStore.settings.units.distance,
            ),
        );

    const yAxis = d3
        .axisLeft(yScale)
        .ticks(6)
        .tickFormat((d) =>
            formatElevation(
                Number(d),
                userSettingsStore.settings.units.elevation,
            ),
        );

    g.append("g")
        .attr("transform", `translate(0,${innerHeight})`)
        .call(xAxis)
        .selectAll("text")
        .style("fill", "var(--sub-color)")
        .style("font-size", "12px");

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
        .text(`Elevation (${userSettingsStore.settings.units.elevation})`);

    g.append("text")
        .attr(
            "transform",
            `translate(${innerWidth / 2}, ${innerHeight + margin.bottom})`,
        )
        .style("text-anchor", "middle")
        .style("fill", "var(--sub-color)")
        .style("font-size", "12px")
        .text(`Distance (${userSettingsStore.settings.units.distance})`);
}

// Handle mouse movement over the chart
function handleMouseMove(event: MouseEvent) {
    if (!xScale || !crosshair || !tooltip.value) return;

    const [mouseX] = d3.pointer(event);
    const distance = xScale.invert(mouseX);

    // Show crosshair
    crosshair.attr("x1", mouseX).attr("x2", mouseX).style("opacity", 1);

    // Interpolate elevation and coordinates at this distance
    const interpolatedPoint = interpolateAtDistance(elevationPoints, distance);

    if (interpolatedPoint) {
        // Calculate grade at this distance
        const grade = calculateGradeAtDistance(
            elevationPoints,
            interpolatedPoint.distance,
        );
        const gradeFormatted =
            grade >= 0 ? `+${grade.toFixed(1)}%` : `${grade.toFixed(1)}%`;

        // Update tooltip data
        tooltipData.value = {
            distance: formatDistance(
                interpolatedPoint.distance,
                userSettingsStore.settings.units.distance,
            ),
            elevation: formatElevation(
                interpolatedPoint.elevation,
                userSettingsStore.settings.units.elevation,
            ),
            grade: gradeFormatted,
        };

        // Position tooltip
        const containerRect = chartContainer.value!.getBoundingClientRect();
        const tooltipEl = tooltip.value;
        const margin = { top: 20, right: 30, bottom: 40, left: 60 };

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

    // Only hide tooltip if map crosshair is also not visible
    if (!mapHoverCrosshair || mapHoverCrosshair.style("opacity") === "0") {
        tooltipVisible.value = false;
        tooltipFromMap.value = false;
    } else {
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
        mapHoverCrosshair.attr("x1", x).attr("x2", x).style("opacity", 0.7); // Slightly less opacity to distinguish from chart hover

        // Show tooltip for map hover as well
        const interpolatedPoint = interpolateAtDistance(
            elevationPoints,
            props.mapHoverDistance,
        );

        if (interpolatedPoint) {
            // Calculate grade at this distance
            const grade = calculateGradeAtDistance(
                elevationPoints,
                interpolatedPoint.distance,
            );
            const gradeFormatted =
                grade >= 0 ? `+${grade.toFixed(1)}%` : `${grade.toFixed(1)}%`;

            // Update tooltip data
            tooltipData.value = {
                distance: formatDistance(
                    interpolatedPoint.distance,
                    userSettingsStore.settings.units.distance,
                ),
                elevation: formatElevation(
                    interpolatedPoint.elevation,
                    userSettingsStore.settings.units.elevation,
                ),
                grade: gradeFormatted,
            };

            // Position tooltip at the map hover crosshair
            const containerRect = chartContainer.value!.getBoundingClientRect();
            const tooltipEl = tooltip.value;
            const margin = { top: 20, right: 30, bottom: 40, left: 60 };

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
            elevationPoints,
            props.selectedWaypointDistance,
        );

        if (interpolatedPoint) {
            // Calculate grade at this distance
            const grade = calculateGradeAtDistance(
                elevationPoints,
                interpolatedPoint.distance,
            );
            const gradeFormatted =
                grade >= 0 ? `+${grade.toFixed(1)}%` : `${grade.toFixed(1)}%`;

            // Update tooltip data
            tooltipData.value = {
                distance: formatDistance(
                    interpolatedPoint.distance,
                    userSettingsStore.settings.units.distance,
                ),
                elevation: formatElevation(
                    interpolatedPoint.elevation,
                    userSettingsStore.settings.units.elevation,
                ),
                grade: gradeFormatted,
            };

            // Position tooltip at the waypoint crosshair
            const containerRect = chartContainer.value!.getBoundingClientRect();
            const tooltipEl = tooltip.value;
            const margin = { top: 20, right: 30, bottom: 40, left: 60 };

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

            // Show tooltip for waypoint
            tooltipVisible.value = true;
            tooltipFromMap.value = false; // This is from waypoint selection
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
    },
    { immediate: true, deep: true },
);

// Watch for settings changes (units)
watch(
    () => userSettingsStore.settings.units,
    () => {
        if (hasElevationData.value) {
            nextTick(() => {
                initChart();
            });
        }
    },
    { deep: true },
);

// Watch for map hover distance changes
watch(
    () => props.mapHoverDistance,
    () => {
        updateMapHoverCrosshair();
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

// Setup resize observer
onMounted(() => {
    if (chartContainer.value) {
        const resizeObserver = new ResizeObserver(() => {
            handleResize();
        });
        resizeObserver.observe(chartContainer.value);

        onUnmounted(() => {
            resizeObserver.disconnect();
        });
    }
});
</script>

<template>
    <div class="elevation-chart-container">
        <div
            ref="chartContainer"
            class="elevation-chart"
            :class="{ 'creation-mode': creationMode }"
        />

        <!-- Creation mode indicator -->
        <div v-if="creationMode" class="creation-mode-indicator">
            <Icon name="heroicons:plus-circle" class="h-4 w-4" />
            <span>Click on the elevation profile to add a waypoint</span>
        </div>

        <!-- Custom tooltip -->
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
        </div>

        <div v-if="!hasElevationData" class="no-elevation-warning">
            <Icon name="heroicons:exclamation-triangle" class="h-4 w-4" />
            <span>No elevation data available for this course</span>
        </div>
    </div>
</template>

<style scoped>
.elevation-chart-container {
    width: 100%;
    position: relative;
}

.elevation-chart {
    width: 100%;
    min-height: 200px;
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
    color: var(--main-color);
    font-size: 0.7rem;
    font-weight: 500;
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
