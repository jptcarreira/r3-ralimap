maptilersdk.config.apiKey = 'rOdxVka6Tfwp1AYx4eq5';

const map = new maptilersdk.Map({
  container: 'map',
  style: maptilersdk.MapStyle.TOPO,
  center: [-8.0, 39.5],
  zoom: 6,
  preserveDrawingBuffer: true,
});

map.setStyle(maptilersdk.MapStyle.TOPO, {
  transformStyle: (_previous, next) => greyTopoStyle(next),
});

let activeMarkers = [];
let placedMarkers = [];
let currentTrackData = null;
let currentTrackBundle = null;
let currentStageIndex = 0;
let trackWidthFactor = 1;
let iconSize = 40;
let arrowsVisible = true;
let arrowSpacing = 50;
let connectionMode = 'normal';

function getTrackWidths() {
  return {
    prePost: 5 * trackWidthFactor,
    main: 7 * trackWidthFactor,
    glow: 16 * trackWidthFactor,
  };
}

function applyTrackWidths() {
  const widths = getTrackWidths();

  if (map.getLayer('track-pre-line')) {
    map.setPaintProperty('track-pre-line', 'line-width', widths.prePost);
  }
  if (map.getLayer('track-post-line')) {
    map.setPaintProperty('track-post-line', 'line-width', widths.prePost);
  }
  if (map.getLayer('track-line')) {
    map.setPaintProperty('track-line', 'line-width', widths.main);
  }
  if (map.getLayer('track-glow')) {
    map.setPaintProperty('track-glow', 'line-width', widths.glow);
  }
}

function applyArrowSettings() {
  if (!map.getLayer('track-arrows')) return;

  map.setLayoutProperty('track-arrows', 'visibility', arrowsVisible ? 'visible' : 'none');
  map.setLayoutProperty('track-arrows', 'symbol-spacing', arrowSpacing);
}

const MARKER_ICONS = {
  start: { title: 'Start', src: 'images/RALI-DSS.png' },
  end: { title: 'Finish - TT', src: 'images/RALI-ASS.png' },
  dss: { title: 'DSS', src: 'images/DSS.svg' },
  ass: { title: 'ASS', src: 'images/ASS.svg' },
  tc: { title: 'Time Control', src: 'images/TC.svg', fallbackSrc: 'images/TC.png' },
  stop: { title: 'Stop', src: 'images/STOP.svg' },
  radio: { title: 'Radio', src: 'images/RADIO.svg' },
  'ap-start': { title: 'Inicio AP', src: 'images/tyre-warming.svg' },
  'ap-end': { title: 'Fim AP', src: 'images/tyre-warming-end.svg' },
  ambulance: { title: 'Ambulância', src: 'images/ambulance-pt.png' },
  exit: { title: 'Saída', src: 'images/exit-pt.png' },
  fire: { title: 'Bombeiros', src: 'images/fire-pt.png' },
  medical: { title: 'Médico', src: 'images/medical-pt.png' },
  trailer: { title: 'Reboque', src: 'images/trailer-pt.png' },
};

const CALLOUT_PAD = 4;
const CALLOUT_GAP = 4;
const CALLOUT_BORDER = 1;
const STEM_GAP = 28;

function calloutColumns(count) {
  if (count <= 1) return 1;
  if (count <= 4) return 2;
  if (count <= 9) return 3;
  return 4;
}

function calloutBox(count) {
  const cols = calloutColumns(count);
  const rows = Math.ceil(count / cols);
  const width = cols * iconSize + Math.max(0, cols - 1) * CALLOUT_GAP + CALLOUT_PAD * 2 + CALLOUT_BORDER * 2;
  const height = rows * iconSize + Math.max(0, rows - 1) * CALLOUT_GAP + CALLOUT_PAD * 2 + CALLOUT_BORDER * 2;
  return { cols, rows, width, height };
}

function createCalloutElement(types) {
  const el = document.createElement('div');
  el.className = 'track-callout';

  const stem = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  stem.setAttribute('class', 'track-callout-stem');
  for (const stroke of [
    { color: '#ffffff', width: '4.5' },
    { color: '#1a1a2e', width: '2' },
  ]) {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('stroke', stroke.color);
    line.setAttribute('stroke-width', stroke.width);
    line.setAttribute('stroke-linecap', 'round');
    stem.appendChild(line);
  }
  el.appendChild(stem);

  const dot = document.createElement('div');
  dot.className = 'track-callout-dot';
  el.appendChild(dot);

  const bubble = document.createElement('div');
  bubble.className = 'track-callout-bubble';
  const box = calloutBox(types.length);
  bubble.style.width = `${box.width}px`;
  bubble.style.height = `${box.height}px`;
  bubble.title = types.map((type) => (MARKER_ICONS[type] || MARKER_ICONS.start).title).join(', ');
  bubble.setAttribute('role', 'group');
  bubble.setAttribute('aria-label', bubble.title);

  types.forEach((type) => {
    const cfg = MARKER_ICONS[type] || MARKER_ICONS.start;
    const img = document.createElement('img');
    img.src = cfg.src;
    img.alt = cfg.title;
    img.title = cfg.title;
    img.draggable = false;
    img.style.width = `${iconSize}px`;
    img.style.height = `${iconSize}px`;
    if (cfg.fallbackSrc) {
      img.onerror = () => {
        img.onerror = null;
        img.src = cfg.fallbackSrc;
      };
    }
    bubble.appendChild(img);
  });
  el.appendChild(bubble);

  return el;
}

// Rally Navigator lexicon ids used by My Roadbook canvas (.rbc).
// Parameter placeholders are dropped, matching the canvas importer.
const RBC_ICON_TAGS = {
  '0a1d95e6-3bef-45ff-b605-4f2bcf7735d9': "<dss open='${open}' clear='${clear}'/>",
  'fe2cfdc7-14d8-48b9-aad4-68aae1c55174': '<dss/>',
  '6d8427db-3869-4f16-8d49-8345ba8ec79b': '<dss/>',
  'e0395ffc-b143-4d88-bd9c-8ff68d255dbd': "<dss open='${open}' clear='${clear}'/>",
  'e36cbf3e-be7f-4cde-b58b-676127a393b6': "<dss open='${open}' clear='${clear}'/>",
  '741b31e3-7aae-402b-88fb-14191f8e55a6': '<ass/>',
  '7628bda8-deb7-4c2f-8dd0-8fbb20989e52': '<ass/>',
  'e252bf77-328c-4148-a71d-1c2f19a7e8a8': "<ass open='${open}' clear='${clear}'/>",
  'ec316c9b-0dcf-4823-ace0-1ed5c570f16f': "<ass open='${open}' clear='${clear}'/>",
  '20481666-2792-494d-a043-0edda3fc422e': '<timecontrol/>',
  '6acd1428-ce6c-4a89-adfe-148da58f685a': '<timecontrol/>',
  'bbf8aa83-6e11-45ba-80ba-a0ce55952e09': '<timecontrol>${time}</timecontrol>',
  '5240b705-e16f-44b5-b915-8c897c964f2a': '<timecontrol>${time}</timecontrol>',
  'c156fa6a-4f71-4223-b8a0-ad0bd7bbe174': '<timecontrol/>',
  '0f906096-c042-414a-89df-3be57460304c': '<stop>${time}</stop>',
  '362f1ef3-4b11-4fce-b128-78f39e8983fe': '<stop>0</stop>',
  '4be33b71-5aa3-4a5b-a1c9-e075fbe3b5e5': '<stop>${time}</stop>',
  'af196255-1017-44ec-a475-b007c43845ee': '<stop>0</stop>',
  '42cb69d4-a78b-43c7-9367-a332ce79a447': '<radio/>',
  '2416f1bf-0278-4a15-ae0f-288e8473cd63': '<radio/>',
  '1e73ade7-44fb-4f87-8f8b-18c9b67010e8': '<radio/>',
  '8470b397-d4eb-4da8-8632-2a082ef43dfc': '<start_tyre_warming_zone/>',
  'fe597f94-0f57-437c-87da-5474f4c01578': '<finish_tyre_warming_zone/>',
};

const ZONE_ICON_TYPES = {
  start_tyre_warming_zone: 'ap-start',
  start_tyre_warming: 'ap-start',
  finish_tyre_warming_zone: 'ap-end',
  finish_tyre_warming: 'ap-end',
};

function parseGpxFeature(raw) {
  const text = String(raw ?? '').trim();
  const open = text.match(/^<\s*(?:([A-Za-z][\w.-]*):)?([\w.-]+)([^>]*)>/);
  if (!open) return null;

  const attributes = {};
  const attrSrc = open[3] || '';
  for (const attr of attrSrc.matchAll(/([\w.-]+)\s*=\s*'([^']*)'/g)) {
    if (!/^\$\{[\w.-]+\}$/.test(attr[2])) attributes[attr[1]] = attr[2];
  }

  let value = null;
  const close = text.match(/<\/\s*(?:[A-Za-z][\w.-]*:)?[\w.-]+\s*>$/);
  if (close) {
    const inner = text.slice(open[0].length, text.length - close[0].length).trim();
    if (inner && !/^\$\{[\w.-]+\}$/.test(inner)) value = inner;
  }

  return {
    namespace: open[1] || null,
    tag: open[2],
    value,
    attributes,
  };
}

