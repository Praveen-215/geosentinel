/**
 * GeoSentinel Evidence & Provenance Service
 * 
 * Provides verifiable audit trail access, cryptographic hash validation,
 * machine-readable JSON exports, and intelligence summary dossiers.
 */

import { EvidencePackageDossier } from '../types';
import { MOCK_EVIDENCE_DOSSIER } from '../data/mockEvidence';

export interface ProvenanceVerificationStatus {
  statusLabel: 'DEMO / LOCAL MOCK VERIFIED';
  pipelineStatus: 'REAL PROVENANCE PIPELINE PENDING';
  isLocalDemo: boolean;
  message: string;
}

export interface EvidenceServiceInterface {
  getEvidenceDossier(): Promise<EvidencePackageDossier>;
  exportDossierAsJson(dossier: EvidencePackageDossier): string;
  exportDossierAsMarkdown(dossier: EvidencePackageDossier): string;
  getVerificationStatus(): ProvenanceVerificationStatus;
}

class MockEvidenceService implements EvidenceServiceInterface {
  private dossier: EvidencePackageDossier = { ...MOCK_EVIDENCE_DOSSIER };

  async getEvidenceDossier(): Promise<EvidencePackageDossier> {
    await new Promise((resolve) => setTimeout(resolve, 80));
    return { ...this.dossier };
  }

  exportDossierAsJson(dossier: EvidencePackageDossier): string {
    return JSON.stringify(
      {
        schema: 'https://geosentinel.internal/schemas/evidence-provenance-dossier-v1.json',
        investigationId: dossier.investigationId,
        packageId: dossier.packageId,
        aoi: {
          id: dossier.aoiId,
          name: dossier.aoiName,
          feature: dossier.feature,
        },
        auditIntegrity: {
          verificationStatus: 'DEMO / LOCAL MOCK VERIFIED',
          packageId: dossier.packageId,
          generatedAt: dossier.generatedTimestamp,
          status: dossier.status,
          backendProvenance: 'PENDING BACKEND PROVENANCE PIPELINE',
        },
        findingSummary: dossier.findingSummary,
        analystReviewRecord: dossier.analystReview,
        sourceScenes: dossier.sourceScenes,
        processingPipeline: dossier.processingPipeline,
        qualityChecks: dossier.qualityChecks,
        temporalLineage: dossier.temporalTimeline,
        provenanceEventLog: dossier.eventLog,
        exportMetadata: {
          generator: 'GeoSentinel Analyst Workstation v0.1.0',
          mode: 'DEMO / LOCAL MOCK',
          classification: 'UNCLASSIFIED // DEMO CATALOG ONLY',
        },
      },
      null,
      2
    );
  }

  exportDossierAsMarkdown(dossier: EvidencePackageDossier): string {
    return `# GEOSENTINEL EVIDENCE & PROVENANCE DOSSIER
**Investigation ID:** ${dossier.investigationId}
**Evidence Package:** ${dossier.packageId}
**AOI:** ${dossier.aoiName} (${dossier.aoiId})
**Target Feature:** ${dossier.feature}
**Status:** ${dossier.status}
**Audit Integrity:** LOCAL MOCK VERIFIED (Pending Backend Provenance Pipeline)
**Generated:** ${dossier.generatedTimestamp}

---

## 1. FINDING SUMMARY
- **Observed Change:** ${dossier.findingSummary.changeType}
- **Baseline Water Extent (T1):** ${dossier.findingSummary.baselineValue}
- **Comparison Water Extent (T2):** ${dossier.findingSummary.comparisonValue}
- **Absolute Change:** ${dossier.findingSummary.absoluteChange}
- **Relative Delta:** ${dossier.findingSummary.relativeChange}
- **Confidence Rating:** ${dossier.findingSummary.confidence}
- **Earliest Supported Observation:** ${dossier.findingSummary.earliestSupportedObservation}
- **Analysis Interval:** ${dossier.findingSummary.analysisInterval}

---

## 2. ANALYST REVIEW RECORD
- **Review ID:** ${dossier.analystReview.reviewId}
- **Disposition:** ${dossier.analystReview.disposition}
- **Review State:** ${dossier.analystReview.reviewStatus}
- **Evidence Checklist:** ${dossier.analystReview.evidenceChecklistPassed} VERIFIED
- **Reviewed At:** ${dossier.analystReview.reviewedAt}
- **Reviewer:** ${dossier.analystReview.reviewer}
- **Analyst Justification:** "${dossier.analystReview.analystNotes}"

---

## 3. SOURCE SCENES LINEAGE
${dossier.sourceScenes
  .map(
    (s) => `- **${s.roleLabel}**: \`${s.sceneId}\`
  - Sensor: ${s.sensor} | Product: ${s.product} | Acquired: ${s.acquisitionTimestamp} | Cloud: ${s.cloudCoverPercent}%`
  )
  .join('\n')}

---

## 4. PROCESSING PIPELINE
${dossier.processingPipeline.map((p) => `- [x] **${p.name}** [${p.status}]: ${p.description}`).join('\n')}

---

## 5. PROVENANCE EVENT LOG (12 EVENTS)
${dossier.eventLog
  .map((e) => `1. **${e.timestamp}** [${e.module}] - ${e.action} (Status: \`${e.status}\`)`)
  .join('\n')}
`;
  }

  getVerificationStatus(): ProvenanceVerificationStatus {
    return {
      statusLabel: 'DEMO / LOCAL MOCK VERIFIED',
      pipelineStatus: 'REAL PROVENANCE PIPELINE PENDING',
      isLocalDemo: true,
      message: 'Cryptographic provenance verification deferred until backend pipeline integration.',
    };
  }
}

export const evidenceService: EvidenceServiceInterface = new MockEvidenceService();
