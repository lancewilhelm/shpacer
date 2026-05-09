export interface CourseAnalysisSettings {
  gradeWindowMeters: number;
  sampleStepMeters: number;
  paceSmoothingMeters: number;
  paceChartMaxDisplaySecondsPerMeter: number | null;
  annotationMinDistanceMeters?: number;
  annotationMinVerticalMeters?: number;
  annotationMinAverageGradePercent?: number;
  annotationFlatGradeThresholdPercent?: number;
  annotationReversalConfirmDistanceMeters?: number;
  annotationMaxCount?: number;
  [key: string]: unknown;
}

export const DEFAULT_COURSE_ANALYSIS_SETTINGS: CourseAnalysisSettings = {
  gradeWindowMeters: 100,
  sampleStepMeters: 50,
  paceSmoothingMeters: 300,
  paceChartMaxDisplaySecondsPerMeter: 1800 / 1609.344, // 30:00 /mi
};

function toFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function toNullableFiniteNumber(value: unknown): number | null | undefined {
  if (value === null) return null;
  return toFiniteNumber(value);
}

export function normalizeCourseAnalysisSettings(
  input?: Partial<CourseAnalysisSettings> | null,
): CourseAnalysisSettings {
  const source =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};

  return {
    ...source,
    gradeWindowMeters:
      toFiniteNumber(source.gradeWindowMeters) ??
      DEFAULT_COURSE_ANALYSIS_SETTINGS.gradeWindowMeters,
    sampleStepMeters:
      toFiniteNumber(source.sampleStepMeters) ??
      DEFAULT_COURSE_ANALYSIS_SETTINGS.sampleStepMeters,
    paceSmoothingMeters:
      toFiniteNumber(source.paceSmoothingMeters) ??
      DEFAULT_COURSE_ANALYSIS_SETTINGS.paceSmoothingMeters,
    paceChartMaxDisplaySecondsPerMeter:
      toNullableFiniteNumber(source.paceChartMaxDisplaySecondsPerMeter) ??
      DEFAULT_COURSE_ANALYSIS_SETTINGS.paceChartMaxDisplaySecondsPerMeter,
    annotationMinDistanceMeters: toFiniteNumber(
      source.annotationMinDistanceMeters,
    ),
    annotationMinVerticalMeters: toFiniteNumber(
      source.annotationMinVerticalMeters,
    ),
    annotationMinAverageGradePercent: toFiniteNumber(
      source.annotationMinAverageGradePercent,
    ),
    annotationFlatGradeThresholdPercent: toFiniteNumber(
      source.annotationFlatGradeThresholdPercent,
    ),
    annotationReversalConfirmDistanceMeters: toFiniteNumber(
      source.annotationReversalConfirmDistanceMeters,
    ),
    annotationMaxCount: toFiniteNumber(source.annotationMaxCount),
  };
}
