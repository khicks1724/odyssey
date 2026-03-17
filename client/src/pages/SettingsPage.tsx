import { useAuth } from '../lib/auth';
import { Github, Monitor, Bell, Palette, Shield } from 'lucide-react';

const settingSections = [
  {
    title: 'Account',
    icon: Shield,
    items: [
      { label: 'Email', value: 'Loading...', editable: false },
      { label: 'Display Name', value: '', editable: true },
    ],
  },
  {
    title: 'Integrations',
    icon: Github,
    items: [
      { label: 'GitHub', value: 'Connected via OAuth', editable: false },
      { label: 'Microsoft 365', value: 'Not connected', editable: false },
    ],
  },
  {
    title: 'Preferences',
    icon: Palette,
    items: [
      { label: 'Theme', value: 'Dark (only option, obviously)', editable: false },
      { label: 'Timezone', value: 'Auto-detect', editable: false },
    ],
  },
  {
    title: 'Notifications',
    icon: Bell,
    items: [
      { label: 'Deadline Alerts', value: 'Enabled', editable: false },
      { label: 'Weekly Digest', value: 'Enabled', editable: false },
    ],
  },
];

export default function SettingsPage() {
  const { user } = useAuth();

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
        {settingSections.map((section) => (
          <div key={section.title} className="bg-surface p-6">
            <div className="flex items-center gap-2 mb-5">
              <section.icon size={14} className="text-accent" />
              <h2 className="font-sans text-sm font-bold text-heading">{section.title}</h2>
            </div>
            <div className="space-y-4">
              {section.items.map((item) => (
                <div key={item.label} className="flex justify-between items-center">
                  <span className="text-xs text-muted">{item.label}</span>
                  <span className="text-xs text-heading font-mono">
                    {section.title === 'Account' && item.label === 'Email'
                      ? user?.email ?? 'Not signed in'
                      : item.value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
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
