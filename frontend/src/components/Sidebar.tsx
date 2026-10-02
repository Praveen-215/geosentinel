import React from 'react';
import {
  Compass,
  SearchCode,
  GitCompare,
  Clock,
  Layers,
  ClipboardCheck,
  FileCheck2,
  Sliders,
  LucideIcon
} from 'lucide-react';
import { NavigationSection } from '../types';

interface SidebarProps {
  activeSection: NavigationSection;
  onSelectSection: (section: NavigationSection) => void;
}

interface NavItem {
  id: NavigationSection;
  label: string;
  icon: LucideIcon;
  shortcut: string;
  badge?: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'overview', label: 'Overview', icon: Compass, shortcut: 'F1' },
  { id: 'retrieval', label: 'Semantic Retrieval', icon: SearchCode, shortcut: 'F2', badge: '3' },
  { id: 'change-analysis', label: 'Change Analysis', icon: GitCompare, shortcut: 'F3' },
  { id: 'review', label: 'Analyst Review', icon: ClipboardCheck, shortcut: 'F4' },
  { id: 'similar-sites', label: 'Similar Sites', icon: Layers, shortcut: 'F5' },
  { id: 'evidence', label: 'Evidence & Provenance', icon: FileCheck2, shortcut: 'F6' },
  { id: 'temporal', label: 'Temporal Analysis', icon: Clock, shortcut: 'F7', badge: 'NEW' },
];

export const Sidebar: React.FC<SidebarProps> = ({
  activeSection,
  onSelectSection,
}) => {
  return (
    <aside style={{
      width: '210px',
      background: 'var(--color-chrome-panel)',
      borderRight: '1px solid var(--color-chrome-border)',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      flexShrink: 0,
      userSelect: 'none',
    }}>
      {/* Top Navigation Group */}
      <div>
        <div style={{
          padding: '8px 12px',
          fontSize: '10px',
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--color-chrome-muted)',
          borderBottom: '1px solid var(--color-chrome-border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <span>Mission Modules</span>
          <span className="font-mono" style={{ fontSize: '9px', color: '#64748b' }}>MOD-7</span>
        </div>

        <nav style={{ padding: '6px 4px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeSection === item.id;

            return (
              <button
                key={item.id}
                onClick={() => onSelectSection(item.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '7px 8px',
                  background: isActive ? 'rgba(56, 189, 248, 0.12)' : 'transparent',
                  color: isActive ? '#38bdf8' : 'var(--color-chrome-text)',
                  border: isActive ? '1px solid rgba(56, 189, 248, 0.3)' : '1px solid transparent',
                  borderRadius: 'var(--radius-xs)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all 0.12s ease',
                  outline: 'none',
                }}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)';
                    e.currentTarget.style.color = '#ffffff';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.color = 'var(--color-chrome-text)';
                  }
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
                  <Icon size={14} strokeWidth={isActive ? 2.2 : 1.8} />
                  <span style={{ fontSize: '12px', fontWeight: isActive ? 600 : 500, letterSpacing: '-0.01em' }}>
                    {item.label}
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {item.badge && (
                    <span style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '9px',
                      padding: '1px 4px',
                      background: item.badge === 'NEW' ? 'rgba(245, 158, 11, 0.2)' : 'rgba(56, 189, 248, 0.18)',
                      color: item.badge === 'NEW' ? '#fcd34d' : '#bae6fd',
                      border: item.badge === 'NEW' ? '1px solid rgba(245, 158, 11, 0.4)' : '1px solid rgba(56, 189, 248, 0.3)',
                      borderRadius: 'var(--radius-xs)',
                      fontWeight: 600,
                    }}>
                      {item.badge}
                    </span>
                  )}
                  <span className="font-mono" style={{ fontSize: '9px', color: '#475569' }}>
                    {item.shortcut}
                  </span>
                </div>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Bottom Mission / Workstation Diagnostics */}
      <div style={{
        padding: '10px',
        borderTop: '1px solid var(--color-chrome-border)',
        background: 'rgba(0, 0, 0, 0.18)',
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '6px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <Sliders size={12} style={{ color: 'var(--color-chrome-muted)' }} />
            <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--color-chrome-muted)', textTransform: 'uppercase' }}>
              Engine Status
            </span>
          </div>
          <span className="font-mono text-xs" style={{ color: '#22c55e', fontSize: '10px' }}>
            READY
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }} className="font-mono text-xs">
          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b', fontSize: '10px' }}>
            <span>ORBIT REPEAT:</span>
            <span style={{ color: '#cbd5e1' }}>5 DAYS</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b', fontSize: '10px' }}>
            <span>CRS EPSG:</span>
            <span style={{ color: '#cbd5e1' }}>32643 UTM</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b', fontSize: '10px' }}>
            <span>EMBEDDING:</span>
            <span style={{ color: '#93c5fd' }}>MOCK_S2_D256</span>
          </div>
        </div>
      </div>
    </aside>
  );
};
