// Circuit outlines for the dashboard's Grand Prix panel. The outlines come from
// data/f1-circuits.geojson (bacinger/f1-circuits, MIT licence) and show each circuit's
// current layout. Uses the global d3 for the map projection.

let tracks = null;

// Map of track id -> GeoJSON feature, fetched once on first use.
export function loadTracks() {
  if (!tracks) {
    tracks = fetch("data/f1-circuits.geojson")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((fc) => new Map(fc.features.map((f) => [f.properties.id, f])));
  }
  return tracks;
}

// SVG markup for a track outline scaled to fit a width x height box.
let glowId = 0;
export function trackSVG(feature, width, height, { pad = 12, stroke = 4, label = "" } = {}) {
  const projection = d3.geoMercator().fitExtent([[pad, pad], [width - pad, height - pad]], feature);
  const d = d3.geoPath(projection)(feature);
  const id = `track-glow-${++glowId}`;
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${label}">
    <defs><filter id="${id}" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="${Math.max(2, stroke)}"/></filter></defs>
    <path d="${d}" fill="none" stroke="#FC1F04" stroke-width="${stroke + 5}" stroke-linejoin="round"
      stroke-linecap="round" opacity="0.8" filter="url(#${id})"/>
    <path d="${d}" fill="none" stroke="#fff" stroke-width="${stroke}" stroke-linejoin="round" stroke-linecap="round"/>
  </svg>`;
}
