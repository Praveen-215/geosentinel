/**
 * GeoSentinel Multi-Temporal Change Analysis Service Interface
 * 
 * Abstraction layer for bi-temporal spectral change detection, NDVI/NDWI delta calculation,
 * anomaly segmentation, and analyst evidence reporting.
 */

import { MOCK_CHANGE_METRICS } from '../data/mockScenes';
import { ChangeAnalysisPayload, ChangeAnalysisRun, ChangeMetric } from '../types';

export interface ChangeAnalysisServiceInterface {
  runTemporalChangeAnalysis(
    baselineSceneId: string,
    comparisonSceneId: string,
    aoiId: string
  ): Promise<ChangeAnalysisRun>;
  getLatestChangeMetrics(aoiId: string): Promise<ChangeMetric[]>;
  verifyMetric(metricId: string, analystNotes: string): Promise<ChangeMetric>;
  getChangeAnalysisPayload(
    baselineSceneId: string,
    comparisonSceneId: string,
    aoiId: string,
    category?: 'ALL' | 'WATER' | 'VEGETATION' | 'BARE_GROUND' | 'BUILT_UP'
  ): Promise<ChangeAnalysisPayload>;
}

class MockChangeAnalysisService implements ChangeAnalysisServiceInterface {
  /**
   * Returns a standard data contract payload matching future backend service interfaces
   */
  async getChangeAnalysisPayload(
    baselineSceneId: string,
    comparisonSceneId: string,
    aoiId: string,
    category: 'ALL' | 'WATER' | 'VEGETATION' | 'BARE_GROUND' | 'BUILT_UP' = 'ALL'
  ): Promise<ChangeAnalysisPayload> {
    await new Promise((resolve) => setTimeout(resolve, 120));

    return {
      aoi: aoiId,
      t1BaselineScene: baselineSceneId,
      t2ComparisonScene: comparisonSceneId,
      changeMask: 'mock_s2_delta_mask_43qdf_v2.geojson',
      changeType: category,
      confidence: 'HIGH',
      earliestSupportedObservation: '2025-06-18T05:18:51Z',
      qualityChecks: {
        cloudCoverT1: 1.4,
        cloudCoverT2: 6.8,
        temporalSeparationDays: 129,
        coRegistration: 'PASS',
        sceneQuality: 'PASS',
        cloudShadowScreening: 'PASS',
        overallConfidence: 'HIGH',
      },
    };
  }
  /**
   * Triggers a multi-temporal change detection run comparing baseline T1 to target T2
   */
  async runTemporalChangeAnalysis(
    baselineSceneId: string,
    comparisonSceneId: string,
    aoiId: string
  ): Promise<ChangeAnalysisRun> {
    await new Promise((resolve) => setTimeout(resolve, 450));

    return {
      runId: `run-${Date.now().toString(36)}`,
      aoiId,
      baselineSceneId,
      comparisonSceneId,
      executionTimestamp: new Date().toISOString(),
      algorithm: 'Multi-Temporal Spectral Delta v2.4 (Analysis Ready)',
      overallAnomalyScore: 78.4,
      confidenceScore: 94.6,
      metrics: MOCK_CHANGE_METRICS,
      status: 'COMPLETED',
    };
  }

  /**
   * Fetches latest analyzed bi-temporal change metrics for an AOI
   */
  async getLatestChangeMetrics(_aoiId: string): Promise<ChangeMetric[]> {
    await new Promise((resolve) => setTimeout(resolve, 100));
    return MOCK_CHANGE_METRICS;
  }

  /**
   * Allows analyst verification or override of detected spectral deltas
   */
  async verifyMetric(metricId: string, analystNotes: string): Promise<ChangeMetric> {
    await new Promise((resolve) => setTimeout(resolve, 80));
    const target = MOCK_CHANGE_METRICS.find((m) => m.id === metricId);
    if (!target) {
      throw new Error(`Metric ${metricId} not found`);
    }
    return {
      ...target,
      verificationStatus: 'ANALYST_VERIFIED',
      notes: analystNotes || target.notes,
    };
  }
}

export const changeAnalysisService: ChangeAnalysisServiceInterface = new MockChangeAnalysisService();
