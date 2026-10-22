import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Map, { Source, Layer, Popup, NavigationControl, Marker } from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'
import {
  fetchFiresGeoJSON,
  fetchFiresWithin,
  fetchCountiesGeoJSON,
  fetchExposureModel,
} from './api.js'

// Free raster base map style (OpenStreetMap tiles). No API key required.
const MAP_STYLE = {
  version: 8,
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
  sources: {
    // Esri "World Dark Gray Canvas": a dark basemap served freely by ArcGIS
    // Online with no API key. Note Esri tile order is {z}/{y}/{x}.
    basemap: {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      attribution: 'Tiles © Esri — Esri, DeLorme, HERE, MapmyIndia',
    },
    // Matching reference layer: city names, roads, and labels (transparent PNG).
    basemapLabels: {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
    },
  },
  layers: [
    { id: 'basemap', type: 'raster', source: 'basemap' },
    { id: 'basemap-labels', type: 'raster', source: 'basemapLabels' },
  ],
}

// Washington State, roughly centered.
const INITIAL_VIEW = { longitude: -120.5, latitude: 47.4, zoom: 5.8 }

// Cause -> color, used for the dot halos and the legend.
const CAUSE_PALETTE = {
  Natural: '#3a86ff',
  Lightning: '#3a86ff',
  Arson: '#e63946',
  'Debris Burn': '#fb5607',
  Recreation: '#6a994e',
  Smoking: '#8338ec',
  'Equip/Vehicle': '#ffb703',
  Celebration: '#f4a261',
  'Power Gen': '#bc6c25',
}
const CAUSE_FALLBACK = '#9aa0aa'

const CAUSE_COLOR_EXPR = [
  'match',
  ['get', 'cause'],
  ...Object.entries(CAUSE_PALETTE).flat(),
  CAUSE_FALLBACK,
]

// --- Modernized individual markers: soft glow + crisp core + white ring ---
const fireGlowLayer = {
  id: 'fire-glow',
  type: 'circle',
  filter: ['!', ['has', 'point_count']],
  paint: {
    'circle-radius': [
      'interpolate', ['linear'], ['coalesce', ['get', 'acres_burned'], 0],
      0, 8, 100, 12, 1000, 18, 50000, 30,
    ],
    'circle-color': CAUSE_COLOR_EXPR,
    'circle-opacity': 0.18,
    'circle-blur': 0.6,
  },
}

const firePointLayer = {
  id: 'fire-point',
  type: 'circle',
  filter: ['!', ['has', 'point_count']],
  paint: {
    'circle-radius': [
      'interpolate', ['linear'], ['coalesce', ['get', 'acres_burned'], 0],
      0, 3.5, 100, 5, 1000, 8, 50000, 14,
    ],
    'circle-color': CAUSE_COLOR_EXPR,
    'circle-opacity': 0.95,
    'circle-stroke-width': 1.5,
    'circle-stroke-color': '#ffffff',
  },
}

// --- Modernized clusters: translucent outer halo + solid inner disc + count ---
const clusterHaloLayer = {
  id: 'cluster-halo',
  type: 'circle',
  filter: ['has', 'point_count'],
  paint: {
    'circle-color': [
      'step', ['get', 'point_count'],
      '#f4a261', 50, '#fb5607', 200, '#e63946',
    ],
    'circle-opacity': 0.25,
    'circle-radius': ['step', ['get', 'point_count'], 22, 50, 30, 200, 40],
    'circle-blur': 0.2,
  },
}

const clusterLayer = {
  id: 'clusters',
  type: 'circle',
  filter: ['has', 'point_count'],
  paint: {
    'circle-color': [
      'step', ['get', 'point_count'],
      '#f4a261', 50, '#fb5607', 200, '#e63946',
    ],
    'circle-radius': ['step', ['get', 'point_count'], 14, 50, 20, 200, 28],
    'circle-stroke-width': 2,
    'circle-stroke-color': 'rgba(255,255,255,0.9)',
  },
}

const clusterCountLayer = {
  id: 'cluster-count',
  type: 'symbol',
  filter: ['has', 'point_count'],
  layout: {
    'text-field': ['get', 'point_count_abbreviated'],
    'text-font': ['Noto Sans Regular'],
    'text-size': 13,
  },
  paint: { 'text-color': '#1a1d24' },
}

