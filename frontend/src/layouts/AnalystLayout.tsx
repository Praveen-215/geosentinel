import React, { ReactNode } from 'react';
import { Header } from '../components/Header';
import { Sidebar } from '../components/Sidebar';
import { AOI, GeoCoordinates, NavigationSection, SatelliteScene } from '../types';

interface AnalystLayoutProps {
  currentAoi: AOI;
  currentScene: SatelliteScene;
  activeCoordinates?: GeoCoordinates;
  activeSection: NavigationSection;
  onSelectSection: (section: NavigationSection) => void;
  children: ReactNode;
}

export const AnalystLayout: React.FC<AnalystLayoutProps> = ({
  currentAoi,
  currentScene,
  activeCoordinates,
  activeSection,
  onSelectSection,
  children,
}) => {
  return (
    <div style={{
      width: '100vw',
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--color-canvas)',
      overflow: 'hidden',
    }}>
      {/* 1. TOP APPLICATION BAR */}
      <Header
        currentAoi={currentAoi}
        currentScene={currentScene}
        activeCoordinates={activeCoordinates}
      />

      {/* 2. LOWER OPERATIONAL AREA (Sidebar + Content Workspace) */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'row',
        overflow: 'hidden',
      }}>
        {/* Left Navigation Rail */}
        <Sidebar
          activeSection={activeSection}
          onSelectSection={onSelectSection}
        />

        {/* Dynamic Center Workstation Viewport & Panels */}
        <main style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          background: 'var(--color-surface-sunken)',
        }}>
          {children}
        </main>
      </div>
    </div>
  );
};
