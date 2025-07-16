<template>
  <div class="elevation-chart-container">
    <div ref="chartContainer" class="elevation-chart" />
    
    <!-- Custom tooltip -->
    <div 
      ref="tooltip" 
      class="elevation-tooltip"
      :class="{ 
        'tooltip-visible': tooltipVisible,
        'tooltip-from-map': tooltipFromMap 
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

<script setup lang="ts">
import * as d3 from 'd3';
import { extractElevationProfile, interpolateAtDistance, getElevationStats, calculateGradeAtDistance, type ElevationPoint } from '~/utils/elevationProfile';
import { formatDistance, formatElevation } from '~/utils/courseMetrics';
import { useUserSettingsStore } from '~/stores/userSettings';
import { getWaypointColor } from '~/utils/waypoints';

interface Props {
  geoJsonData: GeoJSON.FeatureCollection[];
  height?: number;
  mapHoverDistance?: number | null;
  selectedWaypointDistance?: number | null;
  waypoints?: Array<{
    id: string;
    name: string;
    distance: number;
    type: 'start' | 'finish' | 'waypoint' | 'poi';
  }>;
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
});

const emit = defineEmits<{
  'elevation-hover': [event: ElevationHoverEvent];
  'elevation-leave': [];
  'waypoint-click': [waypoint: { id: string; name: string; distance: number; type: 'start' | 'finish' | 'waypoint' | 'poi' }];
}>();

const userSettingsStore = useUserSettingsStore();
const chartContainer = ref<HTMLElement>();
const tooltip = ref<HTMLElement>();

// Tooltip state
const tooltipVisible = ref(false);
const tooltipFromMap = ref(false); // Track if tooltip is from map hover
const tooltipData = ref({
  distance: '',
  elevation: '',
  grade: ''
});

// Chart state
let svg: d3.Selection<SVGSVGElement, unknown, null, undefined> | null = null;
let xScale: d3.ScaleLinear<number, number> | null = null;
let yScale: d3.ScaleLinear<number, number> | null = null;
let elevationPoints: ElevationPoint[] = [];
let crosshair: d3.Selection<SVGLineElement, unknown, null, undefined> | null = null;
let mapHoverCrosshair: d3.Selection<SVGLineElement, unknown, null, undefined> | null = null;
let waypointCrosshair: d3.Selection<SVGLineElement, unknown, null, undefined> | null = null;

// Computed properties
const hasElevationData = computed(() => {
  return elevationPoints.length > 0 && elevationPoints.some(point => point.elevation > 0);
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
    type: 'FeatureCollection',
    features: combinedFeatures
  };

  elevationPoints = extractElevationProfile(combinedGeoJson); // Use all points for maximum accuracy
}

// Function to create SVG pin path based on map pin design
function createPinPath(size: number = 20): string {
  // Scale the path to fit our size
  const scale = size / 24; // Original viewBox is 24x24
  
  // Create the map pin shape without the inner circle
  // Based on: M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0
  const path = `M${20 * scale} ${10 * scale}c0 ${4.993 * scale}-${5.539 * scale} ${10.193 * scale}-${7.399 * scale} ${11.799 * scale}a${1 * scale} ${1 * scale} 0 0 1-${1.202 * scale} 0C${9.539 * scale} ${20.193 * scale} ${4 * scale} ${14.993 * scale} ${4 * scale} ${10 * scale}a${8 * scale} ${8 * scale} 0 0 1 ${16 * scale} 0`;
  
  return path;
}

// Add waypoint pins to the elevation chart
function addWaypointPins() {
  if (!svg || !xScale || !yScale || !props.waypoints) return;

  // Remove existing waypoint pins
  svg.selectAll('.waypoint-pin').remove();

  // Create waypoint pins
  const waypointGroup = svg.select('g').append('g').attr('class', 'waypoint-pins');

  props.waypoints.forEach((waypoint) => {
    // Find elevation at this distance
    const interpolatedPoint = interpolateAtDistance(elevationPoints, waypoint.distance);
    if (!interpolatedPoint) return;

    const x = xScale!(waypoint.distance);
    const y = yScale!(interpolatedPoint.elevation);
    const color = getWaypointColor(waypoint.type);
    const isSelected = props.selectedWaypointDistance === waypoint.distance;
    const pinSize = isSelected ? 24 : 20;

    // Create a group for each waypoint pin
    const pinGroup = waypointGroup
      .append('g')
      .attr('class', 'waypoint-pin')
      .attr('data-waypoint-id', waypoint.id)
      .attr('transform', `translate(${x - pinSize/2}, ${y - pinSize * 0.95})`) // Position pin so bottom point touches the line
      .style('cursor', 'pointer');

    // Add the pin shape
    pinGroup
      .append('path')
      .attr('d', createPinPath(pinSize))
      .style('fill', color)
      .style('stroke', '#ffffff')
      .style('stroke-width', isSelected ? 2 : 1)
      .style('opacity', 0.9)
      .style('filter', 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))');

    // Add click handler with proper event binding
    pinGroup
      .on('click', (event) => {
        event.stopPropagation();
        emit('waypoint-click', waypoint);
      })
      .on('mouseenter', function() {
        d3.select(this).style('cursor', 'pointer');
      })
      .on('mouseleave', function() {
        d3.select(this).style('cursor', 'pointer');
      });

    // Add hover tooltip
    pinGroup
      .append('title')
      .text(`${waypoint.name} - ${formatDistance(waypoint.distance, userSettingsStore.settings.units.distance)}`);
  });
}