function gpxFeaturesEqual(a, b) {
  if (a.tag !== b.tag) return false;
  if ((a.namespace || null) !== (b.namespace || null)) return false;
  if ((a.value || null) !== (b.value || null)) return false;
  const aKeys = Object.keys(a.attributes || {});
  const bKeys = Object.keys(b.attributes || {});
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => a.attributes[key] === b.attributes[key]);
}

const SERVICE_ICON_TYPES = {
  'ambulance-pt': 'ambulance',
  'exit-pt': 'exit',
  'fire-pt': 'fire',
  'medical-pt': 'medical',
  'trailer-pt': 'trailer',
};

function rbcServiceIcons(row) {
  const types = [];
  for (const path of rbcAssetPaths(row)) {
    const file = String(path).split('/').pop().replace(/\.[^.]+$/, '');
    const type = SERVICE_ICON_TYPES[file];
    if (type && !types.includes(type)) types.push(type);
  }
  return types;
}

function rbcIconId(assetPath) {
  const match = String(assetPath).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return match ? match[0].toLowerCase() : null;
}

function rbcAssetPaths(row) {
  const paths = [];
  for (const key of ['notesCanvas', 'tulipCanvas']) {
    const objects = row?.[key]?.objects;
    if (!Array.isArray(objects)) continue;
    for (const obj of objects) {
      if (typeof obj?.assetPath === 'string') paths.push(obj.assetPath);
    }
  }
  if (typeof row?.waypointMarker === 'string') paths.push(row.waypointMarker);
  return paths;
}

function rbcActiveFeatures(row) {
  const removed = (Array.isArray(row?.removedFeatures) ? row.removedFeatures : [])
    .map(parseGpxFeature)
    .filter(Boolean);
  const active = [];

  const consider = (feature) => {
    if (!feature) return;
    if (removed.some((item) => gpxFeaturesEqual(item, feature))) return;
    active.push(feature);
  };

  const added = Array.isArray(row?.addedFeatures) ? row.addedFeatures : [];
  for (const raw of added) consider(parseGpxFeature(raw));

  for (const path of rbcAssetPaths(row)) {
    const tag = RBC_ICON_TAGS[rbcIconId(path)];
    if (tag) consider(parseGpxFeature(tag));
  }

  return active;
}

function rbcControlFlags(row) {
  const active = rbcActiveFeatures(row);
  const has = (tag) => active.some((feature) => feature.tag === tag);
  return {
    dss: has('dss'),
    ass: has('ass'),
    tc: has('timecontrol'),
    stop: has('stop'),
    radio: has('radio'),
  };
}

function rbcZoneIcons(row) {
  const types = [];
  for (const feature of rbcActiveFeatures(row)) {
    const type = ZONE_ICON_TYPES[feature.tag];
    if (type && !types.includes(type)) types.push(type);
  }
  return types;
}

function rbcHeaderBefore(headers, indexById, dssIndex) {
  let best = null;
  let bestIndex = -1;
  for (const header of headers) {
    if ((header?.pass ?? 1) !== 1) continue;
    const afterId = header?.afterRowId;
    const index = afterId ? indexById.get(afterId) : -1;
    if (index == null || index >= dssIndex || index < bestIndex) continue;
    best = header;
    bestIndex = index;
  }
  return best;
}

function rbcStageLabel(header, fallbackName) {
  const stageName = (header?.specialStageName || header?.fromLabel || fallbackName || 'Special Stage').trim() || 'Special Stage';
  const specialStage = (header?.specialStage || '').trim();
  const fromCode = (header?.fromCode || '').trim();
  const stageOrdinal = specialStage ? `SS ${specialStage}` : (fromCode || null);
  const label = stageOrdinal ? `${stageOrdinal} - ${stageName}` : stageName;
  return { stageName, stageOrdinal, label };
}

function assembleStages(points, meta) {
  function toCoords(slice) {
    return slice
      .filter((point) => typeof point.lat === 'number' && typeof point.lon === 'number')
      .map((point) => [point.lon, point.lat]);
  }

  function rowIndexOf(index) {
    const point = points[index];
    return Number.isInteger(point?.rowIndex) ? point.rowIndex : index;
  }

  function branchesBetween(startRow, endRow) {
    return (meta.detours || [])
      .filter((detour) => detour.forkIndex >= startRow && detour.forkIndex <= endRow)
      .map((detour) => detour.coords);
  }

  function pushDetourIcons(mapIcons, startRow, endRow, index) {
    for (const detour of meta.detours || []) {
      if (detour.forkIndex < startRow || detour.forkIndex > endRow) continue;
      for (const icon of detour.icons || []) {
        mapIcons.push({ type: icon.type, coord: icon.coord, index });
      }
    }
  }

  const markers = [];
  points.forEach((point, index) => {
    if (point.dss) markers.push({ type: 'dss', index });
    if (point.ass) markers.push({ type: 'ass', index });
  });

  if (!markers.some((marker) => marker.type === 'dss')) {
    throw new Error('No <dss/> (Start Special Stage) marker found in this file.');
  }
  if (!markers.some((marker) => marker.type === 'ass')) {
    throw new Error('No <ass/> (Arrival Special Stage) marker found in this file.');
  }

  const stages = [];
  let pendingDss = null;

  markers.forEach((marker) => {
    if (marker.type === 'dss') {
      pendingDss = marker.index;
      return;
    }

    if (pendingDss === null || marker.index <= pendingDss) {
      return;
    }

    const coords = toCoords(points.slice(pendingDss, marker.index + 1));

    if (coords.length < 2) {
      pendingDss = null;
      return;
    }

    const dssRow = rowIndexOf(pendingDss);
    const assRow = rowIndexOf(marker.index);
    const preCoordsNormal = toCoords(points.slice(0, pendingDss + 1));
    const postCoordsNormal = toCoords(points.slice(marker.index));

    let preTcIndex = -1;
    for (let i = pendingDss; i >= 0; i -= 1) {
      if (points[i].tc) {
        preTcIndex = i;
        break;
      }
    }
    const preTcStart = preTcIndex >= 0 ? preTcIndex : 0;
    const preCoordsTcStop = toCoords(points.slice(preTcStart, pendingDss + 1));

    let postStopOffset = -1;
    for (let i = marker.index; i < points.length; i += 1) {
      if (points[i].stop) {
        postStopOffset = i - marker.index;
        break;
      }
    }
    const postStopEnd = postStopOffset >= 0 ? marker.index + postStopOffset : points.length - 1;
    const postCoordsTcStop = toCoords(points.slice(marker.index, postStopEnd + 1));
    const tcToStopCoords = toCoords(points.slice(preTcStart, postStopEnd + 1));
    const radioEnd = postStopOffset >= 0 ? marker.index + postStopOffset : marker.index;

    const radioCoords = [];
    for (let i = pendingDss; i <= radioEnd; i += 1) {
      const point = points[i];
      if (!point?.radio || typeof point.lat !== 'number' || typeof point.lon !== 'number') continue;
      radioCoords.push({ coord: [point.lon, point.lat], index: i });
    }
    const postStopRow = rowIndexOf(postStopEnd);
    const detourEnd = postStopOffset >= 0 ? postStopRow : assRow - 1;
    for (const detour of meta.detours || []) {
      if (detour.forkIndex < dssRow || detour.forkIndex > detourEnd) continue;
      const index = detour.forkIndex >= assRow ? radioEnd : pendingDss;
      for (const coord of detour.radios || []) radioCoords.push({ coord, index });
    }

    const naming = meta.labelFor(pendingDss);
    const mapIcons = [];
    points.forEach((point, index) => {
      if (!Array.isArray(point.icons) || typeof point.lat !== 'number' || typeof point.lon !== 'number') return;
      for (const type of point.icons) {
        mapIcons.push({ type, coord: [point.lon, point.lat], index });
      }
    });
    const preTcRow = rowIndexOf(preTcStart);
    pushDetourIcons(mapIcons, 0, preTcRow - 1, 0);
    pushDetourIcons(mapIcons, preTcRow, dssRow - 1, preTcStart);
    pushDetourIcons(mapIcons, dssRow, assRow - 1, pendingDss);
    pushDetourIcons(mapIcons, assRow, postStopRow, marker.index);
    pushDetourIcons(mapIcons, postStopRow + 1, Number.POSITIVE_INFINITY, points.length);

    stages.push({
      label: naming.label,
      coords,
      coordsBranches: branchesBetween(dssRow, assRow - 1),
      preCoordsNormal,
      preBranchesNormal: branchesBetween(0, dssRow - 1),
      postCoordsNormal,
      postBranchesNormal: branchesBetween(assRow, Number.POSITIVE_INFINITY),
      preCoordsTcStop,
      preBranchesTcStop: branchesBetween(preTcRow, dssRow - 1),
      postCoordsTcStop,
      postBranchesTcStop: branchesBetween(assRow, postStopRow),
      tcToStopCoords,
      radioCoords,
      mapIcons,
      preTcIndex,
      postStopIndex: postStopOffset >= 0 ? marker.index + postStopOffset : -1,
      startCoord: coords[0],
      endCoord: coords[coords.length - 1],
      name: meta.name || 'Special Stage',
      stageName: naming.stageName,
      stageOrdinal: naming.stageOrdinal,
      dssIndex: pendingDss,
      assIndex: marker.index,
      hasPreTc: preTcIndex >= 0,
      hasPostStop: postStopOffset >= 0,
    });

    pendingDss = null;
  });

  stages.forEach((stage, index) => {
    const prev = stages[index - 1];
    const next = stages[index + 1];
    const prevEnd = prev
      ? (prev.hasPostStop && prev.postStopIndex >= 0 ? prev.postStopIndex : prev.assIndex)
      : -1;
    const nextOpen = next
      ? (next.hasPreTc && next.preTcIndex >= 0 ? next.preTcIndex : next.dssIndex)
      : Number.POSITIVE_INFINITY;
    stage.linkStart = prevEnd >= 0 ? prevEnd + 1 : 0;
    stage.linkEnd = Number.isFinite(nextOpen) ? nextOpen - 1 : Number.POSITIVE_INFINITY;
  });

  if (stages.length === 0) {
    throw new Error('No complete <dss/> → <ass/> stage pairs were found in this file.');
  }

  return {
    name: meta.name || 'Special Stage',
    stages,
  };
}

