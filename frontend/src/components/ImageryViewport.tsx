import React, { useState, useRef, MouseEvent } from 'react';
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  Eye,
  Grid,
  MapPin,
  Crosshair
} from 'lucide-react';
import { AOI, SatelliteScene, ViewportDisplayMode } from '../types';

interface ImageryViewportProps {
  scene: SatelliteScene;
  aoi: AOI;
  onCoordinatesHover?: (coords: { lat: number; lon: number; mgrs: string; elevationMsl?: number }) => void;
}

export const ImageryViewport: React.FC<ImageryViewportProps> = ({
  scene,
  aoi,
  onCoordinatesHover,
}) => {
  const [zoomLevel, setZoomLevel] = useState<number>(100);
  const [displayMode, setDisplayMode] = useState<ViewportDisplayMode>('true-color');
  const [showGrid, setShowGrid] = useState<boolean>(true);
  const [showAoiBounds, setShowAoiBounds] = useState<boolean>(true);
  const [showLabels, setShowLabels] = useState<boolean>(true);
  const [showCrosshairs, setShowCrosshairs] = useState<boolean>(true);
  const [mousePos, setMousePos] = useState<{ x: number; y: number; lat: number; lon: number } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const normX = Math.max(0, Math.min(1, x / rect.width));
    const normY = Math.max(0, Math.min(1, y / rect.height));

    // Interpolate within scene bbox
    const lon = aoi.bbox.minLon + normX * (aoi.bbox.maxLon - aoi.bbox.minLon);
    const lat = aoi.bbox.maxLat - normY * (aoi.bbox.maxLat - aoi.bbox.minLat);

    const estElevation = Math.round(540 + (Math.sin(normX * 8) + Math.cos(normY * 6)) * 90);

    setMousePos({ x, y, lat, lon });

    if (onCoordinatesHover) {
      onCoordinatesHover({
        lat,
        lon,
        mgrs: `${aoi.mgrsGrid} ${Math.floor(normX * 9999)} ${Math.floor((1 - normY) * 9999)}`,
        elevationMsl: estElevation,
      });
    }
  };

  // Color theme generator based on display mode
  const getThemePalette = () => {
    switch (displayMode) {
      case 'false-color':
        return {
          bg: '#1c2430',
          water: '#0b1928',
          waterHighlight: '#1e3a5f',
          vegetationHigh: '#b91c1c',
          vegetationMed: '#dc2626',
          vegetationLow: '#ef4444',
          fallowLand: '#cbd5e1',
          soil: '#94a3b8',
          urban: '#38bdf8',
          ridge: '#334155',
          changeMask: 'rgba(239, 68, 68, 0.4)',
        };
      case 'ndvi-mask':
        return {
          bg: '#1a231f',
          water: '#0f172a',
          waterHighlight: '#1e293b',
          vegetationHigh: '#15803d',
          vegetationMed: '#22c55e',
          vegetationLow: '#84cc16',
          fallowLand: '#eab308',
          soil: '#ca8a04',
          urban: '#78716c',
          ridge: '#292524',
          changeMask: 'rgba(34, 197, 94, 0.4)',
        };
      case 'change-heatmap':
        return {
          bg: '#181b24',
          water: '#0f172a',
          waterHighlight: '#1e293b',
          vegetationHigh: '#334155',
          vegetationMed: '#475569',
          vegetationLow: '#64748b',
          fallowLand: '#1e293b',
          soil: '#0f172a',
          urban: '#334155',
          ridge: '#1e293b',
          changeMask: 'rgba(239, 68, 68, 0.75)', // Prominent delta alert
        };
      case 'true-color':
      default:
        return {
          bg: '#1e2a38',
          water: '#1b3b5a',
          waterHighlight: '#2a557e',
          vegetationHigh: '#2d5a27',
          vegetationMed: '#3f6d38',
          vegetationLow: '#5b8252',
          fallowLand: '#c2b280',
          soil: '#9b7653',
          urban: '#78828a',
          ridge: '#485563',
          changeMask: 'rgba(6, 182, 212, 0.3)',
        };
    }
  };

  const palette = getThemePalette();

  return (
    <div style={{
      flex: 1,
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--color-surface-base)',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Viewport Top Control Strip */}
      <div style={{
        height: '34px',
        background: 'var(--color-surface-subtle)',
        borderBottom: '1px solid var(--color-border-standard)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 8px',
        zIndex: 10,
        userSelect: 'none',
      }}>
        {/* Spectral Band Mode Selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
          <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', marginRight: '4px' }}>
            SPECTRAL VIEW:
          </span>
          {[
            { id: 'true-color', label: 'True Color (RGB 4-3-2)' },
            { id: 'false-color', label: 'Color Infrared (NIR 8-4-3)' },
            { id: 'ndvi-mask', label: 'NDVI Vegetation Index' },
            { id: 'change-heatmap', label: 'Multi-Temporal Delta Heatmap' },
          ].map((mode) => (
            <button
              key={mode.id}
              onClick={() => setDisplayMode(mode.id as ViewportDisplayMode)}
              className="btn btn-sm"
              style={{
                background: displayMode === mode.id ? 'var(--color-chrome-bg)' : 'transparent',
                color: displayMode === mode.id ? '#38bdf8' : 'var(--color-text-secondary)',
                borderColor: displayMode === mode.id ? 'var(--color-chrome-border)' : 'var(--color-border-subtle)',
                fontWeight: displayMode === mode.id ? 600 : 500,
                fontSize: '11px',
              }}
            >
              {mode.label}
            </button>
          ))}
        </div>

        {/* GIS Layer Toggles & Zoom Strip */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          {/* Layer toggles */}
          <button
            onClick={() => setShowGrid(!showGrid)}
            className={`btn btn-sm ${showGrid ? 'badge-blue' : ''}`}
            title="Toggle 1km Coordinate Grid"
          >
            <Grid size={11} />
            <span style={{ fontSize: '10px' }}>GRID</span>
          </button>

          <button
            onClick={() => setShowAoiBounds(!showAoiBounds)}
            className={`btn btn-sm ${showAoiBounds ? 'badge-blue' : ''}`}
            title="Toggle AOI Polygon Boundary"
          >
            <MapPin size={11} />
            <span style={{ fontSize: '10px' }}>AOI MASK</span>
          </button>

          <button
            onClick={() => setShowLabels(!showLabels)}
            className={`btn btn-sm ${showLabels ? 'badge-blue' : ''}`}
            title="Toggle GIS Geographic Feature Labels"
          >
            <Eye size={11} />
            <span style={{ fontSize: '10px' }}>LABELS</span>
          </button>

          <button
            onClick={() => setShowCrosshairs(!showCrosshairs)}
            className={`btn btn-sm ${showCrosshairs ? 'badge-blue' : ''}`}
            title="Toggle Center Crosshairs"
          >
            <Crosshair size={11} />
            <span style={{ fontSize: '10px' }}>RETICLE</span>
          </button>

          <div style={{ height: '14px', width: '1px', background: 'var(--color-border-standard)', margin: '0 2px' }} />

          {/* Zoom controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '1px' }}>
            <button
              onClick={() => setZoomLevel((z) => Math.max(50, z - 15))}
              className="btn btn-sm btn-icon"
              title="Zoom Out"
            >
              <ZoomOut size={12} />
            </button>
            <span className="font-mono text-xs" style={{ minWidth: '38px', textAlign: 'center', fontSize: '10px', color: 'var(--color-text-secondary)' }}>
              {zoomLevel}%
            </span>
            <button
              onClick={() => setZoomLevel((z) => Math.min(250, z + 15))}
              className="btn btn-sm btn-icon"
              title="Zoom In"
            >
              <ZoomIn size={12} />
            </button>
            <button
              onClick={() => setZoomLevel(100)}
              className="btn btn-sm btn-icon"
              title="Reset Extent to 1:1"
            >
              <Maximize2 size={11} />
            </button>
          </div>
        </div>
      </div>

      {/* Main Imagery Canvas Area */}
      <div
        ref={containerRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setMousePos(null)}
        style={{
          flex: 1,
          position: 'relative',
          background: palette.bg,
          cursor: 'crosshair',
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {/* SVG Synthetic Earth-Observation Scene Representation */}
        <svg
          viewBox="0 0 1000 650"
          preserveAspectRatio="xMidYMid slice"
          style={{
            width: `${zoomLevel}%`,
            height: `${zoomLevel}%`,
            maxWidth: '100%',
            maxHeight: '100%',
            transition: 'width 0.15s ease-out, height 0.15s ease-out',
            filter: 'contrast(102%) brightness(99%)',
          }}
        >
          <defs>
            {/* Pattern for Agricultural Fields / Cadastral Mosaic */}
            <pattern id="cropGrid" width="40" height="30" patternUnits="userSpaceOnUse">
              <rect width="38" height="28" fill={palette.vegetationMed} opacity="0.85" />
              <rect x="2" y="2" width="16" height="12" fill={palette.vegetationHigh} opacity="0.9" />
              <rect x="20" y="2" width="16" height="12" fill={palette.fallowLand} opacity="0.65" />
              <rect x="2" y="16" width="34" height="10" fill={palette.vegetationLow} opacity="0.75" />
              <line x1="0" y1="29" x2="40" y2="29" stroke="#1f2937" strokeWidth="0.8" opacity="0.4" />
              <line x1="39" y1="0" x2="39" y2="30" stroke="#1f2937" strokeWidth="0.8" opacity="0.4" />
            </pattern>

            {/* Urban / Industrial Texture */}
            <pattern id="urbanGrid" width="16" height="16" patternUnits="userSpaceOnUse">
              <rect width="16" height="16" fill={palette.urban} opacity="0.45" />
              <rect x="2" y="2" width="5" height="5" fill="#e2e8f0" opacity="0.7" />
              <rect x="9" y="2" width="5" height="5" fill="#94a3b8" opacity="0.7" />
              <rect x="2" y="9" width="12" height="5" fill="#475569" opacity="0.6" />
            </pattern>

            {/* Lake Surface Waves Filter */}
            <linearGradient id="waterGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={palette.water} />
              <stop offset="60%" stopColor={palette.waterHighlight} />
              <stop offset="100%" stopColor={palette.water} />
            </linearGradient>

            {/* Hillside Shading */}
            <linearGradient id="ridgeShade" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={palette.ridge} stopOpacity="0.9" />
              <stop offset="50%" stopColor={palette.soil} stopOpacity="0.7" />
              <stop offset="100%" stopColor={palette.ridge} stopOpacity="0.85" />
            </linearGradient>
          </defs>

          {/* Base Background Landscape */}
          <rect width="1000" height="650" fill={palette.soil} />

          {/* Geological Ridges (Western Ghats / Sahyadri Escarpment & Sinhagad Ridge) */}
          <path
            d="M -20,120 Q 180,60 380,140 T 780,90 Q 920,130 1020,80 L 1020,0 L -20,0 Z"
            fill="url(#ridgeShade)"
            opacity="0.85"
          />
          <path
            d="M 50,650 Q 250,480 440,540 T 820,490 Q 940,560 1020,530 L 1020,650 Z"
            fill="url(#ridgeShade)"
            opacity="0.75"
          />

          {/* Agricultural Field Mosaic Area */}
          <polygon
            points="120,160 520,170 590,440 280,480 90,320"
            fill="url(#cropGrid)"
          />
          <polygon
            points="580,240 890,210 940,460 620,490"
            fill="url(#cropGrid)"
            opacity="0.9"
          />

          {/* Winding River (Mutha & Mula River Drainage Channels) */}
          <path
            d="M 20,40 C 140,80 210,180 290,230 S 420,290 510,310 S 710,360 840,430 S 960,540 1020,590"
            fill="none"
            stroke="url(#waterGrad)"
            strokeWidth="28"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.95"
          />
          <path
            d="M 20,40 C 140,80 210,180 290,230 S 420,290 510,310 S 710,360 840,430 S 960,540 1020,590"
            fill="none"
            stroke={palette.waterHighlight}
            strokeWidth="10"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.7"
          />

          {/* Major Reservoir Body (Khadakwasla Reservoir Basin) */}
          <path
            d="M 460,250 C 490,220 560,210 610,230 C 660,250 710,290 690,360 C 670,420 590,430 520,410 C 470,390 440,320 460,250 Z"
            fill="url(#waterGrad)"
            stroke={palette.waterHighlight}
            strokeWidth="3"
            opacity="0.98"
          />

          {/* Change Inundation Delta Layer (visible in change mode) */}
          {displayMode === 'change-heatmap' && (
            <path
              d="M 440,240 C 480,200 580,195 635,215 C 690,235 735,280 715,385 C 695,445 610,455 495,430 C 445,410 415,325 440,240 Z"
              fill={palette.changeMask}
              stroke="#ef4444"
              strokeWidth="2"
              strokeDasharray="4 2"
            />
          )}

          {/* Urban & Industrial Clustered Zones */}
          <polygon
            points="180,310 260,305 275,370 195,375"
            fill="url(#urbanGrid)"
            stroke="#475569"
            strokeWidth="1.2"
          />
          <polygon
            points="730,150 830,140 845,210 740,225"
            fill="url(#urbanGrid)"
            stroke="#475569"
            strokeWidth="1.2"
          />

          {/* Transport Corridors (Highways / Rail Lines) */}
          <path
            d="M 0,280 L 1000,280"
            stroke="#94a3b8"
            strokeWidth="2.5"
            strokeDasharray="10 4"
            opacity="0.55"
          />
          <path
            d="M 330,0 L 410,650"
            stroke="#94a3b8"
            strokeWidth="2"
            strokeDasharray="6 3"
            opacity="0.45"
          />

          {/* Scene Footprint Outer Bounding Border */}
          <rect
            x="20"
            y="20"
            width="960"
            height="610"
            fill="none"
            stroke="#64748b"
            strokeWidth="1"
            strokeDasharray="8 6"
            opacity="0.6"
          />

          {/* AOI Boundary Polygon (Primary Focus Area) */}
          {showAoiBounds && (
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
              {/* Corner Coordinate Crosshairs for AOI */}
              {/* Top-Left */}
              <line x1="130" y1="110" x2="150" y2="110" stroke="#06b6d4" strokeWidth="2.5" />
              <line x1="140" y1="100" x2="140" y2="120" stroke="#06b6d4" strokeWidth="2.5" />
              {/* Top-Right */}
              <line x1="850" y1="110" x2="870" y2="110" stroke="#06b6d4" strokeWidth="2.5" />
              <line x1="860" y1="100" x2="860" y2="120" stroke="#06b6d4" strokeWidth="2.5" />
              {/* Bottom-Left */}
              <line x1="130" y1="550" x2="150" y2="550" stroke="#06b6d4" strokeWidth="2.5" />
              <line x1="140" y1="540" x2="140" y2="560" stroke="#06b6d4" strokeWidth="2.5" />
              {/* Bottom-Right */}
              <line x1="850" y1="550" x2="870" y2="550" stroke="#06b6d4" strokeWidth="2.5" />
              <line x1="860" y1="540" x2="860" y2="560" stroke="#06b6d4" strokeWidth="2.5" />

              {/* AOI Header Tag */}
              <rect x="140" y="92" width="220" height="18" fill="rgba(12, 20, 36, 0.9)" stroke="#06b6d4" strokeWidth="1" />
              <text
                x="146"
                y="105"
                fill="#38bdf8"
                fontSize="10"
                fontFamily="var(--font-mono)"
                fontWeight="600"
              >
                AOI: {aoi.code} [184.6 km²]
              </text>
            </g>
          )}

          {/* 1km Coordinate Grid Overlays */}
          {showGrid && (
            <g opacity="0.45">
              {[150, 300, 450, 600, 750, 900].map((gx) => (
                <g key={`gx-${gx}`}>
                  <line x1={gx} y1="0" x2={gx} y2="650" stroke="#94a3b8" strokeWidth="0.8" strokeDasharray="3 5" />
                  <text x={gx + 4} y="20" fill="#cbd5e1" fontSize="9" fontFamily="var(--font-mono)">
                    73°{Math.floor(45 + gx / 65)}'E
                  </text>
                </g>
              ))}
              {[100, 220, 340, 460, 580].map((gy) => (
                <g key={`gy-${gy}`}>
                  <line x1="0" y1={gy} x2="1000" y2={gy} stroke="#94a3b8" strokeWidth="0.8" strokeDasharray="3 5" />
                  <text x="25" y={gy - 4} fill="#cbd5e1" fontSize="9" fontFamily="var(--font-mono)">
                    18°{Math.floor(25 + (650 - gy) / 45)}'N
                  </text>
                </g>
              ))}
            </g>
          )}

          {/* GIS Feature Labels */}
          {showLabels && (
            <g fontFamily="var(--font-mono)" fontSize="10" fontWeight="600">
              {/* Reservoir */}
              <g transform="translate(530, 320)">
                <rect x="-8" y="-12" width="180" height="18" fill="rgba(15, 23, 42, 0.85)" stroke="#38bdf8" strokeWidth="0.8" rx="2" />
                <circle cx="-1" cy="-3" r="3" fill="#38bdf8" />
                <text x="8" y="0" fill="#ffffff" fontSize="9.5">
                  KHADAKWASLA RESERVOIR
                </text>
              </g>

              {/* River Flow Label */}
              <g transform="translate(240, 210)">
                <text x="0" y="0" fill="#bae6fd" fontSize="9" opacity="0.9" fontStyle="italic">
                  MUTHA RIVER DRAINAGE ▶
                </text>
              </g>

              {/* Agricultural Sector */}
              <g transform="translate(260, 430)">
                <rect x="-6" y="-12" width="165" height="17" fill="rgba(15, 23, 42, 0.85)" stroke="#4ade80" strokeWidth="0.8" rx="2" />
                <circle cx="0" cy="-3" r="3" fill="#22c55e" />
                <text x="9" y="0" fill="#86efac" fontSize="9">
                  HAVELI CROPLAND [SUGARCANE]
                </text>
              </g>

              {/* Mining / Quarry Fringe */}
              <g transform="translate(740, 190)">
                <rect x="-6" y="-12" width="165" height="17" fill="rgba(15, 23, 42, 0.85)" stroke="#f59e0b" strokeWidth="0.8" rx="2" />
                <circle cx="0" cy="-3" r="3" fill="#f59e0b" />
                <text x="9" y="0" fill="#fde68a" fontSize="9">
                  HINJAWADI TECH CORRIDOR
                </text>
              </g>
            </g>
          )}
        </svg>

        {/* Live HUD Center Crosshairs */}
        {showCrosshairs && (
          <div style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            pointerEvents: 'none',
            zIndex: 5,
          }}>
            <svg width="40" height="40" viewBox="0 0 40 40">
              <circle cx="20" cy="20" r="12" fill="none" stroke="rgba(56, 189, 248, 0.5)" strokeWidth="1" strokeDasharray="3 3" />
              <line x1="20" y1="2" x2="20" y2="14" stroke="#38bdf8" strokeWidth="1.5" />
              <line x1="20" y1="26" x2="20" y2="38" stroke="#38bdf8" strokeWidth="1.5" />
              <line x1="2" y1="20" x2="14" y2="20" stroke="#38bdf8" strokeWidth="1.5" />
              <line x1="26" y1="20" x2="38" y2="20" stroke="#38bdf8" strokeWidth="1.5" />
              <circle cx="20" cy="20" r="1.5" fill="#38bdf8" />
            </svg>
          </div>
        )}

        {/* HUD Overlay: Top-Left Mission Extent Badge */}
        <div style={{
          position: 'absolute',
          top: '10px',
          left: '10px',
          background: 'rgba(12, 20, 36, 0.88)',
          border: '1px solid var(--color-chrome-border)',
          borderRadius: 'var(--radius-xs)',
          padding: '6px 10px',
          zIndex: 6,
          pointerEvents: 'none',
          backdropFilter: 'blur(2px)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
            <span className="status-pip status-pip-blue" />
            <span className="font-mono text-xs" style={{ color: '#38bdf8', fontWeight: 600 }}>
              {scene.id.slice(0, 32)}...
            </span>
          </div>
          <div className="font-mono" style={{ fontSize: '10px', color: '#94a3b8', lineHeight: 1.3 }}>
            <div>SUN EL: {scene.sunElevationDeg}° | AZIMUTH: {scene.sunAzimuthDeg}°</div>
            <div>RES: {scene.resolutionMeters}m GSD | CLOUD: {scene.cloudCoverPercent}%</div>
          </div>
        </div>

        {/* HUD Overlay: Top-Right Cartographic Compass & North Arrow */}
        <div style={{
          position: 'absolute',
          top: '10px',
          right: '10px',
          background: 'rgba(12, 20, 36, 0.88)',
          border: '1px solid var(--color-chrome-border)',
          borderRadius: 'var(--radius-xs)',
          padding: '6px 8px',
          zIndex: 6,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '2px',
          pointerEvents: 'none',
        }}>
          <svg width="28" height="28" viewBox="0 0 28 28">
            <circle cx="14" cy="14" r="13" fill="none" stroke="#334155" strokeWidth="1" />
            {/* North pointer needle */}
            <polygon points="14,3 17,14 14,12" fill="#ef4444" />
            <polygon points="14,3 11,14 14,12" fill="#b91c1c" />
            {/* South pointer needle */}
            <polygon points="14,25 17,14 14,16" fill="#cbd5e1" />
            <polygon points="14,25 11,14 14,16" fill="#94a3b8" />
            <circle cx="14" cy="14" r="2" fill="#ffffff" />
          </svg>
          <span className="font-mono" style={{ fontSize: '9px', fontWeight: 700, color: '#f8fafc' }}>
            N
          </span>
          <span className="font-mono" style={{ fontSize: '8px', color: '#64748b' }}>
            VAR +0.4°
          </span>
        </div>

        {/* HUD Overlay: Bottom-Left Scale Bar */}
        <div style={{
          position: 'absolute',
          bottom: '10px',
          left: '10px',
          background: 'rgba(12, 20, 36, 0.88)',
          border: '1px solid var(--color-chrome-border)',
          borderRadius: 'var(--radius-xs)',
          padding: '5px 8px',
          zIndex: 6,
          pointerEvents: 'none',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: '#cbd5e1' }} className="font-mono">
            <span>0</span>
            <span>250m</span>
            <span>500m</span>
            <span>1 km</span>
          </div>
          {/* Black & White Segmented Scale Bar */}
          <div style={{ display: 'flex', height: '4px', width: '120px', border: '1px solid #ffffff', marginTop: '2px' }}>
            <div style={{ width: '25%', background: '#ffffff' }} />
            <div style={{ width: '25%', background: '#000000' }} />
            <div style={{ width: '25%', background: '#ffffff' }} />
            <div style={{ width: '25%', background: '#000000' }} />
          </div>
          <div style={{ fontSize: '9px', color: '#94a3b8', marginTop: '2px', textAlign: 'center' }} className="font-mono">
            1:25,000 | EPSG:32643
          </div>
        </div>

        {/* HUD Overlay: Bottom-Right Real-time Cursor Readout */}
        {mousePos && (
          <div style={{
            position: 'absolute',
            bottom: '10px',
            right: '10px',
            background: 'rgba(12, 20, 36, 0.92)',
            border: '1px solid var(--color-chrome-border)',
            borderRadius: 'var(--radius-xs)',
            padding: '4px 8px',
            zIndex: 6,
            pointerEvents: 'none',
          }}>
            <div className="font-mono" style={{ fontSize: '10px', color: '#38bdf8' }}>
              CURSOR: {mousePos.lat.toFixed(5)}°N {mousePos.lon.toFixed(5)}°E
            </div>
            <div className="font-mono" style={{ fontSize: '9px', color: '#94a3b8' }}>
              PX [{Math.round(mousePos.x)}, {Math.round(mousePos.y)}]
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
