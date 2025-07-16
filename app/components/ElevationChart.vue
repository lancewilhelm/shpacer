<template>
  <div class="elevation-chart-container">
    <div ref="chartContainer" class="elevation-chart" />
    <div v-if="!hasElevationData" class="no-elevation-warning">
      <Icon name="heroicons:exclamation-triangle" class="h-4 w-4" />
      <span>No elevation data available for this course</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import * as d3 from 'd3';
import { extractElevationProfile, interpolateAtDistance, getElevationStats, type ElevationPoint } from '~/utils/elevationProfile';
import { formatDistance, formatElevation } from '~/utils/courseMetrics';
import { useUserSettingsStore } from '~/stores/userSettings';

interface Props {
  geoJsonData: GeoJSON.FeatureCollection[];
  height?: number;
}

interface ElevationHoverEvent {
  lat: number;
  lng: number;
  distance: number;
  elevation: number;
}

const props = withDefaults(defineProps<Props>(), {
  height: 200,
});

const emit = defineEmits<{
  'elevation-hover': [event: ElevationHoverEvent];
  'elevation-leave': [];
}>();

const userSettingsStore = useUserSettingsStore();
const chartContainer = ref<HTMLElement>();

// Chart state
let svg: d3.Selection<SVGSVGElement, unknown, null, undefined> | null = null;
let xScale: d3.ScaleLinear<number, number> | null = null;
let yScale: d3.ScaleLinear<number, number> | null = null;
let elevationPoints: ElevationPoint[] = [];
let crosshair: d3.Selection<SVGLineElement, unknown, null, undefined> | null = null;

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

  elevationPoints = extractElevationProfile(combinedGeoJson);
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
  if (!xScale || !crosshair) return;

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
    emit('elevation-hover', {
      lat: interpolatedPoint.lat,
      lng: interpolatedPoint.lng,
      distance: interpolatedPoint.distance,
      elevation: interpolatedPoint.elevation
    });
  }
}

// Handle mouse leaving the chart
function handleMouseLeave() {
  if (!crosshair) return;

  // Hide crosshair
  crosshair.style('opacity', 0);

  emit('elevation-leave');
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