function parseRn2(json) {
  const route = json?.route;
  if (!route || !Array.isArray(route.waypoints)) {
    throw new Error('Invalid .rn2 file: missing route.waypoints array.');
  }

  const waypoints = route.waypoints;

  function getWaypointTags(wpt) {
    const elements = wpt?.notes?.elements;
    if (!Array.isArray(elements)) return [];
    return elements
      .map((el) => (typeof el?.gpx_tags === 'string' ? el.gpx_tags : ''))
      .filter(Boolean);
  }

  function isVisible(wpt) {
    return wpt?.show !== false;
  }

  function hasTag(wpt, tag) {
    return isVisible(wpt) && getWaypointTags(wpt).some((gpxTag) => gpxTag === tag);
  }

  function hasTagPrefix(wpt, prefix) {
    return isVisible(wpt) && getWaypointTags(wpt).some((gpxTag) => gpxTag.startsWith(prefix));
  }

  function hasTulipIcon(wpt, iconId) {
    const tulipElements = wpt?.tulip?.elements;
    const notesElements = wpt?.notes?.elements;
    const hasInTulip = Array.isArray(tulipElements) && tulipElements.some((el) => el?.type === 'Icon' && el?.id === iconId);
    const hasInNotes = Array.isArray(notesElements) && notesElements.some((el) => el?.type === 'Icon' && el?.id === iconId);
    return hasInTulip || hasInNotes;
  }

  const RADIO_ICON_ID = '42cb69d4-a78b-43c7-9367-a332ce79a447';
  const routeName = route.name || 'Special Stage';

  const TYRE_START_ICON_ID = '8470b397-d4eb-4da8-8632-2a082ef43dfc';
  const TYRE_END_ICON_ID = 'fe597f94-0f57-437c-87da-5474f4c01578';

  function zoneIcons(wpt) {
    if (!isVisible(wpt)) return [];
    const types = [];
    const add = (type) => {
      if (type && !types.includes(type)) types.push(type);
    };
    for (const raw of getWaypointTags(wpt)) {
      const feature = parseGpxFeature(raw);
      add(feature && ZONE_ICON_TYPES[feature.tag]);
    }
    if (hasTulipIcon(wpt, TYRE_START_ICON_ID)) add('ap-start');
    if (hasTulipIcon(wpt, TYRE_END_ICON_ID)) add('ap-end');
    return types;
  }

  const points = waypoints.map((wpt) => ({
    lat: wpt?.lat,
    lon: wpt?.lon,
    dss: hasTag(wpt, '<dss/>'),
    ass: hasTag(wpt, '<ass/>'),
    tc: isVisible(wpt) && hasTag(wpt, '<timecontrol/>'),
    stop: isVisible(wpt) && hasTagPrefix(wpt, '<stop'),
    radio: isVisible(wpt) && hasTulipIcon(wpt, RADIO_ICON_ID),
    icons: zoneIcons(wpt),
  }));

  return assembleStages(points, {
    name: routeName,
    labelFor(dssIndex) {
      const sectionHeader = waypoints[dssIndex]?.sectionHeader || {};
      const stageName = sectionHeader.sSName || sectionHeader.section || routeName;
      const stageOrdinal = sectionHeader.sSOrdinal ? `SS ${sectionHeader.sSOrdinal}` : null;
      const label = stageOrdinal ? `${stageOrdinal} - ${stageName}` : stageName;
      return { stageName, stageOrdinal, label };
    },
  });
}

function indexOfRowId(points, id) {
  if (typeof id !== 'string') return -1;
  for (let index = 0; index < points.length; index += 1) {
    if (points[index].id === id) return index;
  }
  return -1;
}

// The book's rows are the physical points. Jumps and loop exits make the
// driven line follow visits: a jump fires on the first pass only, and a loop
// exit fires before a row the track is about to drive again.
function driveRoute(points, route) {
  const positionById = new Map();
  route.forEach((pointIndex, position) => {
    const id = points[pointIndex].id;
    if (typeof id === 'string') positionById.set(id, position);
  });

  let jumpCount = 0;
  for (const pointIndex of route) {
    const point = points[pointIndex];
    if (point.jumpTo) jumpCount += 1;
    if (point.exitTo) jumpCount += 1;
  }
  const maxVisits = route.length * (jumpCount + 1) + 1;
  const passes = new Map();
  const visits = [];
  let cursor = 0;

  while (cursor >= 0 && cursor < route.length && visits.length < maxVisits) {
    const pointIndex = route[cursor];
    const point = points[pointIndex];
    const id = point.id;
    const pass = (typeof id === 'string' ? (passes.get(id) || 0) : 0) + 1;
    if (typeof id === 'string') passes.set(id, pass);

    const jumpTo = pass === 1 ? point.jumpTo : null;
    let target = typeof jumpTo === 'string' ? positionById.get(jumpTo) : undefined;
    if (target == null) target = null;
    let next = target == null ? cursor + 1 : target;

    if (next < route.length) {
      const nextPoint = points[route[next]];
      const nextId = nextPoint.id;
      if (typeof nextId === 'string' && passes.has(nextId) && typeof nextPoint.exitTo === 'string') {
        const exit = positionById.get(nextPoint.exitTo);
        if (exit != null) {
          target = exit;
          next = exit;
        }
      }
    }

    visits.push(pointIndex);
    cursor = next;
  }

  return visits;
}

function visitsToPoints(points, visits) {
  const seen = new Set();
  return visits.map((pointIndex) => {
    const point = points[pointIndex];
    if (seen.has(pointIndex)) {
      return {
        lat: point.lat,
        lon: point.lon,
        dss: false,
        ass: false,
        tc: false,
        stop: false,
        radio: false,
        icons: [],
        rowIndex: point.rowIndex,
      };
    }
    seen.add(pointIndex);
    return point;
  });
}

function rowOnSplitRoute(points, index, split, splitsById, seen) {
  const point = points[index];
  if (!split) return !point.splitId;
  if (!split.id || seen.has(split.id)) return false;
  if (point.splitId === split.id) return true;
  seen.add(split.id);
  try {
    const parent = split.parent ? splitsById.get(split.parent) || null : null;
    if (!rowOnSplitRoute(points, index, parent, splitsById, seen)) return false;
    const fork = indexOfRowId(points, split.fork);
    if (fork < 0) return true;
    if (index <= fork) return true;
    const rejoin = indexOfRowId(points, split.rejoin);
    return rejoin > fork && index >= rejoin;
  } finally {
    seen.delete(split.id);
  }
}

function splitBranch(points, split, splitsById) {
  const route = [];
  for (let index = 0; index < points.length; index += 1) {
    if (rowOnSplitRoute(points, index, split, splitsById, new Set())) route.push(index);
  }
  const fork = indexOfRowId(points, split.fork);
  if (fork < 0 || route.length === 0) return null;
  const visits = driveRoute(points, route);
  const start = visits.indexOf(fork);
  if (start < 0) return null;
  const rejoin = indexOfRowId(points, split.rejoin);
  let end = visits.length - 1;
  if (rejoin >= 0) {
    const at = visits.indexOf(rejoin, start);
    if (at < 0) return null;
    end = at;
  }

  const span = visits.slice(start, end + 1);
  if (!span.some((pointIndex) => points[pointIndex].splitId === split.id)) return null;

  const coords = [];
  const icons = [];
  const radios = [];
  const seen = new Set();
  for (const pointIndex of span) {
    const point = points[pointIndex];
    if (typeof point.lat !== 'number' || typeof point.lon !== 'number') continue;
    coords.push([point.lon, point.lat]);
    if (seen.has(pointIndex) || pointIndex === fork || pointIndex === rejoin) continue;
    seen.add(pointIndex);
    const coord = [point.lon, point.lat];
    for (const type of point.icons || []) icons.push({ type, coord });
    if (point.radio) radios.push(coord);
  }
  if (coords.length < 2) return null;
  return { forkIndex: fork, coords, icons, radios };
}

function rbcDrivenTrack(points, splits) {
  const route = [];
  points.forEach((point, index) => {
    if (!point.splitId) route.push(index);
  });
  const driven = visitsToPoints(points, driveRoute(points, route));

  const list = Array.isArray(splits) ? splits : [];
  const splitsById = new Map();
  for (const split of list) {
    if (split && typeof split.id === 'string') splitsById.set(split.id, split);
  }
  const detours = [];
  for (const split of list) {
    if (!split || typeof split.fork !== 'string') continue;
    const branch = splitBranch(points, split, splitsById);
    if (branch) detours.push(branch);
  }
  return { points: driven, detours };
}

