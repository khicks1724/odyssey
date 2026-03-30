import { useState, useRef, useEffect, useCallback } from 'react';

// ── Color conversion helpers ────────────────────────────────────────────────

function hsvToHex(h: number, s: number, v: number): string {
  s /= 100; v /= 100;
  const k = (n: number) => (n + h / 60) % 6;
  const f = (n: number) => v * (1 - s * Math.max(0, Math.min(k(n), 4 - k(n), 1)));
  const toHex = (n: number) => Math.round(n * 255).toString(16).padStart(2, '0');
  return `#${toHex(f(5))}${toHex(f(3))}${toHex(f(1))}`;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

function hexToHsv(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255) as [number, number, number];
  const max = Math.max(r, g, b), min = Math.min(r, g, b), diff = max - min;
  let h = 0;
  if (diff > 0) {
    if (max === r) h = ((g - b) / diff) % 6;
    else if (max === g) h = (b - r) / diff + 2;
    else h = (r - g) / diff + 4;
    h = ((h * 60) + 360) % 360;
  }
  return [h, max === 0 ? 0 : (diff / max) * 100, max * 100];
}

function hueToHex(hue: number): string {
  return hsvToHex(hue, 100, 100);
}

// ── Palette ─────────────────────────────────────────────────────────────────

const PALETTE: string[] = [
  // Blues
  '#6a9fd8', '#3b82f6', '#60a5fa', '#1e40af', '#93c5fd',
  // Greens / Teals
  '#5a9e8a', '#10b981', '#34d399', '#059669', '#2dd4bf',
  // Purples / Pinks
  '#7c3aed', '#8b5cf6', '#a78bfa', '#c084fc', '#e879f9',
  // Reds / Oranges / Yellows
  '#e05555', '#f97316', '#fb923c', '#eab308', '#fbbf24',
];

// ── Custom color canvas picker ───────────────────────────────────────────────

interface CustomPickerProps {
  value: string;
  onChange: (hex: string) => void;
}

