/**
 * GeoSentinel Analyst Workstation Types
 * Professional Earth Observation (EO) & Multi-Temporal GIS Data Structures
 * Aligned with backend/contracts.py
 */

export type SatelliteConstellation = 'Sentinel-2A' | 'Sentinel-2B';

export interface SpectralBandInfo {
  band: string;
  name: string;
  resolution: string;
  centralWavelength: string;
  status: 'nominal' | 'degraded' | 'saturated';
}

export const SENTINEL2_BAND_METADATA: Record<string, SpectralBandInfo> = {
  B01: { band: 'B01', name: 'Coastal Aerosol', resolution: '60m', centralWavelength: '443 nm', status: 'nominal' },
  B02: { band: 'B02', name: 'Blue', resolution: '10m', centralWavelength: '490 nm', status: 'nominal' },
  B03: { band: 'B03', name: 'Green', resolution: '10m', centralWavelength: '560 nm', status: 'nominal' },
  B04: { band: 'B04', name: 'Red', resolution: '10m', centralWavelength: '665 nm', status: 'nominal' },
  B05: { band: 'B05', name: 'Red Edge 1', resolution: '20m', centralWavelength: '705 nm', status: 'nominal' },
  B06: { band: 'B06', name: 'Red Edge 2', resolution: '20m', centralWavelength: '740 nm', status: 'nominal' },
  B07: { band: 'B07', name: 'Red Edge 3', resolution: '20m', centralWavelength: '783 nm', status: 'nominal' },
  B08: { band: 'B08', name: 'NIR Broad', resolution: '10m', centralWavelength: '842 nm', status: 'nominal' },
  B8A: { band: 'B8A', name: 'NIR Narrow', resolution: '20m', centralWavelength: '865 nm', status: 'nominal' },
  B09: { band: 'B09', name: 'Water Vapour', resolution: '60m', centralWavelength: '945 nm', status: 'nominal' },
  B11: { band: 'B11', name: 'SWIR 1', resolution: '20m', centralWavelength: '1610 nm', status: 'nominal' },
  B12: { band: 'B12', name: 'SWIR 2', resolution: '20m', centralWavelength: '2190 nm', status: 'nominal' },
};

export const getBandMetadata = (bandKey: string): SpectralBandInfo => {
  return SENTINEL2_BAND_METADATA[bandKey] || {
    band: bandKey,
    name: bandKey,
    resolution: '10m',
    centralWavelength: 'N/A',
    status: 'nominal',
  };
};

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
  cloudCoverPercent: number; // 0-100
  resolutionMeters: number;
  processingLevel: string;
  mgrsTile: string;
  crs: string; // native UTM, e.g. 'EPSG:32643'
  bbox: BoundingBox; // lon/lat
  processingBaseline: string; // e.g. '05.10'
  relativeOrbit: number;
  shadowPercent: number; // 0-100
  validPercent: number; // 0-100
  bands: string[]; // e.g. ['B02', 'B03', 'B04', 'B08', ...]
  bandResolutionM: Record<string, number>;
  sunElevationDeg?: number;
  sunAzimuthDeg?: number;
  thumbnailUrl?: string;

  // UI-derived / optional presentation fields
  sceneClassificationSummary?: {
    vegetationPercent: number;
    waterPercent: number;
    bareSoilPercent: number;
    urbanPercent: number;
    cloudPercent: number;
  };
}

export type Scene = SatelliteScene;

export const getSceneCenter = (scene: { bbox: BoundingBox; mgrsTile?: string }): GeoCoordinates => {
  return {
    lat: Number(((scene.bbox.minLat + scene.bbox.maxLat) / 2).toFixed(4)),
    lon: Number(((scene.bbox.minLon + scene.bbox.maxLon) / 2).toFixed(4)),
    mgrs: scene.mgrsTile || '43QDF',
  };
};

export interface Tile {
  tileId: string;
  aoiId: string;
  mgrsTile: string;
  row: number;
  col: number;
  sizeM: number;
  crs: string;
  nativeBounds: [number, number, number, number];
  bbox: BoundingBox;
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
  referenceTileId?: string;
  temporalWindow?: {
    startDate: string;
    endDate: string;
  };
  maxCloudCover?: number;
  cloudCoverRange?: 'all' | '0-10' | '10-25' | '25-50';
  constellationFilter?: SatelliteConstellation[];
  sensorFilter?: 'all' | 'Sentinel-2';
  processingLevelFilter?: 'all' | 'Analysis Ready' | 'L2A';
  spatialRelation?: 'aoi' | 'region' | 'global';
  minSimilarityThreshold?: number;
  referenceImageName?: string;
}

export interface SearchResult {
  id: string;
  sceneId: string;
  tileId: string;
  tileBbox: BoundingBox;
  similarityScore: number; // 0.0 - 1.0
  semanticRank: number; // 1 = best
  scene: SatelliteScene;
  retrievalTimestamp: string;
  aoiId?: string;
  tileImageUrl?: string;

  // Optional presentation fields for current demo UI
  featureMatches?: {
    feature: string;
    confidence: number;
    semanticContext: string;
  }[];
  semanticReason?: string;
  region?: string;
}

export type RetrievalResult = SearchResult;

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

export interface QualityChecks {
  cloudCoverT1: number; // 0-100
  cloudCoverT2: number; // 0-100
  temporalSeparationDays: number;

