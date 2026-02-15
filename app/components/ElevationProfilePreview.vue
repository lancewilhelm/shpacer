<script setup lang="ts">
import {
  extractElevationProfile,
  getElevationStats,
  hasElevationSamples,
  type ElevationPoint,
} from "~/utils/elevationProfile";

interface Props {
  geoJson: GeoJSON.FeatureCollection;
  height?: number;
  maxPoints?: number;
}

const props = withDefaults(defineProps<Props>(), {
  height: 132,
  maxPoints: 600,
});

function downsampleElevationPoints(
  points: ElevationPoint[],
  maxPoints: number,
): ElevationPoint[] {
  if (points.length <= maxPoints) {
    return points;
  }

  const output: ElevationPoint[] = [];
  const stride = Math.ceil((points.length - 1) / (maxPoints - 1));

  for (let index = 0; index < points.length; index += stride) {
    const point = points[index];
    if (point) {
      output.push(point);
    }
  }

  const last = points[points.length - 1];
  if (last && output[output.length - 1]?.distance !== last.distance) {
    output.push(last);
  }

  return output;
}

const hasFileElevationData = computed(() => {
  return hasElevationSamples(props.geoJson);
});

const elevationPoints = computed(() => {
  if (!hasFileElevationData.value) {
    return [];
  }

  return extractElevationProfile(props.geoJson);
});

const sampledPoints = computed(() =>
  downsampleElevationPoints(elevationPoints.value, props.maxPoints),
);

const chartHeight = computed(() => Math.max(80, props.height));
const chartWidth = 1000;
const padding = { top: 8, right: 8, bottom: 10, left: 8 };

const yStats = computed(() => getElevationStats(sampledPoints.value));
const totalDistance = computed(() => {
  const lastPoint = sampledPoints.value[sampledPoints.value.length - 1];
  return lastPoint?.distance ?? 0;
});

const chartLinePath = computed(() => {
  if (sampledPoints.value.length < 2 || totalDistance.value <= 0) {
    return "";
  }

  const innerWidth = chartWidth - padding.left - padding.right;
  const innerHeight = chartHeight.value - padding.top - padding.bottom;
  const range = Math.max(
    yStats.value.maxElevation - yStats.value.minElevation,
    1,
  );

  return sampledPoints.value
    .map((point, index) => {
      const x =
        padding.left + (point.distance / totalDistance.value) * innerWidth;
      const y =
        padding.top +
        ((yStats.value.maxElevation - point.elevation) / range) * innerHeight;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
});

const chartAreaPath = computed(() => {
  if (!chartLinePath.value || sampledPoints.value.length < 2) {
    return "";
  }

  const innerWidth = chartWidth - padding.left - padding.right;
  const baselineY = chartHeight.value - padding.bottom;
  const first = sampledPoints.value[0];
  const last = sampledPoints.value[sampledPoints.value.length - 1];

  if (!first || !last || totalDistance.value <= 0) {
    return "";
  }

  const firstX = padding.left;
  const lastX =
    padding.left + (last.distance / totalDistance.value) * innerWidth;

  return `${chartLinePath.value} L ${lastX.toFixed(2)} ${baselineY.toFixed(2)} L ${firstX.toFixed(2)} ${baselineY.toFixed(2)} Z`;
});

const hasRenderableProfile = computed(() => Boolean(chartLinePath.value));
</script>

<template>
  <div
    v-if="hasFileElevationData && hasRenderableProfile"
    class="mt-4 border border-(--sub-color) rounded-lg p-3 bg-(--bg-color)"
  >
    <div class="text-sm font-medium text-(--sub-color) mb-2">
      Elevation Profile
    </div>

    <svg
      class="w-full block"
      :viewBox="`0 0 ${chartWidth} ${chartHeight}`"
      role="img"
      aria-label="Elevation profile"
      preserveAspectRatio="none"
      :style="{ height: `${chartHeight}px` }"
    >
      <path
        :d="chartAreaPath"
        :style="{ fill: 'var(--main-color)', opacity: '0.12' }"
      />
      <path
        :d="chartLinePath"
        fill="none"
        :style="{ stroke: 'var(--main-color)', strokeWidth: '2' }"
      />
    </svg>
  </div>
</template>
