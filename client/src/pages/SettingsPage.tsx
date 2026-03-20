import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { useProfile } from '../hooks/useProfile';
import { useMicrosoftIntegration } from '../hooks/useMicrosoftIntegration';
import { useTimeFormat, type HourCycle } from '../lib/time-format';
import TimezoneGlobe from '../components/TimezoneGlobe';
import { Github, Monitor, Bell, Palette, Shield, Check, Loader2, Link, Unlink, Clock } from 'lucide-react';

export default function SettingsPage() {
  const { user } = useAuth();
  const { profile, updateProfile } = useProfile();
  const { status: msStatus, loading: msLoading, connecting: msConnecting, connectError: msError, connect: msConnect, disconnect: msDisconnect } = useMicrosoftIntegration();
  const { settings: tfSettings, setTimezone, setHourCycle } = useTimeFormat();
  const [displayName, setDisplayName] = useState('');
  const [nameLoaded, setNameLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Load profile display name once
  if (profile && !nameLoaded) {
    setDisplayName(profile.display_name ?? '');
    setNameLoaded(true);
  }

  const handleSaveName = async () => {
    setSaving(true);
    try {
      await updateProfile({ display_name: displayName });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // silently fail for now
    }
    setSaving(false);
  };

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <div className="mb-10">
        <p className="text-[11px] tracking-[0.25em] uppercase text-muted mb-2 font-mono">
          Settings
        </p>
        <h1 className="font-sans text-3xl font-extrabold text-heading tracking-tight">
          Configuration
        </h1>
      </div>

      <div className="space-y-px border border-border bg-border">
        {/* Account */}
        <div className="bg-surface p-6">
          <div className="flex items-center gap-2 mb-5">
            <Shield size={14} className="text-accent" />
            <h2 className="font-sans text-sm font-bold text-heading">Account</h2>
          </div>
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-xs text-muted">Email</span>
              <span className="text-xs text-heading font-mono">{user?.email ?? 'Not signed in'}</span>
            </div>
            <div className="flex justify-between items-center gap-4">
              <span className="text-xs text-muted shrink-0">Display Name</span>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="px-3 py-1.5 bg-surface border border-border text-heading text-xs font-mono focus:outline-none focus:border-accent/50 transition-colors w-48"
                  placeholder="Your name"
                />
                <button
                  onClick={handleSaveName}
                  disabled={saving}
                  className="px-3 py-1.5 border border-accent/30 text-accent text-[10px] font-sans font-semibold tracking-wider uppercase hover:bg-accent/5 transition-colors rounded disabled:opacity-50"
                >
                  {saved ? <Check size={12} /> : saving ? '…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Integrations */}
        <div className="bg-surface p-6">
          <div className="flex items-center gap-2 mb-5">
            <Github size={14} className="text-accent" />
            <h2 className="font-sans text-sm font-bold text-heading">Integrations</h2>
          </div>
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-xs text-muted">GitHub</span>
              <span className="text-xs text-accent3 font-mono">Connected via OAuth</span>
            </div>
            <div className="flex justify-between items-center">
              <div>
                <span className="text-xs text-muted block">Microsoft 365</span>
                {msStatus?.connected && (
                  <span className="text-[10px] text-muted font-mono">{msStatus.email}</span>
                )}
              </div>
              {msLoading ? (
                <Loader2 size={12} className="animate-spin text-muted" />
              ) : msStatus?.connected ? (
                <div className="flex items-center gap-3">
                  <span className="text-[10px] text-accent3 font-mono">Connected</span>
                  <button
                    type="button"
                    onClick={msDisconnect}
                    className="flex items-center gap-1 text-[10px] text-danger hover:underline"
                  >
                    <Unlink size={10} /> Disconnect
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-end gap-1">
                  <button
                    type="button"
                    onClick={msConnect}
                    disabled={msConnecting}
                    className="flex items-center gap-1 px-3 py-1.5 border border-accent/30 text-accent text-[10px] font-sans font-semibold tracking-wider uppercase hover:bg-accent/5 transition-colors rounded disabled:opacity-50"
                  >
                    {msConnecting ? <Loader2 size={10} className="animate-spin" /> : <Link size={10} />}
                    {msConnecting ? 'Redirecting…' : 'Connect'}
                  </button>
                  {msError && (
                    <span className="text-[10px] text-danger font-mono max-w-[240px] text-right">{msError}</span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Preferences */}
        <div className="bg-surface p-6">
          <div className="flex items-center gap-2 mb-5">
            <Palette size={14} className="text-accent" />
            <h2 className="font-sans text-sm font-bold text-heading">Preferences</h2>
          </div>
          <div className="space-y-5">
            <div className="flex justify-between items-center">
              <span className="text-xs text-muted">Theme</span>
              <span className="text-xs text-heading font-mono">Managed via theme switcher</span>
            </div>

            {/* Timezone */}
            <div>
              <div className="flex items-center gap-1.5 mb-3">
                <Clock size={11} className="text-muted" />
                <span className="text-xs text-muted">Timezone</span>
              </div>
              <div className="max-w-[560px] mx-auto">
                <TimezoneGlobe value={tfSettings.timezone} onChange={setTimezone} />
              </div>
            </div>

            {/* Time format */}
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-1.5">
                <Clock size={11} className="text-muted" />
                <span className="text-xs text-muted">Time Format</span>
              </div>
              <div className="flex border border-border rounded overflow-hidden text-[10px] font-mono">
                {(['h12', 'h23'] as HourCycle[]).map((hc) => (
                  <button
                    key={hc}
                    type="button"
                    onClick={() => setHourCycle(hc)}
                    className={`px-3 py-1.5 transition-colors ${
                      tfSettings.hourCycle === hc
                        ? 'bg-accent text-[var(--color-accent-fg)]'
                        : 'text-muted hover:text-heading hover:bg-surface2'
                    }`}
                  >
                    {hc === 'h12' ? '12h' : '24h'}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Notifications */}
        <div className="bg-surface p-6">
          <div className="flex items-center gap-2 mb-5">
            <Bell size={14} className="text-accent" />
            <h2 className="font-sans text-sm font-bold text-heading">Notifications</h2>
          </div>
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-xs text-muted">Deadline Alerts</span>
              <span className="text-xs text-heading font-mono">Enabled</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs text-muted">Weekly Digest</span>
              <span className="text-xs text-heading font-mono">Enabled</span>
            </div>
          </div>
        </div>
      </div>

      {/* Danger Zone */}
      <div className="mt-8 border border-danger/30 bg-surface p-6">
        <div className="flex items-center gap-2 mb-4">
          <Monitor size={14} className="text-danger" />
          <h2 className="font-sans text-sm font-bold text-danger">Danger Zone</h2>
        </div>
        <p className="text-xs text-muted mb-4">
          Delete your account and all associated data. This action cannot be undone.
        </p>
        <button className="px-5 py-2 border border-danger/30 text-danger text-xs font-sans font-semibold tracking-wider uppercase hover:bg-danger/5 transition-colors rounded-md">
          Delete Account
        </button>
      </div>
    </div>
  );
}
