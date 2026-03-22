/**
 * ProjectQRCode
 *
 * Renders an Odyssey-themed QR code that encodes a time-limited invite URL.
 * The code is generated server-side via the `generate_qr_token` RPC.
 * Owners can click "Regenerate" to invalidate the old token and get a new one.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { RefreshCw, Loader2, QrCode, Clock, Copy, Check } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useTheme } from '../lib/theme';

interface QRTokenData {
  token: string;
  expires_at: string;
}

interface Props {
  projectId: string;
}

// Build the "Odyssey" wordmark as an inline SVG data-URI so it can be
// embedded in the centre of the QR code via imageSettings.
function buildLogoDataUri(fgColor: string, bgColor: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="28" viewBox="0 0 80 28">
    <rect width="80" height="28" rx="4" fill="${bgColor}"/>
    <text
      x="40" y="20"
      font-family="Georgia, 'Times New Roman', serif"
      font-style="italic"
      font-weight="bold"
      font-size="16"
      fill="${fgColor}"
      text-anchor="middle"
      letter-spacing="0.5"
    >Odyssey</text>
  </svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

function formatTimeLeft(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'Expired';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h > 0) return `${h}h ${m}m remaining`;
  return `${m}m remaining`;
}

export default function ProjectQRCode({ projectId }: Props) {
  const { theme } = useTheme();
  const colors = theme.colors;

  const [tokenData, setTokenData]     = useState<QRTokenData | null>(null);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [timeLeft, setTimeLeft]       = useState('');
  const [copied, setCopied]           = useState(false);
  const intervalRef                   = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch the most recent active token for this project (without generating one)
  const fetchExistingToken = useCallback(async () => {
    const { data } = await supabase
      .from('qr_invite_tokens')
      .select('token, expires_at')
      .eq('project_id', projectId)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (data) {
      setTokenData({ token: data.token as string, expires_at: data.expires_at as string });
    }
  }, [projectId]);

  useEffect(() => { fetchExistingToken(); }, [fetchExistingToken]);

  // Update the countdown every 30 seconds
  useEffect(() => {
    if (!tokenData) return;
    setTimeLeft(formatTimeLeft(tokenData.expires_at));
    intervalRef.current = setInterval(() => {
      const left = formatTimeLeft(tokenData.expires_at);
      setTimeLeft(left);
      if (left === 'Expired') {
        setTokenData(null);
        clearInterval(intervalRef.current!);
      }
    }, 30_000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [tokenData]);

  const generateToken = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcErr } = await supabase.rpc('generate_qr_token', { p_project_id: projectId });
      if (rpcErr) throw rpcErr;
      const res = data as { token?: string; expires_at?: string; error?: string };
      if (res.error) throw new Error(res.error);
      setTokenData({ token: res.token!, expires_at: res.expires_at! });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to generate QR code');
    }
    setLoading(false);
  };

  const inviteUrl = tokenData
    ? `${window.location.origin}/join/qr/${tokenData.token}`
    : null;

  const handleCopyLink = async () => {
    if (!inviteUrl) return;
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // QR code colors from the current theme
  const qrFg  = colors.heading;
  const qrBg  = colors.surface;
  const logoDataUri = buildLogoDataUri(colors.accent, qrBg);

  return (
    <div className="border border-border bg-surface p-6">
      <div className="flex items-center gap-2 mb-4">
        <QrCode size={14} className="text-accent" />
        <h3 className="font-sans text-sm font-bold text-heading">QR Invite Code</h3>
        <span className="ml-auto text-[9px] font-mono bg-surface2 text-muted px-1.5 py-0.5 rounded border border-border">
          24-hour expiry
        </span>
      </div>

      <p className="text-[11px] text-muted mb-5 leading-relaxed">
        Share this QR code so others can scan it and join (or request to join) your project.
        Generating a new code immediately invalidates the previous one.
      </p>

      {error && (
        <p className="text-xs text-danger font-mono mb-4">{error}</p>
      )}

      {tokenData && inviteUrl ? (
        <div className="flex flex-col items-center gap-5">
          {/* Themed QR code */}
          <div
            className="p-4 rounded-lg border-2"
            style={{
              background: qrBg,
              borderColor: colors.accent + '40',
              boxShadow: `0 0 32px ${colors.accent}18`,
            }}
          >
            <QRCodeSVG
              value={inviteUrl}
              size={220}
              bgColor={qrBg}
              fgColor={qrFg}
              level="H"
              imageSettings={{
                src: logoDataUri,
                x: undefined,
                y: undefined,
                height: 36,
                width: 100,
                excavate: true,
              }}
            />
          </div>

          {/* Expiry countdown */}
          <div className="flex items-center gap-1.5 text-[10px] text-muted font-mono">
            <Clock size={10} />
            {timeLeft}
          </div>

          {/* Link + controls */}
          <div className="flex flex-wrap items-center gap-2 w-full max-w-sm">
            <code className="flex-1 text-[10px] font-mono text-muted bg-surface2 border border-border px-2 py-1.5 rounded truncate">
              {inviteUrl}
            </code>
            <button
              type="button"
              onClick={handleCopyLink}
              title="Copy link"
              className="flex items-center gap-1 px-3 py-1.5 border border-border text-muted hover:text-heading hover:bg-surface2 text-[10px] font-semibold tracking-wider uppercase transition-colors rounded"
            >
              {copied ? <Check size={10} className="text-accent2" /> : <Copy size={10} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button
              type="button"
              onClick={generateToken}
              disabled={loading}
              title="Generate new QR code (invalidates current)"
              className="flex items-center gap-1.5 px-3 py-1.5 border border-border text-muted hover:text-heading hover:bg-surface2 text-[10px] font-semibold tracking-wider uppercase transition-colors rounded disabled:opacity-50"
            >
              {loading ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
              Regenerate
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4 py-8">
          {/* Placeholder QR frame */}
          <div
            className="w-[220px] h-[220px] rounded-lg border-2 border-dashed flex flex-col items-center justify-center gap-3"
            style={{ borderColor: colors.accent + '30', background: colors.surface2 }}
          >
            <QrCode size={40} style={{ color: colors.accent + '40' }} />
            <span className="text-[10px] font-mono text-muted">No active QR code</span>
          </div>
          <button
            type="button"
            onClick={generateToken}
            disabled={loading}
            className="flex items-center gap-2 px-5 py-2.5 bg-accent/10 border border-accent/30 text-accent text-xs font-semibold tracking-wider uppercase hover:bg-accent/20 transition-colors rounded-md disabled:opacity-50"
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <QrCode size={12} />}
            {loading ? 'Generating…' : 'Generate QR Code'}
          </button>
        </div>
      )}
    </div>
  );
}
