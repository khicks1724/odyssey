import { useRef, useEffect, useState, useCallback } from 'react';
import { Locate } from 'lucide-react';
import { feature } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import worldTopo from 'world-atlas/countries-110m.json';
import { useTheme } from '../lib/theme';
import { TIMEZONE_GROUPS } from '../lib/time-format';
import tzBoundaries from '../data/tz-boundaries.json';

/* ── Types ────────────────────────────────────────────────────────────────── */

type Coord = [number, number]; // [lng, lat]
type Ring = Coord[];

interface CountryFeature {
  rings: Ring[];
}

/* ── Parse world data once ────────────────────────────────────────────────── */

const parsedCountries: CountryFeature[] = (() => {
  const topo = worldTopo as unknown as Topology<{ countries: GeometryCollection }>;
  const geo = feature(topo, topo.objects.countries);
  const out: CountryFeature[] = [];

  for (const f of geo.features) {
    const rings: Ring[] = [];
    if (f.geometry.type === 'Polygon') {
      for (const ring of f.geometry.coordinates) rings.push(ring as Ring);
    } else if (f.geometry.type === 'MultiPolygon') {
      for (const poly of f.geometry.coordinates)
        for (const ring of poly) rings.push(ring as Ring);
    }
    if (rings.length) out.push({ rings });
  }
  return out;
})();

/* ── Timezone helpers ─────────────────────────────────────────────────────── */

function getTimezoneOffset(tz: string): number {
  try {
    const now = new Date();
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' });
    const parts = fmt.formatToParts(now);
    const tzPart = parts.find((p) => p.type === 'timeZoneName');
    if (!tzPart) return 0;
    const m = tzPart.value.match(/GMT([+-]?)(\d+)(?::(\d+))?/);
    if (!m) return 0;
    const sign = m[1] === '-' ? -1 : 1;
    return sign * (parseInt(m[2], 10) + (m[3] ? parseInt(m[3], 10) / 60 : 0));
  } catch { return 0; }
}

