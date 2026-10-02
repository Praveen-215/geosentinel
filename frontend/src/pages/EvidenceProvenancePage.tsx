import React, { useState } from 'react';
import {
  FileCheck2,
  CheckCircle2,
  ShieldCheck,
  Clock,
  Database,
  Download,
  Copy,
  Check,
  Sliders,
  Layers,
  SearchCode,
  GitCompare,
  ClipboardCheck,
  Info,
} from 'lucide-react';
import {
  AOI,
  EvidencePackageDossier,
  NavigationSection,
  SourceSceneLineage,
} from '../types';
import { MOCK_EVIDENCE_DOSSIER } from '../data/mockEvidence';
import { evidenceService } from '../services/evidenceService';

interface EvidenceProvenancePageProps {
  currentAoi: AOI;
  onNavigateSection?: (section: NavigationSection) => void;
}

export const EvidenceProvenancePage: React.FC<EvidenceProvenancePageProps> = ({
  currentAoi,
  onNavigateSection,
}) => {
  const dossier: EvidencePackageDossier = MOCK_EVIDENCE_DOSSIER;

  // Selected scene for metadata drawer
  const [selectedScene, setSelectedScene] = useState<SourceSceneLineage | null>(dossier.sourceScenes[0]);
  const [showMetadataModal, setShowMetadataModal] = useState<boolean>(false);

  // Export Modal state
  const [showExportModal, setShowExportModal] = useState<boolean>(false);
  const [exportFormat, setExportFormat] = useState<'json' | 'markdown'>('json');
  const [copiedAuditHash, setCopiedAuditHash] = useState<boolean>(false);
  const [copiedExport, setCopiedExport] = useState<boolean>(false);

  // Copy Audit Hash handler
  const handleCopyAuditHash = () => {
    navigator.clipboard.writeText(dossier.auditHash);
    setCopiedAuditHash(true);
    setTimeout(() => setCopiedAuditHash(false), 2500);
  };

  // Copy Export content handler
  const handleCopyExport = () => {
    const text =
      exportFormat === 'json'
        ? evidenceService.exportDossierAsJson(dossier)
        : evidenceService.exportDossierAsMarkdown(dossier);
    navigator.clipboard.writeText(text);
    setCopiedExport(true);
    setTimeout(() => setCopiedExport(false), 2500);
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
      {/* 1. TOP INVESTIGATION TELEMETRY HEADER */}
      <div style={{
        background: 'var(--color-chrome-bg)',
        borderBottom: '1px solid var(--color-chrome-border)',
        padding: '6px 12px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
        color: 'var(--color-chrome-text)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            width: '24px',
            height: '24px',
            background: 'rgba(56, 189, 248, 0.15)',
            border: '1px solid #38bdf8',
            borderRadius: 'var(--radius-xs)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#38bdf8',
          }}>
            <FileCheck2 size={14} strokeWidth={2.4} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontWeight: 700, fontSize: '12px', color: '#ffffff', letterSpacing: '0.04em' }}>
                EVIDENCE & PROVENANCE
              </span>
              <span className="badge badge-neutral" style={{ fontSize: '9px', fontWeight: 600 }}>
                MOD-F6
              </span>
              <span className="font-mono text-muted" style={{ fontSize: '10px' }}>
                {dossier.investigationId} • {dossier.packageId}
              </span>
            </div>
            <div style={{ fontSize: '10.5px', color: 'var(--color-chrome-muted)' }}>
              Trace the evidence chain from retrieval to analyst disposition / {currentAoi.name}
            </div>
          </div>
        </div>

        {/* Center / Right Telemetry Status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            background: 'rgba(0, 0, 0, 0.35)',
            border: '1px solid var(--color-chrome-border)',
            padding: '3px 9px',
            borderRadius: 'var(--radius-xs)',
            fontSize: '10px',
            fontFamily: 'var(--font-mono)',
          }}>
            <span style={{ color: 'var(--color-chrome-muted)' }}>STATUS:</span>
            <span style={{ color: '#22c55e', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px' }}>
              <CheckCircle2 size={11} />
              {dossier.status}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <button
              onClick={handleCopyAuditHash}
              className="btn btn-sm font-mono"
              style={{
                height: '24px',
                fontSize: '9.5px',
                padding: '0 8px',
                gap: '5px',
                background: 'rgba(255, 255, 255, 0.05)',
                color: '#cbd5e1',
              }}
              title="Copy SHA-256 Audit Integrity Hash"
            >
              {copiedAuditHash ? <Check size={11} color="#22c55e" /> : <Copy size={11} />}
              <span>{copiedAuditHash ? 'HASH COPIED!' : 'HASH: 7f4a...e9f0'}</span>
            </button>

            <button
              onClick={() => setShowExportModal(true)}
              className="btn btn-sm"
              style={{
                height: '24px',
                padding: '0 9px',
                fontSize: '10.5px',
                fontWeight: 600,
                gap: '5px',
                background: 'rgba(56, 189, 248, 0.1)',
                borderColor: 'rgba(56, 189, 248, 0.4)',
                color: '#38bdf8',
              }}
            >
              <Download size={12} />
              <span>EXPORT DOSSIER</span>
            </button>

            <span className="font-mono text-xs" style={{ color: '#b45309', fontSize: '9.5px', marginLeft: '4px' }}>
              DEMO / LOCAL MOCK
            </span>
          </div>
        </div>
      </div>

      {/* 2. OPERATIONAL BODY: EVIDENCE LINEAGE CHAIN + DENSE PANELS */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflowY: 'auto',
        padding: '8px 10px',
        gap: '8px',
      }}>
        {/* TOP: EVIDENCE CHAIN LINEAGE (Horizontal Connected Pipeline) */}
        <div className="panel" style={{ flexShrink: 0 }}>
          <div className="panel-header" style={{ justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <ShieldCheck size={13} style={{ color: '#0284c7' }} />
              <span>End-to-End Evidence Lineage Chain</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="font-mono text-muted" style={{ fontSize: '9px' }}>
                5-NODE VERIFIABLE AUDIT TRACE
              </span>
              <span className="badge badge-amber font-mono" style={{ fontSize: '8.5px' }}>
                LOCAL DEMO PROVENANCE
              </span>
            </div>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(5, 1fr)',
            gap: '8px',
            padding: '8px 10px',
            background: 'var(--color-surface-subtle)',
          }}>
            {/* NODE 1: F2 Semantic Retrieval */}
            <div style={{
              background: 'var(--color-surface-base)',
              border: '1px solid var(--color-border-standard)',
              borderRadius: 'var(--radius-xs)',
              padding: '6px 8px',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
              position: 'relative',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <SearchCode size={12} style={{ color: '#0284c7' }} />
                  <span style={{ fontWeight: 700, fontSize: '11px', color: '#0284c7' }}>F2 RETRIEVAL</span>
                </div>
                <span className="badge badge-green font-mono" style={{ fontSize: '8px' }}>EVAL 6</span>
              </div>
              <div style={{ fontSize: '10.5px', fontWeight: 600, color: 'var(--color-text-primary)' }}>
                Semantic Retrieval
              </div>
              <div className="font-mono text-muted" style={{ fontSize: '9.5px', lineHeight: 1.3 }}>
                Query: "water body expansion after monsoon"
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', marginTop: 'auto', paddingTop: '4px', borderTop: '1px solid var(--color-border-subtle)' }}>
                <span className="text-muted font-mono">TOP SCORE:</span>
                <span className="font-mono" style={{ color: '#0284c7', fontWeight: 700 }}>0.94 MATCH</span>
              </div>
            </div>

            {/* NODE 2: F5 Similar Site Discovery */}
            <div style={{
              background: 'var(--color-surface-base)',
              border: '1px solid var(--color-border-standard)',
              borderRadius: 'var(--radius-xs)',
              padding: '6px 8px',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Layers size={12} style={{ color: '#0284c7' }} />
                  <span style={{ fontWeight: 700, fontSize: '11px', color: '#0284c7' }}>F5 SIMILAR SITE</span>
                </div>
                <span className="badge badge-blue font-mono" style={{ fontSize: '8px' }}>HYBRID</span>
              </div>
              <div style={{ fontSize: '10.5px', fontWeight: 600, color: 'var(--color-text-primary)' }}>
                Site Discovery
              </div>
              <div className="font-mono text-muted" style={{ fontSize: '9.5px', lineHeight: 1.3 }}>
                Selected: Panshet Reservoir Basin (24.6 km SW)
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', marginTop: 'auto', paddingTop: '4px', borderTop: '1px solid var(--color-border-subtle)' }}>
                <span className="text-muted font-mono">SIMILARITY:</span>
                <span className="font-mono" style={{ color: '#0284c7', fontWeight: 700 }}>0.94 MATCH</span>
              </div>
            </div>

            {/* NODE 3: F3 Change Analysis */}
            <div style={{
              background: 'var(--color-surface-base)',
              border: '1px solid var(--color-border-standard)',
              borderRadius: 'var(--radius-xs)',
              padding: '6px 8px',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <GitCompare size={12} style={{ color: '#0284c7' }} />
                  <span style={{ fontWeight: 700, fontSize: '11px', color: '#0284c7' }}>F3 CHANGE</span>
                </div>
                <span className="badge badge-green font-mono" style={{ fontSize: '8px' }}>+154.0%</span>
              </div>
              <div style={{ fontSize: '10.5px', fontWeight: 600, color: 'var(--color-text-primary)' }}>
                Spectral Delta
              </div>
              <div className="font-mono text-muted" style={{ fontSize: '9.5px', lineHeight: 1.3 }}>
                T1: 15 MAY 2025 → T2: 21 SEP 2025 (129d)
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', marginTop: 'auto', paddingTop: '4px', borderTop: '1px solid var(--color-border-subtle)' }}>
                <span className="text-muted font-mono">CONFIDENCE:</span>
                <span className="font-mono" style={{ color: '#15803d', fontWeight: 700 }}>HIGH</span>
              </div>
            </div>

            {/* NODE 4: F4 Analyst Review */}
            <div style={{
              background: 'var(--color-surface-base)',
              border: '1px solid var(--color-border-standard)',
              borderRadius: 'var(--radius-xs)',
              padding: '6px 8px',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <ClipboardCheck size={12} style={{ color: '#15803d' }} />
                  <span style={{ fontWeight: 700, fontSize: '11px', color: '#15803d' }}>F4 REVIEW</span>
                </div>
                <span className="badge badge-green font-mono" style={{ fontSize: '8px' }}>6/6 CHECKS</span>
              </div>
              <div style={{ fontSize: '10.5px', fontWeight: 600, color: 'var(--color-text-primary)' }}>
                Analyst Decision
              </div>
              <div className="font-mono text-muted" style={{ fontSize: '9.5px', lineHeight: 1.3 }}>
                Review ID: EV-2025-0921-01 (Confirmed)
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', marginTop: 'auto', paddingTop: '4px', borderTop: '1px solid var(--color-border-subtle)' }}>
                <span className="text-muted font-mono">DISPOSITION:</span>
                <span className="font-mono" style={{ color: '#15803d', fontWeight: 700 }}>CONFIRMED</span>
              </div>
            </div>

            {/* NODE 5: F6 Evidence Package */}
            <div style={{
              background: 'rgba(56, 189, 248, 0.08)',
              border: '1.5px solid #0284c7',
              borderRadius: 'var(--radius-xs)',
              padding: '6px 8px',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <FileCheck2 size={12} style={{ color: '#0284c7' }} />
                  <span style={{ fontWeight: 700, fontSize: '11px', color: '#0284c7' }}>F6 DOSSIER</span>
                </div>
                <span className="badge badge-blue font-mono" style={{ fontSize: '8px' }}>SEALED</span>
              </div>
              <div style={{ fontSize: '10.5px', fontWeight: 700, color: 'var(--color-text-primary)' }}>
                Evidence Package
              </div>
              <div className="font-mono text-muted" style={{ fontSize: '9.5px', lineHeight: 1.3 }}>
                12 Lineage Events • Complete Audit Trail
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', marginTop: 'auto', paddingTop: '4px', borderTop: '1px solid rgba(56, 189, 248, 0.3)' }}>
                <span className="text-muted font-mono">EXPORT:</span>
                <span className="font-mono" style={{ color: '#0284c7', fontWeight: 700 }}>JSON / SUMMARY</span>
              </div>
            </div>
          </div>
        </div>

        {/* MIDDLE SECTION: 2-COLUMN DENSE AUDIT WORKSTATION */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
          gap: '8px',
          flexShrink: 0,
        }}>
          {/* COLUMN 1: EVIDENCE SUMMARY + SOURCE SCENES + PROCESSING LINEAGE */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {/* Evidence Package Summary Card */}
            <div className="panel">
              <div className="panel-header" style={{ justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <CheckCircle2 size={13} style={{ color: '#15803d' }} />
                  <span>Evidence Package Summary</span>
                </div>
                <span className="badge badge-green font-mono" style={{ fontSize: '9px', fontWeight: 700 }}>
                  EVIDENCE PACKAGE COMPLETE
                </span>
              </div>

              <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '8px 10px' }}>
                <div>
                  <div className="font-mono text-xs text-muted" style={{ fontSize: '9px' }}>INVESTIGATION FINDING</div>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--color-text-primary)' }}>
                    {dossier.findingSummary.changeType}
                  </div>
                  <div style={{ fontSize: '11px', color: '#0284c7', fontWeight: 600 }}>
                    {dossier.feature} • {dossier.aoiName} [{dossier.aoiId}]
                  </div>
                </div>

                {/* Metrics Matrix */}
                <div className="font-mono" style={{
                  background: 'var(--color-surface-subtle)',
                  border: '1px solid var(--color-border-standard)',
                  borderRadius: 'var(--radius-xs)',
                  padding: '6px 10px',
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4, 1fr)',
                  gap: '6px',
                  fontSize: '10.5px',
                }}>
                  <div>
                    <div className="text-muted" style={{ fontSize: '8.5px' }}>BASELINE (T1)</div>
                    <div style={{ fontWeight: 700, color: 'var(--color-text-primary)' }}>{dossier.findingSummary.baselineValue}</div>
                    <div style={{ fontSize: '8.5px', color: 'var(--color-text-muted)' }}>15 MAY 2025</div>
                  </div>
                  <div>
                    <div className="text-muted" style={{ fontSize: '8.5px' }}>COMPARISON (T2)</div>
                    <div style={{ fontWeight: 700, color: 'var(--color-text-primary)' }}>{dossier.findingSummary.comparisonValue}</div>
                    <div style={{ fontSize: '8.5px', color: 'var(--color-text-muted)' }}>21 SEP 2025</div>
                  </div>
                  <div>
                    <div className="text-muted" style={{ fontSize: '8.5px' }}>DELTA CHANGE</div>
                    <div style={{ fontWeight: 700, color: '#15803d' }}>{dossier.findingSummary.relativeChange}</div>
                    <div style={{ fontSize: '8.5px', color: '#15803d' }}>{dossier.findingSummary.absoluteChange}</div>
                  </div>
                  <div>
                    <div className="text-muted" style={{ fontSize: '8.5px' }}>CONFIDENCE</div>
                    <div style={{ fontWeight: 700, color: '#0284c7' }}>{dossier.findingSummary.confidence}</div>
                    <div style={{ fontSize: '8.5px', color: 'var(--color-text-muted)' }}>{dossier.findingSummary.analysisInterval}</div>
                  </div>
                </div>

                <div style={{
                  fontSize: '10.5px',
                  color: 'var(--color-text-secondary)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}>
                  <span>Earliest Supported Transition: <strong style={{ color: '#0284c7' }}>{dossier.findingSummary.earliestSupportedObservation}</strong></span>
                  <span className="font-mono text-muted" style={{ fontSize: '9px' }}>SHA-256 AUDIT SEALED</span>
                </div>
              </div>
            </div>

            {/* Source Scenes Lineage Table */}
            <div className="panel">
              <div className="panel-header" style={{ justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Database size={13} style={{ color: '#0284c7' }} />
                  <span>Source Scenes Lineage</span>
                </div>
                <span className="font-mono text-muted" style={{ fontSize: '9px' }}>
                  3 KEY OBSERVATIONS
                </span>
              </div>

              <div className="panel-body" style={{ padding: '6px', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                {dossier.sourceScenes.map((scene) => (
                  <div
                    key={scene.sceneId}
                    onClick={() => {
                      setSelectedScene(scene);
                      setShowMetadataModal(true);
                    }}
                    style={{
                      background: 'var(--color-surface-subtle)',
                      border: '1px solid var(--color-border-standard)',
                      borderRadius: 'var(--radius-xs)',
                      padding: '6px 8px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      cursor: 'pointer',
                      gap: '8px',
                      transition: 'background 0.12s ease',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(56, 189, 248, 0.08)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--color-surface-subtle)'; }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span className="badge badge-neutral font-mono" style={{ fontSize: '8.5px', minWidth: '70px', textAlign: 'center' }}>
                        {scene.roleLabel}
                      </span>
                      <div>
                        <div className="font-mono" style={{ fontSize: '10px', fontWeight: 600, color: 'var(--color-text-primary)' }}>
                          {scene.sceneId}
                        </div>
                        <div style={{ fontSize: '9.5px', color: 'var(--color-text-muted)' }}>
                          {scene.sensor} • {scene.product} • Acquired: {scene.acquisitionTimestamp}
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div className="font-mono text-muted" style={{ fontSize: '9.5px', textAlign: 'right' }}>
                        <div>Cloud: {scene.cloudCoverPercent}%</div>
                        <div>{scene.resolutionMeters}m BOA</div>
                      </div>
                      <Info size={13} style={{ color: '#0284c7' }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Processing / Analysis Lineage (10 Pipeline Steps) */}
            <div className="panel">
              <div className="panel-header" style={{ justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Sliders size={13} style={{ color: '#0284c7' }} />
                  <span>Processing Lineage Pipeline</span>
                </div>
                <span className="font-mono text-muted" style={{ fontSize: '9px' }}>
                  DEMO PROCESSING RECORD
                </span>
              </div>

              <div className="panel-body" style={{
                padding: '6px 8px',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
                maxHeight: '190px',
                overflowY: 'auto',
              }}>
                {dossier.processingPipeline.map((step, idx) => (
                  <div
                    key={step.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '3px 6px',
                      background: 'var(--color-surface-subtle)',
                      borderRadius: 'var(--radius-xs)',
                      border: '1px solid var(--color-border-subtle)',
                      fontSize: '10px',
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ color: 'var(--color-text-muted)', fontSize: '8.5px' }}>
                        {(idx + 1).toString().padStart(2, '0')}
                      </span>
                      <span style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>
                        {step.name}
                      </span>
                      <span style={{ color: 'var(--color-text-muted)', fontSize: '9px', fontFamily: 'var(--font-sans)' }}>
                        — {step.description}
                      </span>
                    </div>

                    <span style={{
                      fontWeight: 700,
                      fontSize: '9px',
                      color: step.status === 'PASS' ? '#15803d' : '#0284c7',
                      background: step.status === 'PASS' ? 'rgba(34, 197, 94, 0.12)' : 'rgba(56, 189, 248, 0.12)',
                      padding: '1px 5px',
                      borderRadius: 'var(--radius-xs)',
                    }}>
                      {step.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* COLUMN 2: EVIDENCE QUALITY + TEMPORAL EVIDENCE + ANALYST REVIEW RECORD */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {/* Evidence Quality Card */}
            <div className="panel">
              <div className="panel-header" style={{ justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <ShieldCheck size={13} style={{ color: '#15803d' }} />
                  <span>Evidence Quality & Verification Status</span>
                </div>
                <span className="badge badge-green font-mono" style={{ fontSize: '9px', fontWeight: 700 }}>
                  OVERALL STATUS: VERIFIED
                </span>
              </div>

              <div className="panel-body" style={{
                padding: '8px 10px',
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '5px 12px',
                fontSize: '10px',
                fontFamily: 'var(--font-mono)',
              }}>
                {dossier.qualityChecks.map((qc) => (
                  <div key={qc.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="text-muted">{qc.name}:</span>
                    <span style={{ color: '#15803d', fontWeight: 700 }}>{qc.metric}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Temporal Evidence Timeline */}
            <div className="panel">
              <div className="panel-header" style={{ justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Clock size={13} style={{ color: '#0284c7' }} />
                  <span>Temporal Evidence (Multi-Temporal Series)</span>
                </div>
                <span className="font-mono text-muted" style={{ fontSize: '9px' }}>
                  LOCAL MOCK TEMPORAL RECORD
                </span>
              </div>

              <div className="panel-body" style={{ padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                {dossier.temporalTimeline.map((item) => (
                  <div
                    key={item.date}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '4px 8px',
                      background: item.isEarliest
                        ? 'rgba(56, 189, 248, 0.12)'
                        : 'var(--color-surface-subtle)',
                      border: item.isEarliest
                        ? '1px solid rgba(56, 189, 248, 0.4)'
                        : '1px solid var(--color-border-subtle)',
                      borderRadius: 'var(--radius-xs)',
                      gap: '8px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: '130px' }}>
                      <span className="font-mono" style={{ fontSize: '10.5px', fontWeight: 700, color: item.isEarliest ? '#0284c7' : 'var(--color-text-primary)' }}>
                        {item.date}
                      </span>
                      {item.isEarliest && (
                        <span style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: '8px',
                          padding: '1px 4px',
                          background: '#0284c7',
                          color: '#ffffff',
                          borderRadius: 'var(--radius-xs)',
                          fontWeight: 700,
                        }}>
                          EARLIEST OBSERVATION
                        </span>
                      )}
                    </div>

                    <div style={{ flex: 1, fontSize: '10px', color: 'var(--color-text-secondary)' }}>
                      {item.waterState}
                    </div>

                    <div className="font-mono text-muted" style={{ fontSize: '9px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {item.shortSceneId} • Cloud {item.cloudPercent}%
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Analyst Review Record */}
            <div className="panel">
              <div className="panel-header" style={{ justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <ClipboardCheck size={13} style={{ color: '#15803d' }} />
                  <span>Analyst Review Record</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span className="badge badge-green font-mono" style={{ fontSize: '9px' }}>
                    {dossier.analystReview.disposition}
                  </span>
                  <span className="font-mono text-muted" style={{ fontSize: '9px' }}>
                    {dossier.analystReview.reviewId}
                  </span>
                </div>
              </div>

              <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '8px 10px' }}>
                <div className="font-mono text-xs" style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '3px 10px',
                  background: 'var(--color-surface-subtle)',
                  border: '1px solid var(--color-border-standard)',
                  borderRadius: 'var(--radius-xs)',
                  padding: '6px 8px',
                  fontSize: '9.5px',
                }}>
                  <div><span className="text-muted">REVIEW STATE:</span> <strong>{dossier.analystReview.reviewStatus}</strong></div>
                  <div><span className="text-muted">CHECKLIST:</span> <strong style={{ color: '#15803d' }}>{dossier.analystReview.evidenceChecklistPassed} VERIFIED</strong></div>
                  <div><span className="text-muted">REVIEWED AT:</span> <span>{dossier.analystReview.reviewedAt}</span></div>
                  <div><span className="text-muted">REVIEWER:</span> <strong>{dossier.analystReview.reviewer}</strong></div>
                </div>

                <div style={{ fontSize: '10.5px', color: 'var(--color-text-secondary)', lineHeight: 1.35 }}>
                  <span style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>Analyst Justification:</span> "{dossier.analystReview.analystNotes}"
                </div>

                <div style={{
                  display: 'flex',
                  gap: '6px',
                  marginTop: 'auto',
                  paddingTop: '6px',
                  borderTop: '1px solid var(--color-border-subtle)',
                }}>
                  {onNavigateSection && (
                    <>
                      <button
                        onClick={() => onNavigateSection('review')}
                        className="btn btn-sm"
                        style={{ flex: 1, fontSize: '10px', height: '26px', gap: '4px' }}
                      >
                        <ClipboardCheck size={11} />
                        <span>Open in Review [F4]</span>
                      </button>
                      <button
                        onClick={() => onNavigateSection('change-analysis')}
                        className="btn btn-sm"
                        style={{ flex: 1, fontSize: '10px', height: '26px', gap: '4px' }}
                      >
                        <GitCompare size={11} />
                        <span>View in Change Analysis [F3]</span>
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* BOTTOM: PROVENANCE EVENT LOG (12 Technical Audit Rows) */}
        <div className="panel" style={{ flexShrink: 0 }}>
          <div className="panel-header" style={{ justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Database size={13} style={{ color: '#0284c7' }} />
              <span>Provenance Event Log (12 Audit Events)</span>
            </div>
            <span className="badge badge-neutral font-mono" style={{ fontSize: '8.5px' }}>
              LOCAL MOCK EVENT LOG
            </span>
          </div>

          <div style={{
            maxHeight: '180px',
            overflowY: 'auto',
            padding: '4px 6px',
            display: 'flex',
            flexDirection: 'column',
            gap: '3px',
          }}>
            {dossier.eventLog.map((event) => (
              <div
                key={event.stepNumber}
                className="font-mono"
                style={{
                  display: 'grid',
                  gridTemplateColumns: '26px 140px 105px minmax(280px, 1fr) 60px',
                  alignItems: 'center',
                  padding: '3px 6px',
                  background: 'var(--color-surface-subtle)',
                  borderRadius: 'var(--radius-xs)',
                  border: '1px solid var(--color-border-subtle)',
                  fontSize: '9.5px',
                  gap: '6px',
                }}
              >
                <span style={{ color: 'var(--color-text-muted)', fontWeight: 700 }}>
                  {event.stepNumber}
                </span>
                <span style={{ color: 'var(--color-text-secondary)', fontSize: '9px' }}>
                  {event.timestamp.replace('T', ' ').replace('Z', ' UTC')}
                </span>
                <span style={{ color: '#0284c7', fontWeight: 600 }}>
                  {event.module}
                </span>
                <span style={{ color: 'var(--color-text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {event.action}
                </span>
                <span style={{
                  color: '#15803d',
                  fontWeight: 700,
                  fontSize: '8.5px',
                  background: 'rgba(34, 197, 94, 0.12)',
                  padding: '1px 4px',
                  borderRadius: 'var(--radius-xs)',
                  textAlign: 'center',
                }}>
                  {event.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 3. EXPORT EVIDENCE PACKAGE MODAL */}
      {showExportModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.65)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 100,
          padding: '20px',
        }}>
          <div className="panel" style={{
            maxWidth: '720px',
            width: '100%',
            maxHeight: '85vh',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: 'var(--shadow-modal)',
          }}>
            <div className="panel-header" style={{
              background: 'var(--color-chrome-bg)',
              color: '#ffffff',
              justifyContent: 'space-between',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                <Download size={13} style={{ color: '#38bdf8' }} />
                <span>EXPORT EVIDENCE DOSSIER: {dossier.packageId}</span>
              </div>
              <button
                onClick={() => setShowExportModal(false)}
                className="btn btn-sm"
                style={{ fontSize: '11px', padding: '0 6px', height: '20px' }}
              >
                ✕
              </button>
            </div>

            <div className="panel-body" style={{
              flex: 1,
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
              padding: '14px',
            }}>
              {/* Format selection */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <button
                    onClick={() => setExportFormat('json')}
                    className="btn btn-sm"
                    style={{
                      height: '24px',
                      fontSize: '10px',
                      fontWeight: exportFormat === 'json' ? 700 : 500,
                      background: exportFormat === 'json' ? 'var(--color-chrome-bg)' : 'transparent',
                      color: exportFormat === 'json' ? '#38bdf8' : 'var(--color-text-secondary)',
                    }}
                  >
                    JSON SPECIFICATION
                  </button>
                  <button
                    onClick={() => setExportFormat('markdown')}
                    className="btn btn-sm"
                    style={{
                      height: '24px',
                      fontSize: '10px',
                      fontWeight: exportFormat === 'markdown' ? 700 : 500,
                      background: exportFormat === 'markdown' ? 'var(--color-chrome-bg)' : 'transparent',
                      color: exportFormat === 'markdown' ? '#38bdf8' : 'var(--color-text-secondary)',
                    }}
                  >
                    MARKDOWN BRIEFING
                  </button>
                </div>

                <button
                  onClick={handleCopyExport}
                  className="btn btn-sm"
                  style={{ height: '24px', fontSize: '10px', gap: '4px' }}
                >
                  {copiedExport ? <Check size={11} color="#15803d" /> : <Copy size={11} />}
                  <span>{copiedExport ? 'Copied to Clipboard!' : 'Copy to Clipboard'}</span>
                </button>
              </div>

              {/* Text content preview */}
              <pre style={{
                background: '#090d16',
                color: '#93c5fd',
                border: '1px solid var(--color-border-standard)',
                borderRadius: 'var(--radius-xs)',
                padding: '10px',
                fontFamily: 'var(--font-mono)',
                fontSize: '10px',
                lineHeight: 1.4,
                maxHeight: '340px',
                overflowY: 'auto',
              }}>
                {exportFormat === 'json'
                  ? evidenceService.exportDossierAsJson(dossier)
                  : evidenceService.exportDossierAsMarkdown(dossier)}
              </pre>

              <div className="font-mono text-muted" style={{ fontSize: '9px' }}>
                INTEGRITY AUDIT HASH: {dossier.auditHash}
              </div>
            </div>

            <div style={{
              padding: '8px 14px',
              background: 'var(--color-surface-subtle)',
              borderTop: '1px solid var(--color-border-standard)',
              display: 'flex',
              justifyContent: 'flex-end',
            }}>
              <button
                onClick={() => setShowExportModal(false)}
                className="btn btn-sm"
                style={{ fontSize: '11px', height: '26px' }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. SCENE METADATA MODAL */}
      {showMetadataModal && selectedScene && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.65)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 100,
          padding: '20px',
        }}>
          <div className="panel" style={{
            maxWidth: '620px',
            width: '100%',
            maxHeight: '85vh',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: 'var(--shadow-modal)',
          }}>
            <div className="panel-header" style={{
              background: 'var(--color-chrome-bg)',
              color: '#ffffff',
              justifyContent: 'space-between',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                <Database size={13} style={{ color: '#38bdf8' }} />
                <span>SCENE LINEAGE RECORD: {selectedScene.roleLabel}</span>
              </div>
              <button
                onClick={() => setShowMetadataModal(false)}
                className="btn btn-sm"
                style={{ fontSize: '11px', padding: '0 6px', height: '20px' }}
              >
                ✕
              </button>
            </div>

            <div className="panel-body" style={{
              flex: 1,
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
              padding: '14px',
            }}>
              <div className="font-mono text-xs" style={{
                background: '#090d16',
                color: '#cbd5e1',
                padding: '10px',
                borderRadius: 'var(--radius-xs)',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
              }}>
                <div>SCENE ID: <span style={{ color: '#93c5fd' }}>{selectedScene.sceneId}</span></div>
                <div>ROLE IN INVESTIGATION: <span style={{ color: '#f59e0b', fontWeight: 700 }}>{selectedScene.role}</span></div>
                <div>SENSOR / CONSTELLATION: <span style={{ color: '#f8fafc' }}>{selectedScene.sensor} MSI</span></div>
                <div>PRODUCT LEVEL: <span style={{ color: '#f8fafc' }}>{selectedScene.processingLevel}</span></div>
                <div>ACQUISITION TIMESTAMP: <span style={{ color: '#f8fafc' }}>{selectedScene.acquisitionTimestamp}</span></div>
                <div>MGRS TILE GRID: <span style={{ color: '#f8fafc' }}>{selectedScene.mgrsTile}</span></div>
                <div>CLOUD COVER: <span style={{ color: '#f8fafc' }}>{selectedScene.cloudCoverPercent}%</span></div>
                <div>SPATIAL RESOLUTION: <span style={{ color: '#f8fafc' }}>{selectedScene.resolutionMeters}m Multispectral</span></div>
                <div>SUN ELEVATION: <span style={{ color: '#f8fafc' }}>{selectedScene.sunElevationDeg}°</span></div>
                <div>INGEST SOURCE: <span style={{ color: '#86efac' }}>COPERNICUS HUB / LOCAL DEMO CATALOG</span></div>
              </div>

              <div style={{ fontSize: '10.5px', color: 'var(--color-text-muted)' }}>
                This source scene has been certified in the investigation audit trail for bi-temporal delta calculations.
              </div>
            </div>

            <div style={{
              padding: '8px 14px',
              background: 'var(--color-surface-subtle)',
              borderTop: '1px solid var(--color-border-standard)',
              display: 'flex',
              justifyContent: 'flex-end',
            }}>
              <button
                onClick={() => setShowMetadataModal(false)}
                className="btn btn-sm"
                style={{ fontSize: '11px', height: '26px' }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
