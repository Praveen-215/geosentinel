/**
 * GeoSentinel Semantic Retrieval Service Interface
 * 
 * Abstraction layer for satellite imagery semantic search, embedding similarity,
 * and natural-language query resolution. Designed for drop-in backend integration.
 */

import { MOCK_RETRIEVAL_RESULTS, MOCK_SCENES } from '../data/mockScenes';
import { RetrievalResult, SatelliteScene, SemanticRetrievalQuery } from '../types';

export interface RetrievalServiceInterface {
  queryScenesBySemanticPrompt(query: SemanticRetrievalQuery): Promise<RetrievalResult[]>;
  getSceneById(sceneId: string): Promise<SatelliteScene | null>;
  listAvailableScenes(filter?: { constellation?: string; maxCloud?: number }): Promise<SatelliteScene[]>;
}

class MockRetrievalService implements RetrievalServiceInterface {
  /**
   * Simulates natural-language or embedding-based semantic retrieval against the scene catalog
   */
  async queryScenesBySemanticPrompt(query: SemanticRetrievalQuery): Promise<RetrievalResult[]> {
    // Artificial mock delay simulating embedding generation and vector search (approx 180-250ms)
    await new Promise((resolve) => setTimeout(resolve, 184));

    let results = [...MOCK_RETRIEVAL_RESULTS];

    // Temporal filter
    if (query.temporalWindow?.startDate && query.temporalWindow?.endDate) {
      const start = new Date(query.temporalWindow.startDate).getTime();
      const end = new Date(query.temporalWindow.endDate).getTime();
      results = results.filter((r) => {
        const sceneDate = new Date(r.scene.acquisitionDate).getTime();
        return sceneDate >= start && sceneDate <= end;
      });
    }

    // Cloud cover range filter
    if (query.cloudCoverRange && query.cloudCoverRange !== 'all') {
      if (query.cloudCoverRange === '0-10') {
        results = results.filter((r) => r.scene.cloudCoverPercent <= 10);
      } else if (query.cloudCoverRange === '10-25') {
        results = results.filter((r) => r.scene.cloudCoverPercent > 10 && r.scene.cloudCoverPercent <= 25);
      } else if (query.cloudCoverRange === '25-50') {
        results = results.filter((r) => r.scene.cloudCoverPercent > 25 && r.scene.cloudCoverPercent <= 50);
      }
    } else if (query.maxCloudCover !== undefined) {
      results = results.filter((r) => r.scene.cloudCoverPercent <= (query.maxCloudCover ?? 100));
    }

    // Sensor / Constellation filter
    if (query.sensorFilter === 'Sentinel-2') {
      results = results.filter((r) => r.scene.satellite.startsWith('Sentinel-2'));
    } else if (query.constellationFilter && query.constellationFilter.length > 0) {
      results = results.filter((r) => query.constellationFilter?.includes(r.scene.satellite));
    }

    // Processing level filter
    if (query.processingLevelFilter && query.processingLevelFilter !== 'all') {
      results = results.filter((r) => r.scene.processingLevel.includes(query.processingLevelFilter as string));
    }

    // Similarity threshold filter
    if (query.minSimilarityThreshold !== undefined) {
      results = results.filter((r) => r.similarityScore >= (query.minSimilarityThreshold ?? 0));
    }

    // Sort by rank / similarity descending
    results.sort((a, b) => b.similarityScore - a.similarityScore);

    // Re-assign semantic ranks 1..N
    results = results.map((item, idx) => ({
      ...item,
      semanticRank: idx + 1,
    }));

    return results;
  }

  /**
   * Retrieves full technical metadata for an individual satellite scene
   */
  async getSceneById(sceneId: string): Promise<SatelliteScene | null> {
    await new Promise((resolve) => setTimeout(resolve, 80));
    const found = MOCK_SCENES.find((s) => s.id === sceneId);
    return found || null;
  }

  /**
   * Lists all cataloged scenes within the active analyst mission footprint
   */
  async listAvailableScenes(filter?: { constellation?: string; maxCloud?: number }): Promise<SatelliteScene[]> {
    await new Promise((resolve) => setTimeout(resolve, 120));
    let scenes = [...MOCK_SCENES];

    if (filter?.constellation) {
      scenes = scenes.filter((s) => s.satellite === filter.constellation);
    }
    if (filter?.maxCloud !== undefined) {
      const maxCloud = filter.maxCloud;
      scenes = scenes.filter((s) => s.cloudCoverPercent <= maxCloud);
    }

    return scenes;
  }
}

export const retrievalService: RetrievalServiceInterface = new MockRetrievalService();
