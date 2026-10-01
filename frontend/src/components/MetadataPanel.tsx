import React, { useState } from 'react';
import {
  Info,
  Layers,
  Activity,
  FileText,
  ExternalLink,
  ChevronRight,
  Database
} from 'lucide-react';
import { AOI, ChangeMetric, SatelliteScene } from '../types';

interface MetadataPanelProps {
  scene: SatelliteScene;
  aoi: AOI;
  changeMetrics: ChangeMetric[];
  onTriggerAnalysis?: () => void;
}

export const MetadataPanel: React.FC<MetadataPanelProps> = ({
  scene,
  aoi,
  changeMetrics,
  onTriggerAnalysis,
}) => {
  const [activeTab, setActiveTab] = useState<'scene' | 'aoi' | 'spectral' | 'metrics'>('scene');

  return (
    <div style={{
      width: '320px',
      background: 'var(--color-surface-base)',
      borderLeft: '1px solid var(--color-border-standard)',
      display: 'flex',
      flexDirection: 'column',
      flexShrink: 0,
      height: '100%',
      overflow: 'hidden',
    }}>
      {/* Panel Tab Navigation Header */}
      <div style={{
        height: '34px',
        background: 'var(--color-surface-subtle)',
        borderBottom: '1px solid var(--color-border-standard)',
        display: 'flex',
        alignItems: 'stretch',
        padding: '0 4px',
      }}>
        {[
          { id: 'scene', label: 'Scene Meta', icon: Info },
          { id: 'aoi', label: 'AOI Footprint', icon: Database },
          { id: 'spectral', label: 'Bands', icon: Layers },
          { id: 'metrics', label: 'Delta Metrics', icon: Activity },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px',
                background: isActive ? 'var(--color-surface-base)' : 'transparent',
                border: 'none',
                borderBottom: isActive ? '2px solid var(--color-accent-blue)' : '2px solid transparent',
                color: isActive ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                fontWeight: isActive ? 600 : 500,
                fontSize: '11px',
                cursor: 'pointer',
                padding: '0 2px',
                transition: 'all 0.1s ease',
              }}
            >
              <Icon size={12} strokeWidth={isActive ? 2.2 : 1.8} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Panel Scrollable Content Body */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '10px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      }}>
        {/* TAB 1: SCENE METADATA */}
        {activeTab === 'scene' && (
          <>
            {/* Primary Scene ID Card */}
            <div className="panel">
              <div className="panel-header">
                <span>Active Scene Identification</span>
                <span className="badge badge-blue">L2A</span>
              </div>
              <div className="panel-body font-mono" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div>
                  <div className="text-xs text-muted" style={{ fontSize: '10px', textTransform: 'uppercase' }}>Scene ID</div>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-text-primary)', wordBreak: 'break-all', marginTop: '2px' }}>
                    {scene.id}
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', paddingTop: '4px', borderTop: '1px solid var(--color-border-subtle)' }}>
                  <div>
                    <div className="text-xs text-muted" style={{ fontSize: '10px' }}>SENSOR</div>
                    <div className="text-xs font-semibold" style={{ color: 'var(--color-text-primary)' }}>{scene.sensor}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted" style={{ fontSize: '10px' }}>CLOUD COVER</div>
                    <div className="text-xs font-semibold" style={{ color: scene.cloudCoverPercent < 10 ? '#15803d' : '#b45309' }}>
                      {scene.cloudCoverPercent}%
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted" style={{ fontSize: '10px' }}>ACQUISITION UTC</div>
                    <div className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                      {scene.acquisitionDate.replace('T', ' ').replace('Z', '')}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted" style={{ fontSize: '10px' }}>PROCESSING</div>
                    <div className="text-xs font-semibold" style={{ color: '#0369a1' }}>
                      {scene.processingLevel}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Target AOI Technical Spec */}
            <div className="panel">
              <div className="panel-header">
                <span>AOI Georeference</span>
                <span className="font-mono text-xs">{aoi.mgrsGrid}</span>
              </div>
              <div className="panel-body font-mono" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
                  <span className="text-muted">CENTROID:</span>
                  <span className="font-semibold">{aoi.center.lat.toFixed(4)}°N  {aoi.center.lon.toFixed(4)}°E</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
                  <span className="text-muted">MGRS TILE:</span>
                  <span>{aoi.mgrsGrid}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
                  <span className="text-muted">CRS:</span>
                  <span style={{ fontSize: '10px' }}>EPSG:32643 UTM 43N</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
                  <span className="text-muted">SUN AZ / ELEV:</span>
                  <span>{scene.sunAzimuthDeg}° / {scene.sunElevationDeg}°</span>
                </div>
              </div>
            </div>

            {/* Surface Classification Breakdown */}
            {scene.sceneClassificationSummary && (
              <div className="panel">
                <div className="panel-header">
                  <span>Classification Breakdown (SCL)</span>
                  <span className="badge badge-neutral">10m GSD</span>
                </div>
                <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {[
                    { label: 'Vegetation Canopy', pct: scene.sceneClassificationSummary.vegetationPercent, color: '#15803d' },
                    { label: 'Water Reservoir / Canals', pct: scene.sceneClassificationSummary.waterPercent, color: '#0284c7' },
                    { label: 'Bare Soil / Arid Regolith', pct: scene.sceneClassificationSummary.bareSoilPercent, color: '#b45309' },
                    { label: 'Urban & Built Infrastructure', pct: scene.sceneClassificationSummary.urbanPercent, color: '#64748b' },
                    { label: 'Cloud / Shadow Mask', pct: scene.sceneClassificationSummary.cloudPercent, color: '#94a3b8' },
                  ].map((item) => (
                    <div key={item.label}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '2px' }}>
                        <span style={{ color: 'var(--color-text-secondary)' }}>{item.label}</span>
                        <span className="font-mono text-xs font-semibold">{item.pct}%</span>
                      </div>
                      <div style={{ width: '100%', height: '5px', background: 'var(--color-surface-sunken)', borderRadius: '1px', overflow: 'hidden' }}>
                        <div style={{ width: `${item.pct}%`, height: '100%', background: item.color }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* TAB 2: AOI FOOTPRINT */}
        {activeTab === 'aoi' && (
          <>
            <div className="panel">
              <div className="panel-header">
                <span>Cadastral & Territory Summary</span>
                <span className="badge badge-green">VERIFIED</span>
              </div>
              <div className="panel-body font-mono text-xs" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span className="text-muted">DESIGNATION:</span>
                  <span className="font-semibold">{aoi.name}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span className="text-muted">AREA EXTENT:</span>
                  <span className="font-semibold">{aoi.areaSqKm} km²</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span className="text-muted">PERIMETER:</span>
                  <span>{aoi.perimeterKm} km</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span className="text-muted">MEAN ELEVATION:</span>
                  <span>{aoi.elevationRange.meanMeters}m MSL (min {aoi.elevationRange.minMeters}m / max {aoi.elevationRange.maxMeters}m)</span>
                </div>
              </div>
            </div>

            <div className="panel">
              <div className="panel-header">
                <span>Key Monitored Features</span>
                <span className="font-mono text-xs">4 SECTORS</span>
              </div>
              <div className="panel-body">
                <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                  {aoi.keyFeatures.map((f, i) => (
                    <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '6px', fontSize: '11px', color: 'var(--color-text-secondary)' }}>
                      <ChevronRight size={12} style={{ color: 'var(--color-accent-blue)', marginTop: '2px', flexShrink: 0 }} />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </>
        )}

        {/* TAB 3: SPECTRAL BANDS */}
        {activeTab === 'spectral' && (
          <div className="panel">
            <div className="panel-header">
              <span>Sentinel-2 MSI Radiometric Bands</span>
              <span className="badge badge-blue">10 BANDS</span>
            </div>
            <table className="table-dense font-mono">
              <thead>
                <tr>
                  <th>Band</th>
                  <th>Name</th>
                  <th>GSD</th>
                  <th>Wave</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {scene.bands.map((b) => (
                  <tr key={b.band}>
                    <td className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>{b.band}</td>
                    <td style={{ color: 'var(--color-text-secondary)' }}>{b.name}</td>
                    <td>{b.resolution}</td>
                    <td>{b.centralWavelength}</td>
                    <td>
                      <span className="status-pip status-pip-green" title="Nominal" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* TAB 4: DELTA METRICS */}
        {activeTab === 'metrics' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {changeMetrics.map((metric) => (
              <div key={metric.id} className="panel">
                <div className="panel-header">
                  <span>{metric.category}</span>
                  <span className={`badge ${metric.trend === 'increase' ? 'badge-green' : metric.trend === 'decrease' ? 'badge-amber' : 'badge-neutral'}`}>
                    {metric.percentChange > 0 ? `+${metric.percentChange}%` : `${metric.percentChange}%`}
                  </span>
                </div>
                <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-text-primary)' }}>
                    {metric.metricName}
                  </div>
                  <div className="font-mono text-xs" style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--color-text-muted)' }}>
                    <span>Baseline (T1): {metric.baselineValue} {metric.unit}</span>
                    <span>Current (T2): {metric.comparisonValue} {metric.unit}</span>
                  </div>
                  <p style={{ fontSize: '11px', color: 'var(--color-text-secondary)', lineHeight: 1.35, background: 'var(--color-surface-subtle)', padding: '5px', borderRadius: 'var(--radius-xs)' }}>
                    {metric.notes}
                  </p>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '2px' }}>
                    <span className="badge badge-blue">CONFIDENCE {metric.confidenceScore}%</span>
                    <span className="font-mono" style={{ fontSize: '9px', color: '#15803d' }}>
                      ✓ {metric.verificationStatus}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bottom Panel Actions */}
      <div style={{
        padding: '8px 10px',
        borderTop: '1px solid var(--color-border-standard)',
        background: 'var(--color-surface-subtle)',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
      }}>
        <button
          onClick={onTriggerAnalysis}
          className="btn btn-primary"
          style={{ width: '100%', height: '28px', fontSize: '11px', fontWeight: 600 }}
        >
          <Activity size={12} />
          <span>Execute Bi-Temporal Change Detection</span>
        </button>
        <div style={{ display: 'flex', gap: '4px' }}>
          <button className="btn btn-sm" style={{ flex: 1, fontSize: '10px' }}>
            <FileText size={11} />
            <span>AOI Export</span>
          </button>
          <button className="btn btn-sm" style={{ flex: 1, fontSize: '10px' }}>
            <ExternalLink size={11} />
            <span>Metadata JSON</span>
          </button>
        </div>
      </div>
    </div>
  );
};
