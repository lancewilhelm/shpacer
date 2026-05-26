import type { StyleSpecification } from 'maplibre-gl';

export const mapBasemapIds = [
  'osm',
  'osmHot',
  'openTopoMap',
  'esriSatellite',
] as const;

export type MapBasemapId = (typeof mapBasemapIds)[number];

export interface MapBasemapDefinition {
  id: MapBasemapId;
  label: string;
  attributionHtml: string;
  attributionText: string;
  tiles: string[];
  maxzoom: number;
}

const OSM_ATTRIBUTION_HTML =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const OSM_HOT_ATTRIBUTION_HTML =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, Tiles styled by <a href="https://www.hotosm.org/">Humanitarian OpenStreetMap Team</a> hosted by <a href="https://openstreetmap.fr/">OpenStreetMap France</a>';
const OPEN_TOPO_MAP_ATTRIBUTION_HTML =
  'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, <a href="http://viewfinderpanoramas.org/">SRTM</a> | Map style: &copy; <a href="https://opentopomap.org/">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)';
const ESRI_SATELLITE_ATTRIBUTION_HTML =
  '&copy; <a href="http://www.esri.com/">Esri</a>, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community';

export const DEFAULT_MAP_BASEMAP_ID: MapBasemapId = 'osm';

export const MAP_BASEMAPS: MapBasemapDefinition[] = [
  {
    id: 'osm',
    label: 'OpenStreetMap',
    attributionHtml: OSM_ATTRIBUTION_HTML,
    attributionText: 'Map data © OpenStreetMap contributors',
    tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
    maxzoom: 19,
  },
  {
    id: 'osmHot',
    label: 'OpenStreetMap.HOT',
    attributionHtml: OSM_HOT_ATTRIBUTION_HTML,
    attributionText:
      'Map data © OpenStreetMap contributors; tiles styled by Humanitarian OpenStreetMap Team and hosted by OpenStreetMap France',
    tiles: ['https://a.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png'],
    maxzoom: 19,
  },
  {
    id: 'openTopoMap',
    label: 'OpenTopoMap',
    attributionHtml: OPEN_TOPO_MAP_ATTRIBUTION_HTML,
    attributionText:
      'Map data © OpenStreetMap contributors and SRTM; map style © OpenTopoMap (CC-BY-SA)',
    tiles: ['https://a.tile.opentopomap.org/{z}/{x}/{y}.png'],
    maxzoom: 17,
  },
  {
    id: 'esriSatellite',
    label: 'Esri Satellite',
    attributionHtml: ESRI_SATELLITE_ATTRIBUTION_HTML,
    attributionText:
      'Imagery © Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
    tiles: [
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    ],
    maxzoom: 18,
  },
];

export function normalizeMapBasemapId(value: unknown): MapBasemapId {
  return mapBasemapIds.includes(value as MapBasemapId)
    ? (value as MapBasemapId)
    : DEFAULT_MAP_BASEMAP_ID;
}

export function getMapBasemapById(value: unknown): MapBasemapDefinition {
  const basemapId = normalizeMapBasemapId(value);
  return (
    MAP_BASEMAPS.find((basemap) => basemap.id === basemapId) ??
    MAP_BASEMAPS[0]
  )!;
}

export function getBasemapSourceId(id: MapBasemapId): string {
  return `basemap-source-${id}`;
}

export function getBasemapLayerId(id: MapBasemapId): string {
  return `basemap-layer-${id}`;
}

export function createRasterBasemapStyle(
  basemapId: MapBasemapId,
): StyleSpecification {
  const basemap = getMapBasemapById(basemapId);
  const sourceId = getBasemapSourceId(basemap.id);
  const layerId = getBasemapLayerId(basemap.id);

  return {
    version: 8,
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    sources: {
      [sourceId]: {
        type: 'raster',
        tiles: basemap.tiles,
        tileSize: 256,
        maxzoom: basemap.maxzoom,
        attribution: basemap.attributionHtml,
      },
    },
    layers: [
      {
        id: layerId,
        type: 'raster',
        source: sourceId,
      },
    ],
  };
}