function parseRbc(json, fileName) {
  const rows = json?.rows;
  if (!Array.isArray(rows)) {
    throw new Error('Invalid .rbc file: missing rows array.');
  }

  const headers = Array.isArray(json.sectionHeaders) ? json.sectionHeaders : [];
  const indexById = new Map();
  rows.forEach((row, index) => {
    if (typeof row?.id === 'string') indexById.set(row.id, index);
  });

  const name = (fileName || json?.id || 'Roadbook').trim() || 'Roadbook';
  const points = rows.map((row, index) => {
    const location = row?.location || {};
    const hidden = row?.visible === false;
    const flags = hidden
      ? { dss: false, ass: false, tc: false, stop: false, radio: false }
      : rbcControlFlags(row);
    return {
      id: typeof row?.id === 'string' ? row.id : null,
      jumpTo: typeof row?.jumpTo === 'string' ? row.jumpTo : null,
      exitTo: typeof row?.exitTo === 'string' ? row.exitTo : null,
      splitId: typeof row?.split === 'string' ? row.split : null,
      rowIndex: index,
      lat: location.lat,
      lon: location.lon,
      icons: hidden ? [] : [...rbcServiceIcons(row), ...rbcZoneIcons(row)],
      ...flags,
    };
  });

  const driven = rbcDrivenTrack(points, json?.splits);
  return assembleStages(driven.points, {
    name,
    detours: driven.detours,
    labelFor(dssIndex) {
      const physical = driven.points[dssIndex]?.rowIndex ?? dssIndex;
      return rbcStageLabel(rbcHeaderBefore(headers, indexById, physical), name);
    },
  });
}

function getVisibleTrackCoords(stage) {
  if (connectionMode === 'tc-dss') {
    const preCoords = stage.preCoordsTcStop || [];
    if (preCoords.length >= 2) return preCoords;
  }

  if (connectionMode === 'ass-stop') {
    const postCoords = stage.postCoordsTcStop || [];
    if (postCoords.length >= 2) return postCoords;
  }

  return stage.coords || [];
}

function renderTrack(data) {
  currentTrackData = data;
  const { name, label } = data;
  const coords = getVisibleTrackCoords(data);
  const isSpecialOnlyMode = connectionMode === 'tc-dss' || connectionMode === 'ass-stop';
  let preCoords, postCoords, mainExtras, preExtras, postExtras;
  if (isSpecialOnlyMode) {
    preCoords = [];
    postCoords = [];
    preExtras = [];
    postExtras = [];
    mainExtras = connectionMode === 'tc-dss'
      ? (data.preBranchesTcStop || [])
      : (data.postBranchesTcStop || []);
  } else if (connectionMode === 'all') {
    preCoords = data.preCoordsTcStop || [];
    postCoords = data.postCoordsTcStop || [];
    mainExtras = data.coordsBranches || [];
    preExtras = data.preBranchesTcStop || [];
    postExtras = data.postBranchesTcStop || [];
  } else if (connectionMode === 'dss-ass-stop') {
    preCoords = [];
    postCoords = data.postCoordsTcStop || [];
    mainExtras = data.coordsBranches || [];
    preExtras = [];
    postExtras = data.postBranchesTcStop || [];
  } else {
    preCoords = data.preCoordsNormal || [];
    postCoords = data.postCoordsNormal || [];
    mainExtras = data.coordsBranches || [];
    preExtras = data.preBranchesNormal || [];
    postExtras = data.postBranchesNormal || [];
  }
  const startCoord = coords[0] || data.startCoord;
  const endCoord = coords[coords.length - 1] || data.endCoord;
  const assCoord = data.endCoord || endCoord;
  const stopCoord = data.hasPostStop && data.postCoordsTcStop?.length
    ? data.postCoordsTcStop[data.postCoordsTcStop.length - 1]
    : null;
  
  const trackColor = connectionMode === 'tc-dss' ? '#1a7a1a' : (connectionMode === 'ass-stop' ? '#f97316' : '#ff0000');
  const widths = getTrackWidths();

  activeMarkers.forEach((marker) => {
    marker.remove();
  });
  activeMarkers = [];
  placedMarkers = [];

  const toGeoJson = (coordinates, extras) => {
    const lines = [coordinates, ...(extras || [])].filter((line) => Array.isArray(line) && line.length >= 2);
    if (lines.length <= 1) {
      return {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: lines[0] || [] },
      };
    }
    return {
      type: 'Feature',
      geometry: { type: 'MultiLineString', coordinates: lines },
    };
  };

  const ssGj = toGeoJson(coords, mainExtras);
  const preGj = toGeoJson(preCoords && preCoords.length >= 2 ? preCoords : [], preExtras);
  const postGj = toGeoJson(postCoords && postCoords.length >= 2 ? postCoords : [], postExtras);

  if (map.getSource('track')) {
    map.getSource('track-pre').setData(preGj);
    map.getSource('track-post').setData(postGj);
    map.getSource('track').setData(ssGj);
    map.setPaintProperty('track-glow', 'line-color', trackColor);
    map.setPaintProperty('track-line', 'line-color', trackColor);
    map.setPaintProperty('track-line', 'line-opacity', 0.5);
    map.setPaintProperty('track-pre-line', 'line-opacity', 0.5);
    map.setPaintProperty('track-post-line', 'line-opacity', 0.5);
    map.setPaintProperty('track-arrows', 'text-color', trackColor);
    map.setPaintProperty('track-arrows', 'text-opacity', 0.5);
  } else {
    map.addSource('track-pre', { type: 'geojson', data: preGj });
    map.addLayer({
      id: 'track-pre-line',
      type: 'line',
      source: 'track-pre',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': '#1a7a1a', 'line-width': widths.prePost, 'line-opacity': 0.5 },
    });

    map.addSource('track-post', { type: 'geojson', data: postGj });
    map.addLayer({
      id: 'track-post-line',
      type: 'line',
      source: 'track-post',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': '#f97316', 'line-width': widths.prePost, 'line-opacity': 0.5 },
    });

    map.addSource('track', { type: 'geojson', data: ssGj });
    map.addLayer({
      id: 'track-glow',
      type: 'line',
      source: 'track',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': trackColor, 'line-width': widths.glow, 'line-opacity': 0.25, 'line-blur': 6 },
    });
    map.addLayer({
      id: 'track-line',
      type: 'line',
      source: 'track',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': trackColor, 'line-width': widths.main, 'line-opacity': 0.5 },
    });
    map.addLayer({
      id: 'track-arrows',
      type: 'symbol',
      source: 'track',
      layout: {
        'symbol-placement': 'line',
        'symbol-spacing': arrowSpacing,
        'text-field': '▶',
        'text-size': 20,
        'text-font': ['Noto Sans Regular'],
        'text-allow-overlap': true,
        'text-ignore-placement': true,
        'text-keep-upright': false,
      },
      paint: {
        'text-color': trackColor,
        'text-opacity': 0.5,
        'text-halo-color': '#000000',
        'text-halo-width': 1.2,
      },
    });
  }

  applyTrackWidths();
  applyArrowSettings();

  const markerDefs = radiosForView(data).map((coord) => ({ type: 'radio', coord, anchor: 'bottom' }));
  const addMarker = (type, coord) => {
    if (!coord || coord.length < 2) return;
    markerDefs.push({ type, coord, anchor: 'bottom' });
  };

  if (connectionMode === 'tc-dss') {
    addMarker(data.hasPreTc ? 'tc' : 'dss', startCoord);
    addMarker('dss', endCoord);
  } else if (connectionMode === 'ass-stop') {
    addMarker('ass', startCoord);
    addMarker(data.hasPostStop ? 'stop' : 'ass', endCoord);
  } else if (connectionMode === 'all') {
    const tcCoord = data.preCoordsTcStop?.[0];
    if (data.hasPreTc) addMarker('tc', tcCoord);
    addMarker('dss', data.startCoord);
    addMarker('ass', assCoord);
    addMarker('stop', stopCoord);
  } else {
    addMarker('dss', startCoord);
    addMarker('ass', assCoord);
    addMarker('stop', stopCoord);
  }

  serviceIconsForView(data).forEach((icon) => addMarker(icon.type, icon.coord));

  const callouts = new Map();
  markerDefs.forEach((def) => {
    if (!def.coord || def.coord.length < 2) return;
    const key = `${Number(def.coord[0]).toFixed(5)},${Number(def.coord[1]).toFixed(5)}`;
    let group = callouts.get(key);
    if (!group) {
      group = { coord: def.coord, types: [] };
      callouts.set(key, group);
    }
    if (!group.types.includes(def.type)) group.types.push(def.type);
  });

  callouts.forEach((group) => {
    group.types.sort((a, b) => (MARKER_SORT[a] ?? 99) - (MARKER_SORT[b] ?? 99));
    const element = createCalloutElement(group.types);
    const marker = new maptilersdk.Marker({
      element,
      anchor: 'center',
    })
      .setLngLat(group.coord)
      .addTo(map);
    activeMarkers.push(marker);
    const entry = {
      marker,
      coord: group.coord,
      types: group.types,
      bubble: element.querySelector('.track-callout-bubble'),
      stem: element.querySelector('.track-callout-stem'),
      userShift: null,
    };
    placedMarkers.push(entry);
    enableCalloutDrag(entry);
  });
  layoutPlacedMarkers();

  const extraCoords = [...(mainExtras || []), ...(preExtras || []), ...(postExtras || [])].flat();
  const fitCoords = connectionMode === 'all'
    ? [...preCoords, ...coords, ...postCoords, ...extraCoords]
    : [...coords, ...extraCoords];
  if (fitCoords.length >= 2) {
    const bounds = fitCoords.reduce(
      (acc, coordinate) => acc.extend(coordinate),
      new maptilersdk.LngLatBounds(fitCoords[0], fitCoords[0])
    );
    map.fitBounds(bounds, { padding: 140, maxZoom: 15 });
  }

  document.getElementById('track-name').textContent = `${name} — ${label} — ${coords.length} pts`;
  document.getElementById('hint').style.display = 'none';
  updateLegend(data);
}

