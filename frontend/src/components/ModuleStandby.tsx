import React from 'react';
import { Terminal, Compass, SearchCode } from 'lucide-react';
import { NavigationSection } from '../types';

interface ModuleStandbyProps {
  sectionId: NavigationSection;
  onNavigate: (section: NavigationSection) => void;
}

const SECTION_METADATA: Record<NavigationSection, { title: string; shortcut: string; desc: string }> = {
  overview: { title: 'Overview Workstation', shortcut: 'F1', desc: 'Primary cartographic observation canvas & telemetry.' },
  retrieval: { title: 'Semantic Retrieval', shortcut: 'F2', desc: 'Natural-language & visual similarity satellite catalog search.' },
  'change-analysis': { title: 'Multi-Temporal Change Analysis', shortcut: 'F3', desc: 'Bi-temporal spectral delta detection & anomaly segmentation.' },
  review: { title: 'Analyst Review & Verification Queue', shortcut: 'F4', desc: 'Human-in-the-loop validation of algorithmic spectral flags.' },
  'similar-sites': { title: 'Similar Sites Geospatial Explorer', shortcut: 'F5', desc: 'Cross-AOI geographical analog retrieval across MGRS grid tiles.' },
  evidence: { title: 'Evidence & Provenance Workstation', shortcut: 'F6', desc: 'Trace the evidence chain from retrieval to analyst disposition.' },
  temporal: { title: 'Temporal Analysis & Timeseries', shortcut: 'F7', desc: 'Long-term NDVI/NDWI seasonal variation charts.' },
};

export const ModuleStandby: React.FC<ModuleStandbyProps> = ({ sectionId, onNavigate }) => {
  const meta = SECTION_METADATA[sectionId] || {
    title: 'Mission Module',
    shortcut: 'MOD',
    desc: 'Operational analyst station.'
  };

  return (
    <div style={{
      flex: 1,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--color-surface-sunken)',
      padding: '24px',
    }}>
      <div className="panel" style={{
        maxWidth: '540px',
        width: '100%',
        boxShadow: 'var(--shadow-panel)',
        borderRadius: 'var(--radius-sm)',
        overflow: 'hidden',
      }}>
        <div className="panel-header" style={{
          background: 'var(--color-chrome-bg)',
          color: '#ffffff',
          borderBottom: '1px solid var(--color-chrome-border)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Terminal size={14} style={{ color: '#38bdf8' }} />
            <span style={{ fontSize: '11px', letterSpacing: '0.06em' }}>
              MODULE STANDBY: {meta.shortcut}
            </span>
          </div>
          <span className="badge badge-amber" style={{ fontSize: '9px' }}>
            PENDING INTEGRATION
          </span>
        </div>

        <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: '16px' }}>
          <div>
            <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--color-text-primary)' }}>
              {meta.title}
            </div>
            <div style={{ fontSize: '11.5px', color: 'var(--color-text-secondary)', marginTop: '4px', lineHeight: 1.4 }}>
              {meta.desc}
            </div>
          </div>

          <div style={{
            background: 'var(--color-surface-subtle)',
            border: '1px solid var(--color-border-standard)',
            borderRadius: 'var(--radius-xs)',
            padding: '10px 12px',
            fontFamily: 'var(--font-mono)',
            fontSize: '10.5px',
            color: 'var(--color-text-muted)',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>STATUS:</span>
              <span style={{ color: '#b45309', fontWeight: 600 }}>STANDBY / SCHEDULED FOR NEXT SPRINT</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>ACTIVE CONSOLES:</span>
              <span style={{ color: '#15803d' }}>F1 (Overview), F2 (Semantic Retrieval), F3 (Change Analysis), F4 (Analyst Review), F5 (Similar Sites) & F6 (Evidence & Provenance)</span>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => onNavigate('retrieval')}
              className="btn btn-primary"
              style={{ flex: 1, height: '28px', fontSize: '11px', fontWeight: 600 }}
            >
              <SearchCode size={13} />
              <span>Open Semantic Retrieval [F2]</span>
            </button>
            <button
              onClick={() => onNavigate('overview')}
              className="btn"
              style={{ flex: 1, height: '28px', fontSize: '11px' }}
            >
              <Compass size={13} />
              <span>Return to Overview [F1]</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
