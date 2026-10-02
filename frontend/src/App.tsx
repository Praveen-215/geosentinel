import React, { useState, useEffect } from 'react';
import { AnalystLayout } from './layouts/AnalystLayout';
import { WorkspacePage } from './pages/WorkspacePage';
import { SemanticRetrievalPage } from './pages/SemanticRetrievalPage';
import { ChangeAnalysisPage } from './pages/ChangeAnalysisPage';
import { AnalystReviewPage } from './pages/AnalystReviewPage';
import { SimilarSitesPage } from './pages/SimilarSitesPage';
import { EvidenceProvenancePage } from './pages/EvidenceProvenancePage';
import { TemporalAnalysisPage } from './pages/TemporalAnalysisPage';
import { ModuleStandby } from './components/ModuleStandby';
import { MOCK_CHANGE_METRICS, MOCK_PRIMARY_AOI, MOCK_SCENES } from './data/mockScenes';
import { AOI, AnalystReviewPackage, ChangeMetric, GeoCoordinates, NavigationSection, SatelliteScene } from './types';

export const App: React.FC = () => {
  const [currentAoi] = useState<AOI>(MOCK_PRIMARY_AOI);
  const [currentScene, setCurrentScene] = useState<SatelliteScene>(MOCK_SCENES[0]);
  const [comparisonScene, setComparisonScene] = useState<SatelliteScene | null>(null);
  const [stagedReviewPackage, setStagedReviewPackage] = useState<AnalystReviewPackage | null>(null);
  const [allScenes] = useState<SatelliteScene[]>(MOCK_SCENES);
  const [changeMetrics] = useState<ChangeMetric[]>(MOCK_CHANGE_METRICS);
  const [activeSection, setActiveSection] = useState<NavigationSection>('overview');
  const [hoveredCoordinates, setHoveredCoordinates] = useState<GeoCoordinates | undefined>(undefined);

  // Global Function Key Shortcuts (F1 - F7)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const keyMap: Record<string, NavigationSection> = {
        F1: 'overview',
        F2: 'retrieval',
        F3: 'change-analysis',
        F4: 'review',
        F5: 'similar-sites',
        F6: 'evidence',
        F7: 'temporal',
      };

      if (keyMap[e.key]) {
        e.preventDefault();
        setActiveSection(keyMap[e.key]);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <AnalystLayout
      currentAoi={currentAoi}
      currentScene={currentScene}
      activeCoordinates={hoveredCoordinates}
      activeSection={activeSection}
      onSelectSection={setActiveSection}
    >
      {activeSection === 'overview' && (
        <WorkspacePage
          currentAoi={currentAoi}
          currentScene={currentScene}
          allScenes={allScenes}
          changeMetrics={changeMetrics}
          activeSection={activeSection}
          onSceneChange={setCurrentScene}
          onCoordinatesHover={setHoveredCoordinates}
          onOpenRetrieval={() => setActiveSection('retrieval')}
        />
      )}

      {activeSection === 'retrieval' && (
        <SemanticRetrievalPage
          currentAoi={currentAoi}
          comparisonScene={comparisonScene}
          onSelectScene={(scene) => setCurrentScene(scene)}
          onSetComparisonScene={(scene) => setComparisonScene(scene)}
          onNavigateChangeAnalysis={(scene) => {
            setComparisonScene(scene);
            setActiveSection('change-analysis');
          }}
          onNavigateSimilarSites={() => setActiveSection('similar-sites')}
        />
      )}

      {activeSection === 'change-analysis' && (
        <ChangeAnalysisPage
          currentAoi={currentAoi}
          stagedComparisonScene={comparisonScene}
          allScenes={allScenes}
          onNavigateSection={(target) => setActiveSection(target)}
          onQueueForReview={(pkg) => setStagedReviewPackage(pkg)}
        />
      )}

      {activeSection === 'review' && (
        <AnalystReviewPage
          currentAoi={currentAoi}
          stagedReviewPackage={stagedReviewPackage}
          onNavigateSection={(target) => setActiveSection(target)}
        />
      )}

      {activeSection === 'similar-sites' && (
        <SimilarSitesPage
          currentAoi={currentAoi}
          onNavigateSection={(target) => setActiveSection(target)}
          onStageComparisonScene={(scene) => {
            setComparisonScene(scene);
            setActiveSection('change-analysis');
          }}
        />
      )}

      {activeSection === 'evidence' && (
        <EvidenceProvenancePage
          currentAoi={currentAoi}
          onNavigateSection={(target) => setActiveSection(target)}
        />
      )}

      {activeSection === 'temporal' && (
        <TemporalAnalysisPage
          currentAoi={currentAoi}
          allScenes={allScenes}
          onNavigateSection={(target) => setActiveSection(target)}
          onStageComparisonScene={(scene) => {
            setComparisonScene(scene);
            setActiveSection('change-analysis');
          }}
        />
      )}

      {activeSection !== 'overview' &&
        activeSection !== 'retrieval' &&
        activeSection !== 'change-analysis' &&
        activeSection !== 'review' &&
        activeSection !== 'similar-sites' &&
        activeSection !== 'evidence' &&
        activeSection !== 'temporal' && (
          <ModuleStandby
            sectionId={activeSection}
            onNavigate={(target) => setActiveSection(target)}
          />
        )}
    </AnalystLayout>
  );
};

export default App;