function updateLegend(data) {
  const legend = document.getElementById('legend');
  const keys = legendKeysForView(data);
  legend.querySelectorAll('[data-legend]').forEach((item) => {
    item.hidden = !keys.has(item.dataset.legend);
  });
  legend.hidden = keys.size === 0;
  syncLegendOffset();
}

function syncLegendOffset() {
  const legend = document.getElementById('legend');
  const wrapper = document.getElementById('map-wrapper');
  const height = legend.hidden ? 0 : legend.offsetHeight;
  wrapper.style.setProperty('--legend-offset', `${height}px`);
}

function visibleIconRange(data) {
  const dss = data?.dssIndex ?? 0;
  const ass = data?.assIndex ?? dss;
  const preStart = data?.hasPreTc && data.preTcIndex >= 0 ? data.preTcIndex : 0;
  const postEnd = data?.hasPostStop && data.postStopIndex >= 0 ? data.postStopIndex : Number.POSITIVE_INFINITY;
  if (connectionMode === 'tc-dss') return [preStart, dss];
  if (connectionMode === 'ass-stop') return [ass, postEnd];
  if (connectionMode === 'dss-ass-stop') return [dss, postEnd];
  if (connectionMode === 'all') return [preStart, postEnd];
  const start = data?.linkStart ?? 0;
  const end = data?.linkEnd ?? Number.POSITIVE_INFINITY;
  return [start, end];
}

function iconInView(index, data) {
  const [start, end] = visibleIconRange(data);
  return index >= start && index <= end;
}

function radiosForView(data) {
  return (data?.radioCoords || []).flatMap((radio) => {
    const coord = Array.isArray(radio) ? radio : radio?.coord;
    const index = Array.isArray(radio) ? data.assIndex : radio?.index;
    if (!Array.isArray(coord) || coord.length < 2 || !iconInView(index, data)) return [];
    return [coord];
  });
}

function serviceIconsForView(data) {
  return (data?.mapIcons || []).filter((icon) => (
    Array.isArray(icon?.coord) && icon.coord.length >= 2 && iconInView(icon.index, data)
  ));
}

function legendKeysForView(data) {
  const keys = new Set();
  if (!data) return keys;

  const coords = getVisibleTrackCoords(data);
  const startCoord = coords[0] || data.startCoord;
  const endCoord = coords[coords.length - 1] || data.endCoord;
  const assCoord = data.endCoord || endCoord;
  const stopCoord = data.hasPostStop && data.postCoordsTcStop?.length
    ? data.postCoordsTcStop[data.postCoordsTcStop.length - 1]
    : null;
  const hasCoord = (coord) => Array.isArray(coord) && coord.length >= 2;

  if (radiosForView(data).length) keys.add('radio');
  serviceIconsForView(data).forEach((icon) => keys.add(icon.type));

  if (connectionMode === 'tc-dss') {
    if (hasCoord(startCoord)) keys.add(data.hasPreTc ? 'tc' : 'dss');
    if (hasCoord(endCoord)) keys.add('dss');
    if (coords.length >= 2) keys.add('liaison-pre');
  } else if (connectionMode === 'all') {
    const preCoords = data.preCoordsTcStop || [];
    const postCoords = data.postCoordsTcStop || [];
    if (data.hasPreTc && hasCoord(preCoords[0])) keys.add('tc');
    if (hasCoord(data.startCoord)) keys.add('dss');
    if (hasCoord(assCoord)) keys.add('ass');
    if (hasCoord(stopCoord)) keys.add('stop');
    if (coords.length >= 2) keys.add('pe');
    if (preCoords.length >= 2) keys.add('liaison-pre');
    if (postCoords.length >= 2) keys.add('liaison-post');
  } else if (connectionMode === 'ass-stop') {
    if (hasCoord(startCoord)) keys.add('ass');
    if (hasCoord(endCoord)) keys.add(data.hasPostStop ? 'stop' : 'ass');
    if (coords.length >= 2) keys.add('liaison-post');
  } else {
    if (hasCoord(startCoord)) keys.add('dss');
    if (hasCoord(assCoord)) keys.add('ass');
    if (hasCoord(stopCoord)) keys.add('stop');
    if (coords.length >= 2) keys.add('pe');
    const preCoords = connectionMode === 'dss-ass-stop' ? [] : (data.preCoordsNormal || []);
    const postCoords = connectionMode === 'dss-ass-stop' ? (data.postCoordsTcStop || []) : (data.postCoordsNormal || []);
    if (preCoords.length >= 2) keys.add('liaison-pre');
    if (postCoords.length >= 2) keys.add('liaison-post');
  }

  return keys;
}

function populateStageSelector(bundle) {
  const wrap = document.getElementById('stage-selector-wrap');
  const selector = document.getElementById('stage-selector');

  selector.innerHTML = '';

  bundle.stages.forEach((stage, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = `${stage.label} (${stage.coords.length} pts)`;
    selector.appendChild(option);
  });

  wrap.hidden = bundle.stages.length <= 1;
  selector.value = String(Math.min(currentStageIndex, bundle.stages.length - 1));
}

function renderSelectedStage(index) {
  if (!currentTrackBundle?.stages?.length) return;
  const safeIndex = Math.max(0, Math.min(index, currentTrackBundle.stages.length - 1));
  currentStageIndex = safeIndex;
  renderTrack(currentTrackBundle.stages[safeIndex]);
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.style.display = 'block';
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    toast.style.display = 'none';
  }, 5000);
}

function processFile(file) {
  const lowerName = file.name.toLowerCase();
  const isRn2 = lowerName.endsWith('.rn2');
  const isRbc = lowerName.endsWith('.rbc');
  if (!isRn2 && !isRbc) {
    showToast('Please drop a .rn2 or .rbc file.');
    return;
  }

  const reader = new FileReader();
  reader.onload = (event) => {
    let json;
    try {
      json = JSON.parse(event.target.result);
    } catch (_) {
      showToast('Could not parse file — make sure it is valid JSON.');
      return;
    }

    let data;
    try {
      const routeName = file.name.replace(/\.(rn2|rbc)$/i, '');
      data = isRbc ? parseRbc(json, routeName) : parseRn2(json);
    } catch (err) {
      showToast(err.message);
      return;
    }

    currentTrackBundle = data;
    currentStageIndex = 0;
    populateStageSelector(data);

    if (map.isStyleLoaded()) {
      renderSelectedStage(currentStageIndex);
    } else {
      map.once('load', () => renderSelectedStage(currentStageIndex));
    }
  };
  reader.readAsText(file);
}

const overlay = document.getElementById('drop-overlay');

window.addEventListener('dragover', (event) => {
  event.preventDefault();
});

window.addEventListener('drop', (event) => {
  event.preventDefault();
});

window.addEventListener('dragenter', (event) => {
  if (event.dataTransfer?.types.includes('Files')) {
    overlay.classList.add('active');
  }
});

window.addEventListener('dragleave', (event) => {
  if (event.relatedTarget === null) {
    overlay.classList.remove('active');
  }
});

window.addEventListener('drop', (event) => {
  overlay.classList.remove('active');
  const files = event.dataTransfer?.files;
  if (files && files.length > 0) {
    processFile(files[0]);
  }
});

map.on('load', () => {
  // Map is ready; drag-and-drop will trigger renderTrack when needed.
  updateScaleBar();
});

map.on('move', () => {
  updateScaleBar();
  layoutPlacedMarkers();
});

function applyIconSize() {
  placedMarkers.forEach((entry) => {
    const box = calloutBox(entry.types.length);
    entry.bubble.style.width = `${box.width}px`;
    entry.bubble.style.height = `${box.height}px`;
    entry.bubble.querySelectorAll('img').forEach((img) => {
      img.style.width = `${iconSize}px`;
      img.style.height = `${iconSize}px`;
    });
  });
  layoutPlacedMarkers();
}
const MARKER_SORT = {
  tc: 0,
  dss: 1,
  ass: 2,
  stop: 3,
  radio: 4,
  'ap-start': 5,
  'ap-end': 6,
  ambulance: 7,
  exit: 8,
  fire: 9,
  medical: 10,
  trailer: 11,
};

function calloutRect(item) {
  const left = item.x - item.width / 2 + item.shiftX;
  const top = item.y - STEM_GAP - item.height + item.shiftY;
  return {
    left,
    top,
    right: left + item.width,
    bottom: top + item.height,
  };
}