// Major city coordinates [lat, lng]
const CITY_COORDS: Record<string, [number, number]> = {
  'America/New_York': [40.71, -74.01], 'America/Chicago': [41.88, -87.63],
  'America/Denver': [39.74, -104.99], 'America/Los_Angeles': [34.05, -118.24],
  'America/Anchorage': [61.22, -149.90], 'Pacific/Honolulu': [21.31, -157.86],
  'America/Phoenix': [33.45, -112.07], 'America/Toronto': [43.65, -79.38],
  'America/Vancouver': [49.28, -123.12], 'America/Mexico_City': [19.43, -99.13],
  'America/Bogota': [4.71, -74.07], 'America/Lima': [-12.05, -77.04],
  'America/Santiago': [-33.45, -70.67], 'America/Sao_Paulo': [-23.55, -46.63],
  'America/Argentina/Buenos_Aires': [-34.60, -58.38],
  'Europe/London': [51.51, -0.13], 'Europe/Paris': [48.86, 2.35],
  'Europe/Berlin': [52.52, 13.41], 'Europe/Madrid': [40.42, -3.70],
  'Europe/Rome': [41.90, 12.50], 'Europe/Moscow': [55.76, 37.62],
  'Europe/Istanbul': [41.01, 28.98], 'Europe/Athens': [37.98, 23.73],
  'Europe/Amsterdam': [52.37, 4.90], 'Europe/Stockholm': [59.33, 18.07],
  'Europe/Helsinki': [60.17, 24.94], 'Europe/Warsaw': [52.23, 21.01],
  'Europe/Zurich': [47.38, 8.54], 'Europe/Vienna': [48.21, 16.37],
  'Europe/Prague': [50.08, 14.44], 'Europe/Dublin': [53.35, -6.26],
  'Europe/Lisbon': [38.72, -9.14], 'Europe/Oslo': [59.91, 10.75],
  'Europe/Copenhagen': [55.68, 12.57], 'Europe/Brussels': [50.85, 4.35],
  'Europe/Bucharest': [44.43, 26.10], 'Europe/Budapest': [47.50, 19.04],
  'Europe/Kiev': [50.45, 30.52], 'Europe/Kyiv': [50.45, 30.52],
  'Asia/Tokyo': [35.68, 139.69], 'Asia/Shanghai': [31.23, 121.47],
  'Asia/Hong_Kong': [22.32, 114.17], 'Asia/Singapore': [1.35, 103.82],
  'Asia/Seoul': [37.57, 126.98], 'Asia/Taipei': [25.03, 121.57],
  'Asia/Bangkok': [13.76, 100.50], 'Asia/Jakarta': [-6.21, 106.85],
  'Asia/Manila': [14.60, 120.98], 'Asia/Kolkata': [22.57, 88.36],
  'Asia/Calcutta': [22.57, 88.36], 'Asia/Mumbai': [19.08, 72.88],
  'Asia/Dubai': [25.20, 55.27], 'Asia/Karachi': [24.86, 67.01],
  'Asia/Dhaka': [23.81, 90.41], 'Asia/Colombo': [6.93, 79.84],
  'Asia/Riyadh': [24.69, 46.72], 'Asia/Tehran': [35.69, 51.39],
  'Asia/Baghdad': [33.31, 44.37], 'Asia/Almaty': [43.24, 76.95],
  'Asia/Tashkent': [41.30, 69.28], 'Asia/Vladivostok': [43.12, 131.87],
  'Asia/Novosibirsk': [55.01, 82.93], 'Asia/Yekaterinburg': [56.84, 60.61],
  'Africa/Cairo': [30.04, 31.24], 'Africa/Lagos': [6.52, 3.38],
  'Africa/Johannesburg': [-26.20, 28.04], 'Africa/Nairobi': [-1.29, 36.82],
  'Africa/Casablanca': [33.57, -7.59], 'Africa/Addis_Ababa': [9.02, 38.75],
  'Africa/Accra': [5.56, -0.19], 'Africa/Dar_es_Salaam': [-6.79, 39.28],
  'Australia/Sydney': [-33.87, 151.21], 'Australia/Melbourne': [-37.81, 144.96],
  'Australia/Brisbane': [-27.47, 153.03], 'Australia/Perth': [-31.95, 115.86],
  'Australia/Adelaide': [-34.93, 138.60], 'Australia/Darwin': [-12.46, 130.84],
  'Pacific/Auckland': [-36.85, 174.77], 'Pacific/Fiji': [-18.14, 178.44],
  'Indian/Maldives': [4.18, 73.51], 'Indian/Mauritius': [-20.16, 57.50],
  'Atlantic/Reykjavik': [64.15, -21.94],
};

function tzToLatLng(tz: string): [number, number] {
  if (CITY_COORDS[tz]) return CITY_COORDS[tz];
  const offset = getTimezoneOffset(tz);
  const lng = offset * 15;
  const region = tz.split('/')[0];
  const latMap: Record<string, number> = {
    America: 20, Europe: 50, Asia: 35, Africa: 5, Australia: -25,
    Pacific: -10, Indian: -5, Atlantic: 30, Antarctica: -80, Arctic: 80,
  };
  return [latMap[region] ?? 30, lng];
}

/* ── Mercator helpers ─────────────────────────────────────────────────────── */

function mercatorY(latDeg: number): number {
  const latRad = (Math.max(-85, Math.min(85, latDeg)) * Math.PI) / 180;
  return Math.log(Math.tan(Math.PI / 4 + latRad / 2));
}

/* ── Component ────────────────────────────────────────────────────────────── */

interface TimezoneGlobeProps {
  value: string;
  onChange: (tz: string) => void;
}

