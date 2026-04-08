function getInitials(label: string): string {
  const parts = label
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 2);

  if (parts.length === 0) return '?';
  return parts.map((part) => part[0]?.toUpperCase() ?? '').join('') || '?';
}

function getContrastColor(hex: string): string {
  const normalized = /^#[0-9a-f]{6}$/i.test(hex) ? hex : '#1d4ed8';
  const r = parseInt(normalized.slice(1, 3), 16);
  const g = parseInt(normalized.slice(3, 5), 16);
  const b = parseInt(normalized.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

  if (luminance > 0.5) {
    const darken = (channel: number) => Math.max(0, Math.round(channel * 0.35));
    return `rgb(${darken(r)},${darken(g)},${darken(b)})`;
  }

  const lighten = (channel: number) => Math.min(255, Math.round(channel + (255 - channel) * 0.75));
  return `rgb(${lighten(r)},${lighten(g)},${lighten(b)})`;
}

function parseCustomAvatar(value: string | null | undefined): { initials?: string; color?: string } | null {
  const trimmed = value?.trim();
  if (!trimmed?.startsWith('{')) return null;

  try {
    return JSON.parse(trimmed) as { initials?: string; color?: string };
  } catch {
    return null;
  }
}

type UserAvatarProps = {
  label: string;
  avatar?: string | null;
  className?: string;
  fallbackClassName?: string;
  textClassName?: string;
};

export default function UserAvatar({
  label,
  avatar,
  className = '',
  fallbackClassName = 'bg-surface2 text-muted',
  textClassName = 'text-[10px] font-semibold uppercase',
}: UserAvatarProps) {
  const customAvatar = parseCustomAvatar(avatar);

  if (customAvatar) {
    const backgroundColor = customAvatar.color ?? '#1d4ed8';
    return (
      <div
        className={`rounded-full flex items-center justify-center select-none ${className}`}
        style={{ backgroundColor, color: getContrastColor(backgroundColor) }}
      >
        <span className={textClassName}>{customAvatar.initials?.trim() || getInitials(label)}</span>
      </div>
    );
  }

  if (avatar) {
    return <img src={avatar} alt="" className={`rounded-full object-cover ${className}`} />;
  }

  return (
    <div className={`rounded-full flex items-center justify-center select-none ${fallbackClassName} ${className}`}>
      <span className={textClassName}>{getInitials(label)}</span>
    </div>
  );
}
