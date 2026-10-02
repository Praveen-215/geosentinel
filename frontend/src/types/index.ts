/**
 * GeoSentinel Analyst Workstation Types
 * Professional Earth Observation (EO) & Multi-Temporal GIS Data Structures
 */

export type SatelliteConstellation = 'Sentinel-2A' | 'Sentinel-2B' | 'Landsat-8' | 'Landsat-9';

export interface SpectralBandInfo {
  band: string;
  name: string;
  resolution: string;
  centralWavelength: string;
  status: 'nominal' | 'degraded' | 'saturated';
}

export interface BoundingBox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

export interface GeoCoordinates {
  lat: number;
  lon: number;
  mgrs: string;
  elevationMsl?: number;
}

export interface SatelliteScene {
  id: string;
  satellite: SatelliteConstellation;
  sensor: string;
  acquisitionDate: string; // ISO 8601 UTC
  cloudCoverPercent: number;
  resolutionMeters: number;
  sunElevationDeg: number;
  sunAzimuthDeg: number;
  processingLevel: 'L1C' | 'L2A / Analysis Ready' | 'L3 Core';
  mgrsTile: string;
  crs: string;
  bbox: BoundingBox;
  centerCoordinates: GeoCoordinates;
  bands: SpectralBandInfo[];
  thumbnailUrl?: string;
  sceneClassificationSummary?: {
    vegetationPercent: number;
    waterPercent: number;
    bareSoilPercent: number;
    urbanPercent: number;
    cloudPercent: number;
  };
  tags: string[];
}

export interface AOI {
  id: string;
  code: string;
  name: string;
  region: string;
  country: string;
  mgrsGrid: string;
  crs: string;
  center: GeoCoordinates;
  bbox: BoundingBox;
  areaSqKm: number;
  perimeterKm: number;
  elevationRange: {
    minMeters: number;
    maxMeters: number;
    meanMeters: number;
  };
  keyFeatures: string[];
  activeAlertLevel: 'NOMINAL' | 'ADVISORY' | 'ELEVATED' | 'CRITICAL';
}

export interface SemanticRetrievalQuery {
  queryText: string;
  referenceSceneId?: string;
  temporalWindow?: {
    startDate: string;
    endDate: string;
  };
  maxCloudCover?: number;
  cloudCoverRange?: 'all' | '0-10' | '10-25' | '25-50';
  constellationFilter?: SatelliteConstellation[];
  sensorFilter?: 'all' | 'Sentinel-2' | 'Landsat-8' | 'Landsat-9';
  processingLevelFilter?: 'all' | 'Analysis Ready' | 'L2A';
  spatialRelation?: 'aoi' | 'region' | 'global';
  minSimilarityThreshold?: number;
  referenceImageName?: string;
}

export interface RetrievalResult {
  id: string;
  sceneId: string;
  similarityScore: number; // 0.000 to 1.000
  semanticRank: number;
  scene: SatelliteScene;
  featureMatches: {
    feature: string;
    confidence: number;
    semanticContext: string;
  }[];
  retrievalTimestamp: string;
  semanticReason?: string;
  aoiId?: string;
  region?: string;
}

export interface ChangeMetric {
  id: string;
  category: 'Vegetation (NDVI)' | 'Water Extent (NDWI)' | 'Built-up / Urban' | 'Soil / Bare Ground';
  metricName: string;
  unit: string;
  baselineValue: number;
  comparisonValue: number;
  absoluteDelta: number;
  percentChange: number;
  trend: 'increase' | 'decrease' | 'stable';
  confidenceScore: number; // 0 - 100%
  verificationStatus: 'AUTOMATED_MATCH' | 'ANALYST_VERIFIED' | 'FLAGGED_ARTIFACT';
  notes: string;
}

export interface ChangeAnalysisRun {
  runId: string;
  aoiId: string;
  baselineSceneId: string;
  comparisonSceneId: string;
  executionTimestamp: string;
  algorithm: 'Multi-Temporal Spectral Delta v2.4 (Analysis Ready)';
  overallAnomalyScore: number; // 0 - 100
  confidenceScore: number;
  metrics: ChangeMetric[];
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FLAGGED';
}

export interface ChangeAnalysisPayload {
  aoi: string;
  t1BaselineScene: string;
  t2ComparisonScene: string;
  changeMask?: string;
  changeType: 'ALL' | 'WATER' | 'VEGETATION' | 'BARE_GROUND' | 'BUILT_UP';
  confidence: string;
  earliestSupportedObservation: string;
  qualityChecks: {
    cloudCoverT1: number;
    cloudCoverT2: number;
    temporalSeparationDays: number;
    coRegistration: 'PASS' | 'WARN' | 'FAIL';
    sceneQuality: 'PASS' | 'WARN' | 'FAIL';
    cloudShadowScreening: 'PASS' | 'WARN' | 'FAIL';
    overallConfidence: 'HIGH' | 'MEDIUM' | 'LOW';
  };
}

export type NavigationSection =
  | 'overview'
  | 'retrieval'
  | 'change-analysis'
  | 'temporal'
  | 'similar-sites'
  | 'review'
  | 'evidence';

export type ViewportDisplayMode =
  | 'true-color'
  | 'false-color'
  | 'ndvi-mask'
  | 'change-heatmap'
  | 'spectral-split';