// --- Heatmap of fire density (dominant when zoomed out) ---
const heatmapLayer = {
  id: 'fire-heat',
  type: 'heatmap',
  maxzoom: 10,
  paint: {
    // Weight by acres burned so bigger fires push the color toward red.
    // Density itself reflects how many fires are clustered together.
    'heatmap-weight': [
      'interpolate', ['linear'], ['coalesce', ['get', 'acres_burned'], 0],
      0, 0.3, 100, 0.5, 1000, 0.8, 50000, 1,
    ],
    // Intensify with zoom.
    'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 0, 1, 9, 3],
    // Gradient from yellow (low) through orange to red (high).
    'heatmap-color': [
      'interpolate', ['linear'], ['heatmap-density'],
      0, 'rgba(255,237,160,0)',
      0.2, 'rgb(255,237,160)',
      0.45, 'rgb(254,196,79)',
      0.7, 'rgb(253,141,60)',
      0.9, 'rgb(240,59,32)',
      1, 'rgb(189,0,38)',
    ],
    // Tighter footprint so hotspots read as localized, not a smear.
    'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 0, 4, 9, 14],
    // Semi-transparent so the base map stays readable underneath.
    'heatmap-opacity': 0.55,
  },
}

// --- Exposure/risk model grid (Tom's exposurePrioritization) ---
// priorityScore = burnFrequency(per yr) * meanSize(acres). The score is highly
// skewed, so we color on a log scale: log10(score + 1). A cell burning ~1 acre
// once ~= 0.3; a 170k-acre cell ~= 5.2. Green (low) -> red (high risk).
const exposureFillLayer = {
  id: 'exposure-fill',
  type: 'fill',
  paint: {
    'fill-color': [
      'interpolate', ['linear'],
      ['log10', ['+', ['get', 'priorityScore'], 1]],
      0, 'rgba(26,152,80,0.0)',
      0.5, 'rgba(26,152,80,0.55)',
      1.5, 'rgba(166,217,106,0.6)',
      2.5, 'rgba(254,224,139,0.65)',
      3.5, 'rgba(253,141,60,0.7)',
      4.5, 'rgba(240,59,32,0.8)',
      5.5, 'rgba(189,0,38,0.9)',
    ],
    'fill-outline-color': 'rgba(0,0,0,0.15)',
  },
}

// --- County choropleth (fades in when zoomed all the way in) ---
// fillColor is set dynamically from the data's maxCount.
function countyFillLayer(maxCount) {
  // Build strictly-ascending integer stops. A non-ascending or duplicate stop
  // makes MapLibre throw, which can break rendering of other layers.
  const max = Math.max(Math.round(maxCount) || 1, 5)
  const fractions = [0.1, 0.3, 0.55, 0.8, 1]
  const colors = ['#fee5d9', '#fcae91', '#fb6a4a', '#de2d26', '#a50f15']
  const stops = ['interpolate', ['linear'], ['get', 'fire_count'], 0, 'rgba(255,255,255,0.05)']
  let prev = 0
  fractions.forEach((frac, i) => {
    const val = Math.max(Math.round(max * frac), prev + 1) // guarantee ascending
    stops.push(val, colors[i])
    prev = val
  })
  return {
    id: 'county-fill',
    type: 'fill',
    minzoom: 7.5,
    paint: {
      'fill-color': stops,
      'fill-opacity': ['interpolate', ['linear'], ['zoom'], 7.5, 0, 9, 0.6],
    },
  }
}

const countyLineLayer = {
  id: 'county-line',
  type: 'line',
  minzoom: 7.5,
  paint: {
    'line-color': '#ffffff',
    'line-width': 1,
    'line-opacity': ['interpolate', ['linear'], ['zoom'], 7.5, 0, 9, 0.7],
  },
}

const countyLabelLayer = {
  id: 'county-label',
  type: 'symbol',
  minzoom: 8.5,
  layout: {
    'text-field': [
      'concat', ['get', 'name'], '\n', ['to-string', ['get', 'fire_count']], ' fires',
    ],
    'text-font': ['Noto Sans Regular'],
    'text-size': 11,
    'text-anchor': 'center',
  },
  paint: {
    'text-color': '#1a1d24',
    'text-halo-color': 'rgba(255,255,255,0.9)',
    'text-halo-width': 1.5,
    'text-opacity': ['interpolate', ['linear'], ['zoom'], 8.5, 0, 9.5, 1],
  },
}

