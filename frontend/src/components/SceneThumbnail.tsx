import React from 'react';
import { SatelliteScene } from '../types';

interface SceneThumbnailProps {
  scene: SatelliteScene;
  width?: number | string;
  height?: number | string;
  showOverlay?: boolean;
}

export const SceneThumbnail: React.FC<SceneThumbnailProps> = ({
  scene,
  width = '100%',
  height = 120,
  showOverlay = true,
}) => {
  // Determine seasonal palette based on acquisition date & cloud cover
  const isDrySeason = scene.acquisitionDate.includes('-05-') || scene.acquisitionDate.includes('-06-');
  const isPeakMonsoon = scene.acquisitionDate.includes('-08-') || scene.acquisitionDate.includes('-09-');
  const isLandsat = scene.satellite.startsWith('Landsat');

  const waterColor = isDrySeason ? '#1e3a5f' : '#0c4a6e';
  const waterHighlight = isDrySeason ? '#2563eb' : '#0284c7';
  const vegColor = isDrySeason ? '#65a30d' : '#15803d';
  const soilColor = isDrySeason ? '#a16207' : '#78716c';
  const ridgeColor = isDrySeason ? '#713f12' : '#334155';

  return (
    <div style={{
      width,
      height,
      position: 'relative',
      overflow: 'hidden',
      background: '#0f172a',
      borderRadius: 'var(--radius-xs)',
      border: '1px solid var(--color-border-standard)',
    }}>
      <svg
        viewBox="0 0 300 180"
        preserveAspectRatio="xMidYMid slice"
        style={{ width: '100%', height: '100%', display: 'block' }}
      >
        <defs>
          <linearGradient id={`thumbWater-${scene.id}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={waterColor} />
            <stop offset="60%" stopColor={waterHighlight} />
            <stop offset="100%" stopColor={waterColor} />
          </linearGradient>

          <pattern id={`cropGridThumb-${scene.id}`} width="20" height="15" patternUnits="userSpaceOnUse">
            <rect width="18" height="13" fill={vegColor} opacity={isDrySeason ? 0.45 : 0.85} />
            <rect x="2" y="2" width="7" height="6" fill={soilColor} opacity={0.6} />
          </pattern>
        </defs>

        {/* Base soil & terrain */}
        <rect width="300" height="180" fill={soilColor} opacity="0.6" />

        {/* Foothills & geological ridge */}
        <path
          d="M -10,40 Q 60,10 130,45 T 240,25 Q 280,40 310,20 L 310,0 L -10,0 Z"
          fill={ridgeColor}
          opacity="0.85"
        />
        <path
          d="M 10,180 Q 90,130 160,150 T 270,140 L 310,180 Z"
          fill={ridgeColor}
          opacity="0.75"
        />

        {/* Crop parcel zone */}
        <polygon
          points="40,50 180,45 210,140 70,150"
          fill={`url(#cropGridThumb-${scene.id})`}
        />
        <polygon
          points="200,60 290,55 300,140 220,150"
          fill={`url(#cropGridThumb-${scene.id})`}
          opacity="0.8"
        />

        {/* River Drainage */}
        <path
          d="M 0,20 C 50,40 80,70 120,80 S 190,110 240,135 S 280,165 300,180"
          fill="none"
          stroke={`url(#thumbWater-${scene.id})`}
          strokeWidth={isPeakMonsoon ? "14" : "7"}
          strokeLinecap="round"
        />

        {/* Central Reservoir Body */}
        {isPeakMonsoon ? (
          // Expanded reservoir (monsoon fill)
          <path
            d="M 140,75 C 160,55 200,50 225,65 C 250,80 260,105 245,130 C 230,150 190,155 165,140 C 145,125 130,95 140,75 Z"
            fill={`url(#thumbWater-${scene.id})`}
            stroke="#38bdf8"
            strokeWidth="1.2"
          />
        ) : (
          // Shrunk reservoir (dry season)
          <path
            d="M 160,85 C 175,70 205,70 220,80 C 235,95 240,110 230,122 C 215,132 185,135 175,125 C 160,115 150,98 160,85 Z"
            fill={`url(#thumbWater-${scene.id})`}
            stroke="#94a3b8"
            strokeWidth="1"
            strokeDasharray="3 2"
          />
        )}

        {/* Cloud coverage overlay representation */}
        {scene.cloudCoverPercent > 10 && (
          <g fill="#ffffff" opacity={scene.cloudCoverPercent > 20 ? 0.75 : 0.45}>
            <ellipse cx="60" cy="35" rx="35" ry="18" />
            <ellipse cx="85" cy="45" rx="25" ry="14" />
            <ellipse cx="250" cy="140" rx="30" ry="16" />
          </g>
        )}

        {/* AOI Sub-boundary overlay */}
        <rect
          x="30"
          y="25"
          width="240"
          height="130"
          fill="none"
          stroke="var(--color-aoi-cyan)"
          strokeWidth="1"
          strokeDasharray="4 3"
          opacity="0.8"
        />

        {/* Subtle grid lines */}
        <line x1="100" y1="0" x2="100" y2="180" stroke="#cbd5e1" strokeWidth="0.5" strokeDasharray="2 3" opacity="0.3" />
        <line x1="200" y1="0" x2="200" y2="180" stroke="#cbd5e1" strokeWidth="0.5" strokeDasharray="2 3" opacity="0.3" />
        <line x1="0" y1="90" x2="300" y2="90" stroke="#cbd5e1" strokeWidth="0.5" strokeDasharray="2 3" opacity="0.3" />
      </svg>

      {/* Technical HUD Overlays */}
      {showOverlay && (
        <>
          <div style={{
            position: 'absolute',
            top: '4px',
            left: '4px',
            background: 'rgba(12, 20, 36, 0.88)',
            border: '1px solid var(--color-chrome-border)',
            padding: '1px 5px',
            borderRadius: 'var(--radius-xs)',
            fontSize: '9px',
            fontFamily: 'var(--font-mono)',
            color: '#38bdf8',
            fontWeight: 600,
          }}>
            {isLandsat ? 'L9 30m' : 'S2 10m'}
          </div>

          <div style={{
            position: 'absolute',
            bottom: '4px',
            left: '4px',
            background: 'rgba(12, 20, 36, 0.88)',
            border: '1px solid var(--color-chrome-border)',
            padding: '1px 5px',
            borderRadius: 'var(--radius-xs)',
            fontSize: '9px',
            fontFamily: 'var(--font-mono)',
            color: '#e2e8f0',
          }}>
            {scene.acquisitionDate.split('T')[0]}
          </div>

          <div style={{
            position: 'absolute',
            bottom: '4px',
            right: '4px',
            background: 'rgba(12, 20, 36, 0.88)',
            border: '1px solid var(--color-chrome-border)',
            padding: '1px 5px',
            borderRadius: 'var(--radius-xs)',
            fontSize: '9px',
            fontFamily: 'var(--font-mono)',
            color: scene.cloudCoverPercent < 10 ? '#86efac' : '#fde68a',
          }}>
            ☁ {scene.cloudCoverPercent}%
          </div>
        </>
      )}
    </div>
  );
};