function calloutRectsOverlap(a, b) {
  const margin = 8;
  return a.left - margin < b.right
    && a.right + margin > b.left
    && a.top - margin < b.bottom
    && a.bottom + margin > b.top;
}

function calloutStemAnchor(left, top, width, height, targetX, targetY, radius = 8) {
  const right = left + width;
  const bottom = top + height;
  const midX = left + width / 2;
  const midY = top + height / 2;
  const curve = Math.max(0, Math.min(radius, width / 2, height / 2));
  const tuck = (2 * radius) / 8;
  const inset = curve * (1 - 1 / Math.SQRT2) + tuck / Math.SQRT2;
  const points = [
    [midX, bottom],
    [midX, top],
    [left, midY],
    [right, midY],
    [left + inset, top + inset],
    [right - inset, top + inset],
    [left + inset, bottom - inset],
    [right - inset, bottom - inset],
  ];
  let best = points[0];
  let bestDist = Infinity;
  for (const point of points) {
    const dist = Math.hypot(point[0] - targetX, point[1] - targetY);
    if (dist < bestDist) {
      best = point;
      bestDist = dist;
    }
  }
  return { x: best[0], y: best[1] };
}

function drawCalloutStem(stem, x, y) {
  const length = Math.hypot(x, y) || 1;
  const trim = 6;
  const endX = (x / length) * trim;
  const endY = (y / length) * trim;
  const pad = 6;
  const minX = Math.min(x, endX) - pad;
  const minY = Math.min(y, endY) - pad;
  const maxX = Math.max(x, endX) + pad;
  const maxY = Math.max(y, endY) + pad;
  stem.setAttribute('width', String(maxX - minX));
  stem.setAttribute('height', String(maxY - minY));
  stem.style.left = `${minX}px`;
  stem.style.top = `${minY}px`;
  stem.querySelectorAll('line').forEach((line) => {
    line.setAttribute('x1', String(x - minX));
    line.setAttribute('y1', String(y - minY));
    line.setAttribute('x2', String(endX - minX));
    line.setAttribute('y2', String(endY - minY));
  });
}

function layoutPlacedMarkers() {
  if (!placedMarkers.length) return;

  const items = placedMarkers.map((entry) => {
    const point = map.project(entry.coord);
    const box = calloutBox(entry.types.length);
    const placed = entry.userShift;
    return {
      ...entry,
      x: point.x,
      y: point.y,
      width: box.width,
      height: box.height,
      shiftX: placed ? placed.x : 0,
      shiftY: placed ? placed.y : 0,
      pinned: Boolean(placed),
    };
  });

  for (let pass = 0; pass < 24; pass += 1) {
    let moved = false;
    for (let i = 0; i < items.length; i += 1) {
      for (let j = i + 1; j < items.length; j += 1) {
        if (items[i].pinned && items[j].pinned) continue;
        const a = calloutRect(items[i]);
        const b = calloutRect(items[j]);
        if (!calloutRectsOverlap(a, b)) continue;
        const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const onePinned = items[i].pinned || items[j].pinned;
        const push = onePinned ? overlapX + 8 : overlapX / 2 + 4;
        const aCenter = (a.left + a.right) / 2;
        const bCenter = (b.left + b.right) / 2;
        const iDir = aCenter <= bCenter ? -1 : 1;
        if (!items[i].pinned) items[i].shiftX += iDir * push;
        if (!items[j].pinned) items[j].shiftX -= iDir * push;
        moved = true;
      }
    }
    if (!moved) break;
  }

  items.forEach((item) => {
    const left = -item.width / 2 + item.shiftX;
    const top = -STEM_GAP - item.height + item.shiftY;
    item.bubble.style.left = `${left}px`;
    item.bubble.style.top = `${top}px`;
    const anchor = calloutStemAnchor(left, top, item.width, item.height, 0, 0);
    drawCalloutStem(item.stem, anchor.x, anchor.y);
    item.marker.setOffset([0, 0]);
  });
}

function calloutShiftFromBubble(entry) {
  const box = calloutBox(entry.types.length);
  const left = parseFloat(entry.bubble.style.left) || 0;
  const top = parseFloat(entry.bubble.style.top) || 0;
  return {
    x: left + box.width / 2,
    y: top + STEM_GAP + box.height,
  };
}

function enableCalloutDrag(entry) {
  const bubble = entry.bubble;
  bubble.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.stopPropagation();

    const origin = {
      ...calloutShiftFromBubble(entry),
      clientX: event.clientX,
      clientY: event.clientY,
    };
    entry.userShift = { x: origin.x, y: origin.y };
    bubble.classList.add('dragging');
    try {
      bubble.setPointerCapture(event.pointerId);
    } catch (err) {
      // Pointer capture is unavailable for this event.
    }
    const dragWasEnabled = map.dragPan.isEnabled();
    if (dragWasEnabled) map.dragPan.disable();

    const onMove = (moveEvent) => {
      moveEvent.preventDefault();
      entry.userShift = {
        x: origin.x + (moveEvent.clientX - origin.clientX),
        y: origin.y + (moveEvent.clientY - origin.clientY),
      };
      layoutPlacedMarkers();
    };
    const onUp = (upEvent) => {
      bubble.classList.remove('dragging');
      if (bubble.hasPointerCapture(upEvent.pointerId)) {
        bubble.releasePointerCapture(upEvent.pointerId);
      }
      if (dragWasEnabled) map.dragPan.enable();
      bubble.removeEventListener('pointermove', onMove);
      bubble.removeEventListener('pointerup', onUp);
      bubble.removeEventListener('pointercancel', onUp);
    };
    bubble.addEventListener('pointermove', onMove);
    bubble.addEventListener('pointerup', onUp);
    bubble.addEventListener('pointercancel', onUp);
  });
}

function updateScaleBar() {
  const scaleText = document.getElementById('scale-ruler-text');
  const scaleSvg = document.querySelector('.scale-ruler-svg');
  if (!scaleText || !scaleSvg) return;

  const [leftTick, rightTick, middleTick, mainLine] = scaleSvg.querySelectorAll('line');
  if (!leftTick || !rightTick || !middleTick || !mainLine) return;

  const zoom = map.getZoom();
  const metersPerPixel = 40075017 / Math.pow(2, zoom + 8);

  // Pick a readable distance close to a target width (~130 px).
  const targetPixels = 130;
  const rawMeters = Math.max(1, targetPixels * metersPerPixel);
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawMeters)));
  const candidates = [1, 2, 5, 10].map((step) => step * magnitude);
  let chosenMeters = candidates.find((meters) => meters >= rawMeters) || (10 * magnitude);

  // In meter mode, force 50 m jumps.
  if (chosenMeters < 1000) {
    chosenMeters = Math.max(50, Math.ceil(chosenMeters / 50) * 50);
  }

  // Scale both SVG element width and line geometry.
  const rulerLinePixels = chosenMeters / metersPerPixel;
  const svgWidthPixels = Math.max(90, Math.min(260, Math.round(rulerLinePixels / 0.9)));
  scaleSvg.setAttribute('width', String(svgWidthPixels));

  const lineUnits = Math.max(30, Math.min(90, (rulerLinePixels / svgWidthPixels) * 100));
  const centerX = 50;
  const leftX = centerX - (lineUnits / 2);
  const rightX = centerX + (lineUnits / 2);

  // leftTick.setAttribute('x1', String(leftX));
  // leftTick.setAttribute('x2', String(leftX));
  // rightTick.setAttribute('x1', String(rightX));
  // rightTick.setAttribute('x2', String(rightX));
  // middleTick.setAttribute('x1', String(centerX));
  // middleTick.setAttribute('x2', String(centerX));
  // mainLine.setAttribute('x1', String(leftX));
  // mainLine.setAttribute('x2', String(rightX));

  if (chosenMeters < 1000) {
    scaleText.textContent = `${chosenMeters} m`;
  } else {
    const km = chosenMeters / 1000;
    const kmText = Number.isInteger(km) ? String(km) : km.toFixed(1);
    scaleText.textContent = `${kmText} km`;
  }
}

const styleBtn = document.getElementById('style-picker-btn');
const stylePanel = document.getElementById('style-panel');
const stageSelector = document.getElementById('stage-selector');
const trackWidthSelector = document.getElementById('track-width-selector');
const connectionModeSelector = document.getElementById('connection-mode-selector');
const arrowToggle = document.getElementById('arrow-toggle');
const arrowSpacingSlider = document.getElementById('arrow-spacing');
const arrowSpacingValue = document.getElementById('arrow-spacing-value');

styleBtn.addEventListener('click', (event) => {
  event.stopPropagation();
  styleBtn.classList.toggle('open');
  stylePanel.classList.toggle('open');
});

document.addEventListener('click', () => {
  styleBtn.classList.remove('open');
  stylePanel.classList.remove('open');
});

stylePanel.addEventListener('click', (event) => {
  event.stopPropagation();
  const opt = event.target.closest('.style-opt');
  if (!opt) return;

  stylePanel.querySelectorAll('.style-opt').forEach((el) => {
    el.classList.remove('active');
  });
  opt.classList.add('active');

  styleBtn.classList.remove('open');
  stylePanel.classList.remove('open');

  const key = opt.dataset.style;
  if (currentTrackBundle?.stages?.length || currentTrackData) {
    map.once('style.load', () => {
      if (currentTrackBundle?.stages?.length) {
        renderSelectedStage(currentStageIndex);
      } else if (currentTrackData) {
        renderTrack(currentTrackData);
      }
    });
  }

  if (key === 'TOPO.GREY') {
    map.setStyle(maptilersdk.MapStyle.TOPO, {
      transformStyle: (_previous, next) => greyTopoStyle(next),
    });
  } else {
    map.setStyle(mapStyleByKey(key));
  }
});

