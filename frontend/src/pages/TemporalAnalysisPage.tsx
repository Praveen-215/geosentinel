/**
 * GeoSentinel — F7 Multi-Temporal Analysis Workstation
 * 
 * Answers: "When did the change begin, how did it evolve, and what is the strongest supported temporal evidence?"
 * Traces change evolution across 5 chronological Earth Observation acquisitions (15 MAY → 21 SEP 2025).
 * Fully self-contained local mock workstation with interactive timeline, trajectory chart,
 * GIS viewport, multi-metric time series, and cross-module linkages.
 */

import React, { useState } from 'react';
import {
  Clock,
  AlertTriangle,
  CheckCircle2,
  FileCheck2,
  GitCompare,
  Maximize2,
  X,
  Activity,
  Compass,
  Satellite,
  ShieldCheck,
  Copy,
  Check
} from 'lucide-react';
import {
  AOI,
  NavigationSection,
  SatelliteScene,
  TemporalMetricSeries
} from '../types';
import { MOCK_PRIMARY_AOI, MOCK_SCENES } from '../data/mockScenes';
import {
  temporalAnalysisService,
  BaselineComparisonResult
} from '../services/temporalAnalysisService';

interface TemporalAnalysisPageProps {
  currentAoi?: AOI;
  allScenes?: SatelliteScene[];
  onNavigateSection?: (section: NavigationSection) => void;
  onStageComparisonScene?: (scene: SatelliteScene) => void;
}

