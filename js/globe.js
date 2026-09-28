// Spinning globe for the dashboard. With every Grand Prix in view it spins and marks each
// circuit that hosted a race in the current view; with one Grand Prix selected it stops and
// zooms in on that circuit. Uses the global d3 and topojson (loaded from jsDelivr).
import { CIRCUITS } from "./venues.js";

const WORLD_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json";
const SIZE = 500;
const RADIUS = 238;
const ZOOM = 3.4; // scale factor when a Grand Prix is selected
const TILT = -22; // show a little more of the northern hemisphere, where most circuits are
const SPIN = 0.006; // degrees per millisecond (one turn a minute)

export function createGlobe(host, { onPick } = {}) {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const svg = d3.select(host).append("svg")
    .attr("viewBox", `0 0 ${SIZE} ${SIZE}`)
    .attr("role", "img")
    .attr("class", "globe-svg");

  const defs = svg.append("defs");
  const grad = defs.append("radialGradient").attr("id", "globe-ocean").attr("cx", "40%").attr("cy", "35%");
  grad.append("stop").attr("offset", "0%").attr("stop-color", "#1b1b24");
  grad.append("stop").attr("offset", "100%").attr("stop-color", "#07070a");
  defs.append("clipPath").attr("id", "globe-clip")
    .append("rect").attr("width", SIZE).attr("height", SIZE).attr("rx", 6);

  const g = svg.append("g").attr("clip-path", "url(#globe-clip)");
  const projection = d3.geoOrthographic().scale(RADIUS).translate([SIZE / 2, SIZE / 2]).clipAngle(90).rotate([0, TILT]);
  const path = d3.geoPath(projection);

  const sphere = g.append("path").datum({ type: "Sphere" }).attr("fill", "url(#globe-ocean)");
  const graticule = g.append("path").datum(d3.geoGraticule10())
    .attr("fill", "none").attr("stroke", "rgba(255,255,255,0.06)").attr("stroke-width", 0.6);
  const land = g.append("path").attr("fill", "#2a2a33");
  const borders = g.append("path").attr("fill", "none").attr("stroke", "#46464f").attr("stroke-width", 0.5);
  const rim = g.append("path").datum({ type: "Sphere" })
    .attr("fill", "none").attr("stroke", "rgba(252,31,4,0.55)").attr("stroke-width", 1.5);
  const dotLayer = g.append("g");
  const label = g.append("g").attr("class", "globe-label").style("display", "none");
  const labelBg = label.append("rect").attr("rx", 3).attr("fill", "rgba(0,0,0,0.82)").attr("stroke", "#FC1F04");
  const labelText = label.append("text").attr("fill", "#fff").attr("font-size", 15).attr("font-weight", 700);

  let spots = []; // [{ id, circuit, count, races: [[name, n], ...], focus }]
  let focusId = null;
  let spinning = !reduceMotion;
  let onScreen = true;
  let last = null;

  d3.json(WORLD_URL).then((world) => {
    land.datum(topojson.feature(world, world.objects.countries));
    borders.datum(topojson.mesh(world, world.objects.countries, (a, b) => a !== b));
    render();
  }).catch(() => {
    land.datum(null); // globe still works without the map: ocean, grid and circuits
  });

  const isVisible = (lon, lat) => {
    const [l, p] = projection.rotate();
    return d3.geoDistance([lon, lat], [-l, -p]) < Math.PI / 2 - 0.02;
  };

  function render() {
    sphere.attr("d", path);
    graticule.attr("d", path);
    rim.attr("d", path);
    if (land.datum()) {
      land.attr("d", path);
      borders.attr("d", path);
    }
    dotLayer.selectAll("circle").each(function (d) {
      const c = d.circuit;
      const show = isVisible(c.lon, c.lat);
      const [x, y] = projection([c.lon, c.lat]);
      d3.select(this).attr("cx", x).attr("cy", y).style("display", show ? null : "none");
    });
    const f = spots.find((s) => s.id === focusId);
    if (f && isVisible(f.circuit.lon, f.circuit.lat)) {
      const [x, y] = projection([f.circuit.lon, f.circuit.lat]);
      const box = labelText.node().getBBox();
      const lx = Math.min(Math.max(x - box.width / 2, 8), SIZE - box.width - 8);
      const ly = y - 26;
      labelText.attr("x", lx).attr("y", ly);
      labelBg.attr("x", lx - 7).attr("y", ly - box.height + 2).attr("width", box.width + 14).attr("height", box.height + 8);
      label.style("display", null);
    } else {
      label.style("display", "none");
    }
  }

  d3.timer((elapsed) => {
    const dt = last == null ? 0 : elapsed - last;
    last = elapsed;
    if (!spinning || !onScreen || document.hidden) return;
    const [l, p] = projection.rotate();
    projection.rotate([l + SPIN * Math.min(dt, 50), p]);
    render();
  });

  if ("IntersectionObserver" in window) {
    new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; }).observe(host);
  }

  function flyTo(rotation, scale, then) {
    const r0 = projection.rotate();
    const s0 = projection.scale();
    // turn the short way round
    const dl = ((((rotation[0] - r0[0]) % 360) + 540) % 360) - 180;
    const r = d3.interpolate([r0[0], r0[1]], [r0[0] + dl, rotation[1]]);
    const s = d3.interpolate(s0, scale);
    svg.interrupt().transition().duration(reduceMotion ? 0 : 1400).ease(d3.easeCubicInOut)
      .tween("fly", () => (t) => {
        projection.rotate(r(t)).scale(s(t));
        render();
      })
      .on("end", then || null);
  }

  // races: [{ race, year }] distinct races in the current view; selectedRace: "" for all
  function update(races, selectedRace) {
    const byCircuit = new Map();
    for (const { race, circuit: id, year } of races) {
      if (!id) continue;
      let s = byCircuit.get(id);
      if (!s) byCircuit.set(id, (s = { id, circuit: CIRCUITS[id], count: 0, names: new Map(), lastYear: 0 }));
      s.count++;
      s.names.set(race, (s.names.get(race) || 0) + 1);
      s.lastYear = Math.max(s.lastYear, year);
    }
    spots = [...byCircuit.values()]
      .map((s) => ({ ...s, races: [...s.names].sort((a, b) => b[1] - a[1]) }))
      .sort((a, b) => b.count - a.count || b.lastYear - a.lastYear);

    const maxCount = d3.max(spots, (s) => s.count) || 1;
    const r = d3.scaleSqrt().domain([1, maxCount]).range([3.5, 9]);
    focusId = selectedRace && spots.length ? spots[0].id : null;

    dotLayer.selectAll("circle")
      .data(spots, (d) => d.id)
      .join((enter) => enter.append("circle")
        .attr("fill", "#FC1F04")
        .attr("stroke", "#fff")
        .attr("stroke-width", 1)
        .style("cursor", "pointer")
        .on("click", (_, d) => onPick && onPick(d.races[0][0]))
        .call((c) => c.append("title")))
      .attr("r", (d) => (d.id === focusId ? 8 : r(d.count)))
      .attr("fill", (d) => (d.id === focusId ? "#C54CFF" : "#FC1F04"))
      .attr("stroke-width", (d) => (d.id === focusId ? 2.5 : 1))
      .select("title")
      .text((d) => `${d.circuit.name}, ${d.circuit.city} (${d.circuit.country})\n` +
        d.races.map(([n, k]) => `${n}: ${k} race${k === 1 ? "" : "s"}`).join("\n") +
        (onPick ? "\nClick to select this Grand Prix" : ""));

    svg.attr("aria-label", focusId
      ? `Globe zoomed in on ${CIRCUITS[focusId].name}, ${CIRCUITS[focusId].city}, ${CIRCUITS[focusId].country}`
      : `Spinning globe marking ${spots.length} circuits that hosted races in the current view`);

    if (focusId) {
      const c = CIRCUITS[focusId];
      labelText.text(`${c.name} · ${c.city}`);
      spinning = false;
      flyTo([-c.lon, -c.lat], RADIUS * ZOOM);
    } else {
      const zoomedOut = projection.scale() === RADIUS && projection.rotate()[1] === TILT;
      if (zoomedOut) {
        spinning = !reduceMotion;
        render();
      } else {
        spinning = false;
        flyTo([projection.rotate()[0], TILT], RADIUS, () => { spinning = !reduceMotion; });
      }
    }
  }

  return { update };
}
