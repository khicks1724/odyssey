import { useEffect, useMemo, useRef, type RefObject } from 'react';

const VIEWBOX_WIDTH = 1600;
const VIEWBOX_HEIGHT = 900;
const SAMPLE_STEP = 72;
const MOTION_SPEED_MULTIPLIER = 1.34;
const POINTER_AREA_PADDING = 48;
const MAX_WAKE_POINTS = 10;

type Point = { x: number; y: number };

type PointerState = {
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  speed: number;
};

type WakePoint = {
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  energy: number;
  age: number;
};

type WaveLayer = {
  yBase: number;
  amplitude: number;
  frequency: number;
  detailScale: number;
  path: string;
  speed: number;
  driftX: number;
  driftY: number;
  pointerX: number;
  pointerY: number;
  rotate: number;
  phase: number;
  opacity: number;
};

type CrestLayer = {
  path: string;
  speed: number;
  driftX: number;
  driftY: number;
  pointerX: number;
  pointerY: number;
  phase: number;
};

function buildSmoothPath(points: Point[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0]!.x} ${points[0]!.y}`;

  let path = `M ${points[0]!.x.toFixed(2)} ${points[0]!.y.toFixed(2)}`;

  for (let index = 0; index < points.length - 1; index += 1) {
    const previous = points[index - 1] ?? points[index]!;
    const current = points[index]!;
    const next = points[index + 1]!;
    const after = points[index + 2] ?? next;

    const control1X = current.x + (next.x - previous.x) / 6;
    const control1Y = current.y + (next.y - previous.y) / 6;
    const control2X = next.x - (after.x - current.x) / 6;
    const control2Y = next.y - (after.y - current.y) / 6;

    path += ` C ${control1X.toFixed(2)} ${control1Y.toFixed(2)}, ${control2X.toFixed(2)} ${control2Y.toFixed(2)}, ${next.x.toFixed(2)} ${next.y.toFixed(2)}`;
  }

  return path;
}

function buildWaveLine(
  yBase: number,
  amplitude: number,
  frequency: number,
  phase: number,
  detailScale: number,
) {
  const points: Point[] = [];

  for (let x = -280; x <= VIEWBOX_WIDTH + 280; x += SAMPLE_STEP) {
    const normalizedX = x / VIEWBOX_WIDTH;
    const broad =
      Math.sin(normalizedX * Math.PI * frequency + phase) * amplitude +
      Math.sin(normalizedX * Math.PI * (frequency * 0.58) + phase * 0.8) * amplitude * 0.42;
    const detail =
      Math.sin(normalizedX * Math.PI * (frequency * 1.9) + phase * 1.35) * amplitude * detailScale +
      Math.cos(normalizedX * Math.PI * (frequency * 2.7) - phase * 0.6) * amplitude * detailScale * 0.5;

    points.push({ x, y: yBase + broad + detail });
  }

  return buildSmoothPath(points);
}

function buildCrestPath(centerX: number, centerY: number, radius: number, phase: number) {
  const points: Point[] = [];
  const segments = 18;

  for (let index = 0; index <= segments; index += 1) {
    const progress = index / segments;
    const angle = phase + progress * Math.PI * 1.08;
    const easing = 1 - progress * 0.7;
    points.push({
      x: centerX + Math.cos(angle) * radius * easing,
      y: centerY + Math.sin(angle) * radius * 0.68 * easing,
    });
  }

  return buildSmoothPath(points);
}

function createWaveLayers(count: number, startY: number, gap: number, baseAmplitude: number, baseFrequency: number) {
  return Array.from({ length: count }, (_, index): WaveLayer => {
    const amplitude = baseAmplitude + (index % 3) * 6;
    const frequency = baseFrequency + index * 0.14;
    const phase = index * 0.58;
    const yBase = startY + index * gap;
    const detailScale = 0.16;

    return {
      yBase,
      amplitude,
      frequency,
      detailScale,
      path: buildWaveLine(yBase, amplitude, frequency, phase, detailScale),
      speed: (0.05 + index * 0.005) * MOTION_SPEED_MULTIPLIER,
      driftX: 10 + (index % 4) * 4,
      driftY: 7 + (index % 3) * 2,
      pointerX: 18 + (index % 5) * 5,
      pointerY: 16 + (index % 4) * 4,
      rotate: 0.18 + (index % 3) * 0.05,
      phase,
      opacity: 0.94 - index * 0.045,
    };
  });
}

function createCrestLayers(): CrestLayer[] {
  return [
    {
      path: buildCrestPath(280, 200, 78, 0.4),
      speed: 0.08 * MOTION_SPEED_MULTIPLIER,
      driftX: 16,
      driftY: 8,
      pointerX: 18,
      pointerY: 14,
      phase: 0.2,
    },
    {
      path: buildCrestPath(930, 260, 70, 0.92),
      speed: 0.06 * MOTION_SPEED_MULTIPLIER,
      driftX: 14,
      driftY: 10,
      pointerX: 16,
      pointerY: 12,
      phase: 1.1,
    },
    {
      path: buildCrestPath(1280, 420, 64, 1.48),
      speed: 0.07 * MOTION_SPEED_MULTIPLIER,
      driftX: 12,
      driftY: 9,
      pointerX: 14,
      pointerY: 10,
      phase: 1.8,
    },
  ];
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function buildInteractiveWaveLine(
  layer: WaveLayer,
  phase: number,
  pointer: PointerState,
  wakePoints: WakePoint[],
  interactionStrength: number,
) {
  const points: Point[] = [];
  const pointerX = pointer.x * VIEWBOX_WIDTH;
  const pointerY = pointer.y * VIEWBOX_HEIGHT;
  const pointerEnergy = clamp(pointer.speed * 1.7, 0, 1.35) * interactionStrength;

  for (let x = -280; x <= VIEWBOX_WIDTH + 280; x += SAMPLE_STEP) {
    const normalizedX = x / VIEWBOX_WIDTH;
    const broad =
      Math.sin(normalizedX * Math.PI * layer.frequency + phase) * layer.amplitude +
      Math.sin(normalizedX * Math.PI * (layer.frequency * 0.58) + phase * 0.8) * layer.amplitude * 0.42;
    const detail =
      Math.sin(normalizedX * Math.PI * (layer.frequency * 1.9) + phase * 1.35) * layer.amplitude * layer.detailScale +
      Math.cos(normalizedX * Math.PI * (layer.frequency * 2.7) - phase * 0.6) * layer.amplitude * layer.detailScale * 0.5;

    let wakeOffset = 0;

    if (interactionStrength > 0.001) {
      const pointerDx = x - pointerX;
      const pointerDy = layer.yBase - pointerY;
      const pointerDistance = (pointerDx * pointerDx) / (220 * 220) + (pointerDy * pointerDy) / (150 * 150);
      const pointerInfluence = Math.exp(-pointerDistance);
      const wakePhase = pointerDx * 0.021 - pointer.velocityX * 0.65;
      wakeOffset += Math.sin(wakePhase) * 16 * pointerInfluence * pointerEnergy;
      wakeOffset += pointer.velocityY * 7 * pointerInfluence * interactionStrength;
    }

    for (const wakePoint of wakePoints) {
      const dx = x - wakePoint.x;
      const dy = layer.yBase - wakePoint.y;
      const distance = (dx * dx) / (260 * 260) + (dy * dy) / (175 * 175);
      const influence = Math.exp(-distance) * wakePoint.energy * (1 - wakePoint.age);
      if (influence < 0.002) continue;

      const wakePhase = dx * 0.019 - wakePoint.age * 11 + wakePoint.velocityX * 0.32;
      wakeOffset += Math.sin(wakePhase) * 14 * influence;
      wakeOffset += wakePoint.velocityY * 8 * influence;
    }

    points.push({ x, y: layer.yBase + broad + detail + wakeOffset });
  }

  return buildSmoothPath(points);
}

type LoginWaveBackgroundProps = {
  interactionTargetRef?: RefObject<HTMLElement | null>;
};

export default function LoginWaveBackground({ interactionTargetRef }: LoginWaveBackgroundProps) {
  const frameRef = useRef<number | null>(null);
  const startRef = useRef<number | null>(null);
  const targetRef = useRef({ x: 0.5, y: 0.5 });
  const pointerRef = useRef<PointerState>({ x: 0.5, y: 0.5, velocityX: 0, velocityY: 0, speed: 0 });
  const pointerMetaRef = useRef({ clientX: 0, clientY: 0, timestamp: 0 });
  const interactionStrengthRef = useRef(0);
  const interactionTargetStrengthRef = useRef(0);
  const wakeTrailRef = useRef<WakePoint[]>([]);
  const primaryRefs = useRef<(SVGGElement | null)[]>([]);
  const secondaryRefs = useRef<(SVGGElement | null)[]>([]);
  const crestRefs = useRef<(SVGGElement | null)[]>([]);
  const primaryPathRefs = useRef<Array<{ outline: SVGPathElement | null; stroke: SVGPathElement | null }>>([]);
  const secondaryPathRefs = useRef<(SVGPathElement | null)[]>([]);
  const glowRef = useRef<SVGCircleElement | null>(null);

  const primaryLayers = useMemo(() => createWaveLayers(11, 112, 58, 22, 4.1), []);
  const secondaryLayers = useMemo(() => createWaveLayers(8, 150, 82, 44, 2.1), []);
  const crestLayers = useMemo(() => createCrestLayers(), []);

  useEffect(() => {
    const animate = (timestamp: number) => {
      if (startRef.current === null) startRef.current = timestamp;
      const elapsed = (timestamp - startRef.current) / 1000;
      const pointer = pointerRef.current;
      const target = targetRef.current;
      const wakeTrail = wakeTrailRef.current;

      pointer.x += (target.x - pointer.x) * 0.04;
      pointer.y += (target.y - pointer.y) * 0.04;
      pointer.velocityX *= 0.88;
      pointer.velocityY *= 0.88;
      pointer.speed *= 0.9;

      interactionStrengthRef.current += (interactionTargetStrengthRef.current - interactionStrengthRef.current) * 0.08;
      const interactionStrength = interactionStrengthRef.current;

      wakeTrailRef.current = wakeTrail
        .map((wakePoint) => ({ ...wakePoint, age: wakePoint.age + 0.035 }))
        .filter((wakePoint) => wakePoint.age < 1);

      primaryLayers.forEach((layer, index) => {
        const node = primaryRefs.current[index];
        if (!node) return;
        const phase = elapsed * layer.speed + layer.phase;
        const paths = primaryPathRefs.current[index];
        const path = buildInteractiveWaveLine(layer, phase, pointer, wakeTrailRef.current, interactionStrength);
        paths?.outline?.setAttribute('d', path);
        paths?.stroke?.setAttribute('d', path);

        const x =
          Math.sin(phase) * layer.driftX +
          (pointer.x - 0.5) * layer.pointerX;
        const y =
          Math.cos(elapsed * (layer.speed * 1.15) + layer.phase * 0.8) * layer.driftY +
          (pointer.y - 0.5) * layer.pointerY +
          pointer.velocityY * 4.5 * interactionStrength;
        const rotate = Math.sin(elapsed * 0.04 + layer.phase) * layer.rotate;
        node.setAttribute('transform', `translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${rotate.toFixed(2)} 800 450)`);
      });

      secondaryLayers.forEach((layer, index) => {
        const node = secondaryRefs.current[index];
        if (!node) return;
        const phase = elapsed * layer.speed + layer.phase;
        const path = buildInteractiveWaveLine(layer, phase, pointer, wakeTrailRef.current, interactionStrength * 0.86);
        secondaryPathRefs.current[index]?.setAttribute('d', path);

        const x =
          Math.sin(phase) * layer.driftX * 0.85 +
          (pointer.x - 0.5) * layer.pointerX * 0.72;
        const y =
          Math.cos(elapsed * (layer.speed * 0.95) + layer.phase) * layer.driftY * 0.85 +
          (pointer.y - 0.5) * layer.pointerY * 0.72 +
          pointer.velocityY * 3.5 * interactionStrength;
        node.setAttribute('transform', `translate(${x.toFixed(2)} ${y.toFixed(2)})`);
      });

      crestLayers.forEach((layer, index) => {
        const node = crestRefs.current[index];
        if (!node) return;

        const x =
          Math.sin(elapsed * layer.speed + layer.phase) * layer.driftX +
          (pointer.x - 0.5) * layer.pointerX;
        const y =
          Math.cos(elapsed * (layer.speed * 1.2) + layer.phase) * layer.driftY +
          (pointer.y - 0.5) * layer.pointerY;
        const rotate = Math.sin(elapsed * 0.07 + layer.phase) * 1.6;
        node.setAttribute('transform', `translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${rotate.toFixed(2)} 800 450)`);
      });

      const glowX = 250 + pointer.x * (VIEWBOX_WIDTH - 500);
      const glowY = 140 + pointer.y * (VIEWBOX_HEIGHT - 280);
      glowRef.current?.setAttribute('cx', glowX.toFixed(2));
      glowRef.current?.setAttribute('cy', glowY.toFixed(2));

      frameRef.current = window.requestAnimationFrame(animate);
    };

    frameRef.current = window.requestAnimationFrame(animate);
    return () => {
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    };
  }, [crestLayers, primaryLayers, secondaryLayers]);

  useEffect(() => {
    const updatePointer = (clientX: number, clientY: number, timestamp: number) => {
      const viewportWidth = window.innerWidth || 1;
      const viewportHeight = window.innerHeight || 1;
      const cardRect = interactionTargetRef?.current?.getBoundingClientRect() ?? null;
      const activeRect = cardRect
        ? {
            left: cardRect.left - POINTER_AREA_PADDING,
            top: cardRect.top - POINTER_AREA_PADDING,
            right: cardRect.right + POINTER_AREA_PADDING,
            bottom: cardRect.bottom + POINTER_AREA_PADDING,
          }
        : {
            left: 0,
            top: 0,
            right: viewportWidth,
            bottom: viewportHeight,
          };
      const isActive =
        clientX >= activeRect.left &&
        clientX <= activeRect.right &&
        clientY >= activeRect.top &&
        clientY <= activeRect.bottom;

      interactionTargetStrengthRef.current = isActive ? 1 : 0;
      if (!isActive) return;

      targetRef.current = {
        x: clamp(clientX / viewportWidth, 0, 1),
        y: clamp(clientY / viewportHeight, 0, 1),
      };

      const meta = pointerMetaRef.current;
      if (meta.timestamp > 0) {
        const deltaTime = Math.max((timestamp - meta.timestamp) / 1000, 1 / 240);
        const deltaX = clientX - meta.clientX;
        const deltaY = clientY - meta.clientY;
        const normalizedVelocityX = clamp(deltaX / viewportWidth / deltaTime, -2.2, 2.2);
        const normalizedVelocityY = clamp(deltaY / viewportHeight / deltaTime, -2.2, 2.2);
        const speed = Math.hypot(deltaX, deltaY) / Math.max(Math.min(cardRect?.width ?? viewportWidth, cardRect?.height ?? viewportHeight), 240);

        pointerRef.current.velocityX = normalizedVelocityX;
        pointerRef.current.velocityY = normalizedVelocityY;
        pointerRef.current.speed = clamp(speed * 0.9, 0, 1.4);

        if (Math.hypot(deltaX, deltaY) > 1.5) {
          wakeTrailRef.current = [
            {
              x: targetRef.current.x * VIEWBOX_WIDTH,
              y: targetRef.current.y * VIEWBOX_HEIGHT,
              velocityX: normalizedVelocityX,
              velocityY: normalizedVelocityY,
              energy: clamp(speed * 0.75 + 0.16, 0.18, 1),
              age: 0,
            },
            ...wakeTrailRef.current,
          ].slice(0, MAX_WAKE_POINTS);
        }
      }

      pointerMetaRef.current = { clientX, clientY, timestamp };
    };

    const handlePointerMove = (event: PointerEvent) => {
      updatePointer(event.clientX, event.clientY, event.timeStamp);
    };

    const handlePointerLeave = () => {
      interactionTargetStrengthRef.current = 0;
      targetRef.current = { x: 0.5, y: 0.5 };
      pointerMetaRef.current = { clientX: 0, clientY: 0, timestamp: 0 };
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerleave', handlePointerLeave);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerleave', handlePointerLeave);
    };
  }, [interactionTargetRef]);

  return (
    <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(255,255,255,0.78),_transparent_30%),linear-gradient(180deg,#f7f3eb_0%,#f0eadd_52%,#e9dfd0_100%)]" />
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          <radialGradient id="login-wave-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(255,255,255,0.78)" />
            <stop offset="40%" stopColor="rgba(255,255,255,0.22)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0)" />
          </radialGradient>
          <linearGradient id="login-wave-ink" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#7aa5ce" />
            <stop offset="48%" stopColor="#2e6da8" />
            <stop offset="100%" stopColor="#1b4d82" />
          </linearGradient>
          <linearGradient id="login-wave-soft" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#c4d9ed" stopOpacity="0.18" />
            <stop offset="50%" stopColor="#7ea7cf" stopOpacity="0.36" />
            <stop offset="100%" stopColor="#5a88b7" stopOpacity="0.2" />
          </linearGradient>
        </defs>

        <circle ref={glowRef} cx="800" cy="340" r="280" fill="url(#login-wave-glow)" />

        {secondaryLayers.map((layer, index) => (
          <g
            key={`secondary-${index}`}
            ref={(node) => {
              secondaryRefs.current[index] = node;
            }}
            opacity={0.18 + index * 0.035}
          >
            <path
              ref={(node) => {
                secondaryPathRefs.current[index] = node;
              }}
              d={layer.path}
              fill="none"
              stroke="url(#login-wave-soft)"
              strokeWidth={8 - (index % 2)}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
        ))}

        {primaryLayers.map((layer, index) => (
          <g
            key={`primary-${index}`}
            ref={(node) => {
              primaryRefs.current[index] = node;
            }}
            opacity={layer.opacity}
          >
            <path
              ref={(node) => {
                primaryPathRefs.current[index] = {
                  outline: node,
                  stroke: primaryPathRefs.current[index]?.stroke ?? null,
                };
              }}
              d={layer.path}
              fill="none"
              stroke="#e5eff8"
              strokeWidth={7.2}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={0.54}
            />
            <path
              ref={(node) => {
                primaryPathRefs.current[index] = {
                  outline: primaryPathRefs.current[index]?.outline ?? null,
                  stroke: node,
                };
              }}
              d={layer.path}
              fill="none"
              stroke="url(#login-wave-ink)"
              strokeWidth={3.1}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
        ))}

        {crestLayers.map((layer, index) => (
          <g
            key={`crest-${index}`}
            ref={(node) => {
              crestRefs.current[index] = node;
            }}
            opacity="0.72"
          >
            <path d={layer.path} fill="none" stroke="#eef4fa" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
            <path d={layer.path} fill="none" stroke="#6d97c0" strokeWidth="3.1" strokeLinecap="round" strokeLinejoin="round" />
          </g>
        ))}
      </svg>

      <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.16),transparent_38%,transparent_72%,rgba(30,58,95,0.07))]" />
    </div>
  );
}
