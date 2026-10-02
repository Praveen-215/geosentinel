import React, { useState, useEffect } from 'react';
import {
  Layers,
  Search,
  Sliders,
  CheckCircle2,
  GitCompare,
  ArrowRight,
  Info,
  Calendar,
  Compass,
  MapPin,
} from 'lucide-react';
import {
  AOI,
  NavigationSection,
  SatelliteScene,
  SimilarSite,
  SimilarSiteReference,
  SimilarSiteSearchMode,
} from '../types';
import { similarSitesService } from '../services/similarSitesService';
import { MOCK_REFERENCE_SITE, MOCK_SIMILAR_SITES } from '../data/mockSimilarSites';

interface SimilarSitesPageProps {
  currentAoi: AOI;
  onNavigateSection?: (section: NavigationSection) => void;
  onStageComparisonScene?: (scene: SatelliteScene) => void;
}

export const SimilarSitesPage: React.FC<SimilarSitesPageProps> = ({
  currentAoi,
  onNavigateSection,
  onStageComparisonScene,
}) => {
  const referenceSite: SimilarSiteReference = MOCK_REFERENCE_SITE;

  // Search & Filter state
  const [searchConcept, setSearchConcept] = useState<string>('reservoir expansion near peri-urban landscape');
  const [searchMode, setSearchMode] = useState<SimilarSiteSearchMode>('HYBRID');
  const [similarityThreshold, setSimilarityThreshold] = useState<number>(0.78);
  const [searchRadiusKm, setSearchRadiusKm] = useState<number>(150);
  const [maxResults, setMaxResults] = useState<number>(8);

  // Feature weights
  const [weightWater, setWeightWater] = useState<number>(35);
  const [weightVeg, setWeightVeg] = useState<number>(15);
  const [weightBuiltup, setWeightBuiltup] = useState<number>(15);
  const [weightTerrain, setWeightTerrain] = useState<number>(15);
  const [weightSpatial, setWeightSpatial] = useState<number>(20);

  // Candidates & Selection
  const [candidates, setCandidates] = useState<SimilarSite[]>(MOCK_SIMILAR_SITES);
  const [selectedSiteId, setSelectedSiteId] = useState<string>('site-01-panshet');

  // Modals & Notifications
  const [showCompareModal, setShowCompareModal] = useState<boolean>(false);
  const [showMetadataModal, setShowMetadataModal] = useState<boolean>(false);
  const [notification, setNotification] = useState<string | null>(null);

  // Active selected site object
  const selectedSite = candidates.find((s) => s.id === selectedSiteId) || candidates[0] || MOCK_SIMILAR_SITES[0];

  // Filter effect
  useEffect(() => {
    let filtered = MOCK_SIMILAR_SITES.filter(
      (s) => s.similarityScore >= similarityThreshold && (s.searchDistanceKm ?? 0) <= searchRadiusKm
    );
    filtered = filtered.slice(0, maxResults);
    setCandidates(filtered);

    // If current selection is outside filtered list, pick the first
    if (!filtered.some((s) => s.id === selectedSiteId) && filtered.length > 0) {
      setSelectedSiteId(filtered[0].id);
    }
  }, [similarityThreshold, searchRadiusKm, maxResults, selectedSiteId]);

  // Stage candidate for Change Analysis (F3)
  const handleSendToChangeAnalysis = () => {
    const stagedScene = similarSitesService.stageSiteForComparison(selectedSite);
    if (onStageComparisonScene) {
      onStageComparisonScene(stagedScene);
    }
    setNotification(`Site [${selectedSite.name || selectedSite.tileId}] staged as Comparison Scene (T2) for Change Analysis.`);
    setTimeout(() => setNotification(null), 5000);
  };

  // Render SVG mini-preview for candidate cards
  const renderMiniPreview = (site: SimilarSite | SimilarSiteReference) => {
    const isReference = 'featureChips' in site;
    const waterColor = isReference ? '#0284c7' : site.waterSignature === 'HIGH' ? '#0369a1' : '#0284c7';
    const vegColor = (isReference ? site.terrain === 'Sahyadri foothills' : site.vegetationSignature === 'HIGH') ? '#15803d' : '#4d7c0f';
    const gradKey = ('id' in site ? site.id : site.mgrsTile).replace(/[^a-zA-Z0-9]/g, '');

    return (
      <svg
        viewBox="0 0 100 65"
        style={{
          width: '100%',
          height: '100%',
          background: '#0a0f1d',
          borderRadius: 'var(--radius-xs)',
          display: 'block',
        }}
      >
        <defs>
          <linearGradient id={`grad-${gradKey}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#1e293b" />
            <stop offset="100%" stopColor="#0f172a" />
          </linearGradient>
        </defs>
        <rect width="100" height="65" fill={`url(#grad-${gradKey})`} />
        {/* Ridges / Hilly terrain contours */}
        <path d="M 0,15 Q 30,5 60,20 T 100,10 L 100,0 L 0,0 Z" fill="#2d3748" opacity="0.8" />
        <path d="M 0,65 Q 40,45 70,55 T 100,50 L 100,65 Z" fill="#2d3748" opacity="0.8" />
        {/* Vegetation swath */}
        <ellipse cx="75" cy="35" rx="18" ry="12" fill={vegColor} opacity="0.6" />
        <ellipse cx="25" cy="40" rx="15" ry="10" fill={vegColor} opacity="0.5" />
        {/* Reservoir / Waterbody */}
        <path
          d="M 35,22 C 45,18 65,18 70,26 C 75,34 68,44 55,42 C 42,40 30,30 35,22 Z"
          fill={waterColor}
          stroke="#38bdf8"
          strokeWidth="1.2"
          opacity="0.9"
        />
        {/* River channel */}
        <path d="M 0,10 Q 25,20 35,24" stroke={waterColor} strokeWidth="2.5" fill="none" opacity="0.85" />
        <path d="M 70,26 Q 85,28 100,40" stroke={waterColor} strokeWidth="3" fill="none" opacity="0.85" />
        {/* Built-up fringe */}
        {((!isReference && site.builtUpSignature === 'HIGH') || isReference) && (
          <rect x="75" y="42" width="12" height="10" fill="#64748b" opacity="0.75" />
        )}
      </svg>
    );
  };

  // Render regional spatial GIS map preview
  const renderSpatialMap = () => {
    // Map bounds: Lat ~17.8 to 19.3, Lon ~73.2 to 75.3
    const projectX = (lon: number) => ((lon - 73.2) / (75.3 - 73.2)) * 360 + 20;
    const projectY = (lat: number) => ((19.3 - lat) / (19.3 - 17.8)) * 230 + 15;

    const refX = projectX(73.8567);
    const refY = projectY(18.5204);

    return (
      <svg
        viewBox="0 0 400 260"
        style={{
          width: '100%',
          height: '100%',
          background: '#090d16',
          borderRadius: 'var(--radius-xs)',
          display: 'block',
        }}
      >
        <defs>
          <radialGradient id="refGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* 1. Coordinate Grid Lines */}
        {[73.5, 74.0, 74.5, 75.0].map((lon) => {
          const gx = projectX(lon);
          return (
            <g key={`glon-${lon}`}>
              <line x1={gx} y1="0" x2={gx} y2="260" stroke="#1e293b" strokeWidth="0.8" strokeDasharray="3 3" />
              <text x={gx + 2} y="12" fill="#475569" fontSize="8" fontFamily="monospace">
                {lon}°E
              </text>
            </g>
          );
        })}
        {[18.0, 18.5, 19.0].map((lat) => {
          const gy = projectY(lat);
          return (
            <g key={`glat-${lat}`}>
              <line x1="0" y1={gy} x2="400" y2={gy} stroke="#1e293b" strokeWidth="0.8" strokeDasharray="3 3" />
              <text x="5" y={gy - 3} fill="#475569" fontSize="8" fontFamily="monospace">
                {lat}°N
              </text>
            </g>
          );
        })}

        {/* 2. Sahyadri Western Ghats Mountain Corridor (Shaded Backdrop) */}
        <path
          d="M 15,0 Q 45,60 55,130 T 40,260 L 95,260 Q 115,160 110,80 T 70,0 Z"
          fill="#1e293b"
          opacity="0.4"
        />

        {/* 3. Radius Rings from Reference Site (50km & 100km search rings) */}
        <circle cx={refX} cy={refY} r="45" fill="none" stroke="#0369a1" strokeWidth="1" strokeDasharray="4 3" opacity="0.4" />
        <circle cx={refX} cy={refY} r="90" fill="none" stroke="#0369a1" strokeWidth="0.8" strokeDasharray="4 3" opacity="0.25" />
        <text x={refX + 48} y={refY - 5} fill="#0284c7" fontSize="7.5" fontFamily="monospace" opacity="0.7">
          50 km RADIUS
        </text>

        {/* 4. Vectors connecting Reference to Candidates */}
        {candidates.map((site) => {
          const siteLon = site.longitude ?? (site.tileBbox ? (site.tileBbox.minLon + site.tileBbox.maxLon) / 2 : 73.85);
          const siteLat = site.latitude ?? (site.tileBbox ? (site.tileBbox.minLat + site.tileBbox.maxLat) / 2 : 18.52);
          const cx = projectX(siteLon);
          const cy = projectY(siteLat);
          const isSelected = site.id === selectedSiteId;
          return (
            <line
              key={`line-${site.id}`}
              x1={refX}
              y1={refY}
              x2={cx}
              y2={cy}
              stroke={isSelected ? '#38bdf8' : '#334155'}
              strokeWidth={isSelected ? 1.5 : 0.8}
              strokeDasharray={isSelected ? 'none' : '2 2'}
              opacity={isSelected ? 0.9 : 0.4}
            />
          );
        })}

        {/* 5. Reference Site Marker (Khadakwasla Basin) */}
        <circle cx={refX} cy={refY} r="18" fill="url(#refGlow)" />
        <circle cx={refX} cy={refY} r="5" fill="#f59e0b" stroke="#ffffff" strokeWidth="1.5" />
        <text x={refX + 8} y={refY - 7} fill="#fcd34d" fontSize="8.5" fontWeight="bold" fontFamily="monospace">
          REF: KHADAKWASLA
        </text>

        {/* 6. Candidate Site Markers */}
        {candidates.map((site) => {
          const siteLon = site.longitude ?? (site.tileBbox ? (site.tileBbox.minLon + site.tileBbox.maxLon) / 2 : 73.85);
          const siteLat = site.latitude ?? (site.tileBbox ? (site.tileBbox.minLat + site.tileBbox.maxLat) / 2 : 18.52);
          const cx = projectX(siteLon);
          const cy = projectY(siteLat);
          const isSelected = site.id === selectedSiteId;
          const siteLabel = site.name || site.tileId;

          return (
            <g
              key={`pin-${site.id}`}
              onClick={() => setSelectedSiteId(site.id)}
              style={{ cursor: 'pointer' }}
            >
              {isSelected && (
                <circle cx={cx} cy={cy} r="12" fill="none" stroke="#38bdf8" strokeWidth="1.8" strokeDasharray="3 2" />
              )}
              <circle
                cx={cx}
                cy={cy}
                r={isSelected ? 6 : 4}
                fill={isSelected ? '#38bdf8' : '#0284c7'}
                stroke="#ffffff"
                strokeWidth={1}
              />
              <text
                x={cx + 7}
                y={cy + 3}
                fill={isSelected ? '#38bdf8' : '#cbd5e1'}
                fontSize={isSelected ? '8.5' : '7.5'}
                fontWeight={isSelected ? 'bold' : 'normal'}
                fontFamily="monospace"
              >
                0{site.rank} {siteLabel.split(' ')[0]}
              </text>
            </g>
          );
        })}

        {/* Map Legend HUD */}
        <g transform="translate(10, 225)">
          <rect width="130" height="28" fill="rgba(15, 23, 42, 0.85)" rx="3" stroke="#334155" strokeWidth="0.8" />
          <circle cx="10" cy="10" r="3.5" fill="#f59e0b" />
          <text x="18" y="13" fill="#cbd5e1" fontSize="7.5" fontFamily="monospace">REFERENCE (43QDF)</text>
          <circle cx="10" cy="20" r="3.5" fill="#38bdf8" />
          <text x="18" y="23" fill="#cbd5e1" fontSize="7.5" fontFamily="monospace">CANDIDATE SITES</text>
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
      {/* 1. COMPACT TECHNICAL HEADER */}
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
            <Layers size={14} strokeWidth={2.4} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontWeight: 700, fontSize: '12px', color: '#ffffff', letterSpacing: '0.04em' }}>
                SIMILAR SITE DISCOVERY
              </span>
              <span className="badge badge-neutral" style={{ fontSize: '9px', fontWeight: 600 }}>
                MOD-F5
              </span>
              <span className="font-mono text-muted" style={{ fontSize: '10px' }}>
                {referenceSite.aoiId} • MGRS {referenceSite.mgrsTile}
              </span>
            </div>
            <div style={{ fontSize: '10.5px', color: 'var(--color-chrome-muted)' }}>
              Find locations with comparable spectral, land-cover and spatial characteristics
            </div>
          </div>
        </div>

        {/* Center / Right Header Context Tag */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div className="font-mono text-xs" style={{ display: 'flex', gap: '10px', color: '#94a3b8' }}>
            <span>REF: <strong style={{ color: '#f8fafc' }}>{referenceSite.feature}</strong></span>
            <span>DATE: <strong style={{ color: '#38bdf8' }}>{referenceSite.acquisitionDate}</strong></span>
            <span>CATALOG: <strong style={{ color: '#cbd5e1' }}>LOCAL DEMO</strong></span>
          </div>

          <span className="badge badge-amber" style={{ fontSize: '9px', fontWeight: 600 }}>
            DEMO / LOCAL MOCK
          </span>
        </div>
      </div>

      {/* Notification Toast */}
      {notification && (
        <div style={{
          background: 'rgba(56, 189, 248, 0.12)',
          borderBottom: '1px solid rgba(56, 189, 248, 0.4)',
          padding: '4px 12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '11px',
          color: '#0284c7',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <CheckCircle2 size={13} style={{ color: '#0284c7' }} />
            <span className="font-mono" style={{ fontWeight: 600 }}>{notification}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {onNavigateSection && (
              <button
                onClick={() => onNavigateSection('change-analysis')}
                className="btn btn-sm badge-blue"
                style={{ fontSize: '10px', padding: '0 6px', height: '20px' }}
              >
                <span>Go to Change Analysis [F3] →</span>
              </button>
            )}
            <button
              onClick={() => setNotification(null)}
              className="btn btn-sm"
              style={{ fontSize: '10px', padding: '0 4px', height: '18px' }}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* 2. SEARCH & DISCOVERY CONTROLS BAR */}
      <div style={{
        background: 'var(--color-surface-subtle)',
        borderBottom: '1px solid var(--color-border-standard)',
        padding: '6px 12px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
        gap: '12px',
        fontSize: '11px',
      }}>
        {/* Search Concept Input */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: '1 1 340px' }}>
          <Search size={13} style={{ color: 'var(--color-text-muted)' }} />
          <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
            SEARCH CONCEPT:
          </span>
          <input
            type="text"
            value={searchConcept}
            onChange={(e) => setSearchConcept(e.target.value)}
            className="input"
            style={{ height: '24px', fontSize: '11px', flex: 1 }}
            placeholder="Search landscape signature..."
          />
        </div>

        {/* Search Mode Segmented Control */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
          <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', marginRight: '2px' }}>
            MODE:
          </span>
          {(['SEMANTIC', 'VISUAL', 'LAND-COVER', 'HYBRID'] as SimilarSiteSearchMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setSearchMode(mode)}
              className="btn btn-sm"
              style={{
                height: '22px',
                padding: '0 7px',
                fontSize: '9.5px',
                fontWeight: searchMode === mode ? 700 : 500,
                background: searchMode === mode ? 'var(--color-chrome-bg)' : 'transparent',
                color: searchMode === mode ? '#38bdf8' : 'var(--color-text-secondary)',
                borderColor: searchMode === mode ? 'var(--color-chrome-border)' : 'var(--color-border-subtle)',
              }}
            >
              {mode}
            </button>
          ))}
        </div>

        {/* Similarity Threshold Slider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>
            THRESHOLD:
          </span>
          <input
            type="range"
            min="0.50"
            max="0.95"
            step="0.02"
            value={similarityThreshold}
            onChange={(e) => setSimilarityThreshold(Number(e.target.value))}
            style={{ width: '65px', height: '14px', cursor: 'ew-resize' }}
          />
          <span className="font-mono" style={{ fontSize: '10px', fontWeight: 700, color: '#0284c7', minWidth: '28px' }}>
            {similarityThreshold.toFixed(2)}
          </span>
        </div>

        {/* Search Radius Select */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>
            RADIUS:
          </span>
          <select
            value={searchRadiusKm}
            onChange={(e) => setSearchRadiusKm(Number(e.target.value))}
            className="input font-mono"
            style={{ height: '22px', fontSize: '10px', padding: '0 4px' }}
          >
            <option value={50}>50 km</option>
            <option value={100}>100 km</option>
            <option value={150}>150 km</option>
            <option value={200}>200 km</option>
          </select>
        </div>

        {/* Max Results */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>
            MAX:
          </span>
          <select
            value={maxResults}
            onChange={(e) => setMaxResults(Number(e.target.value))}
            className="input font-mono"
            style={{ height: '22px', fontSize: '10px', padding: '0 4px' }}
          >
            <option value={6}>6</option>
            <option value={8}>8</option>
            <option value={12}>12</option>
          </select>
        </div>
      </div>

      {/* Feature Weighting Strip */}
      <div style={{
        background: 'var(--color-surface-base)',
        borderBottom: '1px solid var(--color-border-subtle)',
        padding: '4px 12px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
        fontSize: '10px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Sliders size={11} style={{ color: 'var(--color-text-muted)' }} />
            <span style={{ fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>
              FEATURE WEIGHTING:
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span className="text-muted">Water:</span>
            <input
              type="range"
              min="10"
              max="60"
              value={weightWater}
              onChange={(e) => setWeightWater(Number(e.target.value))}
              style={{ width: '45px', height: '12px' }}
            />
            <span className="font-mono" style={{ fontWeight: 700, color: '#0284c7' }}>{weightWater}%</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span className="text-muted">Vegetation:</span>
            <input
              type="range"
              min="5"
              max="40"
              value={weightVeg}
              onChange={(e) => setWeightVeg(Number(e.target.value))}
              style={{ width: '45px', height: '12px' }}
            />
            <span className="font-mono">{weightVeg}%</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span className="text-muted">Built-up:</span>
            <input
              type="range"
              min="5"
              max="40"
              value={weightBuiltup}
              onChange={(e) => setWeightBuiltup(Number(e.target.value))}
              style={{ width: '45px', height: '12px' }}
            />
            <span className="font-mono">{weightBuiltup}%</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span className="text-muted">Terrain:</span>
            <input
              type="range"
              min="5"
              max="40"
              value={weightTerrain}
              onChange={(e) => setWeightTerrain(Number(e.target.value))}
              style={{ width: '45px', height: '12px' }}
            />
            <span className="font-mono">{weightTerrain}%</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span className="text-muted">Spatial:</span>
            <input
              type="range"
              min="10"
              max="50"
              value={weightSpatial}
              onChange={(e) => setWeightSpatial(Number(e.target.value))}
              style={{ width: '45px', height: '12px' }}
            />
            <span className="font-mono" style={{ fontWeight: 700, color: '#0284c7' }}>{weightSpatial}%</span>
          </div>
        </div>

        <div className="font-mono text-muted" style={{ fontSize: '9.5px' }}>
          EMPHASIS: WATER SIGNATURE + SPATIAL CONTEXT
        </div>
      </div>

      {/* 3. MAIN THREE-COLUMN WORKSTATION OPERATIONAL BODY */}
      <div style={{
        flex: 1,
        display: 'grid',
        gridTemplateColumns: 'minmax(280px, 320px) minmax(360px, 1fr) minmax(340px, 380px)',
        overflow: 'hidden',
        padding: '8px',
        gap: '8px',
      }}>
        {/* COLUMN 1: REFERENCE SITE & REGIONAL SPATIAL MAP */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto' }}>
          {/* Reference Site Card */}
          <div className="panel" style={{ flexShrink: 0 }}>
            <div className="panel-header" style={{ justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Compass size={13} style={{ color: '#f59e0b' }} />
                <span>Reference Site</span>
              </div>
              <span className="badge badge-amber font-mono" style={{ fontSize: '8.5px' }}>
                43QDF REF
              </span>
            </div>

            <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '8px 10px' }}>
              <div>
                <div className="font-mono text-xs text-muted" style={{ fontSize: '9px' }}>FEATURE NAME</div>
                <div style={{ fontSize: '12.5px', fontWeight: 700, color: 'var(--color-text-primary)' }}>
                  {referenceSite.name}
                </div>
                <div style={{ fontSize: '10.5px', color: 'var(--color-text-muted)' }}>
                  {currentAoi.name}
                </div>
              </div>

              {/* Preview Canvas */}
              <div style={{ height: '70px', borderRadius: 'var(--radius-xs)', overflow: 'hidden' }}>
                {renderMiniPreview(referenceSite)}
              </div>

              {/* Metadata Grid */}
              <div className="font-mono" style={{
                background: 'var(--color-surface-subtle)',
                border: '1px solid var(--color-border-standard)',
                borderRadius: 'var(--radius-xs)',
                padding: '6px 8px',
                fontSize: '10px',
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '4px 8px',
              }}>
                <div>
                  <span className="text-muted">WATER EXTENT:</span> <strong>{referenceSite.waterExtentSqKm} km²</strong>
                </div>
                <div>
                  <span className="text-muted">NDWI:</span> <strong>{referenceSite.ndwi}</strong>
                </div>
                <div>
                  <span className="text-muted">BUILT-UP:</span> <strong>{referenceSite.builtUpSqKm} km²</strong>
                </div>
                <div>
                  <span className="text-muted">ELEVATION:</span> <strong>{referenceSite.elevationMeters} m</strong>
                </div>
                <div>
                  <span className="text-muted">TERRAIN:</span> <span style={{ color: '#475569' }}>Sahyadri</span>
                </div>
                <div>
                  <span className="text-muted">SCENE CLOUD:</span> <strong>{referenceSite.cloudPercent}%</strong>
                </div>
              </div>

              {/* Reference Signature Chips */}
              <div>
                <div style={{ fontSize: '9.5px', fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: '4px', textTransform: 'uppercase' }}>
                  REFERENCE SIGNATURE:
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
                  {referenceSite.featureChips.map((chip) => (
                    <span key={chip} className="badge badge-neutral font-mono" style={{ fontSize: '8.5px' }}>
                      {chip}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Regional Spatial View (GIS Map) */}
          <div className="panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: '230px' }}>
            <div className="panel-header" style={{ justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <MapPin size={13} style={{ color: '#0284c7' }} />
                <span>Spatial Distribution Overview</span>
              </div>
              <span className="font-mono text-muted" style={{ fontSize: '9px' }}>MAHARASHTRA</span>
            </div>

            <div style={{ flex: 1, position: 'relative', overflow: 'hidden', padding: '4px' }}>
              {renderSpatialMap()}
            </div>
          </div>
        </div>

        {/* COLUMN 2: SIMILAR SITE RESULTS (Ranked Candidate List) */}
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div className="panel-header" style={{ justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Sliders size={13} style={{ color: '#0284c7' }} />
              <span>Ranked Candidate Sites</span>
              <span className="badge badge-blue font-mono" style={{ fontSize: '9px' }}>
                {candidates.length} SITES
              </span>
            </div>
            <span className="font-mono text-muted" style={{ fontSize: '9.5px' }}>
              RANKED BY MULTI-MODAL SIMILARITY
            </span>
          </div>

          <div style={{
            flex: 1,
            overflowY: 'auto',
            padding: '6px',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
          }}>
            {candidates.map((site) => {
              const isSelected = site.id === selectedSiteId;

              return (
                <div
                  key={site.id}
                  onClick={() => setSelectedSiteId(site.id)}
                  style={{
                    background: isSelected ? 'rgba(56, 189, 248, 0.08)' : 'var(--color-surface-base)',
                    border: isSelected ? '1.5px solid #0284c7' : '1px solid var(--color-border-standard)',
                    borderRadius: 'var(--radius-xs)',
                    padding: '8px 10px',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                    transition: 'all 0.12s ease',
                    boxShadow: isSelected ? '0 0 6px rgba(2, 132, 199, 0.2)' : 'none',
                  }}
                >
                  {/* Top line: Rank, Name, Distance & Overall Similarity Badge */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span className="font-mono" style={{
                        fontSize: '11px',
                        fontWeight: 700,
                        color: isSelected ? '#0284c7' : 'var(--color-text-muted)',
                        background: 'var(--color-surface-subtle)',
                        padding: '1px 5px',
                        borderRadius: 'var(--radius-xs)',
                        border: '1px solid var(--color-border-subtle)',
                      }}>
                        0{site.rank}
                      </span>
                      <div>
                        <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--color-text-primary)' }}>
                          {site.name || site.tileId}
                        </div>
                        <div className="font-mono text-muted" style={{ fontSize: '9.5px' }}>
                          {site.region || 'Region'} • {(site.latitude ?? 0).toFixed(2)}°N, {(site.longitude ?? 0).toFixed(2)}°E ({site.searchDistanceKm ?? 0} km {site.direction ?? ''})
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' }}>
                      <span style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '11px',
                        fontWeight: 700,
                        padding: '2px 7px',
                        borderRadius: 'var(--radius-xs)',
                        background: site.similarityScore >= 0.9
                          ? 'rgba(34, 197, 94, 0.15)'
                          : site.similarityScore >= 0.8
                          ? 'rgba(56, 189, 248, 0.15)'
                          : 'rgba(245, 158, 11, 0.15)',
                        color: site.similarityScore >= 0.9
                          ? '#15803d'
                          : site.similarityScore >= 0.8
                          ? '#0284c7'
                          : '#b45309',
                        border: site.similarityScore >= 0.9
                          ? '1px solid rgba(34, 197, 94, 0.4)'
                          : site.similarityScore >= 0.8
                          ? '1px solid rgba(56, 189, 248, 0.4)'
                          : '1px solid rgba(245, 158, 11, 0.4)',
                      }}>
                        {site.similarityScore.toFixed(2)} MATCH
                      </span>
                      <span className="font-mono text-muted" style={{ fontSize: '8.5px' }}>
                        DEMO SCORE
                      </span>
                    </div>
                  </div>

                  {/* Middle row: Mini preview + match reason */}
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <div style={{ width: '60px', height: '38px', flexShrink: 0 }}>
                      {renderMiniPreview(site)}
                    </div>
                    <div style={{ flex: 1, fontSize: '10.5px', color: 'var(--color-text-secondary)', lineHeight: 1.3 }}>
                      <span style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>Match:</span> {site.matchReason}
                    </div>
                  </div>

                  {/* Bottom row: Score Breakdown & Feature Indicators */}
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingTop: '4px',
                    borderTop: '1px solid var(--color-border-subtle)',
                    fontSize: '9.5px',
                    fontFamily: 'var(--font-mono)',
                  }}>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <span style={{ color: '#0369a1' }}>SEM {(site.semanticScore ?? 0).toFixed(2)}</span>
                      <span style={{ color: '#15803d' }}>SPEC {(site.spectralScore ?? 0).toFixed(2)}</span>
                      <span style={{ color: '#7c3aed' }}>SPAT {(site.spatialScore ?? 0).toFixed(2)}</span>
                    </div>

                    <div style={{ display: 'flex', gap: '4px' }}>
                      <span className="badge badge-neutral" style={{ fontSize: '8.5px', padding: '0 4px' }}>
                        W: {site.waterSignature}
                      </span>
                      <span className="badge badge-neutral" style={{ fontSize: '8.5px', padding: '0 4px' }}>
                        T: {site.terrainSignature}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* COLUMN 3: DETAIL INSPECTOR & OPERATIONAL ACTIONS */}
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
          <div className="panel-header" style={{ justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Info size={13} style={{ color: '#0284c7' }} />
              <span>Detail Inspector</span>
            </div>
            <span className="font-mono text-muted" style={{ fontSize: '9px' }}>
              SITE 0{selectedSite.rank}
            </span>
          </div>

          <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '10px' }}>
            {/* Header info */}
            <div>
              <div className="font-mono text-xs text-muted" style={{ fontSize: '9px' }}>SELECTED CANDIDATE</div>
              <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--color-text-primary)' }}>
                {selectedSite.name}
              </div>
              <div style={{ fontSize: '10.5px', color: '#0284c7', fontWeight: 600 }}>
                {selectedSite.region} • {selectedSite.searchDistanceKm} km {selectedSite.direction} of Pune AOI
              </div>
            </div>

            {/* Location Specs */}
            <div className="font-mono" style={{
              background: 'var(--color-surface-subtle)',
              border: '1px solid var(--color-border-standard)',
              borderRadius: 'var(--radius-xs)',
              padding: '6px 8px',
              fontSize: '10px',
              display: 'flex',
              flexDirection: 'column',
              gap: '3px',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span className="text-muted">COORDINATES:</span>
                <span>{(selectedSite.latitude ?? 0).toFixed(4)}°N, {(selectedSite.longitude ?? 0).toFixed(4)}°E</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span className="text-muted">MGRS TILE:</span>
                <span>{selectedSite.mgrsTile}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span className="text-muted">ELEVATION:</span>
                <span>{selectedSite.elevationMeters ?? 'N/A'} m MSL</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span className="text-muted">SCENE CLOUD:</span>
                <span>{selectedSite.cloudPercent ?? selectedSite.scene?.cloudCoverPercent ?? 0}%</span>
              </div>
            </div>

            {/* Similarity Score Breakdown Bars */}
            <div>
              <div style={{ fontSize: '9.5px', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', marginBottom: '4px' }}>
                SIMILARITY SCORE BREAKDOWN (DEMO):
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '10px' }}>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1px' }}>
                    <span style={{ color: 'var(--color-text-secondary)' }}>Semantic Concept Match</span>
                    <span className="font-mono" style={{ fontWeight: 600, color: '#0284c7' }}>{((selectedSite.semanticScore ?? 0) * 100).toFixed(0)}%</span>
                  </div>
                  <div style={{ width: '100%', height: '4px', background: 'var(--color-surface-sunken)', borderRadius: '1px' }}>
                    <div style={{ width: `${(selectedSite.semanticScore ?? 0) * 100}%`, height: '100%', background: '#0284c7' }} />
                  </div>
                </div>

                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1px' }}>
                    <span style={{ color: 'var(--color-text-secondary)' }}>Spectral Signature Match</span>
                    <span className="font-mono" style={{ fontWeight: 600, color: '#15803d' }}>{((selectedSite.spectralScore ?? 0) * 100).toFixed(0)}%</span>
                  </div>
                  <div style={{ width: '100%', height: '4px', background: 'var(--color-surface-sunken)', borderRadius: '1px' }}>
                    <div style={{ width: `${(selectedSite.spectralScore ?? 0) * 100}%`, height: '100%', background: '#15803d' }} />
                  </div>
                </div>

                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1px' }}>
                    <span style={{ color: 'var(--color-text-secondary)' }}>Spatial & Contextual Relation</span>
                    <span className="font-mono" style={{ fontWeight: 600, color: '#7c3aed' }}>{((selectedSite.spatialScore ?? 0) * 100).toFixed(0)}%</span>
                  </div>
                  <div style={{ width: '100%', height: '4px', background: 'var(--color-surface-sunken)', borderRadius: '1px' }}>
                    <div style={{ width: `${(selectedSite.spatialScore ?? 0) * 100}%`, height: '100%', background: '#7c3aed' }} />
                  </div>
                </div>
              </div>
            </div>

            {/* Landscape Signature Table */}
            <div>
              <div style={{ fontSize: '9.5px', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', marginBottom: '4px' }}>
                LANDSCAPE SIGNATURE MATRIX:
              </div>
              <div className="font-mono" style={{
                background: 'var(--color-surface-subtle)',
                border: '1px solid var(--color-border-standard)',
                borderRadius: 'var(--radius-xs)',
                padding: '6px 8px',
                fontSize: '9.5px',
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '4px',
              }}>
                <div>WATER: <strong style={{ color: '#0284c7' }}>{selectedSite.waterSignature} ({selectedSite.waterExtentSqKm} km²)</strong></div>
                <div>VEGETATION: <strong>{selectedSite.vegetationSignature}</strong></div>
                <div>BUILT-UP: <strong>{selectedSite.builtUpSignature} ({selectedSite.builtUpSqKm} km²)</strong></div>
                <div>AGRICULTURE: <strong>{selectedSite.agricultureSignature}</strong></div>
                <div style={{ gridColumn: 'span 2' }}>
                  TERRAIN: <strong>{selectedSite.terrainSignature}</strong>
                </div>
              </div>
            </div>

            {/* Temporal Milestones Sequence */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '3px' }}>
                <Calendar size={11} style={{ color: 'var(--color-text-muted)' }} />
                <span style={{ fontSize: '9.5px', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>
                  OBSERVED SEASONAL BEHAVIOR:
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                {selectedSite.temporalMilestones?.map((tm) => (
                  <div
                    key={tm.month}
                    className="font-mono"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      fontSize: '9px',
                      padding: '2px 6px',
                      background: 'var(--color-surface-subtle)',
                      borderRadius: 'var(--radius-xs)',
                      border: '1px solid var(--color-border-subtle)',
                    }}
                  >
                    <span style={{ fontWeight: 700, color: '#0284c7', width: '28px' }}>{tm.month}</span>
                    <span style={{ color: 'var(--color-text-secondary)', flex: 1 }}>{tm.waterStatus}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Match Explanation */}
            <div style={{
              background: 'rgba(56, 189, 248, 0.08)',
              border: '1px solid rgba(56, 189, 248, 0.25)',
              borderRadius: 'var(--radius-xs)',
              padding: '6px 8px',
            }}>
              <div style={{ fontSize: '9px', fontWeight: 600, color: '#0284c7', textTransform: 'uppercase', marginBottom: '2px' }}>
                LOCAL MOCK EXPLANATION:
              </div>
              <div style={{ fontSize: '10.5px', color: 'var(--color-text-primary)', lineHeight: 1.3 }}>
                {selectedSite.matchReason}. High correlation observed between Sahyadri drainage patterns and monsoon recharge.
              </div>
            </div>

            {/* Action Buttons */}
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '5px',
              marginTop: 'auto',
              paddingTop: '6px',
              borderTop: '1px solid var(--color-border-subtle)',
            }}>
              <button
                onClick={handleSendToChangeAnalysis}
                className="btn btn-primary"
                style={{ width: '100%', height: '28px', fontSize: '11px', fontWeight: 600, gap: '6px' }}
              >
                <GitCompare size={12} />
                <span>Send to Change Analysis</span>
              </button>

              <div style={{ display: 'flex', gap: '5px' }}>
                <button
                  onClick={() => setShowCompareModal(true)}
                  className="btn btn-sm"
                  style={{ flex: 1, height: '26px', fontSize: '10px', gap: '4px' }}
                >
                  <ArrowRight size={11} />
                  <span>Compare with Reference</span>
                </button>

                <button
                  onClick={() => setShowMetadataModal(true)}
                  className="btn btn-sm"
                  style={{ flex: 1, height: '26px', fontSize: '10px', gap: '4px' }}
                >
                  <Info size={11} />
                  <span>View Scene Metadata</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 4. COMPARE WITH REFERENCE MODAL */}
      {showCompareModal && (
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
            maxWidth: '720px',
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
                <GitCompare size={13} style={{ color: '#38bdf8' }} />
                <span>CROSS-SITE COMPARISON: KHADAKWASLA vs {(selectedSite.name || selectedSite.tileId).toUpperCase()}</span>
              </div>
              <button
                onClick={() => setShowCompareModal(false)}
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
              gap: '12px',
              padding: '14px',
            }}>
              {/* Dual Visual Card Comparison */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                {/* Reference Card */}
                <div style={{
                  background: 'var(--color-surface-subtle)',
                  border: '1px solid var(--color-border-standard)',
                  borderRadius: 'var(--radius-xs)',
                  padding: '10px',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <span className="badge badge-amber font-mono" style={{ fontSize: '9px' }}>REFERENCE AOI</span>
                    <span className="font-mono text-muted" style={{ fontSize: '9px' }}>43QDF</span>
                  </div>
                  <div style={{ fontWeight: 700, fontSize: '12px', marginBottom: '6px' }}>
                    {referenceSite.name}
                  </div>
                  <div style={{ height: '100px', marginBottom: '8px' }}>
                    {renderMiniPreview(referenceSite)}
                  </div>
                  <div className="font-mono text-xs" style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span className="text-muted">Water Extent:</span>
                      <strong>{referenceSite.waterExtentSqKm} km²</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span className="text-muted">NDWI:</span>
                      <strong>{referenceSite.ndwi}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span className="text-muted">Built-up Area:</span>
                      <strong>{referenceSite.builtUpSqKm} km²</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span className="text-muted">Elevation:</span>
                      <strong>{referenceSite.elevationMeters} m</strong>
                    </div>
                  </div>
                </div>

                {/* Candidate Card */}
                <div style={{
                  background: 'var(--color-surface-subtle)',
                  border: '1.5px solid #0284c7',
                  borderRadius: 'var(--radius-xs)',
                  padding: '10px',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <span className="badge badge-blue font-mono" style={{ fontSize: '9px' }}>
                      CANDIDATE 0{selectedSite.rank}
                    </span>
                    <span className="font-mono" style={{ fontSize: '10px', color: '#0284c7', fontWeight: 700 }}>
                      {selectedSite.similarityScore.toFixed(2)} SIMILARITY
                    </span>
                  </div>
                  <div style={{ fontWeight: 700, fontSize: '12px', marginBottom: '6px' }}>
                    {selectedSite.name || selectedSite.tileId}
                  </div>
                  <div style={{ height: '100px', marginBottom: '8px' }}>
                    {renderMiniPreview(selectedSite)}
                  </div>
                  <div className="font-mono text-xs" style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span className="text-muted">Water Extent:</span>
                      <strong>{selectedSite.waterExtentSqKm} km²</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span className="text-muted">NDWI:</span>
                      <strong>{selectedSite.ndwi}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span className="text-muted">Built-up Area:</span>
                      <strong>{selectedSite.builtUpSqKm} km²</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span className="text-muted">Elevation:</span>
                      <strong>{selectedSite.elevationMeters} m</strong>
                    </div>
                  </div>
                </div>
              </div>

              {/* Comparative Synthesis Note */}
              <div style={{
                background: 'rgba(56, 189, 248, 0.08)',
                border: '1px solid rgba(56, 189, 248, 0.3)',
                borderRadius: 'var(--radius-xs)',
                padding: '8px 10px',
                fontSize: '11px',
                lineHeight: 1.4,
              }}>
                <div style={{ fontWeight: 700, color: '#0284c7', marginBottom: '2px' }}>
                  CROSS-CATALOG ANALOG SYNTHESIS:
                </div>
                Both {referenceSite.name} and {selectedSite.name || selectedSite.tileId} feature mountain-valley impoundment morphologies,
                rapid monsoon water filling stages (peak in September), and peri-urban pressure fronts.
                Recommended for transfer learning evaluation.
              </div>
            </div>

            <div style={{
              padding: '8px 14px',
              background: 'var(--color-surface-subtle)',
              borderTop: '1px solid var(--color-border-standard)',
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '8px',
            }}>
              <button
                onClick={() => {
                  setShowCompareModal(false);
                  handleSendToChangeAnalysis();
                }}
                className="btn btn-primary"
                style={{ fontSize: '11px', height: '26px' }}
              >
                <GitCompare size={12} />
                <span>Stage for Change Analysis</span>
              </button>
              <button
                onClick={() => setShowCompareModal(false)}
                className="btn btn-sm"
                style={{ fontSize: '11px', height: '26px' }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 5. SCENE METADATA MODAL */}
      {showMetadataModal && (
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
            maxWidth: '620px',
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
                <Info size={13} style={{ color: '#38bdf8' }} />
                <span>SCENE METADATA: {selectedSite.sceneId}</span>
              </div>
              <button
                onClick={() => setShowMetadataModal(false)}
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
              padding: '12px',
            }}>
              <div className="font-mono text-xs" style={{
                background: '#090d16',
                color: '#cbd5e1',
                padding: '10px',
                borderRadius: 'var(--radius-xs)',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
              }}>
                <div>SCENE ID: <span style={{ color: '#93c5fd' }}>{selectedSite.sceneId}</span></div>
                <div>SENSOR: <span style={{ color: '#f8fafc' }}>Sentinel-2 MSI (Multi-Spectral Instrument)</span></div>
                <div>ACQUISITION DATE: <span style={{ color: '#f8fafc' }}>{selectedSite.acquisitionDate}</span></div>
                <div>CLOUD COVER: <span style={{ color: '#f8fafc' }}>{selectedSite.cloudPercent}%</span></div>
                <div>PROCESSING LEVEL: <span style={{ color: '#f59e0b' }}>L2A / Analysis Ready (BOA Reflectance)</span></div>
                <div>CRS / DATUM: <span style={{ color: '#f8fafc' }}>EPSG:32643 - WGS 84 / UTM zone 43N</span></div>
                <div>MGRS TILE: <span style={{ color: '#f8fafc' }}>{selectedSite.mgrsTile}</span></div>
                <div>SPATIAL RESOLUTION: <span style={{ color: '#f8fafc' }}>10m Bands B02, B03, B04, B08</span></div>
                <div>SOURCE CATALOG: <span style={{ color: '#86efac' }}>LOCAL DEMO CATALOG</span></div>
              </div>

              <div style={{ fontSize: '10.5px', color: 'var(--color-text-muted)' }}>
                This scene record is indexed in the GeoSentinel multi-temporal demonstration database.
              </div>
            </div>

            <div style={{
              padding: '8px 14px',
              background: 'var(--color-surface-subtle)',
              borderTop: '1px solid var(--color-border-standard)',
              display: 'flex',
              justifyContent: 'flex-end',
            }}>
              <button
                onClick={() => setShowMetadataModal(false)}
                className="btn btn-sm"
                style={{ fontSize: '11px', height: '26px' }}
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
