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
    // Artificial mock delay simulating embedding generation and vector search
    await new Promise((resolve) => setTimeout(resolve, 300));

    let results = [...MOCK_RETRIEVAL_RESULTS];

    if (query.maxCloudCover !== undefined) {
      results = results.filter((r) => r.scene.cloudCoverPercent <= (query.maxCloudCover ?? 100));
    }

    if (query.minSimilarityThreshold !== undefined) {
      results = results.filter((r) => r.similarityScore >= (query.minSimilarityThreshold ?? 0));
    }

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