// --- Radius selection circle (fill + outline) ---
const radiusFillLayer = {
  id: 'radius-fill',
  type: 'fill',
  paint: { 'fill-color': '#3a86ff', 'fill-opacity': 0.1 },
}
const radiusLineLayer = {
  id: 'radius-line',
  type: 'line',
  paint: {
    'line-color': '#3a86ff',
    'line-width': 2,
    'line-dasharray': [2, 1.5],
  },
}

// --- Burn-area circle, drawn to scale from a fire's acres burned ---
const burnFillLayer = {
  id: 'burn-fill',
  type: 'fill',
  paint: { 'fill-color': '#fb5607', 'fill-opacity': 0.35 },
}
const burnLineLayer = {
  id: 'burn-line',
  type: 'line',
  paint: { 'line-color': '#e63946', 'line-width': 2 },
}

// Build a circle polygon (GeoJSON) around a center given a radius in miles.
function circlePolygon(lon, lat, radiusMiles, steps = 72) {
  const coords = []
  const latR = radiusMiles / 69
  const lonR = radiusMiles / (69 * Math.max(Math.cos((lat * Math.PI) / 180), 0.01))
  for (let i = 0; i <= steps; i++) {
    const theta = (i / steps) * 2 * Math.PI
    coords.push([lon + lonR * Math.cos(theta), lat + latR * Math.sin(theta)])
  }
  return {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] } }],
  }
}

// Convert acres burned into an equivalent-area circle radius in miles.
// 1 square mile = 640 acres; radius = sqrt(area / pi).
function acresToRadiusMiles(acres) {
  if (!acres || acres <= 0) return 0
  const areaSqMiles = acres / 640
  return Math.sqrt(areaSqMiles / Math.PI)
}

function formatDate(ms) {
  if (!ms) return '—'
  return new Date(ms).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  })
}

function formatNumber(n) {
  if (n == null) return '—'
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })
}