// Initialize the D3 chart
function initChart() {
  if (!chartContainer.value || elevationPoints.length === 0) return;

  // Clear any existing chart
  d3.select(chartContainer.value).selectAll('*').remove();

  const container = chartContainer.value;
  const containerRect = container.getBoundingClientRect();
  const width = containerRect.width;
  const height = props.height;

  const margin = { top: 20, right: 30, bottom: 40, left: 60 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  // Create SVG
  svg = d3.select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .style('background', 'var(--bg-color)');

  const g = svg.append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  // Set up scales
  const stats = elevationStats.value;
  xScale = d3.scaleLinear()
    .domain([0, stats.totalDistance])
    .range([0, innerWidth]);

  yScale = d3.scaleLinear()
    .domain([stats.minElevation * 0.95, stats.maxElevation * 1.05])
    .range([innerHeight, 0]);

  // Create line generator
  const line = d3.line<ElevationPoint>()
    .x(d => xScale!(d.distance))
    .y(d => yScale!(d.elevation))
    .curve(d3.curveCardinal);

  // Add gradient definition
  const defs = svg.append('defs');
  const gradient = defs.append('linearGradient')
    .attr('id', 'elevation-gradient')
    .attr('gradientUnits', 'userSpaceOnUse')
    .attr('x1', 0).attr('y1', yScale(stats.maxElevation))
    .attr('x2', 0).attr('y2', yScale(stats.minElevation));

  gradient.append('stop')
    .attr('offset', '0%')
    .attr('stop-color', 'var(--main-color)')
    .attr('stop-opacity', 0.3);

  gradient.append('stop')
    .attr('offset', '100%')
    .attr('stop-color', 'var(--main-color)')
    .attr('stop-opacity', 0.05);

  // Add area under curve
  const area = d3.area<ElevationPoint>()
    .x(d => xScale!(d.distance))
    .y0(innerHeight)
    .y1(d => yScale!(d.elevation))
    .curve(d3.curveCardinal);

  g.append('path')
    .datum(elevationPoints)
    .attr('fill', 'url(#elevation-gradient)')
    .attr('d', area);

  // Add elevation line
  g.append('path')
    .datum(elevationPoints)
    .attr('fill', 'none')
    .attr('stroke', 'var(--main-color)')
    .attr('stroke-width', 2)
    .attr('d', line);

  // Add axes
  const xAxis = d3.axisBottom(xScale)
    .tickFormat(d => formatDistance(Number(d), userSettingsStore.settings.units.distance));

  const yAxis = d3.axisLeft(yScale)
    .tickFormat(d => formatElevation(Number(d), userSettingsStore.settings.units.elevation));

  g.append('g')
    .attr('transform', `translate(0,${innerHeight})`)
    .call(xAxis)
    .selectAll('text')
    .style('fill', 'var(--sub-color)')
    .style('font-size', '12px');

  g.append('g')
    .call(yAxis)
    .selectAll('text')
    .style('fill', 'var(--sub-color)')
    .style('font-size', '12px');

  // Style axis lines and ticks
  g.selectAll('.domain, .tick line')
    .style('stroke', 'var(--sub-color)')
    .style('opacity', 0.3);

  // Add grid lines
  g.selectAll('.grid-line-x')
    .data(xScale.ticks())
    .enter()
    .append('line')
    .attr('class', 'grid-line-x')
    .attr('x1', d => xScale!(d))
    .attr('x2', d => xScale!(d))
    .attr('y1', 0)
    .attr('y2', innerHeight)
    .style('stroke', 'var(--sub-color)')
    .style('stroke-width', 0.5)
    .style('opacity', 0.1);

  g.selectAll('.grid-line-y')
    .data(yScale.ticks())
    .enter()
    .append('line')
    .attr('class', 'grid-line-y')
    .attr('x1', 0)
    .attr('x2', innerWidth)
    .attr('y1', d => yScale!(d))
    .attr('y2', d => yScale!(d))
    .style('stroke', 'var(--sub-color)')
    .style('stroke-width', 0.5)
    .style('opacity', 0.1);

  // Add crosshair line (initially hidden)
  crosshair = g.append('line')
    .attr('class', 'crosshair')
    .attr('x1', 0)
    .attr('x2', 0)
    .attr('y1', 0)
    .attr('y2', innerHeight)
    .style('stroke', 'var(--main-color)')
    .style('stroke-width', 1)
    .style('opacity', 0)
    .style('pointer-events', 'none');

  // Add map hover crosshair line (initially hidden)
  mapHoverCrosshair = g.append('line')
    .attr('class', 'map-hover-crosshair')
    .attr('x1', 0)
    .attr('x2', 0)
    .attr('y1', 0)
    .attr('y2', innerHeight)
    .style('stroke', 'var(--main-color)')
    .style('stroke-width', 1)
    .style('opacity', 0)
    .style('pointer-events', 'none');

  // Add waypoint crosshair line (initially hidden)
  waypointCrosshair = g.append('line')
    .attr('class', 'waypoint-crosshair')
    .attr('x1', 0)
    .attr('x2', 0)
    .attr('y1', 0)
    .attr('y2', innerHeight)
    .style('stroke', 'var(--accent-color)')
    .style('stroke-width', 2)
    .style('opacity', 0)
    .style('pointer-events', 'none');

  // Add waypoint pins
  nextTick(() => {
    addWaypointPins();
  });

  // Add invisible overlay for mouse interactions
  g.append('rect')
    .attr('class', 'overlay')
    .attr('width', innerWidth)
    .attr('height', innerHeight)
    .style('fill', 'none')
    .style('pointer-events', 'all')
    .on('mousemove', handleMouseMove)
    .on('mouseleave', handleMouseLeave);

  // Add axis labels
  g.append('text')
    .attr('transform', 'rotate(-90)')
    .attr('y', 0 - margin.left)
    .attr('x', 0 - (innerHeight / 2))
    .attr('dy', '1em')
    .style('text-anchor', 'middle')
    .style('fill', 'var(--sub-color)')
    .style('font-size', '12px')
    .text(`Elevation (${userSettingsStore.settings.units.elevation})`);

  g.append('text')
    .attr('transform', `translate(${innerWidth / 2}, ${innerHeight + margin.bottom})`)
    .style('text-anchor', 'middle')
    .style('fill', 'var(--sub-color)')
    .style('font-size', '12px')
    .text(`Distance (${userSettingsStore.settings.units.distance})`);
}

// Handle mouse movement over the chart
function handleMouseMove(event: MouseEvent) {
  if (!xScale || !crosshair || !tooltip.value) return;

  const [mouseX] = d3.pointer(event);
  const distance = xScale.invert(mouseX);

  // Show crosshair
  crosshair
    .attr('x1', mouseX)
    .attr('x2', mouseX)
    .style('opacity', 1);

  // Interpolate elevation and coordinates at this distance
  const interpolatedPoint = interpolateAtDistance(elevationPoints, distance);
  
  if (interpolatedPoint) {
    // Calculate grade at this distance
    const grade = calculateGradeAtDistance(elevationPoints, interpolatedPoint.distance);
    const gradeFormatted = grade >= 0 ? `+${grade.toFixed(1)}%` : `${grade.toFixed(1)}%`;
    
    // Update tooltip data
    tooltipData.value = {
      distance: formatDistance(interpolatedPoint.distance, userSettingsStore.settings.units.distance),
      elevation: formatElevation(interpolatedPoint.elevation, userSettingsStore.settings.units.elevation),
      grade: gradeFormatted
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
    const finalX = Math.min(chartX, containerRect.width - tooltipWidth - 10);
    
    tooltipEl.style.left = `${finalX}px`;
    tooltipEl.style.top = `${chartY}px`;
    
    // Show tooltip
    tooltipVisible.value = true;
    tooltipFromMap.value = false; // This is from chart hover

    emit('elevation-hover', {
      lat: interpolatedPoint.lat,
      lng: interpolatedPoint.lng,
      distance: interpolatedPoint.distance,
      elevation: interpolatedPoint.elevation,
      grade: grade
    });
  }
}

// Handle mouse leaving the chart
function handleMouseLeave() {
  if (!crosshair) return;

  // Hide chart crosshair
  crosshair.style('opacity', 0);
  
  // Only hide tooltip if map crosshair is also not visible
  if (!mapHoverCrosshair || mapHoverCrosshair.style('opacity') === '0') {
    tooltipVisible.value = false;
    tooltipFromMap.value = false;
  } else {
    // If map crosshair is still visible, mark tooltip as from map
    tooltipFromMap.value = true;
  }

  emit('elevation-leave');
}

// Update map hover crosshair position
function updateMapHoverCrosshair() {
  if (!mapHoverCrosshair || !xScale || !tooltip.value) return;

  if (props.mapHoverDistance !== null && props.mapHoverDistance !== undefined) {
    const x = xScale(props.mapHoverDistance);
    mapHoverCrosshair
      .attr('x1', x)
      .attr('x2', x)
      .style('opacity', 0.7); // Slightly less opacity to distinguish from chart hover

    // Show tooltip for map hover as well
    const interpolatedPoint = interpolateAtDistance(elevationPoints, props.mapHoverDistance);
    
    if (interpolatedPoint) {
      // Calculate grade at this distance
      const grade = calculateGradeAtDistance(elevationPoints, interpolatedPoint.distance);
      const gradeFormatted = grade >= 0 ? `+${grade.toFixed(1)}%` : `${grade.toFixed(1)}%`;
      
      // Update tooltip data
      tooltipData.value = {
        distance: formatDistance(interpolatedPoint.distance, userSettingsStore.settings.units.distance),
        elevation: formatElevation(interpolatedPoint.elevation, userSettingsStore.settings.units.elevation),
        grade: gradeFormatted
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
      const finalX = Math.min(chartX, containerRect.width - tooltipWidth - 10);
      
      tooltipEl.style.left = `${finalX}px`;
      tooltipEl.style.top = `${chartY}px`;
      
      // Show tooltip with slightly less opacity to distinguish from chart hover
      tooltipVisible.value = true;
      tooltipFromMap.value = true; // This is from map hover
    }
  } else {
    mapHoverCrosshair.style('opacity', 0);
    
    // Hide tooltip when not hovering over map
    // Only hide if we're not currently hovering over the chart itself
    if (!crosshair || crosshair.style('opacity') === '0') {
      tooltipVisible.value = false;
      tooltipFromMap.value = false;
    }
  }
}

// Update waypoint crosshair position
function updateWaypointCrosshair() {
  if (!waypointCrosshair || !xScale || !tooltip.value) return;

  if (props.selectedWaypointDistance !== null && props.selectedWaypointDistance !== undefined) {
    const x = xScale(props.selectedWaypointDistance);
    waypointCrosshair
      .attr('x1', x)
      .attr('x2', x)
      .style('opacity', 0.9); // High opacity for selected waypoint

    // Show tooltip for selected waypoint
    const interpolatedPoint = interpolateAtDistance(elevationPoints, props.selectedWaypointDistance);
    
    if (interpolatedPoint) {
      // Calculate grade at this distance
      const grade = calculateGradeAtDistance(elevationPoints, interpolatedPoint.distance);
      const gradeFormatted = grade >= 0 ? `+${grade.toFixed(1)}%` : `${grade.toFixed(1)}%`;
      
      // Update tooltip data
      tooltipData.value = {
        distance: formatDistance(interpolatedPoint.distance, userSettingsStore.settings.units.distance),
        elevation: formatElevation(interpolatedPoint.elevation, userSettingsStore.settings.units.elevation),
        grade: gradeFormatted
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
      const finalX = Math.min(chartX, containerRect.width - tooltipWidth - 10);
      
      tooltipEl.style.left = `${finalX}px`;
      tooltipEl.style.top = `${chartY}px`;
      
      // Show tooltip for waypoint
      tooltipVisible.value = true;
      tooltipFromMap.value = false; // This is from waypoint selection
    }
  } else {
    waypointCrosshair.style('opacity', 0);
  }
}

// Resize handler
function handleResize() {
  if (hasElevationData.value) {
    initChart();
  }
}

// Watch for data changes
watch(() => props.geoJsonData, () => {
  processGeoJsonData();
  if (hasElevationData.value) {
    nextTick(() => {
      initChart();
    });
  }
}, { immediate: true, deep: true });

// Watch for settings changes (units)
watch(() => userSettingsStore.settings.units, () => {
  if (hasElevationData.value) {
    nextTick(() => {
      initChart();
    });
  }
}, { deep: true });

// Watch for map hover distance changes
watch(() => props.mapHoverDistance, () => {
  updateMapHoverCrosshair();
});

// Watch for selected waypoint distance changes
watch(() => props.selectedWaypointDistance, () => {
  updateWaypointCrosshair();
});

// Watch for waypoints changes
watch(() => props.waypoints, () => {
  if (hasElevationData.value && svg) {
    nextTick(() => {
      addWaypointPins();
    });
  }
}, { deep: true, immediate: true });

// Watch for waypoints selection changes (to update pin appearance)
watch(() => props.selectedWaypointDistance, () => {
  if (hasElevationData.value && svg) {
    nextTick(() => {
      addWaypointPins();
    });
  }
});

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
  color: var(--accent-color);
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
</style>