  coRegistration: 'PASS' | 'WARN' | 'FAIL';
  sceneQuality: 'PASS' | 'WARN' | 'FAIL';
  cloudShadowScreening: 'PASS' | 'WARN' | 'FAIL';

  shadowCoverT1: number; // 0-100
  shadowCoverT2: number; // 0-100

  validPixelsT1: number; // 0-100
  validPixelsT2: number; // 0-100

  snowHazeScreening: 'PASS' | 'WARN' | 'FAIL';
  seasonalVariation: 'PASS' | 'WARN' | 'FAIL';
  illuminationGeometry: 'PASS' | 'WARN' | 'FAIL';
  radiometricConsistency: 'PASS' | 'WARN' | 'FAIL';

  overallConfidence: 'HIGH' | 'MEDIUM' | 'LOW';

  flags: string[];
}

export type BackendChangeType = 'CONSTRUCTION' | 'CLEARANCE' | 'WATER' | 'ROAD';
export type ChangeType = BackendChangeType;

export type AnalyticalMetricCategory = 'WATER' | 'VEGETATION' | 'BARE_GROUND' | 'BUILT_UP';

export interface ChangeAnalysisRun {
  runId: string;
  aoiId: string;
  baselineSceneId: string;
  comparisonSceneId: string;
  executionTimestamp: string;
  algorithm: string;
  overallAnomalyScore: number; // 0 - 100
  confidenceScore: number;
  metrics: ChangeMetric[];
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FLAGGED';
}

export interface ChangeResult {
  id: string;
  aoi: string;
  tileId: string;
  t1BaselineScene: string;
  t2ComparisonScene: string;
  changeType: BackendChangeType;
  confidence: number; // 0.0 - 1.0
  earliestSupportedObservation: string;
  earliestSceneId: string;
  qualityChecks: QualityChecks;
  changeMask?: string;
  beforeImageUrl?: string;
  afterImageUrl?: string;
}

export interface ChangeAnalysisPayload {
  aoi: string;
  tileId?: string;
  t1BaselineScene: string;
  t2ComparisonScene: string;
  changeMask?: string;
  changeType: BackendChangeType;
  confidence: number; // 0.0 - 1.0
  earliestSupportedObservation: string;
  earliestSceneId?: string;
  qualityChecks: QualityChecks;
  beforeImageUrl?: string;
  afterImageUrl?: string;
}

export type ReviewDisposition = 'confirmed' | 'rejected' | 'flagged';

export interface ReviewDecision {
  reviewId: string;
  candidateId: string;
  disposition: ReviewDisposition;
  reviewedBy: string;
  reviewedAt: string; // ISO 8601 UTC
  analystNotes: string;
}

export interface AnalystReviewPackage {
  reviewId: string;
  candidateId?: string;
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
  confidence: number | 'HIGH' | 'MEDIUM' | 'LOW';
  disposition: ReviewDisposition | 'pending';
  analystNotes: string;
  reviewedAt?: string;
  reviewedBy?: string;
  status?: ReviewDisplayStatus;
  qualityChecks: QualityChecks;
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
  beforeImageUrl?: string;
  afterImageUrl?: string;
  changeMask?: string;
}

export type ConfidenceBucket = 'HIGH' | 'MEDIUM' | 'LOW';

export const getConfidenceBucket = (confidence: number): ConfidenceBucket => {
  if (confidence >= 0.90) return 'HIGH';
  if (confidence >= 0.70) return 'MEDIUM';
  return 'LOW';
};

export const formatConfidence = (confidence: number | string): string => {
  if (typeof confidence === 'string') return confidence;
  const bucket = getConfidenceBucket(confidence);
  const pct = (confidence <= 1.0 ? confidence * 100 : confidence).toFixed(1);
  return `${bucket} (${pct}%)`;
};

export type ReviewDisplayStatus = 'PENDING' | 'CONFIRMED' | 'REJECTED' | 'FLAGGED';

export const getReviewDisplayStatus = (disposition: ReviewDisposition | 'pending'): ReviewDisplayStatus => {
  switch (disposition) {
    case 'confirmed': return 'CONFIRMED';
    case 'rejected': return 'REJECTED';
    case 'flagged': return 'FLAGGED';
    case 'pending': default: return 'PENDING';
  }
};

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
  sceneId: string;
  tileId: string;
  tileBbox: BoundingBox;
  similarityScore: number;
  semanticRank: number;
  scene?: SatelliteScene;
  aoiId?: string;
  tileImageUrl?: string;

  // Optional presentation fields for current demo UI
  rank?: number;
  name?: string;
  region?: string;
  latitude?: number;
  longitude?: number;
  searchDistanceKm?: number;
  direction?: string;
  semanticScore?: number;
  spectralScore?: number;
  spatialScore?: number;
  waterSignature?: 'HIGH' | 'MEDIUM' | 'LOW';
  vegetationSignature?: 'HIGH' | 'MEDIUM' | 'LOW';
  builtUpSignature?: 'HIGH' | 'MEDIUM' | 'LOW';
  agricultureSignature?: 'HIGH' | 'MEDIUM' | 'LOW';
  terrainSignature?: 'HILLY' | 'LOWLAND' | 'LOW' | 'PLATEAU' | 'MOUNTAINOUS';
  matchReason?: string;
  acquisitionDate?: string;
  cloudPercent?: number;
  elevationMeters?: number;
  waterExtentSqKm?: number;
  ndwi?: number;
  builtUpSqKm?: number;
  mgrsTile?: string;
  temporalMilestones?: {
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
  auditHash?: string;
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