export default function FireMap({ filters }) {
  const mapRef = useRef(null)
  const [data, setData] = useState(null)
  const [counties, setCounties] = useState(null)
  const [popup, setPopup] = useState(null)
  const [error, setError] = useState(null)

  // Radius tool state
  const [areaMode, setAreaMode] = useState(false)
  const [center, setCenter] = useState(null) // { lon, lat }
  const [radius, setRadius] = useState(25) // miles
  const [areaResult, setAreaResult] = useState(null)

  // Heatmap is off by default; the officer toggles it on.
  const [showHeat, setShowHeat] = useState(false)

  // Exposure/risk model overlay, off by default.
  const [showModel, setShowModel] = useState(false)
  const [modelData, setModelData] = useState(null)

  // Load the exposure model grid when toggled on or filters change.
  useEffect(() => {
    if (!showModel) return
    let cancelled = false
    fetchExposureModel(filters)
      .then((fc) => {
        if (!cancelled) setModelData(fc)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
    return () => {
      cancelled = true
    }
  }, [showModel, filters])

  // Load all filtered fires for the base map layer.
  useEffect(() => {
    let cancelled = false
    fetchFiresGeoJSON(filters)
      .then((fc) => {
        if (!cancelled) {
          setData(fc)
          setError(null)
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
    return () => {
      cancelled = true
    }
  }, [filters])

  // Load county boundaries + per-county counts for the choropleth.
  useEffect(() => {
    let cancelled = false
    fetchCountiesGeoJSON(filters)
      .then((fc) => {
        if (!cancelled) setCounties(fc)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
    return () => {
      cancelled = true
    }
  }, [filters])

  // Re-run the radius query when center, radius, or filters change.
  useEffect(() => {
    if (!center) {
      setAreaResult(null)
      return
    }
    let cancelled = false
    fetchFiresWithin({ lat: center.lat, lon: center.lon, radius, ...filters })
      .then((res) => {
        if (!cancelled) setAreaResult(res)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
    return () => {
      cancelled = true
    }
  }, [center, radius, filters])

  // When a center is selected, the map shows only the fires inside the circle.
  // Otherwise it shows every filtered fire.
  const displayData = useMemo(() => {
    if (center && areaResult) return areaResult.geojson
    return data
  }, [center, areaResult, data])

  const count = displayData?.features?.length ?? 0

  const circle = useMemo(
    () => (center ? circlePolygon(center.lon, center.lat, radius) : null),
    [center, radius],
  )

  // The burn-area circle for the currently open fire popup, drawn to scale.
  const burnCircle = useMemo(() => {
    if (!popup || !popup.props) return null
    const r = acresToRadiusMiles(popup.props.acres_burned)
    if (r <= 0) return null
    return circlePolygon(popup.longitude, popup.latitude, r)
  }, [popup])

  const interactiveLayerIds = useMemo(
    () => (showModel ? ['clusters', 'fire-point', 'exposure-fill'] : ['clusters', 'fire-point']),
    [showModel],
  )

  const onClick = useCallback(
    (event) => {
      // In area-select mode, a map click sets the circle center.
      if (areaMode) {
        setCenter({ lon: event.lngLat.lng, lat: event.lngLat.lat })
        setPopup(null)
        return
      }

      const feature = event.features && event.features[0]
      if (!feature) return

      // Clicked a risk-model cell: show its model values.
      if (feature.layer && feature.layer.id === 'exposure-fill') {
        setPopup({
          longitude: event.lngLat.lng,
          latitude: event.lngLat.lat,
          model: feature.properties,
        })
        return
      }

      if (feature.properties.cluster) {
        const map = mapRef.current?.getMap()
        const source = map?.getSource('fires')
        source?.getClusterExpansionZoom(feature.properties.cluster_id, (err, zoom) => {
          if (err) return
          map.easeTo({ center: feature.geometry.coordinates, zoom, duration: 500 })
        })
        return
      }

      setPopup({
        longitude: feature.geometry.coordinates[0],
        latitude: feature.geometry.coordinates[1],
        props: feature.properties,
      })
    },
    [areaMode],
  )

  const clearArea = () => {
    setCenter(null)
    setAreaResult(null)
  }

  return (
    <div className="map-wrap">
      {error && <div className="map-error">Map data failed to load: {error}</div>}

      <div className="map-meta">
        {formatNumber(count)} fires shown{center ? ' in selected area' : ''}
      </div>

      {/* Area-select controls */}
      <div className="map-tools">
        <button
          className={`tool-btn ${areaMode ? 'active' : ''}`}
          onClick={() => setAreaMode((m) => !m)}
        >
          {areaMode ? '◉ Click map to set center' : '⊕ Select area'}
        </button>
        <button
          className={`tool-btn ${showHeat ? 'active' : ''}`}
          onClick={() => setShowHeat((h) => !h)}
        >
          {showHeat ? '◉ Heatmap on' : '🔥 Heatmap'}
        </button>
        <button
          className={`tool-btn ${showModel ? 'active' : ''}`}
          onClick={() => setShowModel((m) => !m)}
          title="Exposure prioritization: burn frequency × mean fire size per grid cell"
        >
          {showModel ? '◉ Risk model on' : '📊 Risk model'}
        </button>
        {center && (
          <div className="radius-control">
            <label>
              Radius: {radius} mi
              <input
                type="range"
                min="1"
                max="150"
                step="1"
                value={radius}
                onChange={(e) => setRadius(Number(e.target.value))}
              />
            </label>
            <button className="tool-btn ghost" onClick={clearArea}>
              Clear
            </button>
          </div>
        )}
      </div>

      {/* Area result summary */}
      {areaResult && (
        <div className="area-result">
          <strong>{formatNumber(areaResult.summary.count)}</strong> fires within{' '}
          {areaResult.radius} mi
          <span className="area-sub">
            {formatNumber(areaResult.summary.totalAcres)} acres total ·{' '}
            {formatNumber(areaResult.summary.avgAcres)} avg
          </span>
        </div>
      )}

      {/* Cause legend */}
      <div className="map-legend">
        {Object.entries(CAUSE_PALETTE)
          .filter(([k]) => k !== 'Lightning') // Lightning shares Natural's color
          .map(([cause, color]) => (
            <span key={cause} className="legend-item">
              <span className="legend-dot" style={{ background: color }} />
              {cause}
            </span>
          ))}
        <span className="legend-item">
          <span className="legend-dot" style={{ background: CAUSE_FALLBACK }} />
          Other
        </span>
      </div>

      <Map
        ref={mapRef}
        initialViewState={INITIAL_VIEW}
        mapStyle={MAP_STYLE}
        interactiveLayerIds={areaMode ? [] : interactiveLayerIds}
        onClick={onClick}
        cursor={areaMode ? 'crosshair' : 'auto'}
        style={{ width: '100%', height: '100%' }}
      >
        <NavigationControl position="top-right" />

        {/* County choropleth sits underneath the fire layers. */}
        {counties && (
          <Source id="counties" type="geojson" data={counties}>
            <Layer {...countyFillLayer(counties.maxCount || 1)} />
            <Layer {...countyLineLayer} />
            <Layer {...countyLabelLayer} />
          </Source>
        )}

        {/* Exposure/risk model grid (toggleable, off by default). */}
        {showModel && modelData && (
          <Source id="exposure" type="geojson" data={modelData}>
            <Layer {...exposureFillLayer} />
          </Source>
        )}

        {/* Heatmap (toggleable, off by default). Non-clustered source. */}
        {showHeat && displayData && (
          <Source id="fires-heat" type="geojson" data={displayData}>
            <Layer {...heatmapLayer} />
          </Source>
        )}

        {/* Clustered dots: clusters when zoomed out, individual fires zoomed in.
            Shows only in-area fires when a center is selected. */}
        {displayData && (
          <Source
            id="fires"
            type="geojson"
            data={displayData}
            cluster
            clusterRadius={50}
            clusterMaxZoom={12}
          >
            <Layer {...clusterHaloLayer} />
            <Layer {...clusterLayer} />
            <Layer {...clusterCountLayer} />
            <Layer {...fireGlowLayer} />
            <Layer {...firePointLayer} />
          </Source>
        )}

        {circle && (
          <Source id="radius" type="geojson" data={circle}>
            <Layer {...radiusFillLayer} />
            <Layer {...radiusLineLayer} />
          </Source>
        )}

        {/* Burn-area circle for the open fire popup, drawn to scale. */}
        {burnCircle && (
          <Source id="burn" type="geojson" data={burnCircle}>
            <Layer {...burnFillLayer} />
            <Layer {...burnLineLayer} />
          </Source>
        )}

        {center && (
          <Marker longitude={center.lon} latitude={center.lat} anchor="center">
            <div className="center-marker" />
          </Marker>
        )}

        {popup && (
          <Popup
            longitude={popup.longitude}
            latitude={popup.latitude}
            anchor="bottom"
            onClose={() => setPopup(null)}
            closeOnClick={false}
            maxWidth="300px"
          >
            {popup.model ? (
              <div className="fire-popup">
                <h3>Risk model — grid cell</h3>
                <dl>
                  <dt>Priority score</dt>
                  <dd>{formatNumber(popup.model.priorityScore)}</dd>
                  <dt>Fires</dt>
                  <dd>{formatNumber(popup.model.fires)}</dd>
                  <dt>Burn freq</dt>
                  <dd>{popup.model.burnFrequency_per_yr ?? '—'} /yr</dd>
                  <dt>Mean size</dt>
                  <dd>{formatNumber(popup.model.meanSize_acres)} ac</dd>
                  <dt>Exp. annual</dt>
                  <dd>{formatNumber(popup.model.expectedAnnualAcres)} ac/yr</dd>
                </dl>
                <p className="popup-note">
                  Score = burn frequency × mean fire size (exposure
                  prioritization).
                </p>
              </div>
            ) : (
              <div className="fire-popup">
                <h3>{popup.props.incident_name || 'Unnamed incident'}</h3>
                <dl>
                  <dt>Cause</dt>
                  <dd>{popup.props.cause || '—'}</dd>
                  <dt>Acres burned</dt>
                  <dd>{formatNumber(popup.props.acres_burned)}</dd>
                  {burnCircle && (
                    <>
                      <dt>Burn radius</dt>
                      <dd>
                        ~{acresToRadiusMiles(popup.props.acres_burned).toFixed(2)} mi
                      </dd>
                    </>
                  )}
                  <dt>Discovered</dt>
                  <dd>{formatDate(popup.props.discovered_at)}</dd>
                  <dt>County</dt>
                  <dd>{popup.props.county || '—'}</dd>
                  <dt>Region</dt>
                  <dd>{popup.props.region || '—'}</dd>
                  <dt>Protection</dt>
                  <dd>{popup.props.protection_type || '—'}</dd>
                </dl>
              </div>
            )}
          </Popup>
        )}
      </Map>
    </div>
  )
}
