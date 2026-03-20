/**
 * Generate timezone boundary line data by sampling the world using geo-tz.
 * Detects timezone transitions between adjacent grid cells and outputs
 * boundary segments as compact JSON.
 */
const { find } = require('geo-tz');
const fs = require('fs');
const path = require('path');

const STEP = 0.5; // degrees per grid cell
const LAT_MIN = -60, LAT_MAX = 72; // skip deep antarctic/arctic
const LNG_MIN = -180, LNG_MAX = 180;

const latSteps = Math.ceil((LAT_MAX - LAT_MIN) / STEP);
const lngSteps = Math.ceil((LNG_MAX - LNG_MIN) / STEP);

console.log(`Grid: ${lngSteps} x ${latSteps} = ${lngSteps * latSteps} cells`);
console.log('Sampling timezones...');

// Build grid of timezone names
const grid = new Array(latSteps);
for (let y = 0; y < latSteps; y++) {
  grid[y] = new Array(lngSteps);
  const lat = LAT_MIN + (y + 0.5) * STEP;
  for (let x = 0; x < lngSteps; x++) {
    const lng = LNG_MIN + (x + 0.5) * STEP;
    const tzs = find(lat, lng);
    grid[y][x] = tzs[0] || 'Etc/UTC';
  }
  if (y % 20 === 0) process.stdout.write(`  row ${y}/${latSteps}\r`);
}
console.log('\nGrid complete. Detecting boundaries...');

// Detect horizontal and vertical transitions
// Store boundary segments as: [lat1, lng1, lat2, lng2]
const segments = [];

for (let y = 0; y < latSteps; y++) {
  const lat = LAT_MIN + y * STEP;
  for (let x = 0; x < lngSteps; x++) {
    const lng = LNG_MIN + x * STEP;
    const tz = grid[y][x];

    // Check right neighbor (vertical boundary line)
    if (x + 1 < lngSteps && grid[y][x + 1] !== tz) {
      const bLng = lng + STEP; // boundary is at right edge of this cell
      segments.push([lat, bLng, lat + STEP, bLng]);
    }
    // Check bottom neighbor (horizontal boundary line)
    if (y + 1 < latSteps && grid[y + 1][x] !== tz) {
      const bLat = lat + STEP; // boundary is at bottom edge
      segments.push([bLat, lng, bLat, lng + STEP]);
    }
  }
}

console.log(`Found ${segments.length} boundary segments`);

// Merge colinear adjacent segments into polylines
// Group vertical segments by longitude, horizontal by latitude
console.log('Merging into polylines...');

// Round to avoid float issues
const round = (v) => Math.round(v * 100) / 100;

// Group vertical segments (same lng, merge lat ranges)
const verticalByLng = {};
const horizontalByLat = {};

for (const [lat1, lng1, lat2, lng2] of segments) {
  if (lng1 === lng2) {
    // Vertical segment
    const key = round(lng1);
    if (!verticalByLng[key]) verticalByLng[key] = [];
    verticalByLng[key].push([round(Math.min(lat1, lat2)), round(Math.max(lat1, lat2))]);
  } else {
    // Horizontal segment
    const key = round(lat1);
    if (!horizontalByLat[key]) horizontalByLat[key] = [];
    horizontalByLat[key].push([round(Math.min(lng1, lng2)), round(Math.max(lng1, lng2))]);
  }
}

// Merge consecutive ranges
function mergeRanges(ranges) {
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [ranges[0]];
  for (let i = 1; i < ranges.length; i++) {
    const prev = merged[merged.length - 1];
    if (Math.abs(ranges[i][0] - prev[1]) < 0.01) {
      prev[1] = ranges[i][1]; // extend
    } else {
      merged.push(ranges[i]);
    }
  }
  return merged;
}

// Build polylines: array of [lng, lat] coordinate arrays
const polylines = [];

for (const [lngStr, ranges] of Object.entries(verticalByLng)) {
  const lng = parseFloat(lngStr);
  const merged = mergeRanges(ranges);
  for (const [latMin, latMax] of merged) {
    polylines.push([[lng, latMin], [lng, latMax]]);
  }
}

for (const [latStr, ranges] of Object.entries(horizontalByLat)) {
  const lat = parseFloat(latStr);
  const merged = mergeRanges(ranges);
  for (const [lngMin, lngMax] of merged) {
    polylines.push([[lngMin, lat], [lngMax, lat]]);
  }
}

console.log(`Merged into ${polylines.length} polylines`);

// Convert to compact format: array of arrays of [lng, lat]
// Reduce precision to 1 decimal place to save space
const compact = polylines.map(line =>
  line.map(([lng, lat]) => [Math.round(lng * 10) / 10, Math.round(lat * 10) / 10])
);

const outPath = path.join(__dirname, '..', 'client', 'src', 'data', 'tz-boundaries.json');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(compact));
const sizeKB = Math.round(fs.statSync(outPath).size / 1024);
console.log(`Written to ${outPath} (${sizeKB} KB)`);