export const TemporalAnalysisPage: React.FC<TemporalAnalysisPageProps> = ({
  currentAoi = MOCK_PRIMARY_AOI,
  allScenes = MOCK_SCENES,
  onNavigateSection,
  onStageComparisonScene,
}) => {
  // Service Data
  const context = temporalAnalysisService.getContext();
  const observations = temporalAnalysisService.getTemporalObservations();
  const intervalChanges = temporalAnalysisService.calculateIntervalChanges();
  const qualityRecords = temporalAnalysisService.getTemporalQuality();
  const evolutionPhases = temporalAnalysisService.getChangeEvolutionPhases();
  const earliestRecord = temporalAnalysisService.getEarliestSupportedRecord();

  // Component State
  // Selected observation defaults to 21 SEP 2025 (Peak Response) as required
  const [selectedObsId, setSelectedObsId] = useState<string>('obs-05');
  const [activeMetricTab, setActiveMetricTab] = useState<'water' | 'vegetation' | 'bare-ground' | 'built-up'>('water');
  const [showMetadataModal, setShowMetadataModal] = useState<boolean>(false);
  const [showCompareModal, setShowCompareModal] = useState<boolean>(false);
  const [showGridInViewer, setShowGridInViewer] = useState<boolean>(true);
  const [copiedSceneId, setCopiedSceneId] = useState<boolean>(false);

  const selectedObs = observations.find((o) => o.id === selectedObsId) || observations[4];
  const baselineComparison: BaselineComparisonResult = temporalAnalysisService.compareWithBaseline(selectedObs);
  const currentMetricSeries: TemporalMetricSeries = temporalAnalysisService.getTemporalMetricSeries(activeMetricTab);

  // Copy scene ID helper
  const handleCopySceneId = (sceneId: string) => {
    navigator.clipboard.writeText(sceneId);
    setCopiedSceneId(true);
    setTimeout(() => setCopiedSceneId(false), 2000);
  };

  // Find matching SatelliteScene if available in allScenes or construct fallback
  const getSelectedSatelliteScene = (): SatelliteScene => {
    const matched = allScenes.find((s) => s.id === selectedObs.sceneId);
    if (matched) return matched;
    return {
      id: selectedObs.sceneId,
      satellite: selectedObs.satellite,
      sensor: selectedObs.sensor,
      acquisitionDate: selectedObs.acquisitionTimestamp,
      cloudCoverPercent: selectedObs.cloudCoverPercent,
      resolutionMeters: 10,
      sunElevationDeg: selectedObs.sunElevationDeg,
      sunAzimuthDeg: 120,
      processingLevel: 'L2A / Analysis Ready',
      mgrsTile: selectedObs.mgrsTile,
      crs: selectedObs.crs,
      bbox: currentAoi.bbox,
      centerCoordinates: currentAoi.center,
      bands: [],
      tags: [selectedObs.stateLabel, selectedObs.evidenceRoleLabel],
    };
  };

  // Action handlers
  const handleOpenInChangeAnalysis = () => {
    const scene = getSelectedSatelliteScene();
    if (onStageComparisonScene) {
      onStageComparisonScene(scene);
    } else if (onNavigateSection) {
      onNavigateSection('change-analysis');
    }
  };

  const handleOpenAnalystReview = () => {
    if (onNavigateSection) {
      onNavigateSection('review');
    }
  };

  const handleOpenEvidenceProvenance = () => {
    if (onNavigateSection) {
      onNavigateSection('evidence');
    }
  };

  // SVG Chart Dimensions & Coordinates
  const chartWidth = 560;
  const chartHeight = 200;
  const chartPadLeft = 55;
  const chartPadRight = 35;
  const chartPadTop = 25;
  const chartPadBottom = 35;
  const usableWidth = chartWidth - chartPadLeft - chartPadRight;
  const usableHeight = chartHeight - chartPadTop - chartPadBottom;

  // Chart Y range: 10 km² to 30 km²
  const minY = 10.0;
  const maxY = 30.0;
  const getYCoord = (val: number) => {
    const clamped = Math.max(minY, Math.min(maxY, val));
    const ratio = (clamped - minY) / (maxY - minY);
    return chartPadTop + (1 - ratio) * usableHeight;
  };

  const getXCoord = (index: number) => {
    return chartPadLeft + (index / (observations.length - 1)) * usableWidth;
  };

  const chartPoints = observations.map((obs, idx) => ({
    x: getXCoord(idx),
    y: getYCoord(obs.waterExtentSqKm),
    obs,
  }));

  const chartPathD = chartPoints.reduce((acc, pt, idx) => {
    return idx === 0 ? `M ${pt.x},${pt.y}` : `${acc} L ${pt.x},${pt.y}`;
  }, '');

  const chartAreaD = `${chartPathD} L ${chartPoints[chartPoints.length - 1].x},${chartPadTop + usableHeight} L ${chartPoints[0].x},${chartPadTop + usableHeight} Z`;

  // Scale factor for GIS Reservoir visual based on current water extent (11.20 to 28.45)
  const reservoirScaleFactor = 0.85 + ((selectedObs.waterExtentSqKm - 11.20) / (28.45 - 11.20)) * 0.40;

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      background: 'var(--color-surface-base)',
      overflowY: 'auto',
      userSelect: 'none',
      color: 'var(--color-text-primary)',
    }}>
      {/* 1. TOP INVESTIGATION CONTEXT HEADER */}
      <div style={{
        background: 'var(--color-chrome-bg)',
        borderBottom: '1px solid var(--color-chrome-border)',
        padding: '12px 18px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="badge badge-blue" style={{ fontSize: '10px', letterSpacing: '0.06em' }}>
                F7 WORKSTATION
              </span>
              <h1 style={{ margin: 0, fontSize: '16px', fontWeight: 700, letterSpacing: '0.04em', color: '#f8fafc' }}>
                MULTI-TEMPORAL ANALYSIS
              </h1>
              <span style={{
                background: 'rgba(56, 189, 248, 0.15)',
                color: '#38bdf8',
                border: '1px solid rgba(56, 189, 248, 0.3)',
                padding: '2px 8px',
                borderRadius: '3px',
                fontSize: '10px',
                fontFamily: 'monospace',
                fontWeight: 600,
              }}>
                {context.environment}
              </span>
            </div>
            <p style={{ margin: '2px 0 0 0', fontSize: '11px', color: 'var(--color-text-secondary)' }}>
              Trace change evolution across repeated Earth observation acquisitions
            </p>
          </div>

          {/* Quick Cross-Module Action Links */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <button
              onClick={() => setShowCompareModal(true)}
              className="btn btn-sm"
              style={{
                background: 'rgba(2, 132, 199, 0.15)',
                borderColor: 'rgba(2, 132, 199, 0.4)',
                color: '#38bdf8',
                fontSize: '11px',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
              }}
              title="Compare selected date with 15 MAY 2025 baseline"
            >
              <GitCompare size={12} />
              COMPARE WITH BASELINE
            </button>
            <button
              onClick={handleOpenInChangeAnalysis}
              className="btn btn-sm"
              style={{ fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}
              title="Open bi-temporal diff in F3"
            >
              <GitCompare size={12} />
              CHANGE ANALYSIS [F3]
            </button>
            <button
              onClick={handleOpenAnalystReview}
              className="btn btn-sm"
              style={{ fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}
              title="Review disposition in F4"
            >
              <ShieldCheck size={12} />
              REVIEW [F4]
            </button>
            <button
              onClick={handleOpenEvidenceProvenance}
              className="btn btn-sm"
              style={{ fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}
              title="Inspect provenance in F6"
            >
              <FileCheck2 size={12} />
              EVIDENCE [F6]
            </button>
          </div>
        </div>

        {/* Telemetry Strip */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
          gap: '8px',
          background: 'rgba(15, 23, 42, 0.6)',
          border: '1px solid var(--color-chrome-border)',
          borderRadius: '4px',
          padding: '6px 12px',
          fontSize: '11px',
          fontFamily: 'monospace',
        }}>
          <div>
            <span style={{ color: 'var(--color-text-muted)', fontSize: '10px' }}>INVESTIGATION:</span>{' '}
            <strong style={{ color: '#e2e8f0' }}>{context.investigationId}</strong>
          </div>
          <div>
            <span style={{ color: 'var(--color-text-muted)', fontSize: '10px' }}>AOI:</span>{' '}
            <span style={{ color: '#cbd5e1' }}>{context.aoiName}</span>
          </div>
          <div>
            <span style={{ color: 'var(--color-text-muted)', fontSize: '10px' }}>MGRS TILE:</span>{' '}
            <span style={{ color: '#38bdf8' }}>{context.mgrsTile}</span>
          </div>
          <div>
            <span style={{ color: 'var(--color-text-muted)', fontSize: '10px' }}>FEATURE:</span>{' '}
            <span style={{ color: '#e2e8f0' }}>{context.feature}</span>
          </div>
          <div>
            <span style={{ color: 'var(--color-text-muted)', fontSize: '10px' }}>PERIOD:</span>{' '}
            <span style={{ color: '#93c5fd' }}>{context.period}</span>
          </div>
          <div>
            <span style={{ color: 'var(--color-text-muted)', fontSize: '10px' }}>OBSERVATIONS:</span>{' '}
            <span style={{ color: '#34d399' }}>{context.totalObservations} VALIDATED</span>
          </div>
        </div>
      </div>

      {/* 2. TEMPORAL OVERVIEW METRICS STRIP */}
      <div style={{
        padding: '8px 18px',
        background: 'var(--color-surface-subtle)',
        borderBottom: '1px solid var(--color-border-standard)',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
        gap: '8px',
      }}>
        <div style={{ background: 'var(--color-surface-base)', border: '1px solid var(--color-border-standard)', borderRadius: '3px', padding: '6px 10px' }}>
          <div style={{ fontSize: '9px', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>SEQUENCE COUNT</div>
          <div style={{ fontSize: '14px', fontWeight: 700, color: '#f8fafc', fontFamily: 'monospace' }}>5 OBSERVATIONS</div>
          <div style={{ fontSize: '10px', color: 'var(--color-text-secondary)' }}>Sentinel-2A/B L2A</div>
        </div>

        <div style={{ background: 'var(--color-surface-base)', border: '1px solid var(--color-border-standard)', borderRadius: '3px', padding: '6px 10px' }}>
          <div style={{ fontSize: '9px', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>TIME SPAN</div>
          <div style={{ fontSize: '14px', fontWeight: 700, color: '#e2e8f0', fontFamily: 'monospace' }}>129 DAYS</div>
          <div style={{ fontSize: '10px', color: 'var(--color-text-secondary)' }}>15 May – 21 Sep 2025</div>
        </div>

        <div style={{ background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.35)', borderRadius: '3px', padding: '6px 10px' }}>
          <div style={{ fontSize: '9px', fontWeight: 700, color: '#fbbf24', textTransform: 'uppercase' }}>EARLIEST SUPPORTED</div>
          <div style={{ fontSize: '14px', fontWeight: 700, color: '#fbbf24', fontFamily: 'monospace' }}>18 JUN 2025</div>
          <div style={{ fontSize: '10px', color: '#fde68a' }}>+3.65 km² onset (+32.6%)</div>
        </div>

        <div style={{ background: 'var(--color-surface-base)', border: '1px solid var(--color-border-standard)', borderRadius: '3px', padding: '6px 10px' }}>
          <div style={{ fontSize: '9px', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>PEAK RESPONSE</div>
          <div style={{ fontSize: '14px', fontWeight: 700, color: '#38bdf8', fontFamily: 'monospace' }}>21 SEP 2025</div>
          <div style={{ fontSize: '10px', color: 'var(--color-text-secondary)' }}>Crest capacity reached</div>
        </div>

        <div style={{ background: 'var(--color-surface-base)', border: '1px solid var(--color-border-standard)', borderRadius: '3px', padding: '6px 10px' }}>
          <div style={{ fontSize: '9px', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>T1 BASELINE</div>
          <div style={{ fontSize: '14px', fontWeight: 700, color: '#94a3b8', fontFamily: 'monospace' }}>11.20 km²</div>
          <div style={{ fontSize: '10px', color: 'var(--color-text-secondary)' }}>Pre-monsoon storage</div>
        </div>

        <div style={{ background: 'var(--color-surface-base)', border: '1px solid var(--color-border-standard)', borderRadius: '3px', padding: '6px 10px' }}>
          <div style={{ fontSize: '9px', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>T2 PEAK</div>
          <div style={{ fontSize: '14px', fontWeight: 700, color: '#38bdf8', fontFamily: 'monospace' }}>28.45 km²</div>
          <div style={{ fontSize: '10px', color: 'var(--color-text-secondary)' }}>Post-monsoon water</div>
        </div>

        <div style={{ background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.35)', borderRadius: '3px', padding: '6px 10px' }}>
          <div style={{ fontSize: '9px', fontWeight: 700, color: '#34d399', textTransform: 'uppercase' }}>TOTAL WATER CHANGE</div>
          <div style={{ fontSize: '14px', fontWeight: 700, color: '#34d399', fontFamily: 'monospace' }}>+154.0%</div>
          <div style={{ fontSize: '10px', color: '#a7f3d0' }}>+17.25 km² absolute delta</div>
        </div>
      </div>

      {/* 3. MAIN TEMPORAL TIMELINE (Prominent Horizontal Element) */}
      <div style={{
        padding: '14px 18px',
        background: 'var(--color-surface-subtle)',
        borderBottom: '1px solid var(--color-border-standard)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Clock size={13} style={{ color: '#38bdf8' }} />
            <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#e2e8f0' }}>
              CHRONOLOGICAL EARTH OBSERVATION TIMELINE
            </span>
            <span style={{ fontSize: '10px', color: 'var(--color-text-muted)' }}>
              (Click an observation node to inspect state or compare)
            </span>
          </div>
          <span style={{ fontSize: '10px', fontFamily: 'monospace', color: '#94a3b8' }}>
            ACTIVE SELECTION: <strong style={{ color: '#38bdf8' }}>{selectedObs.date}</strong>
          </span>
        </div>

        {/* Timeline Grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)',
          gap: '10px',
          position: 'relative',
        }}>
          {observations.map((obs, idx) => {
            const isSelected = obs.id === selectedObsId;
            const isEarliest = obs.isEarliestSupported;
            const isQualityReview = obs.qualityStatus === 'REVIEW';

            let borderColor = 'var(--color-border-standard)';
            let bgColor = 'var(--color-surface-base)';
            if (isSelected) {
              borderColor = '#0284c7';
              bgColor = 'rgba(2, 132, 199, 0.12)';
            } else if (isEarliest) {
              borderColor = 'rgba(245, 158, 11, 0.6)';
              bgColor = 'rgba(245, 158, 11, 0.05)';
            }

            return (
              <div
                key={obs.id}
                onClick={() => setSelectedObsId(obs.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setSelectedObsId(obs.id);
                  }
                }}
                style={{
                  border: `1px solid ${borderColor}`,
                  background: bgColor,
                  borderRadius: '4px',
                  padding: '10px',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  position: 'relative',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '5px',
                  boxShadow: isSelected ? '0 0 0 1px #0284c7, 0 4px 12px rgba(2, 132, 199, 0.2)' : 'none',
                }}
              >
                {/* Node Top: Sequence # & Date */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '9px', fontFamily: 'monospace', fontWeight: 700, color: 'var(--color-text-muted)' }}>
                    0{idx + 1}
                  </span>
                  <span style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    fontFamily: 'monospace',
                    color: isEarliest ? '#fbbf24' : isSelected ? '#38bdf8' : '#f8fafc',
                  }}>
                    {obs.date}
                  </span>
                </div>

                {/* State Label */}
                <div style={{
                  fontSize: '9px',
                  fontWeight: 700,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  color: isEarliest ? '#fbbf24' : '#cbd5e1',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}>
                  {obs.stateLabel}
                </div>

                {/* Evidence Role Badge */}
                <div>
                  {isEarliest ? (
                    <span style={{
                      background: 'rgba(245, 158, 11, 0.2)',
                      color: '#fbbf24',
                      border: '1px solid rgba(245, 158, 11, 0.5)',
                      padding: '1px 5px',
                      borderRadius: '2px',
                      fontSize: '8.5px',
                      fontWeight: 700,
                      display: 'inline-block',
                    }}>
                      ★ EARLIEST SUPPORTED
                    </span>
                  ) : obs.isPeakResponse ? (
                    <span style={{
                      background: 'rgba(56, 189, 248, 0.15)',
                      color: '#38bdf8',
                      border: '1px solid rgba(56, 189, 248, 0.3)',
                      padding: '1px 5px',
                      borderRadius: '2px',
                      fontSize: '8.5px',
                      fontWeight: 600,
                      display: 'inline-block',
                    }}>
                      PEAK RESPONSE
                    </span>
                  ) : obs.isBaseline ? (
                    <span style={{
                      background: 'rgba(148, 163, 184, 0.15)',
                      color: '#cbd5e1',
                      border: '1px solid rgba(148, 163, 184, 0.3)',
                      padding: '1px 5px',
                      borderRadius: '2px',
                      fontSize: '8.5px',
                      fontWeight: 600,
                      display: 'inline-block',
                    }}>
                      BASELINE
                    </span>
                  ) : (
                    <span style={{
                      background: 'rgba(100, 116, 139, 0.15)',
                      color: '#94a3b8',
                      border: '1px solid rgba(100, 116, 139, 0.3)',
                      padding: '1px 5px',
                      borderRadius: '2px',
                      fontSize: '8.5px',
                      display: 'inline-block',
                    }}>
                      {obs.evidenceRoleLabel}
                    </span>
                  )}
                </div>

                {/* Metrics */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '4px',
                  fontSize: '10px',
                  fontFamily: 'monospace',
                  marginTop: '2px',
                  background: 'rgba(15, 23, 42, 0.5)',
                  padding: '4px 6px',
                  borderRadius: '3px',
                }}>
                  <div>
                    <span style={{ color: 'var(--color-text-muted)', fontSize: '9px' }}>WATER:</span>{' '}
                    <strong style={{ color: '#e2e8f0' }}>{obs.waterExtentSqKm} km²</strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--color-text-muted)', fontSize: '9px' }}>NDWI:</span>{' '}
                    <span style={{ color: '#38bdf8' }}>{obs.ndwi}</span>
                  </div>
                </div>

                {/* Scene & Quality */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '9px', color: 'var(--color-text-muted)', marginTop: '2px' }}>
                  <span style={{ fontFamily: 'monospace' }}>Cloud: {obs.cloudCoverPercent}%</span>
                  {isQualityReview ? (
                    <span style={{ color: '#fbbf24', display: 'flex', alignItems: 'center', gap: '2px', fontWeight: 600 }}>
                      <AlertTriangle size={10} /> REVIEW
                    </span>
                  ) : (
                    <span style={{ color: '#34d399', display: 'flex', alignItems: 'center', gap: '2px', fontWeight: 600 }}>
                      <CheckCircle2 size={10} /> PASS
                    </span>
                  )}
                </div>

                {/* Active Indicator Pin */}
                {isSelected && (
                  <div style={{
                    position: 'absolute',
                    bottom: '-6px',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    width: '12px',
                    height: '3px',
                    background: '#38bdf8',
                    borderRadius: '2px',
                  }} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 4. MAIN WORKSTATION SECTION: CHART & MULTI-METRIC (LEFT) + OBSERVATION GIS VIEWER (RIGHT) */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1.2fr 1fr',
        gap: '12px',
        padding: '16px 18px',
      }}>
        {/* LEFT COLUMN: TRAJECTORY CHART & MULTI-METRIC SERIES */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* A. WATER EXTENT TRAJECTORY CHART */}
          <div style={{
            background: 'var(--color-surface-subtle)',
            border: '1px solid var(--color-border-standard)',
            borderRadius: '4px',
            padding: '14px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '13px', fontWeight: 700, letterSpacing: '0.04em', color: '#f8fafc' }}>
                  WATER EXTENT TRAJECTORY
                </h3>
                <span style={{ fontSize: '10px', color: 'var(--color-text-muted)' }}>
                  Chronological progression of reservoir inundation surface (km²)
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '10px' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#fbbf24' }}>
                  <span style={{ width: '8px', height: '8px', background: '#fbbf24', borderRadius: '50%' }} />
                  18 JUN: ONSET (+32.6%)
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#38bdf8' }}>
                  <span style={{ width: '8px', height: '8px', background: '#38bdf8', borderRadius: '50%' }} />
                  21 SEP: PEAK (+154.0%)
                </span>
              </div>
            </div>

            {/* SVG Trajectory Chart */}
            <div style={{ width: '100%', overflowX: 'auto', background: 'rgba(15, 23, 42, 0.8)', borderRadius: '4px', border: '1px solid var(--color-chrome-border)' }}>
              <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
                <defs>
                  <linearGradient id="waterTrajectoryGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stopColor="#0284c7" stopOpacity="0.45" />
                    <stop offset="100%" stopColor="#0284c7" stopOpacity="0.03" />
                  </linearGradient>
                </defs>

                {/* Horizontal Gridlines */}
                {[10, 15, 20, 25, 30].map((val) => {
                  const y = getYCoord(val);
                  return (
                    <g key={val}>
                      <line
                        x1={chartPadLeft}
                        y1={y}
                        x2={chartWidth - chartPadRight}
                        y2={y}
                        stroke="rgba(148, 163, 184, 0.15)"
                        strokeDasharray="3 3"
                        strokeWidth="1"
                      />
                      <text
                        x={chartPadLeft - 8}
                        y={y + 3}
                        fill="#64748b"
                        fontSize="9"
                        textAnchor="end"
                        fontFamily="monospace"
                      >
                        {val}
                      </text>
                    </g>
                  );
                })}

                {/* Y Axis Label */}
                <text
                  x="12"
                  y={chartPadTop + usableHeight / 2}
                  fill="#94a3b8"
                  fontSize="8.5"
                  fontWeight="600"
                  textAnchor="middle"
                  transform={`rotate(-90, 12, ${chartPadTop + usableHeight / 2})`}
                  fontFamily="monospace"
                >
                  WATER EXTENT (km²)
                </text>

                {/* Area Gradient Fill */}
                <path d={chartAreaD} fill="url(#waterTrajectoryGrad)" />

                {/* Trajectory Curve Line */}
                <path d={chartPathD} fill="none" stroke="#0284c7" strokeWidth="2.5" strokeLinecap="round" />

                {/* Baseline Dashed Reference Line (11.20 km²) */}
                <line
                  x1={chartPadLeft}
                  y1={getYCoord(11.20)}
                  x2={chartWidth - chartPadRight}
                  y2={getYCoord(11.20)}
                  stroke="#64748b"
                  strokeWidth="1"
                  strokeDasharray="4 2"
                />

                {/* Data Points */}
                {chartPoints.map((pt) => {
                  const isSelected = pt.obs.id === selectedObsId;
                  const isEarliest = pt.obs.isEarliestSupported;
                  const isPeak = pt.obs.isPeakResponse;

                  let pointFill = '#0284c7';
                  if (isEarliest) pointFill = '#fbbf24';
                  if (isPeak) pointFill = '#38bdf8';

                  return (
                    <g
                      key={pt.obs.id}
                      onClick={() => setSelectedObsId(pt.obs.id)}
                      style={{ cursor: 'pointer' }}
                    >
                      {/* X Grid Tick */}
                      <line
                        x1={pt.x}
                        y1={chartPadTop + usableHeight}
                        x2={pt.x}
                        y2={chartPadTop + usableHeight + 5}
                        stroke="#64748b"
                        strokeWidth="1"
                      />
                      {/* X Label */}
                      <text
                        x={pt.x}
                        y={chartPadTop + usableHeight + 16}
                        fill={isSelected ? '#38bdf8' : '#94a3b8'}
                        fontSize="9"
                        fontWeight={isSelected ? 700 : 500}
                        textAnchor="middle"
                        fontFamily="monospace"
                      >
                        {pt.obs.date.replace(' 2025', '')}
                      </text>

                      {/* Halo ring for selected */}
                      {isSelected && (
                        <circle
                          cx={pt.x}
                          cy={pt.y}
                          r="9"
                          fill="none"
                          stroke="#38bdf8"
                          strokeWidth="1.5"
                          opacity="0.8"
                        />
                      )}

                      {/* Point Circle */}
                      <circle
                        cx={pt.x}
                        cy={pt.y}
                        r={isSelected ? '5.5' : isEarliest || isPeak ? '5' : '4'}
                        fill={pointFill}
                        stroke="#0f172a"
                        strokeWidth="1.5"
                      />

                      {/* Value Label above point */}
                      <text
                        x={pt.x}
                        y={pt.y - 8}
                        fill={isEarliest ? '#fbbf24' : isPeak ? '#38bdf8' : '#f8fafc'}
                        fontSize="9"
                        fontWeight="700"
                        textAnchor="middle"
                        fontFamily="monospace"
                      >
                        {pt.obs.waterExtentSqKm} km²
                      </text>

                      {/* Special Callout Badges */}
                      {isEarliest && (
                        <g transform={`translate(${pt.x - 38}, ${pt.y - 28})`}>
                          <rect width="76" height="14" rx="2" fill="#78350f" stroke="#fbbf24" strokeWidth="0.8" />
                          <text x="38" y="10" fill="#fbbf24" fontSize="7.5" fontWeight="700" textAnchor="middle" fontFamily="monospace">
                            18 JUN — ONSET
                          </text>
                        </g>
                      )}

                      {isPeak && (
                        <g transform={`translate(${pt.x - 34}, ${pt.y - 28})`}>
                          <rect width="68" height="14" rx="2" fill="#0c4a6e" stroke="#38bdf8" strokeWidth="0.8" />
                          <text x="34" y="10" fill="#38bdf8" fontSize="7.5" fontWeight="700" textAnchor="middle" fontFamily="monospace">
                            21 SEP — PEAK
                          </text>
                        </g>
                      )}
                    </g>
                  );
                })}
              </svg>
            </div>
          </div>

          {/* B. MULTI-METRIC TEMPORAL ANALYSIS TABS */}
          <div style={{
            background: 'var(--color-surface-subtle)',
            border: '1px solid var(--color-border-standard)',
            borderRadius: '4px',
            padding: '12px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Activity size={13} style={{ color: '#38bdf8' }} />
                <h3 style={{ margin: 0, fontSize: '12px', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#f8fafc' }}>
                  MULTI-METRIC TEMPORAL TRAJECTORY
                </h3>
              </div>
              <span style={{ fontSize: '9px', fontFamily: 'monospace', color: '#94a3b8' }}>
                {currentMetricSeries.disclaimer}
              </span>
            </div>

            {/* Metric Selector Tabs */}
            <div style={{ display: 'flex', gap: '4px', marginBottom: '10px' }}>
              {[
                { id: 'water', label: 'WATER' },
                { id: 'vegetation', label: 'VEGETATION (NDVI)' },
                { id: 'bare-ground', label: 'BARE GROUND' },
                { id: 'built-up', label: 'BUILT-UP' },
              ].map((tab) => {
                const isActive = activeMetricTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveMetricTab(tab.id as any)}
                    className="btn btn-sm"
                    style={{
                      background: isActive ? 'var(--color-chrome-bg)' : 'transparent',
                      color: isActive ? '#38bdf8' : 'var(--color-text-secondary)',
                      borderColor: isActive ? 'var(--color-chrome-border)' : 'var(--color-border-subtle)',
                      fontWeight: isActive ? 700 : 500,
                      fontSize: '10px',
                      padding: '4px 8px',
                    }}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {/* Tab Description */}
            <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)', marginBottom: '8px' }}>
              {currentMetricSeries.description}
            </div>

            {/* Trajectory Table */}
            <div style={{ overflowX: 'auto' }}>
              <table style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: '11px',
                fontFamily: 'monospace',
              }}>
                <thead>
                  <tr style={{ background: 'var(--color-chrome-bg)', borderBottom: '1px solid var(--color-border-standard)' }}>
                    <th style={{ padding: '6px 8px', textAlign: 'left', color: 'var(--color-text-muted)' }}>OBSERVATION</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--color-text-muted)' }}>
                      {currentMetricSeries.title.toUpperCase()}
                    </th>
                    {activeMetricTab === 'water' && (
                      <th style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--color-text-muted)' }}>NDWI INDEX</th>
                    )}
                    <th style={{ padding: '6px 8px', textAlign: 'left', color: 'var(--color-text-muted)' }}>EVIDENCE STATUS</th>
                  </tr>
                </thead>
                <tbody>
                  {currentMetricSeries.points.map((pt, idx) => {
                    const isSelected = observations[idx]?.id === selectedObsId;
                    return (
                      <tr
                        key={pt.date}
                        onClick={() => setSelectedObsId(observations[idx].id)}
                        style={{
                          borderBottom: '1px solid var(--color-border-subtle)',
                          background: isSelected ? 'rgba(2, 132, 199, 0.12)' : idx % 2 === 0 ? 'transparent' : 'rgba(255, 255, 255, 0.02)',
                          cursor: 'pointer',
                        }}
                      >
                        <td style={{ padding: '6px 8px', fontWeight: isSelected ? 700 : 500, color: isSelected ? '#38bdf8' : '#f8fafc' }}>
                          {pt.label}
                        </td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700, color: pt.isEarliest ? '#fbbf24' : pt.isPeak ? '#38bdf8' : '#e2e8f0' }}>
                          {pt.formattedValue}
                        </td>
                        {activeMetricTab === 'water' && (
                          <td style={{ padding: '6px 8px', textAlign: 'right', color: '#93c5fd' }}>
                            {pt.secondaryValue}
                          </td>
                        )}
                        <td style={{ padding: '6px 8px' }}>
                          {pt.isEarliest ? (
                            <span style={{ color: '#fbbf24', fontWeight: 700, fontSize: '10px' }}>★ Onset Milestone</span>
                          ) : pt.isPeak ? (
                            <span style={{ color: '#38bdf8', fontWeight: 700, fontSize: '10px' }}>Peak Crest</span>
                          ) : idx === 0 ? (
                            <span style={{ color: '#94a3b8', fontSize: '10px' }}>Pre-Monsoon Nadir</span>
                          ) : (
                            <span style={{ color: '#cbd5e1', fontSize: '10px' }}>Intermediate Inflow</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Built-up gradual observation remark */}
            {activeMetricTab === 'built-up' && (
              <div style={{
                marginTop: '8px',
                padding: '6px 10px',
                background: 'rgba(56, 189, 248, 0.08)',
                border: '1px solid rgba(56, 189, 248, 0.25)',
                borderRadius: '3px',
                fontSize: '10px',
                color: '#bae6fd',
              }}>
                ℹ <strong>Observation Context:</strong> The built-up trajectory (38.40 → 39.12 km²) demonstrates that urban infrastructure expansion in the western fringe proceeds gradually across the season, contrasting with the acute hydrologic surges observed in reservoir storage.
              </div>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: SELECTED OBSERVATION GIS VIEWER & METADATA */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* GIS Satellite Cartographic Viewer */}
          <div style={{
            background: 'var(--color-surface-subtle)',
            border: '1px solid var(--color-border-standard)',
            borderRadius: '4px',
            padding: '12px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Compass size={13} style={{ color: '#38bdf8' }} />
                <h3 style={{ margin: 0, fontSize: '12px', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#f8fafc' }}>
                  OBSERVATION GIS FOOTPRINT
                </h3>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <button
                  onClick={() => setShowGridInViewer(!showGridInViewer)}
                  className="btn btn-sm"
                  style={{
                    fontSize: '9px',
                    padding: '2px 6px',
                    color: showGridInViewer ? '#38bdf8' : 'var(--color-text-muted)',
                  }}
                >
                  GRID: {showGridInViewer ? 'ON' : 'OFF'}
                </button>
                <span style={{
                  background: 'rgba(2, 132, 199, 0.2)',
                  color: '#38bdf8',
                  padding: '2px 6px',
                  borderRadius: '3px',
                  fontSize: '9px',
                  fontFamily: 'monospace',
                  fontWeight: 700,
                }}>
                  {selectedObs.date}
                </span>
              </div>
            </div>

            {/* Stylized SVG Map of Pune Catchment Footprint */}
            <div style={{
              width: '100%',
              height: '240px',
              background: '#131b26',
              borderRadius: '4px',
              border: '1px solid var(--color-chrome-border)',
              position: 'relative',
              overflow: 'hidden',
            }}>
              <svg viewBox="0 0 500 320" style={{ width: '100%', height: '100%', display: 'block' }}>
                <defs>
                  {/* Water Gradient */}
                  <linearGradient id="mapWaterGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#0369a1" />
                    <stop offset="100%" stopColor="#0284c7" />
                  </linearGradient>

                  {/* Sahyadri Ridge Shading */}
                  <linearGradient id="mapRidgeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#1e293b" />
                    <stop offset="50%" stopColor="#334155" />
                    <stop offset="100%" stopColor="#1e293b" />
                  </linearGradient>

                  {/* Cropland Pattern */}
                  <pattern id="cropPat" width="16" height="16" patternUnits="userSpaceOnUse">
                    <line x1="0" y1="0" x2="16" y2="16" stroke="#2e3b2e" strokeWidth="0.8" />
                    <line x1="16" y1="0" x2="0" y2="16" stroke="#2e3b2e" strokeWidth="0.8" />
                  </pattern>
                </defs>

                {/* Base terrain */}
                <rect width="500" height="320" fill="#1e293b" />

                {/* Western Ghats Ridges */}
                <path d="M 0,60 Q 120,20 240,70 T 480,40 L 500,0 L 0,0 Z" fill="url(#mapRidgeGrad)" opacity="0.9" />
                <path d="M 0,320 Q 150,240 280,270 T 500,250 L 500,320 Z" fill="url(#mapRidgeGrad)" opacity="0.85" />

                {/* Cropland Mosaic */}
                <polygon points="60,90 280,80 320,240 120,260" fill="url(#cropPat)" opacity="0.8" />
                <polygon points="310,130 480,110 490,240 330,250" fill="url(#cropPat)" opacity="0.6" />

                {/* Urban Area (Pune / Pimpri Fringe) */}
                <polygon points="90,170 140,165 150,205 100,210" fill="#475569" stroke="#64748b" strokeWidth="0.5" />
                <polygon points="160,180 200,175 210,215 170,220" fill="#475569" stroke="#64748b" strokeWidth="0.5" />

                {/* Mutha River Channel */}
                <path
                  d="M 10,20 C 80,45 130,105 180,135 S 250,170 300,180 S 410,210 490,260"
                  fill="none"
                  stroke="#0284c7"
                  strokeWidth="14"
                  strokeLinecap="round"
                  opacity="0.8"
                />

                {/* Khadakwasla Reservoir Body - Dynamically Scales with Water Extent */}
                {/* Baseline reference outline */}
                <path
                  d="M 240,140 C 260,120 310,115 345,130 C 380,145 405,170 395,215 C 380,255 330,260 285,245 C 255,235 230,190 240,140 Z"
                  fill="none"
                  stroke="#64748b"
                  strokeWidth="1"
                  strokeDasharray="3 2"
                />

                {/* Scaled Reservoir Surface for Selected Observation */}
                <g transform={`translate(315, 185) scale(${reservoirScaleFactor}) translate(-315, -185)`}>
                  <path
                    d="M 240,140 C 260,120 310,115 345,130 C 380,145 405,170 395,215 C 380,255 330,260 285,245 C 255,235 230,190 240,140 Z"
                    fill="url(#mapWaterGrad)"
                    stroke="#38bdf8"
                    strokeWidth="2"
                    opacity="0.95"
                  />
                  {/* Subtle water ripple */}
                  <path
                    d="M 270,165 Q 310,155 350,170"
                    fill="none"
                    stroke="rgba(255, 255, 255, 0.4)"
                    strokeWidth="1"
                  />
                </g>

                {/* Coordinate Grid & Ticks */}
                {showGridInViewer && (
                  <g stroke="rgba(148, 163, 184, 0.2)" strokeWidth="0.5">
                    <line x1="125" y1="0" x2="125" y2="320" strokeDasharray="3 3" />
                    <line x1="250" y1="0" x2="250" y2="320" strokeDasharray="3 3" />
                    <line x1="375" y1="0" x2="375" y2="320" strokeDasharray="3 3" />
                    <line x1="0" y1="80" x2="500" y2="80" strokeDasharray="3 3" />
                    <line x1="0" y1="160" x2="500" y2="160" strokeDasharray="3 3" />
                    <line x1="0" y1="240" x2="500" y2="240" strokeDasharray="3 3" />

                    <text x="130" y="14" fill="#64748b" fontSize="7.5" fontFamily="monospace">73°45'E</text>
                    <text x="255" y="14" fill="#64748b" fontSize="7.5" fontFamily="monospace">73°51'E</text>
                    <text x="380" y="14" fill="#64748b" fontSize="7.5" fontFamily="monospace">73°58'E</text>
                    <text x="4" y="86" fill="#64748b" fontSize="7.5" fontFamily="monospace">18°35'N</text>
                    <text x="4" y="166" fill="#64748b" fontSize="7.5" fontFamily="monospace">18°31'N</text>
                    <text x="4" y="246" fill="#64748b" fontSize="7.5" fontFamily="monospace">18°25'N</text>
                  </g>
                )}

                {/* AOI Bounding Outline */}
                <rect
                  x="20"
                  y="20"
                  width="460"
                  height="280"
                  fill="none"
                  stroke="#38bdf8"
                  strokeWidth="1"
                  strokeDasharray="6 3"
                  opacity="0.6"
                />

                {/* Cartographic Labels */}
                <text x="315" y="195" fill="#f8fafc" fontSize="9" fontWeight="700" textAnchor="middle" fontFamily="sans-serif">
                  Khadakwasla Reservoir
                </text>
                <text x="315" y="208" fill="#bae6fd" fontSize="8" textAnchor="middle" fontFamily="monospace">
                  Extent: {selectedObs.waterExtentSqKm} km²
                </text>
                <text x="120" y="190" fill="#94a3b8" fontSize="7.5" textAnchor="middle" fontFamily="sans-serif">
                  Pune Fringe
                </text>
                <text x="430" y="245" fill="#60a5fa" fontSize="7.5" textAnchor="middle" fontFamily="sans-serif">
                  Mutha River
                </text>
              </svg>

              {/* In-Map Telemetry Overlay */}
              <div style={{
                position: 'absolute',
                top: '8px',
                left: '8px',
                background: 'rgba(15, 23, 42, 0.85)',
                border: '1px solid var(--color-chrome-border)',
                borderRadius: '3px',
                padding: '4px 8px',
                fontSize: '9px',
                fontFamily: 'monospace',
                display: 'flex',
                flexDirection: 'column',
                gap: '2px',
              }}>
                <div>STATE: <strong style={{ color: '#38bdf8' }}>{selectedObs.stateLabel}</strong></div>
                <div>WATER EXTENT: <strong style={{ color: '#f8fafc' }}>{selectedObs.waterExtentSqKm} km²</strong></div>
                <div>CLOUD COVER: <span style={{ color: selectedObs.cloudCoverPercent > 15 ? '#fbbf24' : '#34d399' }}>{selectedObs.cloudCoverPercent}%</span></div>
              </div>

              {/* Water Expansion Badge */}
              <div style={{
                position: 'absolute',
                bottom: '8px',
                right: '8px',
                background: 'rgba(15, 23, 42, 0.85)',
                border: '1px solid var(--color-chrome-border)',
                borderRadius: '3px',
                padding: '4px 8px',
                fontSize: '9px',
                fontFamily: 'monospace',
                color: '#38bdf8',
              }}>
                BASELINE DELTA: <strong>+{baselineComparison.deltaSqKm} km² ({baselineComparison.relativeChangePercent > 0 ? `+${baselineComparison.relativeChangePercent}%` : '0%'})</strong>
              </div>
            </div>

            {/* Selected Scene Telemetry Details */}
            <div style={{
              background: 'var(--color-surface-base)',
              border: '1px solid var(--color-border-standard)',
              borderRadius: '4px',
              padding: '10px',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '11px', fontWeight: 700, color: '#f8fafc' }}>
                  OBSERVATION SCENE TELEMETRY
                </span>
                <button
                  onClick={() => setShowMetadataModal(true)}
                  className="btn btn-sm"
                  style={{ fontSize: '10px', padding: '2px 8px', display: 'flex', alignItems: 'center', gap: '4px' }}
                >
                  <Maximize2 size={10} />
                  VIEW FULL METADATA
                </button>
              </div>

              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: '6px',
                fontSize: '10px',
                fontFamily: 'monospace',
              }}>
                <div>
                  <span style={{ color: 'var(--color-text-muted)' }}>SCENE ID:</span>
                  <div style={{
                    color: '#e2e8f0',
                    fontSize: '9.5px',
                    wordBreak: 'break-all',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}>
                    {selectedObs.shortSceneId}
                    <button
                      onClick={() => handleCopySceneId(selectedObs.sceneId)}
                      style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 0 }}
                      title="Copy full scene ID"
                    >
                      {copiedSceneId ? <Check size={10} style={{ color: '#34d399' }} /> : <Copy size={10} />}
                    </button>
                  </div>
                </div>

                <div>
                  <span style={{ color: 'var(--color-text-muted)' }}>SATELLITE / SENSOR:</span>
                  <div style={{ color: '#e2e8f0' }}>{selectedObs.satellite} ({selectedObs.sensor})</div>
                </div>

                <div>
                  <span style={{ color: 'var(--color-text-muted)' }}>ACQUISITION UTC:</span>
                  <div style={{ color: '#e2e8f0' }}>{selectedObs.acquisitionTimestamp}</div>
                </div>

                <div>
                  <span style={{ color: 'var(--color-text-muted)' }}>EVIDENCE ROLE:</span>
                  <div style={{ color: '#38bdf8' }}>{selectedObs.evidenceRoleLabel}</div>
                </div>

                <div>
                  <span style={{ color: 'var(--color-text-muted)' }}>QUALITY STATE:</span>
                  <div style={{ color: selectedObs.qualityStatus === 'PASS' ? '#34d399' : '#fbbf24', fontWeight: 600 }}>
                    {selectedObs.qualityStatus} ({selectedObs.qualityNote || 'Screened nominal'})
                  </div>
                </div>

                <div>
                  <span style={{ color: 'var(--color-text-muted)' }}>TEMPORAL CONFIDENCE:</span>
                  <div style={{ color: selectedObs.confidenceState.includes('FLAG') ? '#fbbf24' : '#34d399', fontWeight: 600 }}>
                    {selectedObs.confidenceState}
                  </div>
                </div>
              </div>

              {/* State Narrative */}
              <div style={{
                marginTop: '4px',
                padding: '6px 8px',
                background: 'rgba(15, 23, 42, 0.5)',
                border: '1px solid var(--color-chrome-border)',
                borderRadius: '3px',
                fontSize: '10px',
                color: 'var(--color-text-secondary)',
              }}>
                <strong>Observation Assessment:</strong> {selectedObs.stateDescription}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 5. EARLIEST SUPPORTED OBSERVATION PANEL (CRITICAL HIGHLIGHT) */}
      <div style={{ padding: '0 18px 16px 18px' }}>
        <div style={{
          background: 'rgba(245, 158, 11, 0.05)',
          border: '1px solid rgba(245, 158, 11, 0.4)',
          borderRadius: '4px',
          padding: '12px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{
                background: 'rgba(245, 158, 11, 0.25)',
                color: '#fbbf24',
                border: '1px solid #fbbf24',
                padding: '2px 8px',
                borderRadius: '3px',
                fontSize: '10px',
                fontWeight: 700,
                letterSpacing: '0.04em',
              }}>
                PRIMARY EVIDENCE MILESTONE
              </span>
              <h3 style={{ margin: 0, fontSize: '13px', fontWeight: 700, letterSpacing: '0.04em', color: '#fbbf24' }}>
                EARLIEST SUPPORTED CHANGE — 18 JUN 2025
              </h3>
            </div>
            <span style={{ fontSize: '10px', fontFamily: 'monospace', color: '#fde68a' }}>
              EVIDENCE STATE: <strong style={{ color: '#34d399' }}>{earliestRecord.evidenceState}</strong>
            </span>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
            gap: '8px',
            fontSize: '11px',
            fontFamily: 'monospace',
            background: 'rgba(15, 23, 42, 0.6)',
            padding: '8px 12px',
            borderRadius: '3px',
            border: '1px solid rgba(245, 158, 11, 0.2)',
          }}>
            <div>
              <span style={{ color: '#94a3b8', fontSize: '10px' }}>SCENE ID:</span>
              <div style={{ color: '#f8fafc', fontSize: '10px' }}>{earliestRecord.shortSceneId}</div>
            </div>
            <div>
              <span style={{ color: '#94a3b8', fontSize: '10px' }}>BASELINE DELTA:</span>
              <div style={{ color: '#fbbf24', fontWeight: 700 }}>
                {earliestRecord.baselineValue} → {earliestRecord.observedValue} ({earliestRecord.difference})
              </div>
            </div>
            <div>
              <span style={{ color: '#94a3b8', fontSize: '10px' }}>GROWTH RATE:</span>
              <div style={{ color: '#34d399', fontWeight: 700 }}>{earliestRecord.percentageChange}</div>
            </div>
            <div>
              <span style={{ color: '#94a3b8', fontSize: '10px' }}>NDWI RESPONSE:</span>
              <div style={{ color: '#38bdf8' }}>{earliestRecord.baselineNdwi} → {earliestRecord.observedNdwi}</div>
            </div>
            <div>
              <span style={{ color: '#94a3b8', fontSize: '10px' }}>CLOUD SCREEN:</span>
              <div style={{ color: '#34d399' }}>{earliestRecord.cloudCoverPercent}% (PASS)</div>
            </div>
          </div>

          <p style={{ margin: 0, fontSize: '11px', color: '#fde68a', lineHeight: 1.5 }}>
            <strong>Analyst Explanation:</strong> {earliestRecord.explanation}
          </p>
        </div>
      </div>

      {/* 6. LOWER ANALYTICAL SECTIONS: EVOLUTION PHASES, INTERVAL RATES, QUALITY OVER TIME & CONFIDENCE */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '14px',
        padding: '0 18px 24px 18px',
      }}>
        {/* A. CHANGE EVOLUTION (4 PHASES) */}
        <div style={{
          background: 'var(--color-surface-subtle)',
          border: '1px solid var(--color-border-standard)',
          borderRadius: '4px',
          padding: '12px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h3 style={{ margin: 0, fontSize: '12px', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#f8fafc' }}>
              CHANGE EVOLUTION
            </h3>
            <span style={{ fontSize: '9px', fontFamily: 'monospace', color: 'var(--color-text-muted)' }}>
              4 TEMPORAL PHASES
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {evolutionPhases.map((phase) => (
              <div
                key={phase.phaseNumber}
                style={{
                  border: '1px solid var(--color-border-subtle)',
                  borderRadius: '3px',
                  background: 'var(--color-surface-base)',
                  padding: '8px 10px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '3px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '9px', fontFamily: 'monospace', color: 'var(--color-text-muted)' }}>
                      {phase.phaseNumber}
                    </span>
                    <strong style={{ fontSize: '11px', color: '#f8fafc' }}>{phase.name}</strong>
                    {phase.badge && (
                      <span style={{
                        background: 'rgba(245, 158, 11, 0.2)',
                        color: '#fbbf24',
                        border: '1px solid rgba(245, 158, 11, 0.4)',
                        fontSize: '8px',
                        fontWeight: 700,
                        padding: '1px 5px',
                        borderRadius: '2px',
                      }}>
                        {phase.badge}
                      </span>
                    )}
                  </div>
                  <span style={{ fontSize: '10px', fontFamily: 'monospace', color: '#38bdf8' }}>
                    {phase.dateRange}
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '10px', fontFamily: 'monospace' }}>
                  <span style={{ color: 'var(--color-text-muted)' }}>
                    STATE: <strong style={{ color: '#cbd5e1' }}>{phase.state}</strong>
                  </span>
                  <span style={{ color: '#e2e8f0', fontWeight: 600 }}>
                    WATER: {phase.waterExtent}
                  </span>
                </div>

                <p style={{ margin: '2px 0 0 0', fontSize: '10px', color: 'var(--color-text-secondary)', lineHeight: 1.4 }}>
                  {phase.description}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* B. RATE / INTERVAL ANALYSIS */}
        <div style={{
          background: 'var(--color-surface-subtle)',
          border: '1px solid var(--color-border-standard)',
          borderRadius: '4px',
          padding: '12px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h3 style={{ margin: 0, fontSize: '12px', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#f8fafc' }}>
              INTER-OBSERVATION CHANGE
            </h3>
            <span style={{
              fontSize: '9px',
              fontFamily: 'monospace',
              color: '#38bdf8',
              background: 'rgba(56, 189, 248, 0.1)',
              padding: '1px 6px',
              borderRadius: '2px',
            }}>
              LOCAL MOCK CALCULATION
            </span>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: '11px',
              fontFamily: 'monospace',
            }}>
              <thead>
                <tr style={{ background: 'var(--color-chrome-bg)', borderBottom: '1px solid var(--color-border-standard)' }}>
                  <th style={{ padding: '6px 8px', textAlign: 'left', color: 'var(--color-text-muted)' }}>INTERVAL</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--color-text-muted)' }}>DELTA (km²)</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--color-text-muted)' }}>CHANGE (%)</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--color-text-muted)' }}>SPAN</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--color-text-muted)' }}>DAILY RATE</th>
                </tr>
              </thead>
              <tbody>
                {intervalChanges.map((change, idx) => (
                  <tr
                    key={change.label}
                    style={{
                      borderBottom: '1px solid var(--color-border-subtle)',
                      background: idx % 2 === 0 ? 'transparent' : 'rgba(255, 255, 255, 0.02)',
                    }}
                  >
                    <td style={{ padding: '6px 8px', fontWeight: 600, color: '#f8fafc' }}>
                      {change.label}
                    </td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', color: '#38bdf8', fontWeight: 700 }}>
                      +{change.deltaSqKm} km²
                    </td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', color: '#34d399', fontWeight: 700 }}>
                      +{change.percentageChange}%
                    </td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', color: '#cbd5e1' }}>
                      {change.daysInterval}d
                    </td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', color: '#94a3b8' }}>
                      +{change.rateSqKmPerDay} km²/d
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ fontSize: '10px', color: 'var(--color-text-muted)', lineHeight: 1.4 }}>
            * Rates represent observation-to-observation difference over elapsed interval. Not predictive hydrological simulations.
          </div>
        </div>

        {/* C. TEMPORAL OBSERVATION QUALITY */}
        <div style={{
          background: 'var(--color-surface-subtle)',
          border: '1px solid var(--color-border-standard)',
          borderRadius: '4px',
          padding: '12px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h3 style={{ margin: 0, fontSize: '12px', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#f8fafc' }}>
              TEMPORAL OBSERVATION QUALITY
            </h3>
            <span style={{
              fontSize: '9px',
              fontFamily: 'monospace',
              color: '#34d399',
              background: 'rgba(52, 211, 153, 0.1)',
              padding: '1px 6px',
              borderRadius: '2px',
            }}>
              LOCAL MOCK QUALITY RECORD
            </span>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: '11px',
              fontFamily: 'monospace',
            }}>
              <thead>
                <tr style={{ background: 'var(--color-chrome-bg)', borderBottom: '1px solid var(--color-border-standard)' }}>
                  <th style={{ padding: '6px 8px', textAlign: 'left', color: 'var(--color-text-muted)' }}>OBSERVATION</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--color-text-muted)' }}>CLOUD</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left', color: 'var(--color-text-muted)' }}>SCENE SENSOR</th>
                  <th style={{ padding: '6px 8px', textAlign: 'center', color: 'var(--color-text-muted)' }}>QUALITY</th>
                </tr>
              </thead>
              <tbody>
                {qualityRecords.map((q, idx) => (
                  <tr
                    key={q.observationId}
                    style={{
                      borderBottom: '1px solid var(--color-border-subtle)',
                      background: idx % 2 === 0 ? 'transparent' : 'rgba(255, 255, 255, 0.02)',
                    }}
                  >
                    <td style={{ padding: '6px 8px', fontWeight: 600, color: '#f8fafc' }}>
                      {q.date}
                    </td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', color: q.cloudPercent > 15 ? '#fbbf24' : '#94a3b8' }}>
                      {q.cloudPercent}%
                    </td>
                    <td style={{ padding: '6px 8px', color: '#cbd5e1' }}>
                      {q.satellite}
                    </td>
                    <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                      {q.quality === 'PASS' ? (
                        <span style={{
                          background: 'rgba(52, 211, 153, 0.15)',
                          color: '#34d399',
                          border: '1px solid rgba(52, 211, 153, 0.3)',
                          padding: '1px 6px',
                          borderRadius: '2px',
                          fontSize: '9px',
                          fontWeight: 700,
                        }}>
                          PASS
                        </span>
                      ) : (
                        <span style={{
                          background: 'rgba(245, 158, 11, 0.15)',
                          color: '#fbbf24',
                          border: '1px solid rgba(245, 158, 11, 0.3)',
                          padding: '1px 6px',
                          borderRadius: '2px',
                          fontSize: '9px',
                          fontWeight: 700,
                        }} title={q.details}>
                          REVIEW
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{
            padding: '6px 8px',
            background: 'rgba(245, 158, 11, 0.06)',
            border: '1px solid rgba(245, 158, 11, 0.25)',
            borderRadius: '3px',
            fontSize: '10px',
            color: '#fde68a',
          }}>
            <strong>23 JUL Audit Note:</strong> Higher cloud coverage (21.8%) — intermediate observation retained with quality flag. Demonstrates system discrimination rather than blind acceptance.
          </div>
        </div>

        {/* D. TEMPORAL CONFIDENCE PROGRESSION */}
        <div style={{
          background: 'var(--color-surface-subtle)',
          border: '1px solid var(--color-border-standard)',
          borderRadius: '4px',
          padding: '12px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h3 style={{ margin: 0, fontSize: '12px', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#f8fafc' }}>
              TEMPORAL CONFIDENCE
            </h3>
            <span style={{
              fontSize: '9px',
              fontFamily: 'monospace',
              color: '#38bdf8',
              background: 'rgba(56, 189, 248, 0.1)',
              padding: '1px 6px',
              borderRadius: '2px',
            }}>
              DEMO TEMPORAL CONFIDENCE
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            {observations.map((obs) => {
              const isFlagged = obs.confidenceState.includes('FLAG');
              const isBaseline = obs.confidenceState === 'BASELINE';

              return (
                <div
                  key={obs.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '6px 10px',
                    background: 'var(--color-surface-base)',
                    border: '1px solid var(--color-border-subtle)',
                    borderRadius: '3px',
                    fontSize: '11px',
                    fontFamily: 'monospace',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontWeight: 700, color: '#f8fafc' }}>{obs.date}</span>
                    <span style={{ color: 'var(--color-text-secondary)', fontSize: '10px' }}>{obs.stateLabel}</span>
                  </div>
                  <div>
                    {isFlagged ? (
                      <span style={{
                        background: 'rgba(245, 158, 11, 0.15)',
                        color: '#fbbf24',
                        border: '1px solid rgba(245, 158, 11, 0.3)',
                        padding: '1px 6px',
                        borderRadius: '2px',
                        fontSize: '9px',
                        fontWeight: 700,
                      }}>
                        MEDIUM / QUALITY FLAG
                      </span>
                    ) : isBaseline ? (
                      <span style={{
                        background: 'rgba(148, 163, 184, 0.15)',
                        color: '#cbd5e1',
                        border: '1px solid rgba(148, 163, 184, 0.3)',
                        padding: '1px 6px',
                        borderRadius: '2px',
                        fontSize: '9px',
                        fontWeight: 700,
                      }}>
                        BASELINE
                      </span>
                    ) : (
                      <span style={{
                        background: 'rgba(52, 211, 153, 0.15)',
                        color: '#34d399',
                        border: '1px solid rgba(52, 211, 153, 0.3)',
                        padding: '1px 6px',
                        borderRadius: '2px',
                        fontSize: '9px',
                        fontWeight: 700,
                      }}>
                        HIGH CONFIDENCE
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ fontSize: '10px', color: 'var(--color-text-muted)', lineHeight: 1.4 }}>
            Multi-temporal confidence scores combine spectral index consistency, radiometric calibration validity, and temporal separation.
          </div>
        </div>
      </div>

      {/* MODAL 1: BASELINE COMPARISON MODAL */}
      {showCompareModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.75)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
        }}>
          <div style={{
            background: 'var(--color-surface-subtle)',
            border: '1px solid var(--color-chrome-border)',
            borderRadius: '6px',
            width: '560px',
            maxWidth: '90vw',
            padding: '18px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--color-border-standard)', paddingBottom: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <GitCompare size={14} style={{ color: '#38bdf8' }} />
                <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: '#f8fafc' }}>
                  BASELINE COMPARISON SUMMARY
                </h3>
              </div>
              <button
                onClick={() => setShowCompareModal(false)}
                className="btn btn-sm"
                style={{ padding: '4px', background: 'transparent', border: 'none', color: '#94a3b8' }}
              >
                <X size={16} />
              </button>
            </div>

            <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>
              Comparing currently selected observation (<strong>{selectedObs.date}</strong>) against the pre-monsoon baseline (<strong>15 MAY 2025</strong>).
            </div>

            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: '10px',
              background: 'var(--color-surface-base)',
              padding: '12px',
              borderRadius: '4px',
              border: '1px solid var(--color-border-standard)',
              fontSize: '11px',
              fontFamily: 'monospace',
            }}>
              <div>
                <span style={{ color: 'var(--color-text-muted)' }}>T1 BASELINE (15 MAY 2025):</span>
                <div style={{ fontSize: '14px', fontWeight: 700, color: '#cbd5e1' }}>{baselineComparison.baselineExtentSqKm} km²</div>
              </div>

              <div>
                <span style={{ color: 'var(--color-text-muted)' }}>SELECTED OBS ({baselineComparison.selectedDate}):</span>
                <div style={{ fontSize: '14px', fontWeight: 700, color: '#38bdf8' }}>{baselineComparison.selectedExtentSqKm} km²</div>
              </div>

              <div>
                <span style={{ color: 'var(--color-text-muted)' }}>ABSOLUTE CHANGE:</span>
                <div style={{ fontSize: '14px', fontWeight: 700, color: '#34d399' }}>+{baselineComparison.deltaSqKm} km²</div>
              </div>

              <div>
                <span style={{ color: 'var(--color-text-muted)' }}>RELATIVE CHANGE:</span>
                <div style={{ fontSize: '14px', fontWeight: 700, color: '#34d399' }}>+{baselineComparison.relativeChangePercent}%</div>
              </div>

              <div>
                <span style={{ color: 'var(--color-text-muted)' }}>TEMPORAL SEPARATION:</span>
                <div style={{ color: '#e2e8f0' }}>{baselineComparison.daysSeparation} days</div>
              </div>

              <div>
                <span style={{ color: 'var(--color-text-muted)' }}>NDWI DELTA:</span>
                <div style={{ color: '#93c5fd' }}>+{baselineComparison.ndwiDelta}</div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '6px' }}>
              <button
                onClick={() => setShowCompareModal(false)}
                className="btn btn-sm"
              >
                CLOSE
              </button>
              <button
                onClick={() => {
                  setShowCompareModal(false);
                  handleOpenInChangeAnalysis();
                }}
                className="btn btn-sm"
                style={{
                  background: 'rgba(2, 132, 199, 0.2)',
                  borderColor: '#0284c7',
                  color: '#38bdf8',
                  fontWeight: 600,
                }}
              >
                OPEN IN CHANGE ANALYSIS [F3] →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: FULL SCENE METADATA INSPECTOR */}
      {showMetadataModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.75)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
        }}>
          <div style={{
            background: 'var(--color-surface-subtle)',
            border: '1px solid var(--color-chrome-border)',
            borderRadius: '6px',
            width: '640px',
            maxWidth: '92vw',
            padding: '18px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--color-border-standard)', paddingBottom: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Satellite size={15} style={{ color: '#38bdf8' }} />
                <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: '#f8fafc' }}>
                  SCENE METADATA INSPECTOR
                </h3>
              </div>
              <button
                onClick={() => setShowMetadataModal(false)}
                className="btn btn-sm"
                style={{ padding: '4px', background: 'transparent', border: 'none', color: '#94a3b8' }}
              >
                <X size={16} />
              </button>
            </div>

            <div style={{
              background: 'var(--color-surface-base)',
              padding: '12px',
              borderRadius: '4px',
              border: '1px solid var(--color-border-standard)',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              fontSize: '11px',
              fontFamily: 'monospace',
            }}>
              <div>
                <span style={{ color: 'var(--color-text-muted)' }}>SCENE IDENTIFIER:</span>
                <div style={{ color: '#38bdf8', wordBreak: 'break-all', fontWeight: 600 }}>
                  {selectedObs.sceneId}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
                <div>
                  <span style={{ color: 'var(--color-text-muted)' }}>MISSION / PLATFORM:</span>
                  <div style={{ color: '#e2e8f0' }}>{selectedObs.satellite}</div>
                </div>
                <div>
                  <span style={{ color: 'var(--color-text-muted)' }}>SENSOR INSTRUMENT:</span>
                  <div style={{ color: '#e2e8f0' }}>{selectedObs.platform}</div>
                </div>
                <div>
                  <span style={{ color: 'var(--color-text-muted)' }}>ACQUISITION TIMESTAMP:</span>
                  <div style={{ color: '#e2e8f0' }}>{selectedObs.acquisitionTimestamp}</div>
                </div>
                <div>
                  <span style={{ color: 'var(--color-text-muted)' }}>MGRS TILE:</span>
                  <div style={{ color: '#e2e8f0' }}>{selectedObs.mgrsTile}</div>
                </div>
                <div>
                  <span style={{ color: 'var(--color-text-muted)' }}>PRODUCT LEVEL:</span>
                  <div style={{ color: '#e2e8f0' }}>{selectedObs.productLevel}</div>
                </div>
                <div>
                  <span style={{ color: 'var(--color-text-muted)' }}>PROCESSING BASELINE:</span>
                  <div style={{ color: '#e2e8f0' }}>{selectedObs.processingBaseline}</div>
                </div>
                <div>
                  <span style={{ color: 'var(--color-text-muted)' }}>CLOUD COVER PERCENT:</span>
                  <div style={{ color: selectedObs.cloudCoverPercent > 15 ? '#fbbf24' : '#34d399' }}>
                    {selectedObs.cloudCoverPercent}%
                  </div>
                </div>
                <div>
                  <span style={{ color: 'var(--color-text-muted)' }}>SUN ELEVATION DEG:</span>
                  <div style={{ color: '#e2e8f0' }}>{selectedObs.sunElevationDeg}°</div>
                </div>
                <div>
                  <span style={{ color: 'var(--color-text-muted)' }}>COORDINATE REFERENCE:</span>
                  <div style={{ color: '#e2e8f0' }}>{selectedObs.crs}</div>
                </div>
                <div>
                  <span style={{ color: 'var(--color-text-muted)' }}>EVIDENCE ROLE:</span>
                  <div style={{ color: '#38bdf8' }}>{selectedObs.evidenceRoleLabel}</div>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px' }}>
              <button
                onClick={() => handleCopySceneId(selectedObs.sceneId)}
                className="btn btn-sm"
                style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
              >
                {copiedSceneId ? <Check size={12} style={{ color: '#34d399' }} /> : <Copy size={12} />}
                {copiedSceneId ? 'COPIED TO CLIPBOARD' : 'COPY SCENE ID'}
              </button>

              <button
                onClick={() => setShowMetadataModal(false)}
                className="btn btn-sm"
              >
                DISMISS
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
