import React, { useState, useRef, useEffect } from 'react';
import {
  GitCompare,
  CheckCircle2,
  ArrowRight,
  Droplets,
  Trees,
  Mountain,
  Building2,
  Clock,
  RotateCcw,
} from 'lucide-react';
import { AOI, SatelliteScene, NavigationSection, AnalystReviewPackage } from '../types';
import { MOCK_SCENES } from '../data/mockScenes';

interface ChangeAnalysisPageProps {
  currentAoi: AOI;
  stagedComparisonScene?: SatelliteScene | null;
  allScenes: SatelliteScene[];
  onNavigateSection?: (section: NavigationSection) => void;
  onQueueForReview?: (pkg: AnalystReviewPackage) => void;
}

type ComparisonMode = 'side-by-side' | 'swipe' | 'overlay';
type ChangeCategory = 'ALL' | 'WATER' | 'VEGETATION' | 'BARE_GROUND' | 'BUILT_UP';

export const ChangeAnalysisPage: React.FC<ChangeAnalysisPageProps> = ({
  currentAoi,
  stagedComparisonScene,
  allScenes,
  onNavigateSection,
  onQueueForReview,
}) => {
  // T1 Baseline scene is the May 15 2025 Pre-Monsoon Dry Baseline
  const t1BaselineDefault = allScenes.find((s) => s.id.includes('20250515')) || allScenes[1] || MOCK_SCENES[1];
  const [t1Scene, setT1Scene] = useState<SatelliteScene>(t1BaselineDefault);

  // T2 Comparison scene is staged from F2 or defaults to Sep 21 2025 Post-Monsoon Peak
  const t2ComparisonDefault = stagedComparisonScene || allScenes.find((s) => s.id.includes('20250921')) || allScenes[0] || MOCK_SCENES[0];
  const [t2Scene, setT2Scene] = useState<SatelliteScene>(t2ComparisonDefault);

  // Sync stagedComparisonScene when prop changes
  useEffect(() => {
    if (stagedComparisonScene) {
      setT2Scene(stagedComparisonScene);
    }
  }, [stagedComparisonScene]);

  // Comparison & Layer controls
  const [comparisonMode, setComparisonMode] = useState<ComparisonMode>('side-by-side');
  const [overlayOpacity, setOverlayOpacity] = useState<number>(65);
  const [swipePos, setSwipePos] = useState<number>(50); // percentage 0-100
  const [isDraggingSwipe, setIsDraggingSwipe] = useState<boolean>(false);
  const swipeContainerRef = useRef<HTMLDivElement>(null);

  // Layer toggles
  const [showImagery, setShowImagery] = useState<boolean>(true);
  const [showChangeMask, setShowChangeMask] = useState<boolean>(true);
  const [showWater, setShowWater] = useState<boolean>(true);
  const [showVegetation, setShowVegetation] = useState<boolean>(true);
  const [showBuiltup, setShowBuiltup] = useState<boolean>(true);
  const [showAoi, setShowAoi] = useState<boolean>(true);

  // Change category filter
  const [activeCategory, setActiveCategory] = useState<ChangeCategory>('ALL');

  // Review status state
  const [reviewQueued, setReviewQueued] = useState<boolean>(false);
  const [reviewQueuedTime, setReviewQueuedTime] = useState<string | null>(null);

  // Notification toast
  const [notification, setNotification] = useState<string | null>(null);

  // Calculate temporal separation in days
  const t1Date = new Date(t1Scene.acquisitionDate);
  const t2Date = new Date(t2Scene.acquisitionDate);
  const temporalDays = Math.max(1, Math.round(Math.abs(t2Date.getTime() - t1Date.getTime()) / (1000 * 60 * 60 * 24)));

  // Swipe dragging handlers
  const handleSwipeMove = (clientX: number) => {
    if (!swipeContainerRef.current) return;
    const rect = swipeContainerRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const pct = Math.max(5, Math.min(95, (x / rect.width) * 100));
    setSwipePos(Math.round(pct));
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    setIsDraggingSwipe(true);
    handleSwipeMove(e.clientX);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (isDraggingSwipe) {
      handleSwipeMove(e.clientX);
    }
  };

  const handlePointerUp = () => {
    setIsDraggingSwipe(false);
  };

  const handleSendToReview = () => {
    setReviewQueued(true);
    const now = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setReviewQueuedTime(now);
    setNotification(`Evidence Package [EV-2025-0921-01] queued for Analyst Review at ${now} UTC.`);
    setTimeout(() => setNotification(null), 5000);

    if (onQueueForReview) {
      onQueueForReview({
        reviewId: 'EV-2025-0921-01',
        candidateId: 'change-pune-khadakwasla-2025',
        aoi: currentAoi.code,
        feature: 'Khadakwasla Reservoir Basin',
        changeType: 'WATER',
        t1Scene: t1Scene.id,
        t2Scene: t2Scene.id,
        t1Date: t1Scene.acquisitionDate.split('T')[0],
        t2Date: t2Scene.acquisitionDate.split('T')[0],
        baselineValue: '11.20 km²',
        comparisonValue: '28.45 km²',
        relativeChange: '+154.0%',
        confidence: 0.94,
        disposition: 'pending',
        analystNotes: '',
        status: 'PENDING',
        qualityChecks: {
          cloudCoverT1: t1Scene.cloudCoverPercent,
          cloudCoverT2: t2Scene.cloudCoverPercent,
          temporalSeparationDays: temporalDays,
          coRegistration: 'PASS',
          sceneQuality: 'PASS',
          cloudShadowScreening: 'PASS',
          shadowCoverT1: t1Scene.shadowPercent ?? 0.2,
          shadowCoverT2: t2Scene.shadowPercent ?? 0.8,
          validPixelsT1: t1Scene.validPercent ?? 99.8,
          validPixelsT2: t2Scene.validPercent ?? 98.4,
          snowHazeScreening: 'PASS',
          seasonalVariation: 'PASS',
          illuminationGeometry: 'PASS',
          radiometricConsistency: 'PASS',
          overallConfidence: 'HIGH',
          flags: [],
        },
        provenance: {
          sensor: t2Scene.satellite,
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
      });
    }
  };

  // Reusable SVG Cartographic Render Function
  const renderCartographicSvg = (scene: SatelliteScene, isBaseline: boolean) => {
    // If real image URL / thumbnail is provided, render image crop
    if (scene.thumbnailUrl) {
      return (
        <img
          src={scene.thumbnailUrl}
          alt={scene.id}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            display: 'block',
            opacity: showImagery ? 1 : 0.25,
            transition: 'opacity 0.15s ease',
          }}
        />
      );
    }

    // True Color vs Spectral palette differences between T1 Dry and T2 Wet
    const isT1Dry = isBaseline || scene.acquisitionDate.includes('-05-') || scene.acquisitionDate.includes('-06-');

    // Colors
    const soilColor = isT1Dry ? '#7c6853' : '#3f4738';
    const ridgeColor = isT1Dry ? '#44382c' : '#223021';
    const vegColor = isT1Dry ? '#a38f65' : '#15803d';
    const vegHighlight = isT1Dry ? '#786847' : '#22c55e';
    const waterBase = isT1Dry ? '#192b42' : '#0c4a6e';
    const waterHighlight = isT1Dry ? '#25476d' : '#0284c7';
    const urbanColor = isT1Dry ? '#64748b' : '#526071';

    return (
      <svg
        viewBox="0 0 1000 650"
        preserveAspectRatio="xMidYMid slice"
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
          opacity: showImagery ? 1 : 0.25,
          transition: 'opacity 0.15s ease',
        }}
      >
        <defs>
          {/* Water gradient */}
          <linearGradient id={`waterGrad-${scene.id}-${isBaseline ? 't1' : 't2'}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={waterBase} />
            <stop offset="60%" stopColor={waterHighlight} />
            <stop offset="100%" stopColor={waterBase} />
          </linearGradient>

          {/* Ridge shading */}
          <linearGradient id={`ridgeGrad-${scene.id}-${isBaseline ? 't1' : 't2'}`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={ridgeColor} stopOpacity="0.95" />
            <stop offset="50%" stopColor={soilColor} stopOpacity="0.75" />
            <stop offset="100%" stopColor={ridgeColor} stopOpacity="0.9" />
          </linearGradient>

          {/* Crop mosaic pattern */}
          <pattern id={`cropPat-${scene.id}-${isBaseline ? 't1' : 't2'}`} width="36" height="26" patternUnits="userSpaceOnUse">
            <rect width="34" height="24" fill={vegColor} opacity={isT1Dry ? 0.45 : 0.85} />
            <rect x="2" y="2" width="14" height="10" fill={vegHighlight} opacity={isT1Dry ? 0.35 : 0.9} />
            <line x1="0" y1="25" x2="36" y2="25" stroke="#1e293b" strokeWidth="0.8" opacity="0.3" />
            <line x1="35" y1="0" x2="35" y2="26" stroke="#1e293b" strokeWidth="0.8" opacity="0.3" />
          </pattern>

          {/* Change Mask Hatch Pattern */}
          <pattern id="vegChangeHatch" width="10" height="10" patternTransform="rotate(45 0 0)" patternUnits="userSpaceOnUse">
            <line x1="0" y1="0" x2="0" y2="10" stroke="#22c55e" strokeWidth="2.5" opacity="0.8" />
          </pattern>
        </defs>

        {/* 1. Base Terrain Background */}
        <rect width="1000" height="650" fill={soilColor} />

        {/* 2. Sahyadri / Western Ghats Foothills & Sinhagad Ridges */}
        <path
          d="M -20,120 Q 180,60 380,140 T 780,90 Q 920,130 1020,80 L 1020,0 L -20,0 Z"
          fill={`url(#ridgeGrad-${scene.id}-${isBaseline ? 't1' : 't2'})`}
        />
        <path
          d="M 50,650 Q 250,480 440,540 T 820,490 Q 940,560 1020,530 L 1020,650 Z"
          fill={`url(#ridgeGrad-${scene.id}-${isBaseline ? 't1' : 't2'})`}
        />

        {/* 3. Agricultural Parcels (Haveli Valley) */}
        {showVegetation && (
          <g>
            <polygon
              points="120,160 520,170 590,440 280,480 90,320"
              fill={`url(#cropPat-${scene.id}-${isBaseline ? 't1' : 't2'})`}
            />
            <polygon
              points="580,240 890,210 940,460 620,490"
              fill={`url(#cropPat-${scene.id}-${isBaseline ? 't1' : 't2'})`}
              opacity="0.9"
            />
          </g>
        )}

        {/* 4. Mutha & Mula River Drainage Channels */}
        {showWater && (
          <g>
            {/* Riverbed channel */}
            <path
              d="M 20,40 C 140,80 210,180 290,230 S 420,290 510,310 S 710,360 840,430 S 960,540 1020,590"
              fill="none"
              stroke={`url(#waterGrad-${scene.id}-${isBaseline ? 't1' : 't2'})`}
              strokeWidth={isT1Dry ? "14" : "30"}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity="0.95"
            />
            <path
              d="M 20,40 C 140,80 210,180 290,230 S 420,290 510,310 S 710,360 840,430 S 960,540 1020,590"
              fill="none"
              stroke={waterHighlight}
              strokeWidth={isT1Dry ? "5" : "12"}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity="0.75"
            />
          </g>
        )}

        {/* 5. Khadakwasla Reservoir Water Body */}
        {showWater && (
          <g>
            {isT1Dry ? (
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
                  fill={`url(#waterGrad-${scene.id}-${isBaseline ? 't1' : 't2'})`}
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
                  fill={`url(#waterGrad-${scene.id}-${isBaseline ? 't1' : 't2'})`}
                  stroke="#38bdf8"
                  strokeWidth="3"
                  opacity="0.98"
                />
                {/* Spillway discharge turbulent plume */}
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
        )}

        {/* 6. Urban & Industrial Zones (Hinjawadi / Pimpri) */}
        {showBuiltup && (
          <g>
            <polygon
              points="180,310 260,305 275,370 195,375"
              fill={urbanColor}
              opacity="0.5"
              stroke="#334155"
              strokeWidth="1.2"
            />
            <polygon
              points="730,150 830,140 845,210 740,225"
              fill={urbanColor}
              opacity="0.5"
              stroke="#334155"
              strokeWidth="1.2"
            />
            {/* T2 Slight expansion along Hinjawadi Phase-3 (+1.9%) */}
            {!isT1Dry && (
              <polygon
                points="260,305 295,302 305,345 275,350"
                fill="#64748b"
                opacity="0.75"
                stroke="#38bdf8"
                strokeWidth="1"
              />
            )}
          </g>
        )}

        {/* 7. GIS CHANGE MASK LAYER OVERLAY (Spatially accurate delta masks) */}
        {showChangeMask && (
          <g>
            {/* WATER CHANGE MASK (+154% Inundation delta) */}
            {(activeCategory === 'ALL' || activeCategory === 'WATER') && (
              <g id="mask-water">
                <path
                  d="M 445,235 C 485,195 585,190 640,210 C 695,230 740,275 720,380 C 700,440 615,450 500,425 C 450,405 420,320 445,235 Z"
                  fill="rgba(6, 182, 212, 0.45)"
                  stroke="#06b6d4"
                  strokeWidth="2.5"
                  strokeDasharray="6 3"
                />
                {/* Channel expansion mask */}
                <path
                  d="M 20,40 C 140,80 210,180 290,230 S 420,290 510,310 S 710,360 840,430 S 960,540 1020,590"
                  fill="none"
                  stroke="rgba(6, 182, 212, 0.55)"
                  strokeWidth="20"
                  strokeDasharray="4 4"
                />
              </g>
            )}

            {/* VEGETATION CANOPY FLUSH MASK (+168.4% NDVI) */}
            {(activeCategory === 'ALL' || activeCategory === 'VEGETATION') && (
              <g id="mask-veg">
                <polygon
                  points="140,180 500,190 560,420 260,450 110,310"
                  fill="url(#vegChangeHatch)"
                  stroke="#22c55e"
                  strokeWidth="2"
                  opacity="0.85"
                />
                <polygon
                  points="600,260 870,230 920,440 640,470"
                  fill="url(#vegChangeHatch)"
                  stroke="#22c55e"
                  strokeWidth="1.8"
                  opacity="0.85"
                />
              </g>
            )}

            {/* BARE GROUND REDUCTION MASK (-63.0%) */}
            {(activeCategory === 'ALL' || activeCategory === 'BARE_GROUND') && (
              <g id="mask-soil">
                <path
                  d="M -10,100 Q 180,50 360,130 T 760,80 Q 900,120 1010,70 L 1010,0 L -10,0 Z"
                  fill="rgba(245, 158, 11, 0.35)"
                  stroke="#f59e0b"
                  strokeWidth="1.8"
                  strokeDasharray="3 3"
                />
              </g>
            )}

            {/* BUILT-UP EXPANSION MASK (+1.9%) */}
            {(activeCategory === 'ALL' || activeCategory === 'BUILT_UP') && (
              <g id="mask-urban">
                <rect
                  x="262"
                  y="302"
                  width="44"
                  height="45"
                  fill="rgba(239, 68, 68, 0.45)"
                  stroke="#ef4444"
                  strokeWidth="2"
                  strokeDasharray="4 2"
                />
              </g>
            )}
          </g>
        )}

        {/* 8. AOI Boundary & Grid */}
        {showAoi && (
          <g>
            <rect
              x="140"
              y="110"
              width="720"
              height="440"
              fill="none"
              stroke="var(--color-aoi-cyan)"
              strokeWidth="2"
              strokeDasharray="8 4"
            />
            {/* Corner Crosshairs */}
            <line x1="130" y1="110" x2="150" y2="110" stroke="#06b6d4" strokeWidth="2.5" />
            <line x1="140" y1="100" x2="140" y2="120" stroke="#06b6d4" strokeWidth="2.5" />
            <line x1="850" y1="110" x2="870" y2="110" stroke="#06b6d4" strokeWidth="2.5" />
            <line x1="860" y1="100" x2="860" y2="120" stroke="#06b6d4" strokeWidth="2.5" />
            <line x1="130" y1="550" x2="150" y2="550" stroke="#06b6d4" strokeWidth="2.5" />
            <line x1="140" y1="540" x2="140" y2="560" stroke="#06b6d4" strokeWidth="2.5" />
            <line x1="850" y1="550" x2="870" y2="550" stroke="#06b6d4" strokeWidth="2.5" />
            <line x1="860" y1="540" x2="860" y2="560" stroke="#06b6d4" strokeWidth="2.5" />
          </g>
        )}

        {/* 1km Coordinate Grids */}
        <g opacity="0.35">
          {[200, 380, 560, 740, 920].map((gx) => (
            <line key={`gx-${gx}`} x1={gx} y1="0" x2={gx} y2="650" stroke="#cbd5e1" strokeWidth="0.8" strokeDasharray="3 4" />
          ))}
          {[120, 260, 400, 540].map((gy) => (
            <line key={`gy-${gy}`} x1="0" y1={gy} x2="1000" y2={gy} stroke="#cbd5e1" strokeWidth="0.8" strokeDasharray="3 4" />
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
      {/* 1. TOP INVESTIGATION BANNER & CONTEXT */}
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
            <div style={{
              width: '22px',
              height: '22px',
              background: 'rgba(56, 189, 248, 0.15)',
              border: '1px solid #38bdf8',
              borderRadius: 'var(--radius-xs)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#38bdf8',
            }}>
              <GitCompare size={13} strokeWidth={2.4} />
            </div>
            <div>
              <span style={{ fontWeight: 700, fontSize: '12px', color: '#ffffff', letterSpacing: '0.04em' }}>
                CHANGE ANALYSIS
              </span>
              <span style={{ fontSize: '11px', color: 'var(--color-chrome-muted)', marginLeft: '8px' }}>
                {currentAoi.name} [{currentAoi.code}]
              </span>
            </div>
          </div>

          <div style={{ height: '14px', width: '1px', background: 'var(--color-chrome-border)' }} />

          {/* Core investigation premise */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }} className="font-mono text-xs">
            <span style={{ color: '#38bdf8', fontWeight: 600 }}>T1: {t1Scene.acquisitionDate.split('T')[0]}</span>
            <span style={{ color: 'var(--color-chrome-muted)' }}>→</span>
            <span style={{ color: '#22c55e', fontWeight: 600 }}>T2: {t2Scene.acquisitionDate.split('T')[0]}</span>
            <span style={{ color: 'var(--color-chrome-muted)', fontSize: '10px' }}>({temporalDays}d delta)</span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className="badge badge-amber" style={{ fontSize: '9.5px', fontWeight: 600 }}>
            LOCAL MOCK ANALYSIS
          </span>
          <span className="badge badge-blue" style={{ fontSize: '9.5px' }}>
            GRID: {currentAoi.mgrsGrid}
          </span>
        </div>
      </div>

      {/* 2. COMPARISON MODES & LAYER CONTROLS COMMAND STRIP */}
      <div style={{
        background: 'var(--color-surface-subtle)',
        borderBottom: '1px solid var(--color-border-standard)',
        padding: '5px 12px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
        fontSize: '11px',
        gap: '8px',
      }}>
        {/* Left: Mode Buttons (SIDE-BY-SIDE / SWIPE / OVERLAY) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', marginRight: '2px' }}>
            VIEW MODE:
          </span>
          {[
            { id: 'side-by-side', label: 'SIDE-BY-SIDE' },
            { id: 'swipe', label: 'SWIPE' },
            { id: 'overlay', label: 'OVERLAY' },
          ].map((mode) => (
            <button
              key={mode.id}
              onClick={() => setComparisonMode(mode.id as ComparisonMode)}
              className="btn btn-sm"
              style={{
                height: '22px',
                padding: '0 8px',
                fontSize: '10.5px',
                fontWeight: comparisonMode === mode.id ? 700 : 500,
                background: comparisonMode === mode.id ? 'var(--color-chrome-bg)' : 'transparent',
                color: comparisonMode === mode.id ? '#38bdf8' : 'var(--color-text-secondary)',
                borderColor: comparisonMode === mode.id ? 'var(--color-chrome-border)' : 'var(--color-border-subtle)',
              }}
            >
              {mode.label}
            </button>
          ))}

          {/* Opacity slider visible only in OVERLAY mode */}
          {comparisonMode === 'overlay' && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              marginLeft: '8px',
              background: 'var(--color-surface-base)',
              border: '1px solid var(--color-border-standard)',
              padding: '1px 8px',
              borderRadius: 'var(--radius-xs)',
            }}>
              <span className="font-mono" style={{ fontSize: '10px', color: 'var(--color-text-muted)' }}>
                T2 OPACITY:
              </span>
              <input
                type="range"
                min="0"
                max="100"
                value={overlayOpacity}
                onChange={(e) => setOverlayOpacity(Number(e.target.value))}
                style={{ width: '80px', height: '14px', cursor: 'ew-resize' }}
              />
              <span className="font-mono text-xs" style={{ minWidth: '32px', textAlign: 'right', fontWeight: 600 }}>
                {overlayOpacity}%
              </span>
            </div>
          )}
        </div>

        {/* Middle: Change Category Filters */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
          <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', marginRight: '2px' }}>
            CHANGE CATEGORY:
          </span>
          {[
            { id: 'ALL', label: 'ALL' },
            { id: 'WATER', label: 'WATER' },
            { id: 'VEGETATION', label: 'VEGETATION' },
            { id: 'BARE_GROUND', label: 'BARE GROUND' },
            { id: 'BUILT_UP', label: 'BUILT-UP' },
          ].map((cat) => (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id as ChangeCategory)}
              className="btn btn-sm"
              style={{
                height: '21px',
                padding: '0 6px',
                fontSize: '10px',
                fontWeight: activeCategory === cat.id ? 700 : 500,
                background: activeCategory === cat.id ? '#0284c7' : 'transparent',
                color: activeCategory === cat.id ? '#ffffff' : 'var(--color-text-secondary)',
                borderColor: activeCategory === cat.id ? '#0369a1' : 'var(--color-border-subtle)',
              }}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Right: Layer Toggles */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <button
            onClick={() => setShowImagery(!showImagery)}
            className={`btn btn-sm ${showImagery ? 'badge-blue' : ''}`}
            style={{ height: '21px', fontSize: '9.5px', padding: '0 5px' }}
            title="Toggle Base Satellite Imagery"
          >
            {showImagery ? '☑' : '☐'} IMAGERY
          </button>
          <button
            onClick={() => setShowChangeMask(!showChangeMask)}
            className={`btn btn-sm ${showChangeMask ? 'badge-blue' : ''}`}
            style={{ height: '21px', fontSize: '9.5px', padding: '0 5px', fontWeight: 600 }}
            title="Toggle GIS Change Mask Layer"
          >
            {showChangeMask ? '☑' : '☐'} CHANGE MASK
          </button>
          <button
            onClick={() => setShowWater(!showWater)}
            className={`btn btn-sm ${showWater ? 'badge-blue' : ''}`}
            style={{ height: '21px', fontSize: '9.5px', padding: '0 5px' }}
          >
            {showWater ? '☑' : '☐'} WATER
          </button>
          <button
            onClick={() => setShowVegetation(!showVegetation)}
            className={`btn btn-sm ${showVegetation ? 'badge-blue' : ''}`}
            style={{ height: '21px', fontSize: '9.5px', padding: '0 5px' }}
          >
            {showVegetation ? '☑' : '☐'} VEG
          </button>
          <button
            onClick={() => setShowBuiltup(!showBuiltup)}
            className={`btn btn-sm ${showBuiltup ? 'badge-blue' : ''}`}
            style={{ height: '21px', fontSize: '9.5px', padding: '0 5px' }}
          >
            {showBuiltup ? '☑' : '☐'} BUILT-UP
          </button>
          <button
            onClick={() => setShowAoi(!showAoi)}
            className={`btn btn-sm ${showAoi ? 'badge-blue' : ''}`}
            style={{ height: '21px', fontSize: '9.5px', padding: '0 5px' }}
          >
            {showAoi ? '☑' : '☐'} AOI
          </button>
        </div>
      </div>

      {/* Notification Toast */}
      {notification && (
        <div style={{
          background: 'var(--color-accent-blue-subtle)',
          borderBottom: '1px solid #bae6fd',
          padding: '4px 12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '11px',
          color: '#0369a1',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <CheckCircle2 size={13} style={{ color: '#0284c7' }} />
            <span className="font-mono">{notification}</span>
          </div>
          <button
            onClick={() => setNotification(null)}
            className="btn btn-sm"
            style={{ fontSize: '10px', padding: '0 4px', height: '18px' }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* 3. CENTRAL DUAL SATELLITE IMAGERY VIEWER */}
      <div style={{
        flex: '1 1 380px',
        minHeight: '320px',
        maxHeight: '440px',
        position: 'relative',
        background: '#0a0f1d',
        overflow: 'hidden',
        display: 'flex',
        borderBottom: '1px solid var(--color-border-standard)',
      }}>
        {/* MODE A: SIDE-BY-SIDE VIEWPORT */}
        {comparisonMode === 'side-by-side' && (
          <div style={{ flex: 1, display: 'flex', height: '100%', width: '100%' }}>
            {/* Left Pane: T1 Baseline */}
            <div style={{
              flex: 1,
              position: 'relative',
              borderRight: '1px solid var(--color-border-dark)',
              height: '100%',
              overflow: 'hidden',
            }}>
              {/* T1 Header Pill */}
              <div style={{
                position: 'absolute',
                top: '8px',
                left: '8px',
                zIndex: 10,
                background: 'rgba(12, 20, 36, 0.92)',
                border: '1px solid var(--color-chrome-border)',
                padding: '4px 8px',
                borderRadius: 'var(--radius-xs)',
                fontFamily: 'var(--font-mono)',
                fontSize: '10.5px',
                color: '#e2e8f0',
                pointerEvents: 'none',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span className="badge badge-amber" style={{ fontSize: '9px' }}>T1 BASELINE</span>
                  <span style={{ fontWeight: 700, color: '#f8fafc' }}>
                    15 MAY 2025
                  </span>
                  <span style={{ color: '#94a3b8' }}>({t1Scene.satellite})</span>
                </div>
                <div style={{ fontSize: '9.5px', color: '#94a3b8', marginTop: '2px' }}>
                  Pre-Monsoon Dry | Cloud: {t1Scene.cloudCoverPercent}% | 10m BOA
                </div>
              </div>

              {renderCartographicSvg(t1Scene, true)}
            </div>

            {/* Right Pane: T2 Comparison */}
            <div style={{
              flex: 1,
              position: 'relative',
              height: '100%',
              overflow: 'hidden',
            }}>
              {/* T2 Header Pill */}
              <div style={{
                position: 'absolute',
                top: '8px',
                left: '8px',
                zIndex: 10,
                background: 'rgba(12, 20, 36, 0.92)',
                border: '1px solid var(--color-chrome-border)',
                padding: '4px 8px',
                borderRadius: 'var(--radius-xs)',
                fontFamily: 'var(--font-mono)',
                fontSize: '10.5px',
                color: '#e2e8f0',
                pointerEvents: 'none',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span className="badge badge-green" style={{ fontSize: '9px' }}>T2 COMPARISON</span>
                  <span style={{ fontWeight: 700, color: '#f8fafc' }}>
                    {t2Scene.acquisitionDate.split('T')[0]}
                  </span>
                  <span style={{ color: '#38bdf8' }}>({t2Scene.satellite})</span>
                </div>
                <div style={{ fontSize: '9.5px', color: '#94a3b8', marginTop: '2px' }}>
                  Post-Monsoon Peak | Cloud: {t2Scene.cloudCoverPercent}% | 10m BOA
                </div>
              </div>

              {renderCartographicSvg(t2Scene, false)}
            </div>
          </div>
        )}

        {/* MODE B: SWIPE VIEWPORT (Draggable vertical slider) */}
        {comparisonMode === 'swipe' && (
          <div
            ref={swipeContainerRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            style={{
              flex: 1,
              position: 'relative',
              width: '100%',
              height: '100%',
              cursor: isDraggingSwipe ? 'ew-resize' : 'default',
              userSelect: 'none',
              touchAction: 'none',
            }}
          >
            {/* Underneath: T1 Baseline */}
            <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}>
              {renderCartographicSvg(t1Scene, true)}
            </div>

            {/* Overlaid clipped: T2 Comparison */}
            <div style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              clipPath: `polygon(${swipePos}% 0, 100% 0, 100% 100%, ${swipePos}% 100%)`,
              WebkitClipPath: `polygon(${swipePos}% 0, 100% 0, 100% 100%, ${swipePos}% 100%)`,
            }}>
              {renderCartographicSvg(t2Scene, false)}
            </div>

            {/* Draggable Vertical Divider Bar */}
            <div style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: `${swipePos}%`,
              width: '2px',
              background: '#38bdf8',
              boxShadow: '0 0 8px rgba(56, 189, 248, 0.8)',
              zIndex: 30,
              cursor: 'ew-resize',
              transform: 'translateX(-50%)',
            }}>
              {/* Central Grip Handle */}
              <div style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                background: '#0c1424',
                border: '2px solid #38bdf8',
                borderRadius: 'var(--radius-xs)',
                padding: '4px 6px',
                fontFamily: 'var(--font-mono)',
                fontSize: '9.5px',
                fontWeight: 700,
                color: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                whiteSpace: 'nowrap',
                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.5)',
              }}>
                <span>◄ SWIPE ►</span>
              </div>
            </div>

            {/* Swipe Labels HUD */}
            <div style={{
              position: 'absolute',
              top: '8px',
              left: '8px',
              background: 'rgba(12, 20, 36, 0.92)',
              border: '1px solid var(--color-chrome-border)',
              padding: '3px 8px',
              borderRadius: 'var(--radius-xs)',
              fontFamily: 'var(--font-mono)',
              fontSize: '10px',
              color: '#f8fafc',
              zIndex: 20,
              pointerEvents: 'none',
            }}>
              T1: 15 MAY 2025 ({t1Scene.satellite})
            </div>

            <div style={{
              position: 'absolute',
              top: '8px',
              right: '8px',
              background: 'rgba(12, 20, 36, 0.92)',
              border: '1px solid var(--color-chrome-border)',
              padding: '3px 8px',
              borderRadius: 'var(--radius-xs)',
              fontFamily: 'var(--font-mono)',
              fontSize: '10px',
              color: '#38bdf8',
              zIndex: 20,
              pointerEvents: 'none',
            }}>
              T2: {t2Scene.acquisitionDate.split('T')[0]} ({t2Scene.satellite})
            </div>
          </div>
        )}

        {/* MODE C: OVERLAY VIEWPORT (Adjustable Opacity) */}
        {comparisonMode === 'overlay' && (
          <div style={{ flex: 1, position: 'relative', width: '100%', height: '100%' }}>
            {/* T1 Base */}
            <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}>
              {renderCartographicSvg(t1Scene, true)}
            </div>

            {/* T2 Overlaid with adjustable opacity */}
            <div style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              opacity: overlayOpacity / 100,
              transition: 'opacity 0.05s linear',
            }}>
              {renderCartographicSvg(t2Scene, false)}
            </div>

            {/* Overlay Indicator Badge */}
            <div style={{
              position: 'absolute',
              top: '8px',
              left: '8px',
              background: 'rgba(12, 20, 36, 0.92)',
              border: '1px solid var(--color-chrome-border)',
              padding: '4px 8px',
              borderRadius: 'var(--radius-xs)',
              fontFamily: 'var(--font-mono)',
              fontSize: '10.5px',
              color: '#f8fafc',
              zIndex: 20,
              pointerEvents: 'none',
            }}>
              OVERLAY BLEND: T1 (15 MAY) + T2 ({t2Scene.acquisitionDate.split('T')[0]} @ {overlayOpacity}%)
            </div>
          </div>
        )}

        {/* Change Mask Legend (Bottom Right HUD) */}
        {showChangeMask && (
          <div style={{
            position: 'absolute',
            bottom: '8px',
            right: '8px',
            background: 'rgba(12, 20, 36, 0.92)',
            border: '1px solid var(--color-chrome-border)',
            borderRadius: 'var(--radius-xs)',
            padding: '5px 8px',
            zIndex: 25,
            fontSize: '9.5px',
            fontFamily: 'var(--font-mono)',
            display: 'flex',
            flexDirection: 'column',
            gap: '3px',
            pointerEvents: 'none',
          }}>
            <div style={{ fontSize: '8.5px', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '1px' }}>
              CHANGE MASK LEGEND
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#38bdf8' }}>
              <span style={{ width: '8px', height: '8px', background: 'rgba(6, 182, 212, 0.7)', border: '1px solid #06b6d4' }} />
              <span>WATER INUNDATION (+154%)</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#4ade80' }}>
              <span style={{ width: '8px', height: '8px', background: 'rgba(34, 197, 94, 0.7)', border: '1px solid #22c55e' }} />
              <span>VEGETATION FLUSH (+168%)</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#fde68a' }}>
              <span style={{ width: '8px', height: '8px', background: 'rgba(245, 158, 11, 0.7)', border: '1px solid #f59e0b' }} />
              <span>BARE GROUND LOSS (-63%)</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#f87171' }}>
              <span style={{ width: '8px', height: '8px', background: 'rgba(239, 68, 68, 0.7)', border: '1px solid #ef4444' }} />
              <span>BUILT-UP CHANGE (+1.9%)</span>
            </div>
          </div>
        )}
      </div>

      {/* 4. TEMPORAL ACQUISITION TIMELINE STRIP */}
      <div style={{
        background: 'var(--color-surface-subtle)',
        borderBottom: '1px solid var(--color-border-standard)',
        padding: '5px 12px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Clock size={12} style={{ color: 'var(--color-text-muted)' }} />
            <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>
              SERIES TIMELINE:
            </span>
          </div>
          <button
            onClick={() => {
              const temp = t1Scene;
              setT1Scene(t2Scene);
              setT2Scene(temp);
            }}
            className="btn btn-sm"
            title="Swap T1 Baseline and T2 Comparison scenes"
            style={{ height: '20px', fontSize: '9px', padding: '0 5px', gap: '3px' }}
          >
            <RotateCcw size={10} />
            <span>Swap T1 ⇄ T2</span>
          </button>
        </div>

        {/* Series dates */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflowX: 'auto', flex: 1, marginLeft: '12px' }}>
          {allScenes.map((s) => {
            const isT1 = s.id === t1Scene.id;
            const isT2 = s.id === t2Scene.id;
            const dateStr = s.acquisitionDate.split('T')[0];

            return (
              <button
                key={s.id}
                onClick={() => {
                  if (!isT1) {
                    setT2Scene(s);
                  }
                }}
                className="btn btn-sm"
                style={{
                  height: '24px',
                  padding: '0 8px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  background: isT2
                    ? 'rgba(2, 132, 199, 0.15)'
                    : isT1
                    ? 'rgba(245, 158, 11, 0.15)'
                    : 'var(--color-surface-base)',
                  borderColor: isT2 ? '#0284c7' : isT1 ? '#f59e0b' : 'var(--color-border-subtle)',
                  color: isT2 ? '#0369a1' : isT1 ? '#b45309' : 'var(--color-text-primary)',
                  fontWeight: isT1 || isT2 ? 700 : 500,
                  fontSize: '10.5px',
                  fontFamily: 'var(--font-mono)',
                }}
                title={`Click to set as T2 Comparison Scene (${s.satellite})`}
              >
                {isT1 && (
                  <span style={{
                    fontSize: '9px',
                    padding: '0 3px',
                    background: '#f59e0b',
                    color: '#ffffff',
                    borderRadius: 'var(--radius-xs)',
                  }}>
                    T1
                  </span>
                )}
                {isT2 && (
                  <span style={{
                    fontSize: '9px',
                    padding: '0 3px',
                    background: '#0284c7',
                    color: '#ffffff',
                    borderRadius: 'var(--radius-xs)',
                  }}>
                    T2
                  </span>
                )}
                <span>{dateStr}</span>
                <span style={{ color: 'var(--color-text-muted)', fontSize: '9.5px' }}>
                  ☁{s.cloudCoverPercent}%
                </span>
              </button>
            );
          })}
        </div>

        <span className="font-mono text-xs" style={{ color: 'var(--color-text-muted)', fontSize: '10px' }}>
          INTERVAL: {temporalDays} DAYS
        </span>
      </div>

      {/* 5. BOTTOM TECHNICAL ANALYTICAL PANELS (3 COLUMNS) */}
      <div style={{
        flex: '1 1 auto',
        overflowY: 'auto',
        padding: '10px 12px',
        display: 'grid',
        gridTemplateColumns: '1.2fr 0.95fr 1.05fr',
        gap: '10px',
        background: 'var(--color-canvas)',
      }}>
        {/* COLUMN 1: QUANTITATIVE CHANGE METRICS */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>
              Quantitative Spectral Metrics
            </span>
            <span className="badge badge-amber" style={{ fontSize: '9px' }}>
              LOCAL MOCK ANALYSIS
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {/* Metric 1: Water Extent */}
            <div
              onClick={() => setActiveCategory('WATER')}
              className="panel"
              style={{
                padding: '7px 9px',
                cursor: 'pointer',
                borderColor: activeCategory === 'WATER' ? '#0284c7' : 'var(--color-border-standard)',
                background: activeCategory === 'WATER' ? '#f0f9ff' : 'var(--color-surface-base)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <Droplets size={13} style={{ color: '#0284c7' }} />
                  <span style={{ fontSize: '11px', fontWeight: 600 }}>Water Extent (NDWI)</span>
                </div>
                <span className="badge badge-green" style={{ fontWeight: 700 }}>
                  +154.0%
                </span>
              </div>
              <div className="font-mono" style={{ fontSize: '12px', fontWeight: 700, color: '#0369a1', marginTop: '3px' }}>
                11.20 km² → 28.45 km² (+17.25 km²)
              </div>
              <div style={{ fontSize: '10px', color: 'var(--color-text-muted)', marginTop: '2px', lineHeight: 1.3 }}>
                Khadakwasla reservoir level at 100% capacity; Mutha discharge channels flooded post-monsoon.
              </div>
            </div>

            {/* Metric 2: Vegetation / NDVI */}
            <div
              onClick={() => setActiveCategory('VEGETATION')}
              className="panel"
              style={{
                padding: '7px 9px',
                cursor: 'pointer',
                borderColor: activeCategory === 'VEGETATION' ? '#15803d' : 'var(--color-border-standard)',
                background: activeCategory === 'VEGETATION' ? '#f0fdf4' : 'var(--color-surface-base)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <Trees size={13} style={{ color: '#15803d' }} />
                  <span style={{ fontSize: '11px', fontWeight: 600 }}>Vegetation Canopy (NDVI)</span>
                </div>
                <span className="badge badge-green" style={{ fontWeight: 700 }}>
                  +168.4%
                </span>
              </div>
              <div className="font-mono" style={{ fontSize: '12px', fontWeight: 700, color: '#15803d', marginTop: '3px' }}>
                0.228 → 0.612 NDVI (+0.384)
              </div>
              <div style={{ fontSize: '10px', color: 'var(--color-text-muted)', marginTop: '2px', lineHeight: 1.3 }}>
                Chlorophyll flush across Western Ghats ridges & Haveli agricultural sugarcane plain.
              </div>
            </div>

            {/* Metric 3: Soil / Bare Ground */}
            <div
              onClick={() => setActiveCategory('BARE_GROUND')}
              className="panel"
              style={{
                padding: '7px 9px',
                cursor: 'pointer',
                borderColor: activeCategory === 'BARE_GROUND' ? '#b45309' : 'var(--color-border-standard)',
                background: activeCategory === 'BARE_GROUND' ? '#fffbeb' : 'var(--color-surface-base)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <Mountain size={13} style={{ color: '#b45309' }} />
                  <span style={{ fontSize: '11px', fontWeight: 600 }}>Soil / Exposed Basalt</span>
                </div>
                <span className="badge badge-amber" style={{ fontWeight: 700 }}>
                  -63.0%
                </span>
              </div>
              <div className="font-mono" style={{ fontSize: '12px', fontWeight: 700, color: '#b45309', marginTop: '3px' }}>
                142.6 km² → 52.8 km² (-89.8 km²)
              </div>
              <div style={{ fontSize: '10px', color: 'var(--color-text-muted)', marginTop: '2px', lineHeight: 1.3 }}>
                Arid Deccan trap regolith converted to moist green cover and shallow surface inundation.
              </div>
            </div>

            {/* Metric 4: Built-up / Urban */}
            <div
              onClick={() => setActiveCategory('BUILT_UP')}
              className="panel"
              style={{
                padding: '7px 9px',
                cursor: 'pointer',
                borderColor: activeCategory === 'BUILT_UP' ? '#475569' : 'var(--color-border-standard)',
                background: activeCategory === 'BUILT_UP' ? '#f8fafc' : 'var(--color-surface-base)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <Building2 size={13} style={{ color: '#475569' }} />
                  <span style={{ fontSize: '11px', fontWeight: 600 }}>Built-up / Urban</span>
                </div>
                <span className="badge badge-neutral" style={{ fontWeight: 700 }}>
                  +1.9%
                </span>
              </div>
              <div className="font-mono" style={{ fontSize: '12px', fontWeight: 700, color: '#334155', marginTop: '3px' }}>
                38.40 km² → 39.12 km² (+0.72 km²)
              </div>
              <div style={{ fontSize: '10px', color: 'var(--color-text-muted)', marginTop: '2px', lineHeight: 1.3 }}>
                Minor impervious expansion identified along Hinjawadi Phase 3 and Pune Western Bypass.
              </div>
            </div>
          </div>
        </div>

        {/* COLUMN 2: QUALITY CHECKS & EARLIEST OBSERVATION */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {/* Quality & Confidence Card */}
          <div className="panel" style={{ flex: 1 }}>
            <div className="panel-header">
              <span>Analysis Quality</span>
              <span className="badge badge-green" style={{ fontSize: '9px' }}>DEMO / LOCAL MOCK</span>
            </div>
            <div className="panel-body font-mono text-xs" style={{ display: 'flex', flexDirection: 'column', gap: '5px', fontSize: '10.5px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span className="text-muted">CLOUD COVER T1:</span>
                <span style={{ fontWeight: 600 }}>{t1Scene.cloudCoverPercent}%</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span className="text-muted">CLOUD COVER T2:</span>
                <span style={{ fontWeight: 600 }}>{t2Scene.cloudCoverPercent}%</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span className="text-muted">TEMPORAL SEPARATION:</span>
                <span style={{ color: '#0284c7', fontWeight: 600 }}>{temporalDays} DAYS</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span className="text-muted">CO-REGISTRATION:</span>
                <span style={{ color: '#15803d', fontWeight: 700 }}>PASS</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span className="text-muted">SCENE QUALITY:</span>
                <span style={{ color: '#15803d', fontWeight: 700 }}>PASS</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span className="text-muted">SHADOW SCREENING:</span>
                <span style={{ color: '#15803d', fontWeight: 700 }}>PASS</span>
              </div>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                paddingTop: '4px',
                borderTop: '1px solid var(--color-border-subtle)',
                marginTop: '2px',
              }}>
                <span className="text-muted">ANALYSIS CONFIDENCE:</span>
                <span style={{ color: '#15803d', fontWeight: 700 }}>HIGH (0.94)</span>
              </div>
            </div>
          </div>

          {/* Earliest Supported Observation Card */}
          <div className="panel" style={{ flex: 1 }}>
            <div className="panel-header">
              <span>Earliest Supported Observation</span>
              <span className="font-mono text-xs" style={{ color: '#0284c7' }}>18 JUN 2025</span>
            </div>
            <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-text-primary)' }}>
                Initial water & vegetation transition detected in series.
              </div>
              <div style={{ fontSize: '10px', color: 'var(--color-text-muted)', lineHeight: 1.3 }}>
                First significant backwater expansion observed at Khadakwasla reservoir following early monsoon onset.
              </div>

              <div style={{ marginTop: '2px' }}>
                <div style={{ fontSize: '9.5px', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>
                  Supporting observation scenes:
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', marginTop: '3px' }}>
                  {['18 JUN 2025', '23 JUL 2025', '31 AUG 2025', '21 SEP 2025'].map((d) => (
                    <span key={d} className="badge badge-neutral" style={{ fontSize: '9px' }}>
                      ✓ {d}
                    </span>
                  ))}
                </div>
              </div>

              <div className="font-mono" style={{ fontSize: '9px', color: '#b45309', marginTop: '2px' }}>
                DEMO / LOCAL MOCK CALIBRATION
              </div>
            </div>
          </div>
        </div>

        {/* COLUMN 3: SELECTED CHANGE EVIDENCE & ANALYST REVIEW */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div className="panel" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div className="panel-header">
              <span>Selected Change Evidence</span>
              <span className="badge badge-blue">CONFIDENCE HIGH (0.94)</span>
            </div>
            <div className="panel-body" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div>
                <div className="font-mono text-xs text-muted" style={{ fontSize: '9.5px' }}>TARGET FEATURE</div>
                <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--color-text-primary)' }}>
                  Khadakwasla Reservoir Basin
                </div>
              </div>

              <div className="font-mono" style={{
                background: 'var(--color-surface-subtle)',
                border: '1px solid var(--color-border-subtle)',
                padding: '6px 8px',
                borderRadius: 'var(--radius-xs)',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
                fontSize: '10.5px',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span className="text-muted">OBSERVED CHANGE:</span>
                  <span style={{ fontWeight: 600, color: '#0369a1' }}>Water extent increase</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span className="text-muted">BASELINE (T1):</span>
                  <span>11.20 km²</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span className="text-muted">COMPARISON (T2):</span>
                  <span>28.45 km²</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span className="text-muted">RELATIVE CHANGE:</span>
                  <span style={{ fontWeight: 700, color: '#15803d' }}>+154.0% (+17.25 km²)</span>
                </div>
              </div>

              <div>
                <div className="font-mono text-xs text-muted" style={{ fontSize: '9.5px', marginBottom: '3px' }}>
                  SUPPORTING OBSERVATION TIMESTAMPS
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                  {['15 MAY 2025', '18 JUN 2025', '31 AUG 2025', '21 SEP 2025'].map((date) => (
                    <span key={date} className="badge badge-neutral font-mono" style={{ fontSize: '9.5px' }}>
                      {date}
                    </span>
                  ))}
                </div>
              </div>

              {/* Action Button: Send to Analyst Review */}
              <div style={{ marginTop: 'auto', paddingTop: '8px', borderTop: '1px solid var(--color-border-subtle)' }}>
                {reviewQueued ? (
                  <div style={{
                    padding: '8px',
                    background: 'rgba(21, 128, 61, 0.12)',
                    border: '1px solid rgba(34, 197, 94, 0.4)',
                    borderRadius: 'var(--radius-xs)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '2px',
                    alignItems: 'center',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px', color: '#15803d', fontWeight: 700, fontSize: '11px' }}>
                      <CheckCircle2 size={13} />
                      <span>QUEUED FOR REVIEW</span>
                    </div>
                    <div className="font-mono" style={{ fontSize: '9.5px', color: '#475569' }}>
                      EV-2025-0921-01 @ {reviewQueuedTime || '09:00:00'} UTC
                    </div>
                    {onNavigateSection && (
                      <button
                        onClick={() => onNavigateSection('review')}
                        className="btn btn-sm"
                        style={{ marginTop: '4px', width: '100%', fontSize: '10px' }}
                      >
                        <span>Open in Review Module [F4]</span>
                        <ArrowRight size={10} />
                      </button>
                    )}
                  </div>
                ) : (
                  <button
                    onClick={handleSendToReview}
                    className="btn btn-primary"
                    style={{ width: '100%', height: '30px', fontSize: '11px', fontWeight: 600 }}
                  >
                    <span>Send to Analyst Review</span>
                    <ArrowRight size={13} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
