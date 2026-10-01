import React, { useState } from 'react';
import { ImageryViewport } from '../components/ImageryViewport';
import { MetadataPanel } from '../components/MetadataPanel';
import { AOI, ChangeMetric, GeoCoordinates, NavigationSection, SatelliteScene } from '../types';
import { Search, RefreshCw } from 'lucide-react';

interface WorkspacePageProps {
  currentAoi: AOI;
  currentScene: SatelliteScene;
  allScenes: SatelliteScene[];
  changeMetrics: ChangeMetric[];
  activeSection: NavigationSection;
  onSceneChange: (scene: SatelliteScene) => void;
  onCoordinatesHover: (coords: GeoCoordinates) => void;
}

export const WorkspacePage: React.FC<WorkspacePageProps> = ({
  currentAoi,
  currentScene,
  allScenes,
  changeMetrics,
  activeSection,
  onSceneChange,
  onCoordinatesHover,
}) => {
  const [notification, setNotification] = useState<string | null>(null);
  const [quickQuery, setQuickQuery] = useState<string>('water body expansion post-monsoon runoff');

  const handleTriggerAnalysis = () => {
    setNotification('Bi-temporal change detection run initiated: Comparing T1 Baseline to T2 Current. Spectral confidence 94.6%.');
    setTimeout(() => {
      setNotification(null);
    }, 6000);
  };

  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      overflow: 'hidden',
    }}>
      {/* Analyst Sub-Header / Quick Operations Command Bar */}
      <div style={{
        height: '38px',
        background: 'var(--color-surface-base)',
        borderBottom: '1px solid var(--color-border-standard)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 10px',
        flexShrink: 0,
      }}>
        {/* Quick Semantic Query Input Preview */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, maxWidth: '640px' }}>
          <div style={{
            position: 'relative',
            width: '100%',
            display: 'flex',
            alignItems: 'center',
          }}>
            <Search size={13} style={{ position: 'absolute', left: '8px', color: 'var(--color-text-muted)' }} />
            <input
              type="text"
              value={quickQuery}
              onChange={(e) => setQuickQuery(e.target.value)}
              className="input font-mono"
              placeholder="Enter semantic retrieval prompt (e.g. 'vegetation flush along river delta')..."
              style={{
                width: '100%',
                paddingLeft: '26px',
                paddingRight: '60px',
                fontSize: '11px',
                background: 'var(--color-surface-subtle)',
              }}
            />
            <span style={{
              position: 'absolute',
              right: '6px',
              fontSize: '9px',
              fontFamily: 'var(--font-mono)',
              background: 'var(--color-surface-sunken)',
              border: '1px solid var(--color-border-standard)',
              padding: '1px 5px',
              borderRadius: 'var(--radius-xs)',
              color: 'var(--color-text-muted)',
              pointerEvents: 'none',
            }}>
              SEMANTIC
            </span>
          </div>
        </div>

        {/* Scene Switcher Selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>
              SCENE FEED:
            </span>
            <select
              value={currentScene.id}
              onChange={(e) => {
                const target = allScenes.find((s) => s.id === e.target.value);
                if (target) onSceneChange(target);
              }}
              className="input font-mono"
              style={{
                height: '24px',
                fontSize: '11px',
                fontWeight: 500,
                color: 'var(--color-text-primary)',
                background: 'var(--color-surface-subtle)',
                paddingRight: '20px',
              }}
            >
              {allScenes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.satellite} — {s.acquisitionDate.split('T')[0]} ({s.cloudCoverPercent}% cloud)
                </option>
              ))}
            </select>
          </div>

          <div style={{ height: '16px', width: '1px', background: 'var(--color-border-standard)' }} />

          {/* Active Module Indicator */}
          <span className="badge badge-blue">
            MODE: {activeSection.toUpperCase()}
          </span>

          <div style={{ height: '16px', width: '1px', background: 'var(--color-border-standard)' }} />

          {/* AOI Status Pill */}
          <span className="badge badge-green">
            AOI 43QBD [L2A ARD]
          </span>
        </div>
      </div>

      {/* Notification Banner if active */}
      {notification && (
        <div style={{
          background: 'var(--color-accent-blue-subtle)',
          borderBottom: '1px solid #bae6fd',
          padding: '5px 12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '11px',
          color: '#0369a1',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <RefreshCw size={12} className="animate-spin" />
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

      {/* Main 2-Column Workstation: Viewport (Left/Center) + Technical Panel (Right) */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'row',
        overflow: 'hidden',
      }}>
        {/* Central Cartographic Viewport */}
        <ImageryViewport
          scene={currentScene}
          aoi={currentAoi}
          onCoordinatesHover={onCoordinatesHover}
        />

        {/* Right Metadata / Evidence Sidebar */}
        <MetadataPanel
          scene={currentScene}
          aoi={currentAoi}
          changeMetrics={changeMetrics}
          onTriggerAnalysis={handleTriggerAnalysis}
        />
      </div>
    </div>
  );
};