export default function TimezoneGlobe({ value, onChange }: TimezoneGlobeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { theme } = useTheme();

  // View: center (lng, lat degrees) and zoom multiplier
  const viewRef = useRef({ cx: 0, cy: 20, zoom: 1.8 });
  const dragRef = useRef<{ active: boolean; lastX: number; lastY: number; moved: boolean }>({
    active: false, lastX: 0, lastY: 0, moved: false,
  });
  const animRef = useRef(0);

  const [selectedTz, setSelectedTz] = useState(value);
  const [hoveredTz, setHoveredTz] = useState<string | null>(null);
  const selectedRef = useRef(value);
  const hoveredRef = useRef<string | null>(null);

  const allTimezones = useRef(
    TIMEZONE_GROUPS.flatMap(({ zones }) => zones.map((z) => ({ tz: z, coords: tzToLatLng(z) })))
  );

  // Center on the selected timezone
  useEffect(() => {
    selectedRef.current = value;
    setSelectedTz(value);
    const [lat, lng] = tzToLatLng(value);
    viewRef.current.cx = lng;
    viewRef.current.cy = lat;
  }, [value]);

  /* ── Projection: geo → canvas ───────────────────────────────────────────── */

  const toCanvas = useCallback((lat: number, lng: number, w: number, h: number): [number, number] => {
    const { cx, cy, zoom } = viewRef.current;
    const scale = (w / 360) * zoom;
    const px = w / 2 + (lng - cx) * scale;
    const my = mercatorY(lat);
    const myCtr = mercatorY(cy);
    const py = h / 2 - (my - myCtr) * scale * (180 / Math.PI);
    return [px, py];
  }, []);

  const fromCanvas = useCallback((px: number, py: number, w: number, h: number): [number, number] | null => {
    const { cx, cy, zoom } = viewRef.current;
    const scale = (w / 360) * zoom;
    const lng = cx + (px - w / 2) / scale;
    const myCtr = mercatorY(cy);
    const my = myCtr + (h / 2 - py) / (scale * (180 / Math.PI));
    const lat = (2 * Math.atan(Math.exp(my)) - Math.PI / 2) * (180 / Math.PI);
    if (lat < -85 || lat > 85) return null;
    return [lat, lng];
  }, []);

  /* ── Render ─────────────────────────────────────────────────────────────── */

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const c = theme.colors;

    // Ocean background
    ctx.fillStyle = c.surface2;
    ctx.fillRect(0, 0, w, h);

    // Compute how many horizontal copies we need to fill the canvas
    const { zoom } = viewRef.current;
    const worldPx = w * zoom; // width of 360° in pixels
    const copies = Math.ceil(w / worldPx) + 2;

    /* ── helper: project with lng offset for wrapping ──────────────────── */
    const toC = (lat: number, lng: number, off: number): [number, number] => toCanvas(lat, lng + off, w, h);

    /* ── Countries ─────────────────────────────────────────────────────── */

    ctx.fillStyle = c.bg;
    ctx.strokeStyle = c.border;
    ctx.lineWidth = 0.5;

    for (let copy = -copies; copy <= copies; copy++) {
      const lngOff = copy * 360;
      for (const country of parsedCountries) {
        for (const ring of country.rings) {
          ctx.beginPath();
          let prevLng: number | null = null;
          let first = true;
          for (const [lng, lat] of ring) {
            // Break path at antimeridian crossings to avoid lines across the map
            const jump = prevLng !== null && Math.abs(lng - prevLng) > 180;
            const [px, py] = toC(lat, lng, lngOff);
            if (first || jump) { ctx.moveTo(px, py); first = false; }
            else ctx.lineTo(px, py);
            prevLng = lng;
          }
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
      }
    }

    /* ── Timezone boundaries (real data) ───────────────────────────────── */

    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 0.7;
    ctx.strokeStyle = c.accent + '40';

    for (let copy = -copies; copy <= copies; copy++) {
      const lngOff = copy * 360;
      for (const seg of tzBoundaries) {
        const [p0, p1] = seg as [[number, number], [number, number]];
        const [x1, y1] = toC(p0[1], p0[0], lngOff);
        const [x2, y2] = toC(p1[1], p1[0], lngOff);
        // Skip if completely off-screen
        if ((x1 < -5 && x2 < -5) || (x1 > w + 5 && x2 > w + 5)) continue;
        if ((y1 < -5 && y2 < -5) || (y1 > h + 5 && y2 > h + 5)) continue;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);

    /* ── UTC offset labels along top ───────────────────────────────────── */

    ctx.font = '600 8px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let copy = -copies; copy <= copies; copy++) {
      const lngOff = copy * 360;
      for (let i = -12; i <= 12; i++) {
        const lng = i * 15;
        const [px] = toC(85, lng, lngOff);
        if (px < -30 || px > w + 30) continue;
        const label = i === 0 ? 'UTC' : `${i > 0 ? '+' : ''}${i}`;
        const tw = ctx.measureText(label).width + 6;
        ctx.fillStyle = c.bg + 'CC';
        ctx.fillRect(px - tw / 2, 4, tw, 13);
        ctx.fillStyle = c.muted + 'B0';
        ctx.fillText(label, px, 5);
      }
    }
    ctx.textBaseline = 'alphabetic';

    /* ── City dots ─────────────────────────────────────────────────────── */

    const curSel = selectedRef.current;
    const curHov = hoveredRef.current;

    for (let copy = -copies; copy <= copies; copy++) {
      const lngOff = copy * 360;
      for (const { tz, coords } of allTimezones.current) {
        if (!CITY_COORDS[tz]) continue;
        const [lat, lng] = coords;
        const [px, py] = toC(lat, lng, lngOff);
        if (px < -10 || px > w + 10 || py < -10 || py > h + 10) continue;

        const isSel = tz === curSel;
        const isHov = tz === curHov;

        if (isSel) {
          ctx.beginPath();
          ctx.arc(px, py, 7, 0, Math.PI * 2);
          ctx.fillStyle = c.accent + '28';
          ctx.fill();
          ctx.beginPath();
          ctx.arc(px, py, 4.5, 0, Math.PI * 2);
          ctx.fillStyle = c.accent;
          ctx.fill();
          ctx.strokeStyle = c.heading;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        } else if (isHov) {
          ctx.beginPath();
          ctx.arc(px, py, 4, 0, Math.PI * 2);
          ctx.fillStyle = c.accent + 'B0';
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.arc(px, py, 2, 0, Math.PI * 2);
          ctx.fillStyle = c.muted + '80';
          ctx.fill();
        }
      }
    }

    /* ── Selected label ────────────────────────────────────────────────── */

    if (curSel) {
      const [lat, lng] = tzToLatLng(curSel);
      const [sx, sy] = toCanvas(lat, lng, w, h);
      if (sx > -50 && sx < w + 50 && sy > -50 && sy < h + 50) {
        const label = curSel.replace(/_/g, ' ');
        ctx.font = '600 10px ui-monospace, monospace';
        const tm = ctx.measureText(label);
        const lx = Math.min(sx + 12, w - tm.width - 12);
        const ly = sy - 12;
        const pad = 4;
        ctx.fillStyle = c.surface + 'EB';
        ctx.strokeStyle = c.border;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(lx - pad, ly - 10 - pad, tm.width + pad * 2, 14 + pad * 2, 3);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = c.accent;
        ctx.textAlign = 'left';
        ctx.fillText(label, lx, ly);
      }
    }

    /* ── Hovered label ─────────────────────────────────────────────────── */

    if (curHov && curHov !== curSel) {
      const [lat, lng] = tzToLatLng(curHov);
      const [hx, hy] = toCanvas(lat, lng, w, h);
      if (hx > -50 && hx < w + 50 && hy > -50 && hy < h + 50) {
        const label = curHov.replace(/_/g, ' ');
        ctx.font = '500 9px ui-monospace, monospace';
        const tm = ctx.measureText(label);
        const lx = Math.min(hx + 10, w - tm.width - 10);
        const ly = hy - 10;
        const pad = 3;
        ctx.fillStyle = c.surface + 'D8';
        ctx.strokeStyle = c.border + '80';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.roundRect(lx - pad, ly - 9 - pad, tm.width + pad * 2, 12 + pad * 2, 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = c.heading;
        ctx.textAlign = 'left';
        ctx.fillText(label, lx, ly);
      }
    }

    /* ── Zoom indicator ────────────────────────────────────────────────── */

    if (viewRef.current.zoom > 2) {
      ctx.font = '500 9px ui-monospace, monospace';
      ctx.fillStyle = c.muted + '80';
      ctx.textAlign = 'left';
      ctx.fillText(`${Math.round(viewRef.current.zoom * 100 / 1.8)}%`, 6, h - 6);
    }

  }, [theme, toCanvas]);

  /* ── Animation loop ─────────────────────────────────────────────────────── */

  useEffect(() => {
    let running = true;
    const loop = () => {
      if (!running) return;
      render();
      animRef.current = requestAnimationFrame(loop);
    };
    loop();
    return () => { running = false; cancelAnimationFrame(animRef.current); };
  }, [render]);

  /* ── Event handlers ─────────────────────────────────────────────────────── */

  const handleAutoDetect = () => {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (detected) {
      selectedRef.current = detected;
      setSelectedTz(detected);
      onChange(detected);
      const [lat, lng] = tzToLatLng(detected);
      viewRef.current.cx = lng;
      viewRef.current.cy = lat;
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { active: true, lastX: e.clientX, lastY: e.clientY, moved: false };
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;

    if (dragRef.current.active) {
      const dx = e.clientX - dragRef.current.lastX;
      const dy = e.clientY - dragRef.current.lastY;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragRef.current.moved = true;

      const { zoom } = viewRef.current;
      const scale = (w / 360) * zoom;
      viewRef.current.cx -= dx / scale;

      // Approximate inverse Mercator for lat panning
      const cyRad = (viewRef.current.cy * Math.PI) / 180;
      const latScale = Math.cos(cyRad);
      viewRef.current.cy += (dy / (scale * (180 / Math.PI))) * (180 / Math.PI) * Math.max(0.3, latScale);

      // Clamp so the map content always fills the viewport vertically
      // Use actual Mercator math: compute lat at bottom/top canvas edges
      const mCtr = mercatorY(viewRef.current.cy);
      const halfH = h / 2 / (scale * (180 / Math.PI));
      const bottomMerc = mCtr - halfH;
      const topMerc = mCtr + halfH;
      const bottomLat = (2 * Math.atan(Math.exp(bottomMerc)) - Math.PI / 2) * (180 / Math.PI);
      const topLat = (2 * Math.atan(Math.exp(topMerc)) - Math.PI / 2) * (180 / Math.PI);
      // Allow panning all the way to -90 (South Pole)
      // Clamp so the map content always fills the viewport vertically (±85°)
      if (bottomLat < -85) {
        const targetM = mercatorY(-85) + halfH;
        viewRef.current.cy = (2 * Math.atan(Math.exp(targetM)) - Math.PI / 2) * (180 / Math.PI);
      } else if (topLat > 85) {
        const targetM = mercatorY(85) - halfH;
        viewRef.current.cy = (2 * Math.atan(Math.exp(targetM)) - Math.PI / 2) * (180 / Math.PI);
      }

      dragRef.current.lastX = e.clientX;
      dragRef.current.lastY = e.clientY;
    } else {
      // Hover detection
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      let nearest: string | null = null;
      let bestDist = Infinity;
      for (const { tz, coords } of allTimezones.current) {
        if (!CITY_COORDS[tz]) continue;
        const [px, py] = toCanvas(coords[0], coords[1], w, h);
        const dist = Math.sqrt((px - mx) ** 2 + (py - my) ** 2);
        if (dist < 18 && dist < bestDist) { bestDist = dist; nearest = tz; }
      }
      if (nearest !== hoveredRef.current) {
        hoveredRef.current = nearest;
        setHoveredTz(nearest);
      }
    }
  }, [toCanvas]);

  const handleMouseUp = useCallback(() => {
    dragRef.current.active = false;
  }, []);

  const handleClick = (e: React.MouseEvent) => {
    if (dragRef.current.moved) return;

    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;

    // Find nearest city dot
    let nearest: string | null = null;
    let bestDist = Infinity;
    for (const { tz, coords } of allTimezones.current) {
      if (!CITY_COORDS[tz]) continue;
      const [px, py] = toCanvas(coords[0], coords[1], w, h);
      const dist = Math.sqrt((px - mx) ** 2 + (py - my) ** 2);
      if (dist < 22 && dist < bestDist) { bestDist = dist; nearest = tz; }
    }

    // Fallback: nearest timezone by geographic proximity to click point
    if (!nearest) {
      const geo = fromCanvas(mx, my, w, h);
      if (geo) {
        const [clickLat, clickLng] = geo;
        let bestGeo = Infinity;
        for (const { tz, coords } of allTimezones.current) {
          const dlat = coords[0] - clickLat;
          const dlng = coords[1] - clickLng;
          const d = dlat * dlat + dlng * dlng;
          if (d < bestGeo) { bestGeo = d; nearest = tz; }
        }
      }
    }

    if (nearest) {
      selectedRef.current = nearest;
      setSelectedTz(nearest);
      onChange(nearest);
    }
  };

  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const factor = e.deltaY > 0 ? 0.82 : 1.22;
    viewRef.current.zoom = Math.max(0.8, Math.min(12, viewRef.current.zoom * factor));
  }, []);

  // Global drag listeners
  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  // Non-passive wheel listener so preventDefault actually works
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  // Resize observer
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const obs = new ResizeObserver(() => render());
    obs.observe(canvas);
    return () => obs.disconnect();
  }, [render]);

  return (
    <div className="flex flex-col gap-2">
      <div className="relative w-full border border-border rounded-lg overflow-hidden" style={{ aspectRatio: '1.7' }}>
        <canvas
          ref={canvasRef}
          className="w-full h-full cursor-grab active:cursor-grabbing"
          onMouseDown={handleMouseDown}
          onClick={handleClick}
        />
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-mono text-heading truncate">
            {selectedTz.replace(/_/g, ' ')}
          </p>
          <p className="text-[9px] text-muted font-mono">
            UTC{(() => {
              const off = getTimezoneOffset(selectedTz);
              if (off === 0) return '';
              const sign = off > 0 ? '+' : '';
              const hrs = Math.floor(Math.abs(off));
              const mins = Math.round((Math.abs(off) - hrs) * 60);
              return `${sign}${off < 0 ? '-' : ''}${hrs}${mins ? `:${String(mins).padStart(2, '0')}` : ''}`;
            })()}
          </p>
        </div>
        {hoveredTz && hoveredTz !== selectedTz && (
          <span className="text-[9px] text-muted/60 font-mono truncate max-w-[120px]">
            {hoveredTz.replace(/_/g, ' ')}
          </span>
        )}
        <button
          onClick={handleAutoDetect}
          className="flex items-center gap-1 px-2 py-1 text-[10px] font-mono text-accent border border-border rounded hover:bg-surface2 transition-colors shrink-0"
          title="Auto-detect timezone"
        >
          <Locate size={10} />
          Detect
        </button>
      </div>
      <p className="text-[8px] text-muted/40 font-mono text-center">
        drag to pan · scroll to zoom · click to select
      </p>
    </div>
  );
}
