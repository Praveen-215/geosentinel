import React, { useState } from 'react';
import { AnalystLayout } from './layouts/AnalystLayout';
import { WorkspacePage } from './pages/WorkspacePage';
import { MOCK_CHANGE_METRICS, MOCK_PRIMARY_AOI, MOCK_SCENES } from './data/mockScenes';
import { AOI, ChangeMetric, GeoCoordinates, NavigationSection, SatelliteScene } from './types';

export const App: React.FC = () => {
  const [currentAoi] = useState<AOI>(MOCK_PRIMARY_AOI);
  const [currentScene, setCurrentScene] = useState<SatelliteScene>(MOCK_SCENES[0]);
  const [allScenes] = useState<SatelliteScene[]>(MOCK_SCENES);
  const [changeMetrics] = useState<ChangeMetric[]>(MOCK_CHANGE_METRICS);
  const [activeSection, setActiveSection] = useState<NavigationSection>('overview');
  const [hoveredCoordinates, setHoveredCoordinates] = useState<GeoCoordinates | undefined>(undefined);

  return (
    <AnalystLayout
      currentAoi={currentAoi}
      currentScene={currentScene}
      activeCoordinates={hoveredCoordinates}
      activeSection={activeSection}
      onSelectSection={setActiveSection}
    >
      <WorkspacePage
        currentAoi={currentAoi}
        currentScene={currentScene}
        allScenes={allScenes}
        changeMetrics={changeMetrics}
        activeSection={activeSection}
        onSceneChange={setCurrentScene}
        onCoordinatesHover={setHoveredCoordinates}
      />
    </AnalystLayout>
  );
};

export default App;
