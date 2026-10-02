import React from 'react';
import { 
  Globe, 
  Satellite, 
  Crosshair, 
  Calendar, 
  UserCheck,
  Radio
} from 'lucide-react';
import { AOI, SatelliteScene, getSceneCenter } from '../types';

interface HeaderProps {
  currentAoi: AOI;
  currentScene: SatelliteScene;
  activeCoordinates?: { lat: number; lon: number; mgrs: string; elevationMsl?: number };
}

export const Header: React.FC<HeaderProps> = ({
  currentAoi,
  currentScene,
  activeCoordinates
}) => {
  const coords = activeCoordinates || getSceneCenter(currentScene);

  return (
    <header style={{
      height: '42px',
      background: 'var(--color-chrome-bg)',
      borderBottom: '1px solid var(--color-chrome-border)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 12px',
      color: 'var(--color-chrome-text)',
      userSelect: 'none',
      flexShrink: 0
    }}>
      {/* Brand & Mission Segment */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{
            width: '24px',
            height: '24px',
            background: 'var(--color-chrome-panel)',
            border: '1px solid var(--color-chrome-highlight)',
            borderRadius: 'var(--radius-xs)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--color-chrome-highlight)'
          }}>
            <Globe size={14} strokeWidth={2.2} />
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
            <span style={{
              fontWeight: 700,
              fontSize: '13px',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: '#ffffff'
            }}>
              GeoSentinel
            </span>
            <span className="font-mono text-xs" style={{ color: 'var(--color-chrome-muted)', fontSize: '10px' }}>
              EO-WORKSTATION v0.1
            </span>
          </div>
        </div>

        <div style={{ height: '16px', width: '1px', background: 'var(--color-chrome-border)' }} />

        {/* Mission / Workspace */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '10px', color: 'var(--color-chrome-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
            MISSION:
          </span>
          <span className="font-mono text-xs" style={{ color: '#38bdf8', fontWeight: 500 }}>
            {currentAoi.code}
          </span>
        </div>

        <div style={{ height: '16px', width: '1px', background: 'var(--color-chrome-border)' }} />

        {/* AOI Grid */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Crosshair size={12} style={{ color: 'var(--color-chrome-muted)' }} />
          <span style={{ fontSize: '10px', color: 'var(--color-chrome-muted)', textTransform: 'uppercase' }}>
            AOI:
          </span>
          <span className="font-mono text-xs" style={{ color: '#f1f5f9' }}>
            {currentAoi.mgrsGrid} ({currentAoi.name.split('&')[0].trim()})
          </span>
        </div>
      </div>

      {/* Middle Readout Segment: Coordinates & Date */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        {/* Dynamic Coordinates */}
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: '6px', 
          background: 'var(--color-chrome-panel)',
          border: '1px solid var(--color-chrome-border)',
          padding: '2px 8px',
          borderRadius: 'var(--radius-xs)'
        }}>
          <Radio size={11} className="text-muted" style={{ color: '#38bdf8' }} />
          <span className="font-mono text-xs" style={{ color: '#93c5fd' }}>
            {coords.lat.toFixed(4)}°N  {coords.lon.toFixed(4)}°E
          </span>
          <span className="font-mono text-xs" style={{ color: 'var(--color-chrome-muted)', borderLeft: '1px solid var(--color-chrome-border)', paddingLeft: '6px' }}>
            ELEV: {coords.elevationMsl ?? 582}m MSL
          </span>
        </div>

        {/* Imagery Acquisition Timestamp */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Calendar size={12} style={{ color: 'var(--color-chrome-muted)' }} />
          <span style={{ fontSize: '10px', color: 'var(--color-chrome-muted)', textTransform: 'uppercase' }}>
            SCENE ACQ:
          </span>
          <span className="font-mono text-xs" style={{ color: '#f8fafc' }}>
            {currentScene.acquisitionDate.replace('T', ' ').replace('Z', ' UTC')}
          </span>
        </div>

        {/* Satellite Feed Level */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <Satellite size={12} style={{ color: 'var(--color-chrome-muted)' }} />
          <span className="font-mono text-xs" style={{ color: '#cbd5e1' }}>
            {currentScene.satellite} {currentScene.processingLevel}
          </span>
        </div>
      </div>

      {/* Right Operational Status & Analyst Segment */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        {/* System Health */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '5px',
          padding: '2px 6px',
          background: 'rgba(21, 128, 61, 0.15)',
          border: '1px solid rgba(34, 197, 94, 0.3)',
          borderRadius: 'var(--radius-xs)'
        }}>
          <span className="status-pip status-pip-green" />
          <span className="font-mono text-xs" style={{ color: '#86efac', fontWeight: 600, fontSize: '10px' }}>
            NOMINAL
          </span>
        </div>

        <div style={{ height: '16px', width: '1px', background: 'var(--color-chrome-border)' }} />

        {/* Analyst Identity */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <div style={{
            width: '20px',
            height: '20px',
            borderRadius: 'var(--radius-xs)',
            background: 'var(--color-chrome-panel)',
            border: '1px solid var(--color-chrome-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#cbd5e1'
          }}>
            <UserCheck size={12} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: '11px', fontWeight: 600, color: '#f1f5f9', lineHeight: 1.1 }}>
              JHA, P.
            </span>
            <span className="font-mono" style={{ fontSize: '9px', color: 'var(--color-chrome-muted)', lineHeight: 1.1 }}>
              EO ANALYST [SEC-3]
            </span>
          </div>
        </div>
      </div>
    </header>
  );
};
