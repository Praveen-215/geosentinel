/**
 * GeoSentinel Temporal Analysis Service
 * 
 * Provides mock service APIs for Multi-Temporal Analysis (F7).
 * Encapsulates observation queries, metric trajectories, quality records,
 * and inter-observation interval calculations.
 */

import {
  TemporalObservation,
  TemporalMetricSeries,
  TemporalQualityRecord,
  TemporalIntervalChange,
  TemporalChangeEvolutionPhase
} from '../types';
import {
  MOCK_TEMPORAL_CONTEXT,
  MOCK_TEMPORAL_OBSERVATIONS,
  MOCK_TEMPORAL_SERIES,
  MOCK_INTERVAL_CHANGES,
  MOCK_TEMPORAL_QUALITY,
  MOCK_CHANGE_EVOLUTION_PHASES,
  MOCK_EARLIEST_SUPPORTED_RECORD
} from '../data/mockTemporal';

export interface BaselineComparisonResult {
  baselineDate: string;
  baselineExtentSqKm: number;
  selectedDate: string;
  selectedExtentSqKm: number;
  deltaSqKm: number;
  relativeChangePercent: number;
  daysSeparation: number;
  ndwiDelta: number;
  status: 'EQUAL' | 'INCREASE' | 'DECREASE';
}

class TemporalAnalysisService {
  /**
   * Get the global context metadata for the active temporal investigation
   */
  getContext() {
    return MOCK_TEMPORAL_CONTEXT;
  }

  /**
   * Retrieve all chronological temporal observations for the active AOI
   */
  getTemporalObservations(): TemporalObservation[] {
    return [...MOCK_TEMPORAL_OBSERVATIONS];
  }

  /**
   * Retrieve observation by ID
   */
  getObservationById(id: string): TemporalObservation | undefined {
    return MOCK_TEMPORAL_OBSERVATIONS.find((obs) => obs.id === id);
  }

  /**
   * Retrieve observation by date string (e.g., '18 JUN 2025' or '18 JUN')
   */
  getObservationByDate(dateStr: string): TemporalObservation | undefined {
    return MOCK_TEMPORAL_OBSERVATIONS.find(
      (obs) => obs.date.toLowerCase().includes(dateStr.toLowerCase())
    );
  }

  /**
   * Retrieve the primary metric time-series or specific metric keys
   */
  getTemporalMetricSeries(metricKey: 'water' | 'vegetation' | 'bare-ground' | 'built-up'): TemporalMetricSeries {
    return MOCK_TEMPORAL_SERIES[metricKey] || MOCK_TEMPORAL_SERIES.water;
  }

  /**
   * Retrieve all quality audit records across the temporal sequence
   */
  getTemporalQuality(): TemporalQualityRecord[] {
    return [...MOCK_TEMPORAL_QUALITY];
  }

  /**
   * Calculate/retrieve interval rates of change between consecutive observation pairs
   */
  calculateIntervalChanges(): TemporalIntervalChange[] {
    return [...MOCK_INTERVAL_CHANGES];
  }

  /**
   * Retrieve structured change evolution phases
   */
  getChangeEvolutionPhases(): TemporalChangeEvolutionPhase[] {
    return [...MOCK_CHANGE_EVOLUTION_PHASES];
  }

  /**
   * Retrieve earliest supported observation audit record
   */
  getEarliestSupportedRecord() {
    return MOCK_EARLIEST_SUPPORTED_RECORD;
  }

  /**
   * Compute comparative delta between selected observation and the 15 MAY 2025 baseline
   */
  compareWithBaseline(observation: TemporalObservation): BaselineComparisonResult {
    const baseline = MOCK_TEMPORAL_OBSERVATIONS[0];
    const delta = Number((observation.waterExtentSqKm - baseline.waterExtentSqKm).toFixed(2));
    const percent = baseline.waterExtentSqKm > 0
      ? Number(((delta / baseline.waterExtentSqKm) * 100).toFixed(1))
      : 0;
    
    const d1 = new Date(baseline.isoDate);
    const d2 = new Date(observation.isoDate);
    const diffTime = Math.abs(d2.getTime() - d1.getTime());
    const daysSeparation = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    const ndwiDelta = Number((observation.ndwi - baseline.ndwi).toFixed(3));

    let status: 'EQUAL' | 'INCREASE' | 'DECREASE' = 'EQUAL';
    if (delta > 0.05) status = 'INCREASE';
    else if (delta < -0.05) status = 'DECREASE';

    return {
      baselineDate: baseline.date,
      baselineExtentSqKm: baseline.waterExtentSqKm,
      selectedDate: observation.date,
      selectedExtentSqKm: observation.waterExtentSqKm,
      deltaSqKm: delta,
      relativeChangePercent: percent,
      daysSeparation,
      ndwiDelta,
      status,
    };
  }
}

export const temporalAnalysisService = new TemporalAnalysisService();
