import React, { useState, useEffect } from 'react';
import {
  ClipboardCheck,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  FileCheck2,
  Download,
  Check,
  ShieldCheck,
  Clock,
  Database,
  Layers,
  Copy,
} from 'lucide-react';
import {
  AOI,
  AnalystReviewPackage,
  NavigationSection,
  ReviewDisposition,
  ReviewStatus,
} from '../types';
import { DEFAULT_MOCK_REVIEW_PACKAGE, reviewService } from '../services/reviewService';

interface AnalystReviewPageProps {
  currentAoi: AOI;
  stagedReviewPackage?: AnalystReviewPackage | null;
  onNavigateSection?: (section: NavigationSection) => void;
}

type EvidenceViewLayer = 't1' | 't2' | 'mask';

export const AnalystReviewPage: React.FC<AnalystReviewPageProps> = ({
  currentAoi,
  stagedReviewPackage,
  onNavigateSection,
}) => {
  // Initialize review package with staged finding or fallback to default Pune mock package
  const [reviewPkg, setReviewPkg] = useState<AnalystReviewPackage>(
    stagedReviewPackage || DEFAULT_MOCK_REVIEW_PACKAGE
  );

  // Sync staged package if prop changes
  useEffect(() => {
    if (stagedReviewPackage) {
      setReviewPkg(stagedReviewPackage);
      setSelectedDisposition(stagedReviewPackage.disposition);
      setAnalystNotes(stagedReviewPackage.analystNotes || '');
      setReviewStatus(stagedReviewPackage.status);
    }
  }, [stagedReviewPackage]);

  // Evidence viewer layer tab state
  const [activeLayer, setActiveLayer] = useState<EvidenceViewLayer>('mask');

  // Analyst Disposition decision state (mutually exclusive)
  const [selectedDisposition, setSelectedDisposition] = useState<ReviewDisposition>(
    reviewPkg.disposition || 'pending'
  );

  // Analyst notes
  const [analystNotes, setAnalystNotes] = useState<string>(reviewPkg.analystNotes || '');

  // Review status
  const [reviewStatus, setReviewStatus] = useState<ReviewStatus>(reviewPkg.status || 'PENDING');

  // Save review state
  const [isSaved, setIsSaved] = useState<boolean>(reviewPkg.status !== 'PENDING');
  const [savedTimestamp, setSavedTimestamp] = useState<string | null>(
    reviewPkg.reviewedAt || null
  );
  const [validationError, setValidationError] = useState<string | null>(null);

  // Export evidence modal state
  const [showExportModal, setShowExportModal] = useState<boolean>(false);
  const [copiedExport, setCopiedExport] = useState<boolean>(false);

  // Notification banner
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);

  // Map disposition to ReviewStatus
  const getStatusForDisposition = (disp: ReviewDisposition): ReviewStatus => {
    switch (disp) {
      case 'confirmed':
        return 'CONFIRMED';
      case 'rejected':
        return 'REJECTED';
      case 'flagged':
        return 'FLAGGED_FOR_REVIEW';
      default:
        return 'PENDING';
    }
  };

  // Handle disposition selection
  const handleSelectDisposition = (disp: ReviewDisposition) => {
    setSelectedDisposition(disp);
    setValidationError(null);
    const newStatus = getStatusForDisposition(disp);
    setReviewStatus(newStatus);
  };

  // Handle Save Review
  const handleSaveReview = async () => {
    if (selectedDisposition === 'pending') {
      setValidationError('Please select a disposition (Confirm, Reject, or Flag) before saving.');
      return;
    }

    setValidationError(null);
    const nowUtc = new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
    const finalStatus = getStatusForDisposition(selectedDisposition);

    const updatedPackage: AnalystReviewPackage = {
      ...reviewPkg,
      disposition: selectedDisposition,
      status: finalStatus,
      analystNotes: analystNotes.trim(),
      reviewedAt: nowUtc,
      reviewedBy: 'ANALYST_01_DESK',
    };

    const saved = await reviewService.saveDisposition(updatedPackage);
    setReviewPkg(saved);
    setReviewStatus(finalStatus);
    setIsSaved(true);
    setSavedTimestamp(nowUtc);
    setBannerMessage(`REVIEW RECORDED — ${saved.reviewId} — STATUS: ${finalStatus} — LOCAL SESSION ONLY`);
  };

  // Handle Copy Export JSON
  const handleCopyJson = () => {
    const jsonStr = reviewService.exportPackageAsJson(reviewPkg);
    navigator.clipboard.writeText(jsonStr);
    setCopiedExport(true);
    setTimeout(() => setCopiedExport(false), 2500);
  };

  // Render SVG cartography for evidence inspection
  const renderEvidenceSvg = () => {
    const isT1 = activeLayer === 't1';
    const isMask = activeLayer === 'mask';

    // Palette
    const soilColor = isT1 ? '#7c6853' : '#3f4738';
    const ridgeColor = isT1 ? '#44382c' : '#223021';
    const vegColor = isT1 ? '#a38f65' : '#15803d';
    const vegHighlight = isT1 ? '#786847' : '#22c55e';
    const waterBase = isT1 ? '#192b42' : '#0c4a6e';
    const waterHighlight = isT1 ? '#25476d' : '#0284c7';
    const urbanColor = isT1 ? '#64748b' : '#526071';

    return (
      <svg
        viewBox="0 0 1000 650"
        preserveAspectRatio="xMidYMid slice"
        style={{ width: '100%', height: '100%', display: 'block' }}
      >
        <defs>
          <linearGradient id="evWaterGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={waterBase} />
            <stop offset="60%" stopColor={waterHighlight} />
            <stop offset="100%" stopColor={waterBase} />
          </linearGradient>

          <linearGradient id="evRidgeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={ridgeColor} stopOpacity="0.95" />
            <stop offset="50%" stopColor={soilColor} stopOpacity="0.75" />
            <stop offset="100%" stopColor={ridgeColor} stopOpacity="0.9" />
          </linearGradient>

          <pattern id="evCropPat" width="36" height="26" patternUnits="userSpaceOnUse">
            <rect width="34" height="24" fill={vegColor} opacity={isT1 ? 0.45 : 0.85} />
            <rect x="2" y="2" width="14" height="10" fill={vegHighlight} opacity={isT1 ? 0.35 : 0.9} />
            <line x1="0" y1="25" x2="36" y2="25" stroke="#1e293b" strokeWidth="0.8" opacity="0.3" />
            <line x1="35" y1="0" x2="35" y2="26" stroke="#1e293b" strokeWidth="0.8" opacity="0.3" />
          </pattern>

          <pattern id="evMaskHatch" width="8" height="8" patternTransform="rotate(45 0 0)" patternUnits="userSpaceOnUse">
            <line x1="0" y1="0" x2="0" y2="8" stroke="#38bdf8" strokeWidth="2" opacity="0.9" />
          </pattern>
        </defs>

        {/* 1. Base Terrain Background */}
        <rect width="1000" height="650" fill={soilColor} />

        {/* 2. Sahyadri / Western Ghats Foothills & Sinhagad Ridges */}
        <path
          d="M -20,120 Q 180,60 380,140 T 780,90 Q 920,130 1020,80 L 1020,0 L -20,0 Z"
          fill="url(#evRidgeGrad)"
        />
        <path
          d="M 50,650 Q 250,480 440,540 T 820,490 Q 940,560 1020,530 L 1020,650 Z"
          fill="url(#evRidgeGrad)"
        />

        {/* 3. Agricultural Parcels (Haveli Valley) */}
        <g>
          <polygon points="120,160 520,170 590,440 280,480 90,320" fill="url(#evCropPat)" />
          <polygon points="580,240 890,210 940,460 620,490" fill="url(#evCropPat)" opacity="0.9" />
        </g>

        {/* 4. Mutha & Mula River Drainage Channels */}
        <g>
          <path
            d="M 20,40 C 140,80 210,180 290,230 S 420,290 510,310 S 710,360 840,430 S 960,540 1020,590"
            fill="none"
            stroke="url(#evWaterGrad)"
            strokeWidth={isT1 ? '14' : '30'}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.95"
          />
          <path
            d="M 20,40 C 140,80 210,180 290,230 S 420,290 510,310 S 710,360 840,430 S 960,540 1020,590"
            fill="none"
            stroke={waterHighlight}
            strokeWidth={isT1 ? '5' : '12'}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.75"
          />
        </g>

        {/* 5. Khadakwasla Reservoir Water Body */}
        <g>
          {isT1 ? (
            // T1 Shrunk pool (dry season)
            <g>
              {/* Exposed dry mudflat perimeter */}
              <path
                d="M 445,235 C 485,195 585,190 640,210 C 695,230 740,275 720,380 C 700,440 615,450 500,425 C 450,405 420,320 445,235 Z"
                fill="#998369"
                opacity="0.6"
                stroke="#b5a082"
                strokeWidth="1.5"
                strokeDasharray="4 3"
              />
              {/* Core reservoir water */}
              <path
                d="M 480,270 C 505,245 550,240 585,255 C 620,270 650,300 640,345 C 625,385 575,395 535,380 C 495,365 470,315 480,270 Z"
                fill="url(#evWaterGrad)"
                stroke={waterHighlight}
                strokeWidth="2"
                opacity="0.95"
              />
            </g>
          ) : (
            // T2 Full reservoir pool (monsoon runoff 100% capacity)
            <g>
              <path
                d="M 445,235 C 485,195 585,190 640,210 C 695,230 740,275 720,380 C 700,440 615,450 500,425 C 450,405 420,320 445,235 Z"
                fill="url(#evWaterGrad)"
                stroke="#38bdf8"
                strokeWidth="3"
                opacity="0.98"
              />
              <path
                d="M 640,210 C 680,240 700,280 690,360"
                fill="none"
                stroke="#bae6fd"
                strokeWidth="6"
                opacity="0.65"
                strokeDasharray="6 3"
              />
            </g>
          )}
        </g>

        {/* 6. Urban & Industrial Zones */}
        <g>
          <polygon points="180,310 260,305 275,370 195,375" fill={urbanColor} opacity="0.5" stroke="#334155" strokeWidth="1.2" />
          <polygon points="730,150 830,140 845,210 740,225" fill={urbanColor} opacity="0.5" stroke="#334155" strokeWidth="1.2" />
        </g>

        {/* 7. CHANGE MASK OVERLAY LAYER */}
        {isMask && (
          <g id="evidence-change-mask">
            {/* Highlighted Water Inundation Delta */}
            <path
              d="M 445,235 C 485,195 585,190 640,210 C 695,230 740,275 720,380 C 700,440 615,450 500,425 C 450,405 420,320 445,235 Z"
              fill="rgba(6, 182, 212, 0.45)"
              stroke="#06b6d4"
              strokeWidth="2.5"
              strokeDasharray="6 3"
            />
            {/* Mutha Channel Inflow Delta */}
            <path
              d="M 20,40 C 140,80 210,180 290,230 S 420,290 510,310 S 710,360 840,430 S 960,540 1020,590"
              fill="none"
              stroke="rgba(6, 182, 212, 0.55)"
              strokeWidth="20"
              strokeDasharray="4 4"
            />
          </g>
        )}

        {/* 8. Target Feature Spatial Bounding Box & Crosshairs */}
        <g id="target-feature-reticle">
          <rect
            x="410"
            y="180"
            width="340"
            height="270"
            fill="none"
            stroke="#f59e0b"
            strokeWidth="1.8"
            strokeDasharray="4 3"
          />
          {/* Target Reticle Corners */}
          <line x1="400" y1="180" x2="425" y2="180" stroke="#f59e0b" strokeWidth="2.5" />
          <line x1="410" y1="170" x2="410" y2="195" stroke="#f59e0b" strokeWidth="2.5" />
          <line x1="735" y1="180" x2="760" y2="180" stroke="#f59e0b" strokeWidth="2.5" />
          <line x1="750" y1="170" x2="750" y2="195" stroke="#f59e0b" strokeWidth="2.5" />
          <line x1="400" y1="450" x2="425" y2="450" stroke="#f59e0b" strokeWidth="2.5" />
          <line x1="410" y1="435" x2="410" y2="460" stroke="#f59e0b" strokeWidth="2.5" />
          <line x1="735" y1="450" x2="760" y2="450" stroke="#f59e0b" strokeWidth="2.5" />
          <line x1="750" y1="435" x2="750" y2="460" stroke="#f59e0b" strokeWidth="2.5" />

          {/* Center Target Indicator */}
          <circle cx="580" cy="315" r="5" fill="#f59e0b" />
          <circle cx="580" cy="315" r="14" fill="none" stroke="#f59e0b" strokeWidth="1.2" strokeDasharray="3 3" />
        </g>

        {/* 9. AOI Boundary */}
        <rect
          x="140"
          y="110"
          width="720"
          height="440"
          fill="none"
          stroke="var(--color-aoi-cyan)"
          strokeWidth="1.8"
          strokeDasharray="8 4"
        />

        {/* 10. Coordinate Grid Overlays */}
        <g opacity="0.3">
          {[200, 380, 560, 740, 920].map((gx) => (
            <line key={`egx-${gx}`} x1={gx} y1="0" x2={gx} y2="650" stroke="#cbd5e1" strokeWidth="0.8" strokeDasharray="3 4" />
          ))}
          {[120, 260, 400, 540].map((gy) => (
            <line key={`egy-${gy}`} x1="0" y1={gy} x2="1000" y2={gy} stroke="#cbd5e1" strokeWidth="0.8" strokeDasharray="3 4" />
          ))}
        </g>
      </svg>
    );
  };

  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      overflow: 'hidden',
      background: 'var(--color-surface-base)',
    }}>
      {/* 1. TOP HEADER & REVIEW STATUS BAR */}
      <div style={{
        background: 'var(--color-chrome-bg)',
        borderBottom: '1px solid var(--color-chrome-border)',
        padding: '6px 12px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
        color: 'var(--color-chrome-text)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            width: '24px',
            height: '24px',
            background: 'rgba(56, 189, 248, 0.15)',
            border: '1px solid #38bdf8',
            borderRadius: 'var(--radius-xs)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#38bdf8',
          }}>
            <ClipboardCheck size={14} strokeWidth={2.4} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontWeight: 700, fontSize: '12px', color: '#ffffff', letterSpacing: '0.04em' }}>
                ANALYST REVIEW
              </span>
              <span className="badge badge-neutral" style={{ fontSize: '9px', fontWeight: 600 }}>
                MOD-F4
              </span>
              <span className="font-mono text-muted" style={{ fontSize: '10px' }}>
                {reviewPkg.reviewId}
              </span>
            </div>
            <div style={{ fontSize: '10.5px', color: 'var(--color-chrome-muted)' }}>
              Evidence Package / {currentAoi.name} [{reviewPkg.aoi}]
            </div>
          </div>
        </div>

        {/* Center: Live Review Status Bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            background: 'rgba(0, 0, 0, 0.35)',
            border: '1px solid var(--color-chrome-border)',
            padding: '4px 10px',
            borderRadius: 'var(--radius-xs)',
          }}>
            <span style={{ fontSize: '9.5px', color: 'var(--color-chrome-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
              REVIEW STATUS:
            </span>
            {reviewStatus === 'PENDING' && (
              <span style={{
                color: '#94a3b8',
                fontWeight: 700,
                fontSize: '11px',
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
              }}>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#f59e0b', animation: 'pulse 1.5s infinite' }} />
                PENDING ANALYST DECISION
              </span>
            )}
            {reviewStatus === 'CONFIRMED' && (
              <span style={{
                color: '#22c55e',
                fontWeight: 700,
                fontSize: '11px',
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
              }}>
                <CheckCircle2 size={12} />
                CONFIRMED
              </span>
            )}
            {reviewStatus === 'REJECTED' && (
              <span style={{
                color: '#ef4444',
                fontWeight: 700,
                fontSize: '11px',
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
              }}>
                <XCircle size={12} />
                REJECTED
              </span>
            )}
            {reviewStatus === 'FLAGGED_FOR_REVIEW' && (
              <span style={{
                color: '#f59e0b',
                fontWeight: 700,
                fontSize: '11px',
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
              }}>
                <AlertTriangle size={12} />
                FLAGGED FOR FURTHER REVIEW
              </span>
            )}
          </div>
        </div>

        {/* Right: Export & Diagnostics */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className="font-mono" style={{ fontSize: '9.5px', color: '#b45309' }}>
            DEMO / LOCAL MOCK
          </span>
          <button
            onClick={() => setShowExportModal(true)}
            className="btn btn-sm"
            style={{
              height: '24px',
              padding: '0 8px',
              fontSize: '10.5px',
              fontWeight: 600,
              gap: '5px',
              background: 'rgba(56, 189, 248, 0.1)',
              borderColor: 'rgba(56, 189, 248, 0.4)',
              color: '#38bdf8',
            }}
          >
            <Download size={12} />
            <span>EXPORT EVIDENCE</span>
          </button>
        </div>
      </div>

      {/* Notification Banner */}
      {bannerMessage && (
        <div style={{
          background: 'rgba(21, 128, 61, 0.15)',
          borderBottom: '1px solid rgba(34, 197, 94, 0.4)',
          padding: '4px 12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '11px',
          color: '#15803d',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <CheckCircle2 size={13} style={{ color: '#22c55e' }} />
            <span className="font-mono" style={{ fontWeight: 600 }}>{bannerMessage}</span>
          </div>
          <button
            onClick={() => setBannerMessage(null)}
            className="btn btn-sm"
            style={{ fontSize: '10px', padding: '0 4px', height: '18px' }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* 2. MAIN WORKSTATION OPERATIONAL BODY (2-Column Dense Grid + Bottom Action Panel) */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflowY: 'auto',
        padding: '8px 10px',
        gap: '8px',
      }}>
        {/* Upper 2-Column Section */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1.15fr) minmax(0, 1fr)',
          gap: '8px',
          flexShrink: 0,
        }}>
          {/* LEFT COLUMN: CHANGE EVIDENCE VIEWER + TEMPORAL PROGRESSION */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {/* Visual Evidence Viewer Card */}
            <div className="panel" style={{ display: 'flex', flexDirection: 'column' }}>
              <div className="panel-header" style={{ justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Layers size={13} style={{ color: '#0284c7' }} />
                  <span>Change Evidence Preview</span>
                  <span className="font-mono text-muted" style={{ fontSize: '9px' }}>43QDF</span>
                </div>

                {/* Layer Switching Tabs (T1, T2, CHANGE MASK) */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                  <span style={{ fontSize: '9px', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', marginRight: '2px' }}>
                    INSPECT LAYER:
                  </span>
                  {[
                    { id: 't1', label: 'T1 BASELINE (15 MAY)' },
                    { id: 't2', label: 'T2 COMPARISON (21 SEP)' },
                    { id: 'mask', label: 'CHANGE MASK OVERLAY' },
                  ].map((layer) => (
                    <button
                      key={layer.id}
                      onClick={() => setActiveLayer(layer.id as EvidenceViewLayer)}
                      className="btn btn-sm"
                      style={{
                        height: '20px',
                        padding: '0 7px',
                        fontSize: '9.5px',
                        fontWeight: activeLayer === layer.id ? 700 : 500,
                        background: activeLayer === layer.id ? 'var(--color-chrome-bg)' : 'transparent',
                        color: activeLayer === layer.id ? '#38bdf8' : 'var(--color-text-secondary)',
                        borderColor: activeLayer === layer.id ? 'var(--color-chrome-border)' : 'var(--color-border-subtle)',
                      }}
                    >
                      {layer.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Viewport Canvas */}
              <div style={{
                position: 'relative',
                height: '240px',
                background: '#0a0f1d',
                overflow: 'hidden',
                borderBottom: '1px solid var(--color-border-standard)',
              }}>
                {renderEvidenceSvg()}

                {/* Top Left Viewport Pill */}
                <div style={{
                  position: 'absolute',
                  top: '6px',
                  left: '6px',
                  background: 'rgba(12, 20, 36, 0.92)',
                  border: '1px solid var(--color-chrome-border)',
                  padding: '3px 7px',
                  borderRadius: 'var(--radius-xs)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '9.5px',
                  color: '#e2e8f0',
                  pointerEvents: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}>
                  <span className="badge badge-amber" style={{ fontSize: '8.5px' }}>
                    {activeLayer === 't1' ? 'T1 REF' : activeLayer === 't2' ? 'T2 EVAL' : 'DELTA MASK'}
                  </span>
                  <span style={{ fontWeight: 600 }}>
                    {activeLayer === 't1'
                      ? '15 MAY 2025 (Sentinel-2B)'
                      : activeLayer === 't2'
                      ? '21 SEP 2025 (Sentinel-2A)'
                      : 'Khadakwasla Basin Inundation (+154%)'}
                  </span>
                </div>

                {/* Bottom Left Target Reticle HUD */}
                <div style={{
                  position: 'absolute',
                  bottom: '6px',
                  left: '6px',
                  background: 'rgba(12, 20, 36, 0.92)',
                  border: '1px solid var(--color-chrome-border)',
                  padding: '3px 7px',
                  borderRadius: 'var(--radius-xs)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '9px',
                  color: '#f59e0b',
                  pointerEvents: 'none',
                }}>
                  TARGET: KHADAKWASLA BASIN • 18.5204° N, 73.8567° E • UTM 43QDF
                </div>

                {/* Bottom Right Resolution Pill */}
                <div style={{
                  position: 'absolute',
                  bottom: '6px',
                  right: '6px',
                  background: 'rgba(12, 20, 36, 0.92)',
                  border: '1px solid var(--color-chrome-border)',
                  padding: '3px 7px',
                  borderRadius: 'var(--radius-xs)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '9px',
                  color: '#94a3b8',
                  pointerEvents: 'none',
                }}>
                  10m BOA / L2A • S2 MSI
                </div>
              </div>
            </div>

            {/* Temporal Evidence Supporting Series Card */}
            <div className="panel" style={{ display: 'flex', flexDirection: 'column' }}>
              <div className="panel-header" style={{ justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Clock size={13} style={{ color: '#0284c7' }} />
                  <span>Temporal Evidence (Supporting Series)</span>
                </div>
                <span className="badge badge-blue" style={{ fontSize: '9px' }}>
                  5 OBSERVATIONS
                </span>
              </div>
              <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: '5px', padding: '6px 8px' }}>
                {reviewPkg.supportingObservations.map((obs, idx) => (
                  <div
                    key={obs.date}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '5px 8px',
                      background: obs.isEarliest
                        ? 'rgba(56, 189, 248, 0.12)'
                        : 'var(--color-surface-subtle)',
                      border: obs.isEarliest
                        ? '1px solid rgba(56, 189, 248, 0.4)'
                        : '1px solid var(--color-border-subtle)',
                      borderRadius: 'var(--radius-xs)',
                      gap: '8px',
                    }}
                  >
                    {/* Date & Indicator */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: '160px' }}>
                      <span className="font-mono" style={{
                        fontSize: '9px',
                        color: 'var(--color-text-muted)',
                        width: '14px',
                      }}>
                        0{idx + 1}
                      </span>
                      <span className="font-mono" style={{
                        fontSize: '11px',
                        fontWeight: 700,
                        color: obs.isEarliest ? '#0284c7' : 'var(--color-text-primary)',
                      }}>
                        {obs.date}
                      </span>
                      {obs.isEarliest && (
                        <span style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: '8.5px',
                          padding: '1px 5px',
                          background: '#0284c7',
                          color: '#ffffff',
                          borderRadius: 'var(--radius-xs)',
                          fontWeight: 700,
                        }}>
                          EARLIEST OBSERVATION
                        </span>
                      )}
                    </div>

                    {/* Milestone Context */}
                    <div style={{ flex: 1, fontSize: '10.5px', color: 'var(--color-text-secondary)' }}>
                      <span style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>
                        {obs.label}:
                      </span>{' '}
                      {obs.context}
                    </div>

                    {/* Telemetry pill */}
                    <div className="font-mono text-muted" style={{ fontSize: '9px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {obs.sensor} | Cloud {obs.cloudCover}%
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN: FINDING SUMMARY, QUALITY & PROVENANCE, CHECKLIST */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {/* Selected Finding Summary Card */}
            <div className="panel">
              <div className="panel-header" style={{ justifyContent: 'space-between' }}>
                <span>Selected Finding</span>
                <span className="badge badge-blue">CONFIDENCE {reviewPkg.confidence}</span>
              </div>
              <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div>
                  <div className="font-mono text-xs text-muted" style={{ fontSize: '9px' }}>TARGET FEATURE</div>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--color-text-primary)' }}>
                    {reviewPkg.feature.toUpperCase()}
                  </div>
                  <div style={{ fontSize: '11px', color: '#0284c7', fontWeight: 600 }}>
                    {reviewPkg.changeType}
                  </div>
                </div>

                {/* Metrics Table */}
                <div style={{
                  background: 'var(--color-surface-subtle)',
                  border: '1px solid var(--color-border-standard)',
                  borderRadius: 'var(--radius-xs)',
                  padding: '6px 10px',
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4, 1fr)',
                  gap: '6px',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '10.5px',
                }}>
                  <div>
                    <div className="text-muted" style={{ fontSize: '9px' }}>BASELINE (T1)</div>
                    <div style={{ fontWeight: 700, fontSize: '12px', color: 'var(--color-text-primary)' }}>
                      {reviewPkg.baselineValue}
                    </div>
                    <div style={{ fontSize: '8.5px', color: 'var(--color-text-muted)' }}>15 MAY 2025</div>
                  </div>
                  <div>
                    <div className="text-muted" style={{ fontSize: '9px' }}>COMPARISON (T2)</div>
                    <div style={{ fontWeight: 700, fontSize: '12px', color: 'var(--color-text-primary)' }}>
                      {reviewPkg.comparisonValue}
                    </div>
                    <div style={{ fontSize: '8.5px', color: 'var(--color-text-muted)' }}>21 SEP 2025</div>
                  </div>
                  <div>
                    <div className="text-muted" style={{ fontSize: '9px' }}>RELATIVE CHANGE</div>
                    <div style={{ fontWeight: 700, fontSize: '12px', color: '#15803d' }}>
                      {reviewPkg.relativeChange}
                    </div>
                    <div style={{ fontSize: '8.5px', color: '#15803d' }}>+17.25 km²</div>
                  </div>
                  <div>
                    <div className="text-muted" style={{ fontSize: '9px' }}>CONFIDENCE</div>
                    <div style={{ fontWeight: 700, fontSize: '12px', color: '#0284c7' }}>
                      {reviewPkg.confidence}
                    </div>
                    <div style={{ fontSize: '8.5px', color: 'var(--color-text-muted)' }}>MULTI-SPECTRAL</div>
                  </div>
                </div>

                <div className="font-mono text-muted" style={{ fontSize: '9px', textAlign: 'right' }}>
                  LOCAL MOCK ANALYSIS • ALGORITHM: MULTI-TEMPORAL SPECTRAL DELTA V2.4
                </div>
              </div>
            </div>

            {/* Quality Checks & Provenance (Side-by-side inside right column) */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              {/* Quality Checks Card */}
              <div className="panel">
                <div className="panel-header" style={{ justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <ShieldCheck size={12} style={{ color: '#15803d' }} />
                    <span>Quality Checks</span>
                  </div>
                  <span className="badge badge-green" style={{ fontSize: '8.5px' }}>VERIFIED</span>
                </div>
                <div className="panel-body font-mono" style={{ fontSize: '10px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span className="text-muted">T1 CLOUD COVER:</span>
                    <span style={{ fontWeight: 600 }}>{reviewPkg.qualityChecks.cloudCoverT1}%</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span className="text-muted">T2 CLOUD COVER:</span>
                    <span style={{ fontWeight: 600 }}>{reviewPkg.qualityChecks.cloudCoverT2}%</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span className="text-muted">TEMPORAL SEP:</span>
                    <span style={{ color: '#0284c7', fontWeight: 600 }}>{reviewPkg.qualityChecks.temporalSeparationDays} DAYS</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span className="text-muted">CO-REGISTRATION:</span>
                    <span style={{ color: '#15803d', fontWeight: 700 }}>{reviewPkg.qualityChecks.coRegistration}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span className="text-muted">SCENE QUALITY:</span>
                    <span style={{ color: '#15803d', fontWeight: 700 }}>{reviewPkg.qualityChecks.sceneQuality}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span className="text-muted">CLOUD SCREENING:</span>
                    <span style={{ color: '#15803d', fontWeight: 700 }}>{reviewPkg.qualityChecks.cloudShadowScreening}</span>
                  </div>
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    paddingTop: '3px',
                    borderTop: '1px solid var(--color-border-subtle)',
                    marginTop: '2px',
                  }}>
                    <span className="text-muted">CONFIDENCE:</span>
                    <span style={{ color: '#15803d', fontWeight: 700 }}>{reviewPkg.qualityChecks.overallConfidence}</span>
                  </div>
                  <div style={{ fontSize: '8.5px', color: '#b45309', marginTop: '2px' }}>
                    DEMO / LOCAL MOCK
                  </div>
                </div>
              </div>

              {/* Provenance Card */}
              <div className="panel">
                <div className="panel-header" style={{ justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <Database size={12} style={{ color: '#0284c7' }} />
                    <span>Provenance</span>
                  </div>
                  <span className="font-mono text-muted" style={{ fontSize: '8.5px' }}>AUDIT</span>
                </div>
                <div className="panel-body font-mono" style={{ fontSize: '9.5px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div>
                    <div className="text-muted" style={{ fontSize: '8.5px' }}>T1 SCENE</div>
                    <div style={{ color: 'var(--color-text-primary)', wordBreak: 'break-all', fontSize: '9px' }}>
                      {reviewPkg.t1Scene}
                    </div>
                  </div>
                  <div>
                    <div className="text-muted" style={{ fontSize: '8.5px' }}>T2 SCENE</div>
                    <div style={{ color: 'var(--color-text-primary)', wordBreak: 'break-all', fontSize: '9px' }}>
                      {reviewPkg.t2Scene}
                    </div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '3px', borderTop: '1px solid var(--color-border-subtle)' }}>
                    <span className="text-muted">SENSOR:</span>
                    <span style={{ fontWeight: 600 }}>{reviewPkg.provenance.sensor}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span className="text-muted">AOI / MGRS:</span>
                    <span style={{ fontWeight: 600 }}>{reviewPkg.provenance.mgrsTile}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span className="text-muted">PROCESSING:</span>
                    <span style={{ color: '#b45309', fontWeight: 600 }}>{reviewPkg.provenance.processingLevel}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span className="text-muted">CATALOG SOURCE:</span>
                    <span>{reviewPkg.provenance.sourceCatalog}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Evidence Checklist Card */}
            <div className="panel">
              <div className="panel-header" style={{ justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <FileCheck2 size={12} style={{ color: '#15803d' }} />
                  <span>Evidence Checklist</span>
                </div>
                <span className="font-mono text-muted" style={{ fontSize: '8.5px' }}>6 / 6 PASSED</span>
              </div>
              <div className="panel-body" style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '4px 10px',
                fontSize: '10.5px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px', color: '#15803d' }}>
                  <Check size={12} strokeWidth={2.5} />
                  <span>Baseline scene available</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px', color: '#15803d' }}>
                  <Check size={12} strokeWidth={2.5} />
                  <span>Comparison scene available</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px', color: '#15803d' }}>
                  <Check size={12} strokeWidth={2.5} />
                  <span>Temporal series available</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px', color: '#15803d' }}>
                  <Check size={12} strokeWidth={2.5} />
                  <span>Change mask available</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px', color: '#15803d' }}>
                  <Check size={12} strokeWidth={2.5} />
                  <span>Quality checks available</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px', color: '#15803d' }}>
                  <Check size={12} strokeWidth={2.5} />
                  <span>Scene provenance available</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 3. BOTTOM SECTION: ANALYST DISPOSITION & NOTES (Action Area) */}
        <div className="panel" style={{
          flexShrink: 0,
          border: '1px solid var(--color-border-standard)',
          boxShadow: 'var(--shadow-panel)',
        }}>
          <div className="panel-header" style={{
            background: 'var(--color-chrome-bg)',
            color: '#ffffff',
            justifyContent: 'space-between',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <ClipboardCheck size={13} style={{ color: '#38bdf8' }} />
              <span style={{ letterSpacing: '0.04em' }}>ANALYST DISPOSITION & VERIFICATION RECORD</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {isSaved && savedTimestamp && (
                <span className="font-mono" style={{ fontSize: '9.5px', color: '#22c55e' }}>
                  SAVED: {savedTimestamp}
                </span>
              )}
              <span className="badge badge-neutral font-mono" style={{ fontSize: '9px' }}>
                DECISION MAKER: HUMAN IN THE LOOP
              </span>
            </div>
          </div>

          <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '10px 12px' }}>
            {/* Top row: 3 Mutually Exclusive Disposition Buttons */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '10.5px', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', minWidth: '85px' }}>
                DISPOSITION:
              </span>

              {/* CONFIRM BUTTON */}
              <button
                onClick={() => handleSelectDisposition('confirmed')}
                style={{
                  flex: 1,
                  height: '32px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  borderRadius: 'var(--radius-xs)',
                  border: selectedDisposition === 'confirmed'
                    ? '1.5px solid #22c55e'
                    : '1px solid var(--color-border-standard)',
                  background: selectedDisposition === 'confirmed'
                    ? 'rgba(34, 197, 94, 0.18)'
                    : 'var(--color-surface-base)',
                  color: selectedDisposition === 'confirmed' ? '#15803d' : 'var(--color-text-primary)',
                  boxShadow: selectedDisposition === 'confirmed' ? '0 0 6px rgba(34, 197, 94, 0.3)' : 'none',
                  transition: 'all 0.15s ease',
                }}
              >
                <CheckCircle2 size={14} color={selectedDisposition === 'confirmed' ? '#15803d' : '#64748b'} />
                <span>CONFIRM FINDING</span>
              </button>

              {/* REJECT BUTTON */}
              <button
                onClick={() => handleSelectDisposition('rejected')}
                style={{
                  flex: 1,
                  height: '32px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  borderRadius: 'var(--radius-xs)',
                  border: selectedDisposition === 'rejected'
                    ? '1.5px solid #ef4444'
                    : '1px solid var(--color-border-standard)',
                  background: selectedDisposition === 'rejected'
                    ? 'rgba(239, 68, 68, 0.18)'
                    : 'var(--color-surface-base)',
                  color: selectedDisposition === 'rejected' ? '#b91c1c' : 'var(--color-text-primary)',
                  boxShadow: selectedDisposition === 'rejected' ? '0 0 6px rgba(239, 68, 68, 0.3)' : 'none',
                  transition: 'all 0.15s ease',
                }}
              >
                <XCircle size={14} color={selectedDisposition === 'rejected' ? '#b91c1c' : '#64748b'} />
                <span>REJECT FINDING</span>
              </button>

              {/* FLAG FOR REVIEW BUTTON */}
              <button
                onClick={() => handleSelectDisposition('flagged')}
                style={{
                  flex: 1,
                  height: '32px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  borderRadius: 'var(--radius-xs)',
                  border: selectedDisposition === 'flagged'
                    ? '1.5px solid #f59e0b'
                    : '1px solid var(--color-border-standard)',
                  background: selectedDisposition === 'flagged'
                    ? 'rgba(245, 158, 11, 0.18)'
                    : 'var(--color-surface-base)',
                  color: selectedDisposition === 'flagged' ? '#b45309' : 'var(--color-text-primary)',
                  boxShadow: selectedDisposition === 'flagged' ? '0 0 6px rgba(245, 158, 11, 0.3)' : 'none',
                  transition: 'all 0.15s ease',
                }}
              >
                <AlertTriangle size={14} color={selectedDisposition === 'flagged' ? '#b45309' : '#64748b'} />
                <span>FLAG FOR REVIEW</span>
              </button>
            </div>

            {/* Validation error message if analyst attempts save without disposition */}
            {validationError && (
              <div style={{
                color: '#b91c1c',
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid #fca5a5',
                padding: '4px 8px',
                borderRadius: 'var(--radius-xs)',
                fontSize: '11px',
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
              }}>
                <AlertTriangle size={12} />
                <span>{validationError}</span>
              </div>
            )}

            {/* Middle row: Analyst Notes Field */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label style={{ fontSize: '10px', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>
                  ANALYST NOTES & JUSTIFICATION
                </label>
                <span className="font-mono text-muted" style={{ fontSize: '9px' }}>
                  RECORDED WITH AUDIT HASH
                </span>
              </div>
              <textarea
                value={analystNotes}
                onChange={(e) => setAnalystNotes(e.target.value)}
                placeholder="Enter observations, concerns, or supporting context..."
                rows={2}
                style={{
                  width: '100%',
                  padding: '6px 8px',
                  background: 'var(--color-surface-subtle)',
                  border: '1px solid var(--color-border-standard)',
                  borderRadius: 'var(--radius-xs)',
                  fontFamily: 'var(--font-sans)',
                  fontSize: '11px',
                  color: 'var(--color-text-primary)',
                  resize: 'none',
                  outline: 'none',
                }}
              />
            </div>

            {/* Bottom row: Save Review and Export Actions */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingTop: '6px',
              borderTop: '1px solid var(--color-border-subtle)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {isSaved ? (
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    color: '#15803d',
                    fontSize: '11px',
                    fontWeight: 700,
                  }}>
                    <CheckCircle2 size={14} />
                    <span>REVIEW RECORDED: {reviewPkg.reviewId} (STATUS: {reviewStatus})</span>
                  </div>
                ) : (
                  <span className="font-mono text-muted" style={{ fontSize: '10px' }}>
                    PENDING LOCAL SESSION SAVE
                  </span>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {onNavigateSection && (
                  <button
                    onClick={() => onNavigateSection('change-analysis')}
                    className="btn btn-sm"
                    style={{ fontSize: '10.5px', height: '28px' }}
                  >
                    <span>← Return to Change Analysis [F3]</span>
                  </button>
                )}

                <button
                  onClick={() => setShowExportModal(true)}
                  className="btn btn-sm"
                  style={{ fontSize: '10.5px', height: '28px' }}
                >
                  <Download size={12} />
                  <span>Export Evidence</span>
                </button>

                <button
                  onClick={handleSaveReview}
                  className="btn btn-primary"
                  style={{
                    height: '28px',
                    fontSize: '11px',
                    fontWeight: 700,
                    padding: '0 14px',
                    background: selectedDisposition === 'confirmed'
                      ? '#15803d'
                      : selectedDisposition === 'rejected'
                      ? '#b91c1c'
                      : selectedDisposition === 'flagged'
                      ? '#b45309'
                      : '#0284c7',
                  }}
                >
                  <ClipboardCheck size={13} />
                  <span>SAVE REVIEW</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 4. EXPORT EVIDENCE MODAL / DOSSIER PREVIEW */}
      {showExportModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.65)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 100,
          padding: '20px',
        }}>
          <div className="panel" style={{
            maxWidth: '680px',
            width: '100%',
            maxHeight: '85vh',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: 'var(--shadow-modal)',
          }}>
            <div className="panel-header" style={{
              background: 'var(--color-chrome-bg)',
              color: '#ffffff',
              justifyContent: 'space-between',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                <Download size={13} style={{ color: '#38bdf8' }} />
                <span>EVIDENCE PACKAGE HANDOFF: {reviewPkg.reviewId}</span>
              </div>
              <button
                onClick={() => setShowExportModal(false)}
                className="btn btn-sm"
                style={{ fontSize: '11px', padding: '0 6px', height: '20px' }}
              >
                ✕
              </button>
            </div>

            <div className="panel-body" style={{
              flex: 1,
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
              padding: '14px',
            }}>
              {/* Evidence Status Pill */}
              <div style={{
                background: 'rgba(34, 197, 94, 0.1)',
                border: '1px solid rgba(34, 197, 94, 0.3)',
                borderRadius: 'var(--radius-xs)',
                padding: '8px 12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <CheckCircle2 size={14} color="#15803d" />
                  <span style={{ fontSize: '11.5px', fontWeight: 700, color: '#15803d' }}>
                    EVIDENCE PACKAGE READY
                  </span>
                </div>
                <span className="font-mono text-muted" style={{ fontSize: '10px' }}>
                  LOCAL SESSION • AUDIT VERIFIED
                </span>
              </div>

              {/* JSON preview box */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--color-text-muted)' }}>
                    JSON AUDIT PAYLOAD (MACHINE-READABLE SPECIFICATION)
                  </span>
                  <button
                    onClick={handleCopyJson}
                    className="btn btn-sm"
                    style={{ fontSize: '10px', height: '22px', gap: '4px' }}
                  >
                    {copiedExport ? <Check size={11} color="#15803d" /> : <Copy size={11} />}
                    <span>{copiedExport ? 'Copied to Clipboard!' : 'Copy JSON'}</span>
                  </button>
                </div>
                <pre style={{
                  background: '#090d16',
                  color: '#93c5fd',
                  border: '1px solid var(--color-border-standard)',
                  borderRadius: 'var(--radius-xs)',
                  padding: '10px',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '10px',
                  lineHeight: 1.4,
                  maxHeight: '300px',
                  overflowY: 'auto',
                }}>
                  {reviewService.exportPackageAsJson({
                    ...reviewPkg,
                    disposition: selectedDisposition,
                    status: reviewStatus,
                    analystNotes,
                    reviewedAt: savedTimestamp || reviewPkg.reviewedAt,
                  })}
                </pre>
              </div>

              <div style={{
                fontSize: '10.5px',
                color: 'var(--color-text-muted)',
                lineHeight: 1.4,
                borderTop: '1px solid var(--color-border-subtle)',
                paddingTop: '8px',
              }}>
                This evidence package is formatted for ingestion into downstream mission intelligence systems,
                cryptographic audit registries, or command dispatch briefings.
              </div>
            </div>

            <div style={{
              padding: '10px 14px',
              background: 'var(--color-surface-subtle)',
              borderTop: '1px solid var(--color-border-standard)',
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '8px',
            }}>
              <button
                onClick={() => setShowExportModal(false)}
                className="btn btn-sm"
                style={{ fontSize: '11px', height: '28px', padding: '0 12px' }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
