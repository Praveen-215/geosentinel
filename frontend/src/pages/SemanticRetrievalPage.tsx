import React, { useState, useEffect } from 'react';
import {
  Search,
  RotateCcw,
  LayoutGrid,
  List,
  Calendar,
  Cloud,
  UploadCloud,
  CheckCircle2,
  GitCompare,
  ArrowRight,
  AlertTriangle,
} from 'lucide-react';
import { AOI, RetrievalResult, SatelliteScene, SemanticRetrievalQuery } from '../types';
import { retrievalService } from '../services/retrievalService';
import { SceneThumbnail } from '../components/SceneThumbnail';

interface SemanticRetrievalPageProps {
  currentAoi: AOI;
  comparisonScene?: SatelliteScene | null;
  onSelectScene?: (scene: SatelliteScene) => void;
  onSetComparisonScene?: (scene: SatelliteScene) => void;
  onNavigateChangeAnalysis?: (scene: SatelliteScene) => void;
}

export const SemanticRetrievalPage: React.FC<SemanticRetrievalPageProps> = ({
  currentAoi,
  comparisonScene,
  onSelectScene,
  onSetComparisonScene,
  onNavigateChangeAnalysis,
}) => {
  // Query State
  const [queryText, setQueryText] = useState<string>('water body expansion post-monsoon runoff');
  const [activeQueryPrompt, setActiveQueryPrompt] = useState<string>('water body expansion post-monsoon runoff');
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [searchTelemetry, setSearchTelemetry] = useState<{
    indexStatus: string;
    query: string;
    resultsCount: number;
    topSimilarity: number;
    latencyMs: number;
  }>({
    indexStatus: 'LOCAL MOCK CATALOG (6/6 ARD)',
    query: 'water body expansion post-monsoon runoff',
    resultsCount: 6,
    topSimilarity: 0.94,
    latencyMs: 184,
  });

  // Filter States
  const [startDate, setStartDate] = useState<string>('2025-05-01');
  const [endDate, setEndDate] = useState<string>('2025-10-01');
  const [cloudCoverRange, setCloudCoverRange] = useState<'all' | '0-10' | '10-25' | '25-50'>('all');
  const [sensorFilter, setSensorFilter] = useState<'all' | 'Sentinel-2' | 'Landsat-8' | 'Landsat-9'>('all');
  const [processingLevel, setProcessingLevel] = useState<'all' | 'Analysis Ready' | 'L2A'>('all');
  const [spatialRelation, setSpatialRelation] = useState<'aoi' | 'region' | 'global'>('aoi');
  const [minSimilarity, setMinSimilarity] = useState<number | undefined>(undefined);

  // View & Selection States
  const [viewMode, setViewMode] = useState<'grid' | 'catalog'>('grid');
  const [results, setResults] = useState<RetrievalResult[]>([]);
  const [selectedResult, setSelectedResult] = useState<RetrievalResult | null>(null);

  // Visual Similarity Image Search state
  const [showVisualSearch, setShowVisualSearch] = useState<boolean>(false);
  const [uploadedImageName, setUploadedImageName] = useState<string | null>(null);

  // Operational notification banner
  const [actionNotification, setActionNotification] = useState<string | null>(null);

  // Execute query function
  const runRetrieval = async (overridePrompt?: string) => {
    const prompt = overridePrompt !== undefined ? overridePrompt : queryText;
    setIsSearching(true);
    const startTime = performance.now();

    const query: SemanticRetrievalQuery = {
      queryText: prompt,
      temporalWindow: { startDate, endDate },
      cloudCoverRange,
      sensorFilter,
      processingLevelFilter: processingLevel,
      spatialRelation,
      minSimilarityThreshold: minSimilarity,
      referenceImageName: uploadedImageName || undefined,
    };

    try {
      const fetchedResults = await retrievalService.queryScenesBySemanticPrompt(query);
      const elapsed = Math.round(performance.now() - startTime);

      setResults(fetchedResults);
      setActiveQueryPrompt(prompt);
      const topSim = fetchedResults.length > 0 ? fetchedResults[0].similarityScore : 0.00;

      setSearchTelemetry({
        indexStatus: 'LOCAL MOCK CATALOG (6/6 ARD)',
        query: prompt,
        resultsCount: fetchedResults.length,
        topSimilarity: topSim,
        latencyMs: elapsed > 0 ? elapsed : 184,
      });

      // Keep selection or pick top match
      if (fetchedResults.length > 0) {
        const stillSelected = fetchedResults.find((r) => r.id === selectedResult?.id);
        setSelectedResult(stillSelected || fetchedResults[0]);
      } else {
        setSelectedResult(null);
      }
    } catch (err) {
      console.error('Retrieval query error:', err);
    } finally {
      setIsSearching(false);
    }
  };

  // Initial load
  useEffect(() => {
    runRetrieval('water body expansion post-monsoon runoff');
  }, []);

  // Update whenever filters change
  useEffect(() => {
    runRetrieval(queryText);
  }, [startDate, endDate, cloudCoverRange, sensorFilter, processingLevel, spatialRelation, minSimilarity, uploadedImageName]);

  const handleResetFilters = () => {
    setQueryText('water body expansion post-monsoon runoff');
    setStartDate('2025-05-01');
    setEndDate('2025-10-01');
    setCloudCoverRange('all');
    setSensorFilter('all');
    setProcessingLevel('all');
    setSpatialRelation('aoi');
    setMinSimilarity(undefined);
    setUploadedImageName(null);
    runRetrieval('water body expansion post-monsoon runoff');
  };

  const handleSetComparison = (scene: SatelliteScene) => {
    if (onSetComparisonScene) {
      onSetComparisonScene(scene);
    }
    setActionNotification(`Scene [${scene.id.slice(0, 24)}...] assigned as active Comparison Scene (T2).`);
    setTimeout(() => setActionNotification(null), 4500);
  };

  const handleOpenChangeAnalysis = (scene: SatelliteScene) => {
    if (onNavigateChangeAnalysis) {
      onNavigateChangeAnalysis(scene);
    } else {
      setActionNotification(`Scene [${scene.id.slice(0, 24)}...] staged for Bi-Temporal Change Detection.`);
      setTimeout(() => setActionNotification(null), 4500);
    }
  };

  const handleFileDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      setUploadedImageName(file.name);
      setActionNotification(`Visual reference loaded: "${file.name}" (${(file.size / 1024).toFixed(1)} KB)`);
      setTimeout(() => setActionNotification(null), 4000);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      setUploadedImageName(file.name);
      setActionNotification(`Visual reference loaded: "${file.name}" (${(file.size / 1024).toFixed(1)} KB)`);
      setTimeout(() => setActionNotification(null), 4000);
    }
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
      {/* 1. QUERY CONSOLE COMMAND STRIP */}
      <div style={{
        background: 'var(--color-surface-subtle)',
        borderBottom: '1px solid var(--color-border-standard)',
        padding: '8px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        flexShrink: 0,
      }}>
        {/* Main Search Row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* Query input */}
          <div style={{
            position: 'relative',
            flex: 1,
            display: 'flex',
            alignItems: 'center',
          }}>
            <Search size={14} style={{ position: 'absolute', left: '10px', color: 'var(--color-text-muted)' }} />
            <input
              type="text"
              value={queryText}
              onChange={(e) => setQueryText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') runRetrieval();
              }}
              className="input font-mono"
              placeholder="Search scenes by semantic description, visual characteristics, or temporal context..."
              style={{
                width: '100%',
                paddingLeft: '30px',
                paddingRight: '80px',
                height: '30px',
                fontSize: '12px',
                background: 'var(--color-surface-base)',
                borderColor: 'var(--color-border-strong)',
              }}
            />
            {queryText && (
              <button
                onClick={() => setQueryText('')}
                className="btn btn-sm"
                style={{
                  position: 'absolute',
                  right: '6px',
                  height: '20px',
                  padding: '0 6px',
                  fontSize: '10px',
                  color: 'var(--color-text-muted)',
                }}
                title="Clear query input"
              >
                Clear
              </button>
            )}
          </div>

          {/* Search Trigger Button */}
          <button
            onClick={() => runRetrieval()}
            disabled={isSearching}
            className="btn btn-primary"
            style={{ height: '30px', padding: '0 14px', fontWeight: 600, fontSize: '12px' }}
          >
            <Search size={13} />
            <span>{isSearching ? 'Executing Search...' : 'Search Catalog'}</span>
          </button>

          {/* Visual Similarity Search Toggle */}
          <button
            onClick={() => setShowVisualSearch(!showVisualSearch)}
            className={`btn ${showVisualSearch ? 'btn-primary' : ''}`}
            style={{ height: '30px', padding: '0 10px', fontSize: '11px' }}
            title="Toggle Visual Similarity / Image-to-Image Search"
          >
            <UploadCloud size={13} />
            <span>Visual Similarity Search</span>
          </button>

          {/* Reset Filters */}
          <button
            onClick={handleResetFilters}
            className="btn btn-sm"
            style={{ height: '30px', padding: '0 9px', color: 'var(--color-text-secondary)' }}
            title="Reset query and all filters to defaults"
          >
            <RotateCcw size={12} />
            <span>Reset</span>
          </button>
        </div>

        {/* Query Context & Sample Prompts */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflowX: 'auto' }}>
            <span style={{ color: 'var(--color-text-muted)', fontWeight: 600, fontSize: '10px', textTransform: 'uppercase' }}>
              EXAMPLE QUERIES:
            </span>
            {[
              'water body expansion post-monsoon runoff',
              'agricultural biomass flush in valley floor',
              'quarry excavation and arid ground exposure',
              'turbid flood channels in drainage basin',
            ].map((example) => (
              <button
                key={example}
                onClick={() => {
                  setQueryText(example);
                  runRetrieval(example);
                }}
                className="btn btn-sm"
                style={{
                  fontSize: '10.5px',
                  height: '20px',
                  padding: '0 6px',
                  background: activeQueryPrompt === example ? 'var(--color-accent-blue-subtle)' : 'var(--color-surface-base)',
                  color: activeQueryPrompt === example ? 'var(--color-accent-blue)' : 'var(--color-text-secondary)',
                  borderColor: activeQueryPrompt === example ? '#bae6fd' : 'var(--color-border-subtle)',
                }}
              >
                {example}
              </button>
            ))}
          </div>

          <div style={{ color: 'var(--color-text-muted)', fontSize: '10.5px' }}>
            Search scenes by semantic description, visual characteristics, and temporal context.
          </div>
        </div>

        {/* Visual Similarity Search Dropzone (Collapsible) */}
        {showVisualSearch && (
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleFileDrop}
            className="dropzone-box"
            style={{
              padding: '10px 14px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginTop: '2px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{
                width: '32px',
                height: '32px',
                borderRadius: 'var(--radius-xs)',
                background: 'var(--color-surface-base)',
                border: '1px solid var(--color-border-standard)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--color-accent-blue)',
              }}>
                <UploadCloud size={18} />
              </div>
              <div>
                <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-text-primary)' }}>
                  {uploadedImageName ? `Loaded Reference: ${uploadedImageName}` : 'Drop reference satellite patch or click to browse'}
                </div>
                <div style={{ fontSize: '10px', color: 'var(--color-text-muted)' }}>
                  Prototype input — retrieval backend will be connected later. (TIFF, PNG, JPEG accepted)
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <label className="btn btn-sm" style={{ cursor: 'pointer', fontSize: '11px' }}>
                Browse Local Image
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleFileInput}
                  style={{ display: 'none' }}
                />
              </label>
              {uploadedImageName && (
                <button
                  onClick={() => setUploadedImageName(null)}
                  className="btn btn-sm"
                  style={{ fontSize: '10px' }}
                >
                  Clear File
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 2. TECHNICAL TELEMETRY STATUS BAR */}
      <div style={{
        height: '30px',
        background: 'var(--color-chrome-bg)',
        borderBottom: '1px solid var(--color-chrome-border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 12px',
        color: 'var(--color-chrome-text)',
        fontSize: '11px',
        flexShrink: 0,
        userSelect: 'none',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }} className="font-mono">
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ color: 'var(--color-chrome-muted)', fontSize: '10px' }}>INDEX:</span>
            <span style={{ color: '#86efac', fontWeight: 600, fontSize: '10.5px' }}>{searchTelemetry.indexStatus}</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ color: 'var(--color-chrome-muted)', fontSize: '10px' }}>QUERY:</span>
            <span style={{ color: '#cbd5e1', fontSize: '10.5px' }}>"{searchTelemetry.query.slice(0, 38)}..."</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ color: 'var(--color-chrome-muted)', fontSize: '10px' }}>RESULTS:</span>
            <span style={{ color: '#38bdf8', fontWeight: 600, fontSize: '10.5px' }}>
              {searchTelemetry.resultsCount.toString().padStart(2, '0')} scenes
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ color: 'var(--color-chrome-muted)', fontSize: '10px' }}>TOP SIMILARITY:</span>
            <span style={{ color: '#38bdf8', fontWeight: 600, fontSize: '10.5px' }}>
              {searchTelemetry.topSimilarity.toFixed(2)}
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }} className="font-mono">
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ color: 'var(--color-chrome-muted)', fontSize: '10px' }}>LATENCY:</span>
            <span style={{ color: '#f8fafc', fontSize: '10.5px' }}>{searchTelemetry.latencyMs} ms</span>
          </div>
          <span className="status-pip status-pip-green" title="Retrieval Service Nominal" />
        </div>
      </div>

      {/* 3. TECHNICAL FILTER STRIP */}
      <div style={{
        background: 'var(--color-surface-subtle)',
        borderBottom: '1px solid var(--color-border-standard)',
        padding: '5px 12px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
        fontSize: '11px',
        gap: '10px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          {/* Temporal Range */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Calendar size={12} style={{ color: 'var(--color-text-muted)' }} />
            <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--color-text-muted)' }}>TEMPORAL:</span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="input font-mono"
              style={{ height: '22px', fontSize: '10px', padding: '0 4px', width: '105px' }}
            />
            <span style={{ color: 'var(--color-text-muted)' }}>→</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="input font-mono"
              style={{ height: '22px', fontSize: '10px', padding: '0 4px', width: '105px' }}
            />
          </div>

          <div style={{ height: '14px', width: '1px', background: 'var(--color-border-standard)' }} />

          {/* Cloud Cover Pills */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
            <Cloud size={12} style={{ color: 'var(--color-text-muted)' }} />
            <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--color-text-muted)' }}>CLOUD:</span>
            {[
              { id: 'all', label: 'All' },
              { id: '0-10', label: '0–10%' },
              { id: '10-25', label: '10–25%' },
              { id: '25-50', label: '25–50%' },
            ].map((c) => (
              <button
                key={c.id}
                onClick={() => setCloudCoverRange(c.id as any)}
                className="btn btn-sm"
                style={{
                  height: '20px',
                  padding: '0 6px',
                  fontSize: '10px',
                  background: cloudCoverRange === c.id ? 'var(--color-chrome-bg)' : 'transparent',
                  color: cloudCoverRange === c.id ? '#38bdf8' : 'var(--color-text-secondary)',
                  borderColor: cloudCoverRange === c.id ? 'var(--color-chrome-border)' : 'var(--color-border-subtle)',
                  fontWeight: cloudCoverRange === c.id ? 600 : 500,
                }}
              >
                {c.label}
              </button>
            ))}
          </div>

          <div style={{ height: '14px', width: '1px', background: 'var(--color-border-standard)' }} />

          {/* Sensor Constellation Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--color-text-muted)' }}>SENSOR:</span>
            <select
              value={sensorFilter}
              onChange={(e) => setSensorFilter(e.target.value as any)}
              className="input font-mono"
              style={{ height: '22px', fontSize: '10px', padding: '0 4px', background: 'var(--color-surface-base)' }}
            >
              <option value="all">All Sensors</option>
              <option value="Sentinel-2">Sentinel-2 (MSI)</option>
              <option value="Landsat-8">Landsat-8 (OLI)</option>
              <option value="Landsat-9">Landsat-9 (OLI-2)</option>
            </select>
          </div>

          <div style={{ height: '14px', width: '1px', background: 'var(--color-border-standard)' }} />

          {/* Processing Level */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--color-text-muted)' }}>PROCESSING:</span>
            <select
              value={processingLevel}
              onChange={(e) => setProcessingLevel(e.target.value as any)}
              className="input font-mono"
              style={{ height: '22px', fontSize: '10px', padding: '0 4px', background: 'var(--color-surface-base)' }}
            >
              <option value="all">All Levels</option>
              <option value="Analysis Ready">Analysis Ready (ARD)</option>
              <option value="L2A">L2A Bottom-of-Atmosphere</option>
            </select>
          </div>

          <div style={{ height: '14px', width: '1px', background: 'var(--color-border-standard)' }} />

          {/* Spatial Relation */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--color-text-muted)' }}>SPATIAL:</span>
            <select
              value={spatialRelation}
              onChange={(e) => setSpatialRelation(e.target.value as any)}
              className="input font-mono"
              style={{ height: '22px', fontSize: '10px', padding: '0 4px', background: 'var(--color-surface-base)' }}
            >
              <option value="aoi">Current AOI ({currentAoi.mgrsGrid})</option>
              <option value="region">{currentAoi.region} Catchment</option>
              <option value="global">Global Archive</option>
            </select>
          </div>

          <div style={{ height: '14px', width: '1px', background: 'var(--color-border-standard)' }} />

          {/* Similarity Threshold */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
            <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--color-text-muted)' }}>THRESHOLD:</span>
            {[
              { val: undefined, label: 'All' },
              { val: 0.70, label: '≥ 0.70' },
              { val: 0.80, label: '≥ 0.80' },
              { val: 0.90, label: '≥ 0.90' },
            ].map((t, idx) => (
              <button
                key={idx}
                onClick={() => setMinSimilarity(t.val)}
                className="btn btn-sm"
                style={{
                  height: '20px',
                  padding: '0 5px',
                  fontSize: '10px',
                  background: minSimilarity === t.val ? 'var(--color-chrome-bg)' : 'transparent',
                  color: minSimilarity === t.val ? '#38bdf8' : 'var(--color-text-secondary)',
                  borderColor: minSimilarity === t.val ? 'var(--color-chrome-border)' : 'var(--color-border-subtle)',
                  fontWeight: minSimilarity === t.val ? 600 : 500,
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* View Mode Toggle: [GRID] vs [CATALOG] */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '2px', background: 'var(--color-surface-sunken)', padding: '2px', borderRadius: 'var(--radius-xs)' }}>
          <button
            onClick={() => setViewMode('grid')}
            className={`btn btn-sm ${viewMode === 'grid' ? 'btn-primary' : ''}`}
            style={{
              height: '22px',
              padding: '0 7px',
              fontSize: '10px',
              fontWeight: 600,
              background: viewMode === 'grid' ? 'var(--color-chrome-bg)' : 'transparent',
              color: viewMode === 'grid' ? '#38bdf8' : 'var(--color-text-secondary)',
              border: 'none',
            }}
          >
            <LayoutGrid size={11} />
            <span>GRID</span>
          </button>
          <button
            onClick={() => setViewMode('catalog')}
            className={`btn btn-sm ${viewMode === 'catalog' ? 'btn-primary' : ''}`}
            style={{
              height: '22px',
              padding: '0 7px',
              fontSize: '10px',
              fontWeight: 600,
              background: viewMode === 'catalog' ? 'var(--color-chrome-bg)' : 'transparent',
              color: viewMode === 'catalog' ? '#38bdf8' : 'var(--color-text-secondary)',
              border: 'none',
            }}
          >
            <List size={11} />
            <span>CATALOG</span>
          </button>
        </div>
      </div>

      {/* Notification Toast if operational action fired */}
      {actionNotification && (
        <div style={{
          background: 'var(--color-accent-blue-subtle)',
          borderBottom: '1px solid #bae6fd',
          padding: '4px 12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '11px',
          color: '#0369a1',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <CheckCircle2 size={13} style={{ color: '#0284c7' }} />
            <span className="font-mono">{actionNotification}</span>
          </div>
          <button
            onClick={() => setActionNotification(null)}
            className="btn btn-sm"
            style={{ fontSize: '10px', padding: '0 4px', height: '18px' }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* 4. MAIN 2-COLUMN RETRIEVAL WORKSPACE: RESULTS LIST + DETAIL INSPECTOR */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'row',
        overflow: 'hidden',
      }}>
        {/* Left/Center Results Canvas */}
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflowY: 'auto',
          padding: '10px',
          background: 'var(--color-canvas)',
        }}>
          {results.length === 0 ? (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              gap: '10px',
              color: 'var(--color-text-muted)',
            }}>
              <AlertTriangle size={24} style={{ color: 'var(--color-accent-amber)' }} />
              <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text-secondary)' }}>
                No satellite scenes match the current semantic and filter criteria.
              </div>
              <button onClick={handleResetFilters} className="btn btn-sm">
                Reset All Filters
              </button>
            </div>
          ) : viewMode === 'grid' ? (
            /* GRID VIEW MODE */
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))',
              gap: '10px',
            }}>
              {results.map((res) => {
                const isSelected = selectedResult?.id === res.id;
                const isComparison = comparisonScene?.id === res.scene.id;

                return (
                  <div
                    key={res.id}
                    onClick={() => {
                      setSelectedResult(res);
                      if (onSelectScene) onSelectScene(res.scene);
                    }}
                    className={`catalog-card ${isSelected ? 'active' : ''}`}
                    style={{
                      borderWidth: isSelected ? '1.5px' : '1px',
                    }}
                  >
                    {/* Card Header: Rank, Scene ID, Similarity */}
                    <div style={{
                      padding: '6px 8px',
                      background: isSelected ? 'var(--color-chrome-bg)' : 'var(--color-surface-subtle)',
                      borderBottom: '1px solid var(--color-border-subtle)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: '10px',
                          fontWeight: 700,
                          padding: '1px 5px',
                          background: isSelected ? '#38bdf8' : 'var(--color-surface-sunken)',
                          color: isSelected ? '#0c1424' : 'var(--color-text-primary)',
                          borderRadius: 'var(--radius-xs)',
                        }}>
                          #{res.semanticRank.toString().padStart(2, '0')}
                        </span>
                        <span
                          className="font-mono"
                          style={{
                            fontSize: '11px',
                            fontWeight: 600,
                            color: isSelected ? '#ffffff' : 'var(--color-text-primary)',
                          }}
                        >
                          {res.scene.satellite}
                        </span>
                        {isComparison && (
                          <span className="badge badge-amber" style={{ fontSize: '9px', padding: '0 4px' }}>
                            COMP T2
                          </span>
                        )}
                      </div>

                      {/* Similarity Badge */}
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        padding: '1px 6px',
                        borderRadius: 'var(--radius-xs)',
                        background: res.similarityScore >= 0.9
                          ? 'rgba(21, 128, 61, 0.15)'
                          : res.similarityScore >= 0.8
                          ? 'rgba(2, 132, 199, 0.15)'
                          : 'rgba(180, 83, 9, 0.15)',
                        border: `1px solid ${
                          res.similarityScore >= 0.9 ? '#86efac' : res.similarityScore >= 0.8 ? '#7dd3fc' : '#fde68a'
                        }`,
                        color: res.similarityScore >= 0.9 ? '#15803d' : res.similarityScore >= 0.8 ? '#0369a1' : '#b45309',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '10.5px',
                        fontWeight: 700,
                      }}>
                        <span>SIM</span>
                        <span>{res.similarityScore.toFixed(2)}</span>
                      </div>
                    </div>

                    {/* Card Body: Thumbnail + Spec Breakdown */}
                    <div style={{ padding: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {/* Synthetic Scene Thumbnail */}
                      <SceneThumbnail scene={res.scene} height={110} />

                      {/* Scene ID in Monospace */}
                      <div
                        className="font-mono text-muted"
                        style={{
                          fontSize: '10px',
                          wordBreak: 'break-all',
                          background: 'var(--color-surface-subtle)',
                          padding: '3px 5px',
                          borderRadius: 'var(--radius-xs)',
                          border: '1px solid var(--color-border-subtle)',
                        }}
                      >
                        {res.scene.id}
                      </div>

                      {/* Core Specs Grid */}
                      <div style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr',
                        gap: '4px 8px',
                        fontSize: '10.5px',
                        fontFamily: 'var(--font-mono)',
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span className="text-muted">ACQ:</span>
                          <span style={{ fontWeight: 600 }}>{res.scene.acquisitionDate.split('T')[0]}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span className="text-muted">CLOUD:</span>
                          <span style={{ fontWeight: 600, color: res.scene.cloudCoverPercent < 10 ? '#15803d' : '#b45309' }}>
                            {res.scene.cloudCoverPercent}%
                          </span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span className="text-muted">SENSOR:</span>
                          <span>{res.scene.sensor.split(' ')[0]}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span className="text-muted">LEVEL:</span>
                          <span style={{ color: '#0284c7' }}>{res.scene.processingLevel.split('/')[0].trim()}</span>
                        </div>
                      </div>

                      {/* Semantic Reason Quote Box */}
                      <div style={{
                        background: 'var(--color-surface-subtle)',
                        borderLeft: '2px solid var(--color-accent-blue)',
                        padding: '5px 7px',
                        fontSize: '11px',
                        lineHeight: 1.35,
                        color: 'var(--color-text-secondary)',
                        fontStyle: 'normal',
                      }}>
                        "{res.semanticReason || res.featureMatches[0]?.semanticContext}"
                      </div>

                      {/* Feature Tags */}
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
                        {res.featureMatches.map((f, i) => (
                          <span
                            key={i}
                            className="badge badge-neutral"
                            style={{ fontSize: '9.5px', padding: '1px 5px' }}
                          >
                            {f.feature} ({(f.confidence * 100).toFixed(0)}%)
                          </span>
                        ))}
                      </div>

                      {/* Action buttons inside card */}
                      <div style={{
                        display: 'flex',
                        gap: '4px',
                        paddingTop: '4px',
                        borderTop: '1px solid var(--color-border-subtle)',
                      }}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSetComparison(res.scene);
                          }}
                          className="btn btn-sm"
                          style={{ flex: 1, fontSize: '10px' }}
                        >
                          <GitCompare size={11} />
                          <span>Set Comparison</span>
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenChangeAnalysis(res.scene);
                          }}
                          className="btn btn-sm btn-primary"
                          style={{ flex: 1, fontSize: '10px' }}
                        >
                          <ArrowRight size={11} />
                          <span>Change Analysis</span>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* DENSE TECHNICAL CATALOG TABLE MODE */
            <div className="panel" style={{ flex: 1, overflowY: 'auto' }}>
              <table className="table-dense font-mono" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th style={{ width: '55px' }}>Rank</th>
                    <th>Scene Identifier</th>
                    <th>Sensor</th>
                    <th>Acquisition UTC</th>
                    <th>Cloud</th>
                    <th>Similarity</th>
                    <th>AOI / Grid</th>
                    <th>Processing Level</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((res) => {
                    const isSelected = selectedResult?.id === res.id;
                    return (
                      <tr
                        key={res.id}
                        onClick={() => {
                          setSelectedResult(res);
                          if (onSelectScene) onSelectScene(res.scene);
                        }}
                        className={isSelected ? 'table-row-selected' : ''}
                        style={{ cursor: 'pointer' }}
                      >
                        <td style={{ fontWeight: 700 }}>
                          <span style={{
                            padding: '1px 5px',
                            background: isSelected ? 'var(--color-accent-blue)' : 'var(--color-surface-sunken)',
                            color: isSelected ? '#ffffff' : 'var(--color-text-primary)',
                            borderRadius: 'var(--radius-xs)',
                          }}>
                            #{res.semanticRank.toString().padStart(2, '0')}
                          </span>
                        </td>
                        <td style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>
                          {res.scene.id}
                        </td>
                        <td>{res.scene.satellite} {res.scene.sensor.split(' ')[0]}</td>
                        <td>{res.scene.acquisitionDate.replace('T', ' ').replace('Z', '')}</td>
                        <td style={{ color: res.scene.cloudCoverPercent < 10 ? '#15803d' : '#b45309' }}>
                          {res.scene.cloudCoverPercent}%
                        </td>
                        <td>
                          <span style={{
                            fontWeight: 700,
                            color: res.similarityScore >= 0.9 ? '#15803d' : res.similarityScore >= 0.8 ? '#0284c7' : '#b45309',
                          }}>
                            {res.similarityScore.toFixed(2)}
                          </span>
                        </td>
                        <td>{res.aoiId || res.scene.mgrsTile}</td>
                        <td>{res.scene.processingLevel}</td>
                        <td style={{ textAlign: 'right' }}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSetComparison(res.scene);
                            }}
                            className="btn btn-sm"
                            style={{ height: '20px', fontSize: '9.5px', padding: '0 5px' }}
                          >
                            Set Comp
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right Detail Inspector Panel (Image Preview & Technical Metadata) */}
        {selectedResult && (
          <div style={{
            width: '360px',
            background: 'var(--color-surface-base)',
            borderLeft: '1px solid var(--color-border-standard)',
            display: 'flex',
            flexDirection: 'column',
            flexShrink: 0,
            height: '100%',
            overflow: 'hidden',
          }}>
            {/* Inspector Header */}
            <div style={{
              height: '34px',
              background: 'var(--color-surface-subtle)',
              borderBottom: '1px solid var(--color-border-standard)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0 10px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span className="badge badge-blue">RANK #{selectedResult.semanticRank.toString().padStart(2, '0')}</span>
                <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-text-primary)' }}>
                  Scene Detail Inspector
                </span>
              </div>
              <div style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '11px',
                fontWeight: 700,
                color: selectedResult.similarityScore >= 0.9 ? '#15803d' : '#0369a1',
              }}>
                SIM: {selectedResult.similarityScore.toFixed(2)}
              </div>
            </div>

            {/* Scrollable Inspector Body */}
            <div style={{
              flex: 1,
              overflowY: 'auto',
              padding: '10px',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
            }}>
              {/* Larger Mock Satellite Image Preview */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>
                  Radiometric Synthetic Preview
                </div>
                <SceneThumbnail scene={selectedResult.scene} height={190} showOverlay={true} />
              </div>

              {/* Primary Scene ID Card */}
              <div className="panel">
                <div className="panel-header">
                  <span>Scene Identification</span>
                  <span className="badge badge-blue">{selectedResult.scene.processingLevel.split('/')[0].trim()}</span>
                </div>
                <div className="panel-body font-mono" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div style={{ fontSize: '10px', color: 'var(--color-text-muted)' }}>SCENE RECORD ID</div>
                  <div style={{ fontSize: '10.5px', fontWeight: 600, color: 'var(--color-text-primary)', wordBreak: 'break-all' }}>
                    {selectedResult.scene.id}
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', paddingTop: '6px', borderTop: '1px solid var(--color-border-subtle)' }}>
                    <div>
                      <div className="text-muted" style={{ fontSize: '9.5px' }}>CONSTELLATION</div>
                      <div style={{ fontSize: '11px', fontWeight: 600 }}>{selectedResult.scene.satellite}</div>
                    </div>
                    <div>
                      <div className="text-muted" style={{ fontSize: '9.5px' }}>SENSOR</div>
                      <div style={{ fontSize: '11px', fontWeight: 600 }}>{selectedResult.scene.sensor}</div>
                    </div>
                    <div>
                      <div className="text-muted" style={{ fontSize: '9.5px' }}>ACQUISITION UTC</div>
                      <div style={{ fontSize: '10.5px' }}>{selectedResult.scene.acquisitionDate.replace('T', ' ').replace('Z', '')}</div>
                    </div>
                    <div>
                      <div className="text-muted" style={{ fontSize: '9.5px' }}>CLOUD COVER</div>
                      <div style={{ fontSize: '11px', fontWeight: 600, color: selectedResult.scene.cloudCoverPercent < 10 ? '#15803d' : '#b45309' }}>
                        {selectedResult.scene.cloudCoverPercent}%
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Semantic Match Explanation Card */}
              <div className="panel">
                <div className="panel-header">
                  <span>Semantic Match Breakdown</span>
                  <span className="font-mono text-xs" style={{ color: '#0284c7' }}>
                    {(selectedResult.similarityScore * 100).toFixed(1)}% FIT
                  </span>
                </div>
                <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{
                    background: 'var(--color-surface-subtle)',
                    borderLeft: '3px solid var(--color-accent-blue)',
                    padding: '6px 8px',
                    fontSize: '11.5px',
                    lineHeight: 1.4,
                    color: 'var(--color-text-primary)',
                  }}>
                    {selectedResult.semanticReason}
                  </div>

                  {/* Feature Confidence Breakdown */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                    <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>
                      Correlated Feature Vectors:
                    </div>
                    {selectedResult.featureMatches.map((f, i) => (
                      <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10.5px' }}>
                          <span style={{ color: 'var(--color-text-secondary)', fontWeight: 500 }}>{f.feature}</span>
                          <span className="font-mono" style={{ fontSize: '10px', color: '#0284c7' }}>
                            {(f.confidence * 100).toFixed(0)}%
                          </span>
                        </div>
                        <div style={{ width: '100%', height: '4px', background: 'var(--color-surface-sunken)', borderRadius: '1px' }}>
                          <div style={{ width: `${f.confidence * 100}%`, height: '100%', background: 'var(--color-accent-blue)' }} />
                        </div>
                        <div style={{ fontSize: '9.5px', color: 'var(--color-text-muted)', lineHeight: 1.2 }}>
                          {f.semanticContext}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Georeference & Footprint */}
              <div className="panel">
                <div className="panel-header">
                  <span>Cartographic Georeference</span>
                  <span className="font-mono text-xs">{selectedResult.scene.mgrsTile}</span>
                </div>
                <div className="panel-body font-mono" style={{ display: 'flex', flexDirection: 'column', gap: '5px', fontSize: '10.5px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span className="text-muted">CENTROID:</span>
                    <span>{selectedResult.scene.centerCoordinates.lat.toFixed(4)}°N  {selectedResult.scene.centerCoordinates.lon.toFixed(4)}°E</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span className="text-muted">MGRS TILE:</span>
                    <span>{selectedResult.scene.mgrsTile}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span className="text-muted">CRS:</span>
                    <span style={{ fontSize: '9.5px' }}>{selectedResult.scene.crs}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span className="text-muted">SUN AZ / ELEV:</span>
                    <span>{selectedResult.scene.sunAzimuthDeg}° / {selectedResult.scene.sunElevationDeg}°</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span className="text-muted">RESOLUTION:</span>
                    <span>{selectedResult.scene.resolutionMeters}m GSD</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom Actions Pin */}
            <div style={{
              padding: '8px 10px',
              borderTop: '1px solid var(--color-border-standard)',
              background: 'var(--color-surface-subtle)',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
            }}>
              <button
                onClick={() => handleSetComparison(selectedResult.scene)}
                className="btn btn-primary"
                style={{ width: '100%', height: '28px', fontSize: '11px', fontWeight: 600 }}
              >
                <GitCompare size={12} />
                <span>Set as Comparison Scene (T2)</span>
              </button>

              <button
                onClick={() => handleOpenChangeAnalysis(selectedResult.scene)}
                className="btn"
                style={{ width: '100%', height: '26px', fontSize: '11px' }}
              >
                <ArrowRight size={12} />
                <span>Open in Change Analysis</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
