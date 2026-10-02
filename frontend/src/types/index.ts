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

export type ReviewDisposition = 'pending' | 'confirmed' | 'rejected' | 'flagged';
export type ReviewStatus = 'PENDING' | 'CONFIRMED' | 'REJECTED' | 'FLAGGED_FOR_REVIEW';

export interface AnalystReviewPackage {
  reviewId: string;
  aoi: string;
  feature: string;
  changeType: string;
  t1Scene: string;
  t2Scene: string;
  t1Date: string;
  t2Date: string;
  baselineValue: string;
  comparisonValue: string;
  relativeChange: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  disposition: ReviewDisposition;
  analystNotes: string;
  reviewedAt?: string;
  reviewedBy?: string;
  status: ReviewStatus;
  qualityChecks: {
    cloudCoverT1: number;
    cloudCoverT2: number;
    temporalSeparationDays: number;
    coRegistration: 'PASS' | 'WARN' | 'FAIL';
    sceneQuality: 'PASS' | 'WARN' | 'FAIL';
    cloudShadowScreening: 'PASS' | 'WARN' | 'FAIL';
    overallConfidence: 'HIGH' | 'MEDIUM' | 'LOW';
  };
  provenance: {
    sensor: string;
    mgrsTile: string;
    processingLevel: string;
    sourceCatalog: string;
    spatialResolution: string;
  };
  supportingObservations: {
    date: string;
    label: string;
    context?: string;
    isEarliest?: boolean;
    sensor?: string;
    cloudCover?: number;
  }[];
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

export type SimilarSiteSearchMode = 'SEMANTIC' | 'VISUAL' | 'LAND-COVER' | 'HYBRID';

export interface SimilarSiteWeights {
  water: number;
  vegetation: number;
  builtUp: number;
  terrain: number;
  spatial: number;
}

export interface SimilarSitesFilter {
  searchConcept?: string;
  mode?: SimilarSiteSearchMode;
  similarityThreshold?: number;
  searchRadiusKm?: number;
  maxResults?: number;
  weights?: SimilarSiteWeights;
}

export interface SimilarSite {
  id: string;
  rank: number;
  name: string;
  region: string;
  latitude: number;
  longitude: number;
  searchDistanceKm: number;
  direction: string;
  similarityScore: number;
  semanticScore: number;
  spectralScore: number;
  spatialScore: number;
  waterSignature: 'HIGH' | 'MEDIUM' | 'LOW';
  vegetationSignature: 'HIGH' | 'MEDIUM' | 'LOW';
  builtUpSignature: 'HIGH' | 'MEDIUM' | 'LOW';
  agricultureSignature: 'HIGH' | 'MEDIUM' | 'LOW';
  terrainSignature: 'HILLY' | 'LOWLAND' | 'LOW' | 'PLATEAU' | 'MOUNTAINOUS';
  matchReason: string;
  sceneId: string;
  acquisitionDate: string;
  cloudPercent: number;
  elevationMeters: number;
  waterExtentSqKm: number;
  ndwi: number;
  builtUpSqKm: number;
  mgrsTile: string;
  temporalMilestones: {
    month: string;
    waterStatus: string;
    vegetationStatus: string;
  }[];
}

export interface SimilarSiteReference {
  name: string;
  aoiId: string;
  aoiName: string;
  mgrsTile: string;
  feature: string;
  sceneId: string;
  acquisitionDate: string;
  waterExtentSqKm: number;
  ndwi: number;
  builtUpSqKm: number;
  elevationMeters: number;
  terrain: string;
  cloudPercent: number;
  featureChips: string[];
}

export interface ProcessingLineageStep {
  id: string;
  name: string;
  status: 'PASS' | 'RECORDED' | 'WARN';
  description: string;
  algorithm?: string;
}

export interface ProvenanceEvent {
  stepNumber: string;
  id: string;
  timestamp: string;
  module: string;
  action: string;
  status: string;
  details: string;
}

export interface EvidenceQualityCheck {
  id: string;
  name: string;
  metric: string;
  status: 'PASS' | 'WARN' | 'FAIL';
  verified: boolean;
}

export interface SourceSceneLineage {
  role: 'BASELINE' | 'COMPARISON' | 'EARLIEST_OBSERVATION';
  roleLabel: string;
  sceneId: string;
  sensor: string;
  product: string;
  acquisitionTimestamp: string;
  mgrsTile: string;
  cloudCoverPercent: number;
  processingLevel: string;
  resolutionMeters: number;
  sunElevationDeg: number;
}

export interface TemporalObservationRecord {
  date: string;
  shortSceneId: string;
  waterState: string;
  cloudPercent: number;
  evidenceRole: string;
  isEarliest?: boolean;
}

export interface EvidencePackageDossier {
  investigationId: string;
  packageId: string;
  aoiId: string;
  aoiName: string;
  feature: string;
  status: string;
  auditHash: string;
  generatedTimestamp: string;
  findingSummary: {
    changeType: string;
    baselineValue: string;
    comparisonValue: string;
    absoluteChange: string;
    relativeChange: string;
    confidence: string;
    earliestSupportedObservation: string;
    analysisInterval: string;
  };
  analystReview: {
    reviewId: string;
    finding: string;
    disposition: string;
    reviewStatus: string;
    evidenceChecklistPassed: string;
    reviewedAt: string;
    reviewer: string;
    analystNotes: string;
  };
  sourceScenes: SourceSceneLineage[];
  processingPipeline: ProcessingLineageStep[];
  qualityChecks: EvidenceQualityCheck[];
  temporalTimeline: TemporalObservationRecord[];
  eventLog: ProvenanceEvent[];
}

export type TemporalEvidenceRole =
  | 'BASELINE'
  | 'EARLIEST_OBSERVATION'
  | 'INTERMEDIATE_RESPONSE'
  | 'ACCELERATED_RESPONSE'
  | 'PEAK_RESPONSE';

export interface TemporalObservation {
  id: string;
  date: string;
  isoDate: string;
  sceneId: string;
  shortSceneId: string;
  satellite: SatelliteConstellation;
  sensor: string;
  platform: string;
  productLevel: string;
  acquisitionTimestamp: string;
  mgrsTile: string;
  crs: string;
  processingBaseline: string;
  cloudCoverPercent: number;
  sunElevationDeg: number;
  waterExtentSqKm: number;
  ndwi: number;
  ndvi: number;
  bareGroundSqKm: number;
  builtUpSqKm: number;
  evidenceRole: TemporalEvidenceRole;
  evidenceRoleLabel: string;
  stateLabel: string;
  stateDescription: string;
  qualityStatus: 'PASS' | 'REVIEW' | 'WARN';
  qualityNote?: string;
  confidenceState: 'BASELINE' | 'HIGH' | 'MEDIUM / QUALITY FLAG';
  isEarliestSupported?: boolean;
  isPeakResponse?: boolean;
  isBaseline?: boolean;
}

export interface TemporalMetricPoint {
  date: string;
  label: string;
  value: number;
  unit: string;
  secondaryValue?: number;
  secondaryUnit?: string;
  formattedValue: string;
  isEarliest?: boolean;
  isPeak?: boolean;
}

export interface TemporalMetricSeries {
  metricKey: 'water' | 'vegetation' | 'bare-ground' | 'built-up';
  title: string;
  unit: string;
  description: string;
  disclaimer?: string;
  points: TemporalMetricPoint[];
  min: number;
  max: number;
}

export interface TemporalIntervalChange {
  fromObservationId: string;
  toObservationId: string;
  fromPeriod: string;
  toPeriod: string;
  label: string;
  deltaSqKm: number;
  percentageChange: number;
  daysInterval: number;
  rateSqKmPerDay: number;
}

export interface TemporalQualityRecord {
  observationId: string;
  date: string;
  cloudPercent: number;
  satellite: string;
  quality: 'PASS' | 'REVIEW' | 'WARN';
  details: string;
}

export interface TemporalChangeEvolutionPhase {
  phaseNumber: string;
  name: string;
  dateRange: string;
  waterExtent: string;
  state: string;
  badge?: string;
  description: string;
}

