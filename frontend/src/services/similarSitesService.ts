/**
 * GeoSentinel Similar Sites Service
 * 
 * Local abstraction layer for cross-catalog geographical analog retrieval,
 * multi-modal feature similarity ranking, and comparison staging.
 */

import { SimilarSite, SimilarSiteReference, SimilarSitesFilter, SatelliteScene } from '../types';
import { MOCK_REFERENCE_SITE, MOCK_SIMILAR_SITES } from '../data/mockSimilarSites';
import { SENTINEL2_BANDS } from '../data/mockScenes';

export interface SimilarSitesServiceInterface {
  getReferenceSite(): SimilarSiteReference;
  searchSimilarSites(filter?: SimilarSitesFilter): Promise<SimilarSite[]>;
  getSimilarSiteById(id: string): Promise<SimilarSite | undefined>;
  stageSiteForComparison(site: SimilarSite): SatelliteScene;
}

class MockSimilarSitesService implements SimilarSitesServiceInterface {
  private sites: SimilarSite[] = [...MOCK_SIMILAR_SITES];

  getReferenceSite(): SimilarSiteReference {
    return { ...MOCK_REFERENCE_SITE };
  }

  async searchSimilarSites(filter?: SimilarSitesFilter): Promise<SimilarSite[]> {
    await new Promise((resolve) => setTimeout(resolve, 80));

    let results = [...this.sites];

    if (filter?.similarityThreshold !== undefined) {
      results = results.filter((s) => s.similarityScore >= (filter.similarityThreshold || 0.78));
    }

    if (filter?.searchRadiusKm !== undefined) {
      results = results.filter((s) => s.searchDistanceKm <= (filter.searchRadiusKm || 150));
    }

    if (filter?.maxResults !== undefined) {
      results = results.slice(0, filter.maxResults);
    }

    return results;
  }

  async getSimilarSiteById(id: string): Promise<SimilarSite | undefined> {
    await new Promise((resolve) => setTimeout(resolve, 40));
    return this.sites.find((s) => s.id === id);
  }

  stageSiteForComparison(site: SimilarSite): SatelliteScene {
    // Convert candidate site to SatelliteScene for seamless F3 bi-temporal comparison
    return {
      id: site.sceneId,
      satellite: site.sceneId.startsWith('S2B') ? 'Sentinel-2B' : 'Sentinel-2A',
      sensor: 'Sentinel-2 MSI',
      acquisitionDate: '2025-09-21T05:18:31Z',
      cloudCoverPercent: site.cloudPercent,
      resolutionMeters: 10,
      sunElevationDeg: 58.6,
      sunAzimuthDeg: 136.8,
      processingLevel: 'L2A / Analysis Ready',
      mgrsTile: site.mgrsTile,
      crs: 'EPSG:32643 - WGS 84 / UTM zone 43N',
      bbox: {
        minLon: site.longitude - 0.15,
        minLat: site.latitude - 0.15,
        maxLon: site.longitude + 0.15,
        maxLat: site.latitude + 0.15,
      },
      centerCoordinates: {
        lat: site.latitude,
        lon: site.longitude,
        mgrs: `${site.mgrsTile} ${Math.round(site.longitude * 100)} ${Math.round(site.latitude * 100)}`,
        elevationMsl: site.elevationMeters,
      },
      bands: SENTINEL2_BANDS,
      sceneClassificationSummary: {
        vegetationPercent: site.vegetationSignature === 'HIGH' ? 52.4 : 38.6,
        waterPercent: site.waterSignature === 'HIGH' ? 18.2 : 9.4,
        bareSoilPercent: 16.2,
        urbanPercent: site.builtUpSignature === 'HIGH' ? 24.5 : 5.8,
        cloudPercent: site.cloudPercent,
      },
      tags: [
        `Site Discovery: ${site.name}`,
        `Similarity Score: ${site.similarityScore.toFixed(2)}`,
        site.terrainSignature,
        `${site.waterExtentSqKm} km² Water Extent`,
      ],
    };
  }
}

export const similarSitesService: SimilarSitesServiceInterface = new MockSimilarSitesService();