const GREY_COLOR_PROPS = [
  'background-color',
  'fill-color',
  'fill-outline-color',
  'line-color',
  'text-color',
  'text-halo-color',
  'icon-color',
  'icon-halo-color',
  'circle-color',
  'circle-stroke-color',
  'hillshade-shadow-color',
  'hillshade-highlight-color',
  'hillshade-accent-color',
];

const ROAD_OUTLINE = new Set(['Minor road outline', 'Major road outline', 'Highway outline', 'Tunnel outline']);
const STREET_OUTLINE = '#8a8a8a';
const ROAD_FILL = new Set(['Minor road', 'Major road', 'Highway', 'Tunnel', 'Pier road']);
const ROAD_PATH = new Set(['Path', 'Path minor', 'Tunnel path']);

function greyColor(value) {
  if (typeof value !== 'string') return value;
  const hsl = value.trim().match(/^hsla?\(\s*[\d.]+\s*,\s*[\d.]+%\s*,\s*([\d.]+)%/i);
  if (hsl) return `hsl(0, 0%, ${hsl[1]}%)`;
  const hex = value.trim().match(/^#([0-9a-f]{6})$/i);
  if (!hex) return value;
  const n = parseInt(hex[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const lightness = Math.round((0.2126 * r + 0.7152 * g + 0.0722 * b) / 2.55);
  return `hsl(0, 0%, ${lightness}%)`;
}

function mapExprOutputs(expr, fn) {
  if (typeof expr !== 'object' || expr === null) return fn(expr);
  if (!Array.isArray(expr)) return expr;
  const op = expr[0];
  if (op === 'interpolate') {
    const next = expr.slice(0, 3);
    for (let i = 3; i < expr.length; i += 2) {
      next.push(expr[i], mapExprOutputs(expr[i + 1], fn));
    }
    return next;
  }
  if (op === 'step') {
    const next = [expr[0], expr[1], mapExprOutputs(expr[2], fn)];
    for (let i = 3; i < expr.length; i += 2) {
      next.push(expr[i], mapExprOutputs(expr[i + 1], fn));
    }
    return next;
  }
  if (op === 'match') {
    const next = [expr[0], expr[1]];
    for (let i = 2; i < expr.length - 1; i += 2) {
      next.push(expr[i], mapExprOutputs(expr[i + 1], fn));
    }
    next.push(mapExprOutputs(expr[expr.length - 1], fn));
    return next;
  }
  if (op === 'case') {
    const next = [expr[0]];
    for (let i = 1; i < expr.length - 1; i += 2) {
      next.push(expr[i], mapExprOutputs(expr[i + 1], fn));
    }
    next.push(mapExprOutputs(expr[expr.length - 1], fn));
    return next;
  }
  return expr;
}

function greyExpr(expr) {
  if (expr && typeof expr === 'object' && !Array.isArray(expr) && Array.isArray(expr.stops)) {
    return {
      ...expr,
      stops: expr.stops.map((stop) => [
        stop[0],
        typeof stop[1] === 'string' ? greyColor(stop[1]) : greyExpr(stop[1]),
      ]),
    };
  }
  return mapExprOutputs(expr, (value) => (typeof value === 'string' ? greyColor(value) : value));
}

function scaleWidth(expr, factor) {
  return mapExprOutputs(expr, (value) => (typeof value === 'number' ? value * factor : value));
}

function lightenGrey(value, amount) {
  const hsl = String(value).trim().match(/^hsl\(\s*0\s*,\s*0%\s*,\s*([\d.]+)%\s*\)$/i);
  if (!hsl) return value;
  const lightness = Number(hsl[1]);
  const next = Math.min(97, Math.round(lightness + (100 - lightness) * amount));
  return `hsl(0, 0%, ${next}%)`;
}

function lightenExpr(expr, amount) {
  if (expr && typeof expr === 'object' && !Array.isArray(expr) && Array.isArray(expr.stops)) {
    return {
      ...expr,
      stops: expr.stops.map((stop) => [
        stop[0],
        typeof stop[1] === 'string' ? lightenGrey(stop[1], amount) : lightenExpr(stop[1], amount),
      ]),
    };
  }
  return mapExprOutputs(expr, (value) => (typeof value === 'string' ? lightenGrey(value, amount) : value));
}

const PLACE_LABELS = new Set(['Place labels', 'Village labels', 'Town labels', 'City labels']);

function withoutParkingAisles(filter) {
  const clause = ['!=', 'service', 'parking_aisle'];
  if (!filter) return clause;
  if (filter[0] === 'all') return ['all', ...filter.slice(1), clause];
  return ['all', filter, clause];
}

function greyTopoStyle(style) {
  const layers = (style.layers || []).map((layer) => {
      const paint = layer.paint ? { ...layer.paint } : undefined;
      const layout = layer.layout ? { ...layer.layout } : undefined;
      if (paint) {
        for (const prop of GREY_COLOR_PROPS) {
          if (prop in paint) paint[prop] = greyExpr(paint[prop]);
        }
        if (paint['fill-color'] != null || paint['background-color'] != null) {
          if (paint['fill-color'] != null) paint['fill-color'] = lightenExpr(paint['fill-color'], 0.62);
          if (paint['background-color'] != null) paint['background-color'] = lightenExpr(paint['background-color'], 0.62);
        }
      }
      if (paint && ROAD_OUTLINE.has(layer.id)) {
        paint['line-color'] = STREET_OUTLINE;
        if (paint['line-width'] != null) paint['line-width'] = scaleWidth(paint['line-width'], 1.4);
      }
      if (paint && ROAD_FILL.has(layer.id)) {
        paint['line-color'] = '#ffffff';
        if (paint['line-width'] != null) paint['line-width'] = scaleWidth(paint['line-width'], 1.2);
      }
      if (paint && ROAD_PATH.has(layer.id)) {
        paint['line-color'] = '#2c2c2c';
        if (paint['line-width'] != null) paint['line-width'] = scaleWidth(paint['line-width'], 1.7);
      }
      if (layer.id === 'Hillshade' && paint) {
        paint['hillshade-exaggeration'] = 0.18;
        paint['hillshade-shadow-color'] = 'hsl(0, 0%, 78%)';
        paint['hillshade-highlight-color'] = 'hsl(0, 0%, 100%)';
      }
      if (layer.type === 'line' && /contour/i.test(layer.id) && paint) {
        paint['line-color'] = /index/i.test(layer.id) ? 'hsl(0, 0%, 62%)' : 'hsl(0, 0%, 74%)';
      }
      if (PLACE_LABELS.has(layer.id)) {
        if (layout && layout['text-size'] != null) layout['text-size'] = scaleWidth(layout['text-size'], 1.55);
        if (paint) paint['text-color'] = '#000000';
      }
      const hideParking = layer['source-layer'] === 'transportation' || layer['source-layer'] === 'transportation_name';
      const next = { ...layer };
      if (hideParking) next.filter = withoutParkingAisles(layer.filter);
      if (paint) next.paint = paint;
      if (layout) next.layout = layout;
      return next;
    });
  const majorIndex = layers.findIndex((layer) => layer.id === 'Major road');
  const major = layers[majorIndex];
  if (major) {
    layers.splice(majorIndex, 0, {
      id: 'Secondary road outline',
      type: 'line',
      source: major.source,
      'source-layer': major['source-layer'],
      minzoom: 8,
      filter: ['all', ['!=', 'brunnel', 'tunnel'], ['==', 'class', 'secondary'], ['!=', 'service', 'parking_aisle']],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': STREET_OUTLINE,
        'line-width': [
          'interpolate', ['linear', 2], ['zoom'],
          8, 0,
          10, 2.4,
          12, 3.2,
          14, 6.4,
          16, 6.8,
          20, 32,
        ],
      },
    });
  }
  return { ...style, layers };
}

function mapStyleByKey(key) {
  const [name, variant] = String(key || '').split('.');
  const style = maptilersdk.MapStyle[name];
  if (variant && style && typeof style.getVariant === 'function') {
    return style.getVariant(variant);
  }
  return style;
}

stageSelector.addEventListener('change', (event) => {
  renderSelectedStage(Number(event.target.value));
});

trackWidthSelector.addEventListener('change', (event) => {
  trackWidthFactor = Number(event.target.value) || 1;
  applyTrackWidths();
});

document.getElementById('icon-size-selector').addEventListener('change', (event) => {
  iconSize = Number(event.target.value) || 40;
  applyIconSize();
});

connectionModeSelector.addEventListener('change', (event) => {
  const value = event.target.value;
  connectionMode = (value === 'all' || value === 'tc-dss' || value === 'ass-stop' || value === 'dss-ass-stop') ? value : 'normal';
  if (currentTrackBundle?.stages?.length) {
    renderSelectedStage(currentStageIndex);
  } else if (currentTrackData) {
    renderTrack(currentTrackData);
  }
});

arrowToggle.addEventListener('change', (event) => {
  arrowsVisible = event.target.checked;
  applyArrowSettings();
});

arrowSpacingSlider.addEventListener('input', (event) => {
  arrowSpacing = Number(event.target.value) || 50;
  arrowSpacingValue.textContent = String(arrowSpacing);
  applyArrowSettings();
});

document.getElementById('ctrl-toggle').addEventListener('click', () => {
  const wrapper = document.getElementById('map-wrapper');
  const btn = document.getElementById('ctrl-toggle');
  wrapper.classList.toggle('controls-hidden');
  btn.classList.toggle('hidden-state');
  btn.title = wrapper.classList.contains('controls-hidden') ? 'Show map controls' : 'Hide map controls';
});

document.getElementById('btn-a5').addEventListener('click', () => {
  const wrapper = document.getElementById('map-wrapper');
  const btn = document.getElementById('btn-a5');
  wrapper.classList.toggle('a5-mode');
  document.body.classList.toggle('a5-active');
  btn.classList.toggle('active');
  btn.title = wrapper.classList.contains('a5-mode') ? 'Tamanho normal' : 'Formato A5';
  setTimeout(() => {
    map.resize();
    syncLegendOffset();
  }, 50);
});

window.addEventListener('resize', syncLegendOffset);

function canvasBox(rect, mapRect, dpr) {
  return {
    x: (rect.left - mapRect.left) * dpr,
    y: (rect.top - mapRect.top) * dpr,
    w: rect.width * dpr,
    h: rect.height * dpr,
  };
}

function drawRoundRect(ctx, x, y, w, h, radius) {
  const r = Math.min(radius, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawCalloutsOnCanvas(ctx, dpr) {
  if (!placedMarkers.length) return;
  const mapRect = map.getCanvas().getBoundingClientRect();

  placedMarkers.forEach((entry) => {
    const bubble = entry.bubble;
    const dot = bubble.parentElement.querySelector('.track-callout-dot');
    if (!dot) return;
    const box = canvasBox(bubble.getBoundingClientRect(), mapRect, dpr);
    const dotBox = canvasBox(dot.getBoundingClientRect(), mapRect, dpr);
    const dotX = dotBox.x + dotBox.w / 2;
    const dotY = dotBox.y + dotBox.h / 2;
    const anchor = calloutStemAnchor(box.x, box.y, box.w, box.h, dotX, dotY, 8 * dpr);
    const stemX = anchor.x;
    const stemY = anchor.y;
    const dx = dotX - stemX;
    const dy = dotY - stemY;
    const length = Math.hypot(dx, dy) || 1;
    const trim = 6 * dpr;
    const endX = dotX - (dx / length) * trim;
    const endY = dotY - (dy / length) * trim;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(stemX, stemY);
    ctx.lineTo(endX, endY);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 4.5 * dpr;
    ctx.stroke();
    ctx.strokeStyle = '#1a1a2e';
    ctx.lineWidth = 2 * dpr;
    ctx.stroke();
    ctx.restore();

    ctx.save();
    drawRoundRect(ctx, box.x, box.y, box.w, box.h, 8 * dpr);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.82)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(26, 26, 46, 0.72)';
    ctx.lineWidth = dpr;
    ctx.stroke();
    ctx.restore();

    bubble.querySelectorAll('img').forEach((img) => {
      if (!img.complete || !img.naturalWidth) return;
      const imgBox = canvasBox(img.getBoundingClientRect(), mapRect, dpr);
      ctx.drawImage(img, imgBox.x, imgBox.y, imgBox.w, imgBox.h);
    });

    ctx.save();
    ctx.beginPath();
    ctx.arc(dotX, dotY, 4.5 * dpr, 0, Math.PI * 2);
    ctx.fillStyle = '#e94560';
    ctx.fill();
    ctx.lineWidth = 2 * dpr;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.restore();
  });
}

function loadImg(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function drawLegendOnCanvas(ctx, dpr, width, height) {
  const items = [...document.querySelectorAll('#legend [data-legend]')].filter((item) => !item.hidden);
  const entries = await Promise.all(items.map(async (item) => {
    const label = item.querySelector('span')?.textContent || '';
    const imgEl = item.querySelector('img');
    if (imgEl) {
      return { kind: 'img', img: await loadImg(imgEl.getAttribute('src')), label };
    }
    const line = item.querySelector('.legend-line');
    return { kind: 'line', color: line ? getComputedStyle(line).backgroundColor : '#e94560', label };
  }));
  if (!entries.length) return;

  const cssW = width / dpr;
  const cssH = height / dpr;
  const padX = 12;
  const padY = 6;
  const iconSize = 22;
  const textGap = 6;
  const rowHeight = 28;
  const colGap = 14;
  const minCol = 140;

  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.font = 'bold 11px "Segoe UI", sans-serif';
  const title = 'LEGENDA';
  const titleBlock = ctx.measureText(title).width + 16;
  const gridW = Math.max(minCol, cssW - padX * 2 - titleBlock);
  ctx.font = '14px "Segoe UI", sans-serif';

  const cols = Math.max(1, Math.floor((gridW + colGap) / (minCol + colGap)));
  const colW = (gridW - colGap * (cols - 1)) / cols;
  const rowCount = Math.ceil(entries.length / cols);

  const legendHeight = padY * 2 + rowCount * rowHeight;
  const legendY = cssH - legendHeight;

  ctx.fillStyle = 'rgba(22,33,62,0.88)';
  ctx.fillRect(0, legendY, cssW, legendHeight);
  ctx.strokeStyle = '#0f3460';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, legendY + 0.65);
  ctx.lineTo(cssW, legendY + 0.65);
  ctx.stroke();

  ctx.fillStyle = '#aaaaaa';
  ctx.font = 'bold 11px "Segoe UI", sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(title, padX, legendY + legendHeight / 2);

  entries.forEach((entry, index) => {
    const col = index % cols;
    const rowIndex = Math.floor(index / cols);
    const x = padX + titleBlock + col * (colW + colGap);
    const y = legendY + padY + rowIndex * rowHeight + (rowHeight - iconSize) / 2;
    if (entry.kind === 'img') {
      if (entry.img) ctx.drawImage(entry.img, x, y, iconSize, iconSize);
    } else {
      ctx.save();
      ctx.strokeStyle = entry.color;
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x, y + iconSize / 2);
      ctx.lineTo(x + iconSize, y + iconSize / 2);
      ctx.stroke();
      ctx.restore();
    }
    ctx.fillStyle = '#eeeeee';
    ctx.font = '14px "Segoe UI", sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(entry.label, x + iconSize + textGap, y + iconSize / 2);
  });

  ctx.restore();
}

const PRINT_DPI = 300;
const MAX_PRINT_EDGE = 8192;

function printPixelRatio() {
  const container = map.getContainer();
  const cssW = container.clientWidth;
  const cssH = container.clientHeight;
  const current = map.getPixelRatio();
  if (!cssW || !cssH) return current;

  const a5 = document.getElementById('map-wrapper').classList.contains('a5-mode');
  const pageW = a5 ? 148 : 297;
  const pageH = a5 ? 210 : 210;
  const mapAspect = cssW / cssH;
  const pageAspect = pageW / pageH;
  const widthMm = mapAspect > pageAspect ? pageW : pageH * mapAspect;
  let targetW = Math.round((widthMm / 25.4) * PRINT_DPI);
  let targetH = Math.round(targetW / mapAspect);
  const edge = Math.max(targetW, targetH);
  if (edge > MAX_PRINT_EDGE) {
    const scale = MAX_PRINT_EDGE / edge;
    targetW = Math.round(targetW * scale);
  }
  return Math.max(targetW / cssW, current);
}

function waitForMapIdle(timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    map.once('idle', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

document.getElementById('btn-screenshot').addEventListener('click', async () => {
  const ctrl = document.querySelector('.maplibregl-control-container');
  if (ctrl) ctrl.style.visibility = 'hidden';

  const previousRatio = map.getPixelRatio();
  const printRatio = printPixelRatio();

  try {
    if (printRatio > previousRatio + 0.01) {
      const idle = waitForMapIdle(12000);
      map.setPixelRatio(printRatio);
      await idle;
    }

    await new Promise((resolve) => {
      map.once('render', resolve);
      map.triggerRepaint();
    });

    const mapCanvas = map.getCanvas();
    const width = mapCanvas.width;
    const height = mapCanvas.height;
    const dpr = width / map.getContainer().clientWidth;

    const out = document.createElement('canvas');
    out.width = width;
    out.height = height;
    const ctx = out.getContext('2d');

    ctx.drawImage(mapCanvas, 0, 0);
    drawCalloutsOnCanvas(ctx, dpr);

    const legend = document.getElementById('legend');
    if (!legend.hidden) {
      await drawLegendOnCanvas(ctx, dpr, width, height);
    }

    const blob = await new Promise((resolve) => out.toBlob(resolve, 'image/png'));
    if (!blob) {
      showToast('Failed to generate screenshot.');
      return;
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${currentTrackData ? currentTrackData.name : 'ralimap'}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast(`Imagem para impressão: ${width}×${height} px (${PRINT_DPI} dpi)`);
  } catch (err) {
    showToast('Screenshot export failed: ' + err.message);
  } finally {
    if (ctrl) ctrl.style.visibility = '';
    if (map.getPixelRatio() !== previousRatio) {
      map.setPixelRatio(previousRatio);
    }
  }
});