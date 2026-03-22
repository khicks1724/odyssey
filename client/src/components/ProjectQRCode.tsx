import { useState, useEffect, useCallback, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { RefreshCw, Loader2, QrCode, Clock, Copy, Check, ExternalLink } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useTheme } from '../lib/theme';
import Modal from './Modal';

interface QRTokenData {
  token: string;
  expires_at: string;
}

interface Props {
  projectId: string;
}

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

  const [open, setOpen] = useState(false);
  const [tokenData, setTokenData] = useState<QRTokenData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState('');
  const [copied, setCopied] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchExistingToken = useCallback(async () => {
    const { data, error: tableError } = await supabase
      .from('qr_invite_tokens')
      .select('token, expires_at')
      .eq('project_id', projectId)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (tableError) {
      throw tableError;
    }

    if (data) {
      setTokenData({ token: data.token as string, expires_at: data.expires_at as string });
      return true;
    }

    setTokenData(null);
    return false;
  }, [projectId]);

  const generateToken = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcErr } = await supabase.rpc('generate_qr_token', { p_project_id: projectId });
      if (rpcErr) throw rpcErr;
      const res = data as { token?: string; expires_at?: string; error?: string };
      if (res.error) throw new Error(res.error);
      if (!res.token || !res.expires_at) throw new Error('QR generator returned an invalid response.');
      setTokenData({ token: res.token, expires_at: res.expires_at });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to generate QR code';
      if (message.toLowerCase().includes('function') || message.toLowerCase().includes('qr_invite_tokens')) {
        setError('QR invites are not available yet. Apply Supabase migration 023, then try again.');
      } else {
        setError(message);
      }
    }
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setError(null);
    setLoading(true);
    fetchExistingToken()
      .then((found) => {
        if (active && !found) {
          return generateToken();
        }
        return undefined;
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'Failed to load QR code';
        setError(message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [open, fetchExistingToken, generateToken]);

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

  const inviteUrl = tokenData ? `${window.location.origin}/join/qr/${tokenData.token}` : null;

  const handleCopyLink = async () => {
    if (!inviteUrl) return;
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const qrFg = colors.heading;
  const qrBg = colors.surface;
  const logoDataUri = buildLogoDataUri(colors.accent, qrBg);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-3 py-1.5 border border-accent/30 text-accent text-[10px] font-semibold tracking-wider uppercase hover:bg-accent/10 transition-colors rounded"
      >
        <QrCode size={11} />
        Add via QR
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="Add Members via QR Code">
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-[10px] text-muted font-mono">
            <Clock size={10} />
            24-hour expiry
          </div>

          <p className="text-xs text-muted leading-relaxed">
            Open this preview for the new user to scan. Generating a new QR code immediately invalidates the previous one.
          </p>

          {error && (
            <div className="border border-danger/30 bg-danger/5 px-3 py-2 rounded text-xs text-danger font-mono">
              {error}
            </div>
          )}

          <div className="flex flex-col items-center gap-4">
            <div
              className="p-4 rounded-lg border-2 min-h-[252px] min-w-[252px] flex items-center justify-center"
              style={{
                background: qrBg,
                borderColor: colors.accent + '40',
                boxShadow: `0 0 32px ${colors.accent}18`,
              }}
            >
              {loading ? (
                <div className="flex flex-col items-center gap-3 text-muted">
                  <Loader2 size={20} className="animate-spin" />
                  <span className="text-[10px] font-mono">Preparing QR preview...</span>
                </div>
              ) : inviteUrl ? (
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
              ) : (
                <div className="flex flex-col items-center gap-3 text-muted">
                  <QrCode size={34} style={{ color: colors.accent + '55' }} />
                  <span className="text-[10px] font-mono text-center max-w-[160px]">
                    No QR code is available yet.
                  </span>
                </div>
              )}
            </div>

            {tokenData && (
              <div className="flex items-center gap-1.5 text-[10px] text-muted font-mono">
                <Clock size={10} />
                {timeLeft}
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {!inviteUrl && (
              <button
                type="button"
                onClick={generateToken}
                disabled={loading}
                className="flex items-center gap-1.5 px-3 py-1.5 border border-accent/30 text-accent hover:bg-accent/10 text-[10px] font-semibold tracking-wider uppercase transition-colors rounded disabled:opacity-50"
              >
                {loading ? <Loader2 size={10} className="animate-spin" /> : <QrCode size={10} />}
                Generate QR Code
              </button>
            )}

            {inviteUrl && (
              <>
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="flex items-center gap-1 px-3 py-1.5 border border-border text-muted hover:text-heading hover:bg-surface2 text-[10px] font-semibold tracking-wider uppercase transition-colors rounded"
                >
                  {copied ? <Check size={10} className="text-accent2" /> : <Copy size={10} />}
                  {copied ? 'Copied' : 'Copy Link'}
                </button>
                <a
                  href={inviteUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 px-3 py-1.5 border border-border text-muted hover:text-heading hover:bg-surface2 text-[10px] font-semibold tracking-wider uppercase transition-colors rounded"
                >
                  <ExternalLink size={10} />
                  Open
                </a>
              </>
            )}

            <button
              type="button"
              onClick={generateToken}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-border text-muted hover:text-heading hover:bg-surface2 text-[10px] font-semibold tracking-wider uppercase transition-colors rounded disabled:opacity-50"
            >
              {loading ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
              {inviteUrl ? 'Regenerate' : 'Retry'}
            </button>
          </div>

          {inviteUrl && (
            <div className="space-y-2">
              <code className="block w-full text-[10px] font-mono text-muted bg-surface2 border border-border px-2 py-1.5 rounded break-all">
                {inviteUrl}
              </code>
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
