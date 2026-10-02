/**
 * GeoSentinel Analyst Review & Evidence Verification Service
 * 
 * Manages human-in-the-loop analyst decisions, evidence packages,
 * provenance audit trails, and mock verification payloads.
 */

import { AnalystReviewPackage, ReviewDecision, getReviewDisplayStatus } from '../types';

export const DEFAULT_MOCK_REVIEW_PACKAGE: AnalystReviewPackage = {
  reviewId: 'EV-2025-0921-01',
  candidateId: 'change-pune-khadakwasla-2025',
  aoi: 'AOI-MAHARASHTRA-PUNE-METRO',
  feature: 'Khadakwasla Reservoir Basin',
  changeType: 'WATER',
  t1Scene: 'S2B_MSIL2A_20250515T051859_N0510_R019_T43QDF',
  t2Scene: 'S2A_MSIL2A_20250921T051831_N0511_R019_T43QDF',
  t1Date: '15 MAY 2025',
  t2Date: '21 SEP 2025',
  baselineValue: '11.20 km²',
  comparisonValue: '28.45 km²',
  relativeChange: '+154.0%',
  confidence: 0.94,
  disposition: 'pending',
  analystNotes: '',
  status: 'PENDING',
  qualityChecks: {
    cloudCoverT1: 1.4,
    cloudCoverT2: 6.8,
    temporalSeparationDays: 129,
    coRegistration: 'PASS',
    sceneQuality: 'PASS',
    cloudShadowScreening: 'PASS',
    shadowCoverT1: 0.2,
    shadowCoverT2: 0.8,
    validPixelsT1: 99.8,
    validPixelsT2: 98.4,
    snowHazeScreening: 'PASS',
    seasonalVariation: 'PASS',
    illuminationGeometry: 'PASS',
    radiometricConsistency: 'PASS',
    overallConfidence: 'HIGH',
    flags: [],
  },
  provenance: {
    sensor: 'Sentinel-2',
    mgrsTile: '43QDF',
    processingLevel: 'L2A / LOCAL MOCK',
    sourceCatalog: 'LOCAL DEMO CATALOG',
    spatialResolution: '10m BOA Multi-Spectral',
  },
  supportingObservations: [
    {
      date: '15 MAY 2025',
      label: 'Pre-Monsoon Dry Baseline',
      context: 'Desiccated reservoir basin and exposed dry mudflat perimeter.',
      isEarliest: false,
      sensor: 'Sentinel-2B',
      cloudCover: 1.4,
    },
    {
      date: '18 JUN 2025',
      label: 'Monsoon Onset',
      context: 'Initial water / vegetation transition within the selected temporal series.',
      isEarliest: true,
      sensor: 'Sentinel-2B',
      cloudCover: 4.2,
    },
    {
      date: '23 JUL 2025',
      label: 'Ghats Orographic Surge',
      context: 'Heavy orographic precipitation along Sahyadri ridge crests.',
      isEarliest: false,
      sensor: 'Sentinel-2A',
      cloudCover: 18.5,
    },
    {
      date: '31 AUG 2025',
      label: 'High Discharge Inflow',
      context: 'Active spillway discharge and turbid sediment runoff plumes.',
      isEarliest: false,
      sensor: 'Sentinel-2B',
      cloudCover: 12.4,
    },
    {
      date: '21 SEP 2025',
      label: 'Post-Monsoon Peak',
      context: 'Catchment reservoir at 100% capacity; peak observed inundation area.',
      isEarliest: false,
      sensor: 'Sentinel-2A',
      cloudCover: 6.8,
    },
  ],
};

export interface ReviewServiceInterface {
  getDefaultPackage(): AnalystReviewPackage;
  saveDisposition(pkg: AnalystReviewPackage): Promise<AnalystReviewPackage>;
  submitReviewDecision(decision: ReviewDecision): Promise<ReviewDecision>;
  exportPackageAsJson(pkg: AnalystReviewPackage): string;
}

class MockReviewService implements ReviewServiceInterface {
  private currentPackage: AnalystReviewPackage = { ...DEFAULT_MOCK_REVIEW_PACKAGE };

  getDefaultPackage(): AnalystReviewPackage {
    return { ...this.currentPackage };
  }

  async saveDisposition(pkg: AnalystReviewPackage): Promise<AnalystReviewPackage> {
    await new Promise((resolve) => setTimeout(resolve, 80));
    this.currentPackage = { ...pkg };
    return this.currentPackage;
  }

  /**
   * Submits human review decision.
   * NOTE: This is the isolated persistence boundary. Currently operates in local demo mock mode.
   * Ready for future backend integration: POST /api/v1/reviews
   * Does NOT claim backend persistence in current demo.
   */
  async submitReviewDecision(decision: ReviewDecision): Promise<ReviewDecision> {
    await new Promise((resolve) => setTimeout(resolve, 80));
    this.currentPackage = {
      ...this.currentPackage,
      candidateId: decision.candidateId,
      disposition: decision.disposition,
      reviewedBy: decision.reviewedBy,
      reviewedAt: decision.reviewedAt,
      analystNotes: decision.analystNotes,
      status: getReviewDisplayStatus(decision.disposition),
    };
    return decision;
  }

  exportPackageAsJson(pkg: AnalystReviewPackage): string {
    return JSON.stringify(
      {
        schema: 'https://geosentinel.internal/schemas/analyst-evidence-v1.json',
        reviewId: pkg.reviewId,
        candidateId: pkg.candidateId || 'change-pune-khadakwasla-2025',
        aoi: pkg.aoi,
        feature: pkg.feature,
        changeType: pkg.changeType,
        temporalBaseline: {
          sceneId: pkg.t1Scene,
          date: pkg.t1Date,
          measuredWaterExtent: pkg.baselineValue,
        },
        temporalComparison: {
          sceneId: pkg.t2Scene,
          date: pkg.t2Date,
          measuredWaterExtent: pkg.comparisonValue,
        },
        relativeChange: pkg.relativeChange,
        confidence: pkg.confidence,
        analystDisposition: {
          decision: pkg.disposition,
          status: getReviewDisplayStatus(pkg.disposition),
          notes: pkg.analystNotes,
          reviewedAt: pkg.reviewedAt || new Date().toISOString(),
          reviewedBy: pkg.reviewedBy || 'ANALYST_LOCAL_SESSION',
        },
        qualityChecks: pkg.qualityChecks,
        provenance: pkg.provenance,
        supportingObservations: pkg.supportingObservations,
        exportMetadata: {
          mode: 'DEMO / LOCAL MOCK',
          system: 'GeoSentinel Analyst Workstation v0.1.0',
          exportedAt: new Date().toISOString(),
          backendPersistence: 'UNCOMMITTED / LOCAL MOCK ONLY (PENDING BACKEND API)',
        },
      },
      null,
      2
    );
  }
}

export const reviewService: ReviewServiceInterface = new MockReviewService();