function CustomPicker({ value, onChange }: CustomPickerProps) {
  const [hsv, setHsv] = useState<[number, number, number]>(() => hexToHsv(value));
  const [rgb, setRgb] = useState<[number, number, number]>(() => hexToRgb(value));
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const draggingCanvas = useRef(false);
  const draggingHue = useRef(false);

  // Sync from external value change
  useEffect(() => {
    const newHsv = hexToHsv(value);
    setHsv(newHsv);
    setRgb(hexToRgb(value));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // Draw the SV canvas whenever hue changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { width, height } = canvas;

    // Fill with pure hue
    ctx.fillStyle = hueToHex(hsv[0]);
    ctx.fillRect(0, 0, width, height);

    // White gradient: left = white, right = transparent
    const whiteGrad = ctx.createLinearGradient(0, 0, width, 0);
    whiteGrad.addColorStop(0, 'rgba(255,255,255,1)');
    whiteGrad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = whiteGrad;
    ctx.fillRect(0, 0, width, height);

    // Black gradient: top = transparent, bottom = black
    const blackGrad = ctx.createLinearGradient(0, 0, 0, height);
    blackGrad.addColorStop(0, 'rgba(0,0,0,0)');
    blackGrad.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = blackGrad;
    ctx.fillRect(0, 0, width, height);
  }, [hsv[0]]);

  const pickFromCanvas = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    const s = x * 100;
    const v = (1 - y) * 100;
    const newHsv: [number, number, number] = [hsv[0], s, v];
    const hex = hsvToHex(...newHsv);
    setHsv(newHsv);
    setRgb(hexToRgb(hex));
    onChange(hex);
  }, [hsv, onChange]);

  const pickHue = useCallback((clientX: number) => {
    const slider = document.getElementById('hue-slider') as HTMLInputElement | null;
    if (!slider) return;
    const rect = slider.getBoundingClientRect();
    const hue = Math.max(0, Math.min(360, ((clientX - rect.left) / rect.width) * 360));
    const newHsv: [number, number, number] = [hue, hsv[1], hsv[2]];
    const hex = hsvToHex(...newHsv);
    setHsv(newHsv);
    setRgb(hexToRgb(hex));
    onChange(hex);
  }, [hsv, onChange]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (draggingCanvas.current) pickFromCanvas(e.clientX, e.clientY);
      if (draggingHue.current) pickHue(e.clientX);
    };
    const onUp = () => { draggingCanvas.current = false; draggingHue.current = false; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [pickFromCanvas, pickHue]);

  // Canvas cursor position (% of width/height)
  const cursorX = `${hsv[1]}%`;
  const cursorY = `${100 - hsv[2]}%`;

  const handleRgbChange = (channel: 0 | 1 | 2, raw: string) => {
    const val = Math.max(0, Math.min(255, parseInt(raw) || 0));
    const newRgb: [number, number, number] = [...rgb] as [number, number, number];
    newRgb[channel] = val;
    setRgb(newRgb);
    const hex = rgbToHex(...newRgb);
    setHsv(hexToHsv(hex));
    onChange(hex);
  };

  const handleEyedropper = async () => {
    if (!('EyeDropper' in window)) return;
    try {
      // @ts-expect-error EyeDropper is not in all TS lib versions
      const eyedropper = new window.EyeDropper();
      const result = await eyedropper.open();
      const hex = result.sRGBHex as string;
      setHsv(hexToHsv(hex));
      setRgb(hexToRgb(hex));
      onChange(hex);
    } catch { /* user cancelled */ }
  };

  return (
    <div className="p-3 space-y-2.5">
      {/* SV canvas */}
      <div
        className="relative rounded overflow-hidden cursor-crosshair"
        style={{ width: '100%', height: 160 }}
        onMouseDown={(e) => { draggingCanvas.current = true; pickFromCanvas(e.clientX, e.clientY); }}
      >
        <canvas
          ref={canvasRef}
          width={280}
          height={160}
          className="w-full h-full block"
        />
        {/* Cursor ring */}
        <div
          className="absolute w-4 h-4 rounded-full border-2 border-white shadow -translate-x-1/2 -translate-y-1/2 pointer-events-none"
          style={{
            left: cursorX,
            top: cursorY,
            boxShadow: '0 0 0 1px rgba(0,0,0,0.4)',
          }}
        />
      </div>

      {/* Eyedropper + preview + hue slider */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          title="Pick color from screen"
          onClick={handleEyedropper}
          className="w-7 h-7 flex items-center justify-center text-[var(--color-muted)] hover:text-[var(--color-heading)] transition-colors shrink-0"
        >
          {/* Eyedropper icon */}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2l4 4-9.5 9.5a2 2 0 0 1-2.83 0l-.17-.17a2 2 0 0 1 0-2.83L12 2z"/>
            <path d="M15 5l4 4"/>
            <path d="M2 22l4-1-3-3z"/>
          </svg>
        </button>

        {/* Color preview */}
        {/* eslint-disable-next-line react/forbid-dom-props */}
        <div className="w-8 h-8 rounded-full border border-[var(--color-border)] shrink-0 shadow-inner" style={{ background: value }} />

        {/* Hue slider */}
        <div
          id="hue-slider"
          className="flex-1 h-4 rounded-full cursor-pointer relative"
          style={{ background: 'linear-gradient(to right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)' }}
          onMouseDown={(e) => { draggingHue.current = true; pickHue(e.clientX); }}
        >
          {/* Hue thumb */}
          <div
            className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full border-2 border-white shadow pointer-events-none -translate-x-1/2"
            style={{
              left: `${(hsv[0] / 360) * 100}%`,
              boxShadow: '0 0 0 1px rgba(0,0,0,0.3)',
            }}
          />
        </div>
      </div>

      {/* RGB inputs */}
      <div className="flex gap-1.5">
        {(['R', 'G', 'B'] as const).map((ch, i) => (
          <div key={ch} className="flex-1 flex flex-col items-center gap-0.5">
            <input
              type="number"
              min={0}
              max={255}
              value={rgb[i]}
              onChange={(e) => handleRgbChange(i as 0 | 1 | 2, e.target.value)}
              className="w-full text-center text-xs py-1.5 px-1 rounded border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-heading)] focus:outline-none focus:border-[var(--color-accent)]/50 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
            />
            <span className="text-[10px] text-[var(--color-muted)] font-mono">{ch}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

interface LabelColorPickerProps {
  value: string;
  onChange: (hex: string) => void;
}

export default function LabelColorPicker({ value, onChange }: LabelColorPickerProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'palette' | 'custom'>('palette');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div ref={ref} className="relative shrink-0">
      {/* Trigger swatch */}
      <button
        type="button"
        title="Pick color"
        onClick={() => setOpen((o) => !o)}
        className="w-8 h-8 rounded border border-[var(--color-border)] cursor-pointer shadow-inner transition-transform hover:scale-105 active:scale-95"
        // eslint-disable-next-line react/forbid-dom-props
        style={{ background: value }}
      />

      {open && (
        <div
          className="absolute left-0 top-full mt-1 z-50 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl overflow-hidden"
          style={{ width: 304 }}
        >
          {/* Tabs */}
          <div className="flex border-b border-[var(--color-border)]">
            {(['palette', 'custom'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`flex-1 py-2 text-[11px] font-semibold tracking-wider uppercase transition-colors ${
                  tab === t
                    ? 'text-[var(--color-accent)] border-b-2 border-[var(--color-accent)] -mb-px'
                    : 'text-[var(--color-muted)] hover:text-[var(--color-heading)]'
                }`}
              >
                {t === 'palette' ? 'Palette' : 'Custom'}
              </button>
            ))}
          </div>

          {tab === 'palette' ? (
            <div className="p-3">
              <div className="grid grid-cols-10 gap-1.5">
                {PALETTE.map((color) => (
                  <button
                    key={color}
                    type="button"
                    title={color}
                    onClick={() => { onChange(color); setOpen(false); }}
                    className="relative w-full aspect-square rounded-full border transition-transform hover:scale-110 active:scale-95 focus:outline-none"
                    style={{
                      background: color,
                      borderColor: color === value ? 'var(--color-heading)' : 'transparent',
                      boxShadow: color === value ? '0 0 0 2px var(--color-surface), 0 0 0 3px var(--color-heading)' : undefined,
                    }}
                  />
                ))}
              </div>
              {/* Selected preview */}
              <div className="mt-3 flex items-center gap-2 px-1">
                {/* eslint-disable-next-line react/forbid-dom-props */}
                <div className="w-6 h-6 rounded-full border border-[var(--color-border)] shrink-0" style={{ background: value }} />
                <span className="text-xs font-mono text-[var(--color-muted)]">{value}</span>
              </div>
            </div>
          ) : (
            <CustomPicker value={value} onChange={onChange} />
          )}
        </div>
      )}
    </div>
  );
}
