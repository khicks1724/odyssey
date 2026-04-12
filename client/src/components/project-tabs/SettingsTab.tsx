import React from 'react';
import { useTabVisibility, ALL_TABS } from '../../hooks/useTabVisibility';
import {
  Users,
  UserPlus,
  Github,
  Sparkles,
  Plus,
  Trash2,
  Clock,
  Search,
  Link,
  Loader2,
  CheckCircle,
  X,
  Settings,
  ClipboardList,
  ChevronRight,
  Pencil,
  RefreshCw,
  Download,
  Table,
  Copy,
  LogOut,
  FileText,
  Check,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import LabelColorPicker from '../LabelColorPicker';
import UserAvatar from '../UserAvatar';
import { generateProjectCode, sanitizeProjectCode, PROJECT_CODE_LENGTH } from '../../lib/project-code';
import { getProjectFingerprint } from '../../lib/project-fingerprint';
import { DEFAULT_PROMPTS } from '../../lib/defaultPrompts';
import { PROMPT_LABELS, type PromptFeature } from '../../hooks/useProjectPrompts';
import { getGitHubRepos } from '../../lib/github';
import { toAbsoluteAppUrl, withBasePath } from '../../lib/base-path';
import { formatMemberRole } from '../../lib/member-role';
import { supabase } from '../../lib/supabase';
import type { OdysseyEvent } from '../../types';

interface MemberRow {
  user_id: string;
  role: string;
  joined_at: string;
  profile?: { display_name: string | null; avatar_url: string | null; email?: string | null };
}

interface JoinRequest {
  id: string;
  user_id: string;
  created_at: string;
  profile?: { display_name: string | null; avatar_url: string | null } | null;
}

interface SharedInviteCandidate {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  project_id: string | null;
  project_name: string | null;
}

const REPORT_TEMPLATE_CHUNK_BYTES = 256 * 1024;

async function readTemplateUploadError(res: Response, fallback: string): Promise<string> {
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const payload = await res.json().catch(() => ({ error: '' })) as { error?: string };
    return payload.error?.trim() || fallback;
  }

  const text = await res.text().catch(() => '');
  const normalized = text
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) return fallback;
  if (/<html|<!doctype html|request entity too large/i.test(text)) return fallback;
  return normalized.slice(0, 220);
}

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }
      reject(new Error('Failed to read image.'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read image.'));
    reader.readAsDataURL(blob);
  });
}

async function resolveImageSourceToDataUrl(src: string): Promise<string> {
  if (src.startsWith('data:')) return src;
  const response = await fetch(src, { mode: 'cors' });
  if (!response.ok) {
    throw new Error('Failed to load image.');
  }
  return readBlobAsDataUrl(await response.blob());
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to load image.'));
    image.decoding = 'async';
    image.src = src;
  });
}

async function createCroppedProjectImageFile(
  sourceUrl: string,
  zoom: number,
  offsetX: number,
  offsetY: number,
  fileName: string,
): Promise<File> {
  const cropSize = 720;
  const image = await loadImageElement(sourceUrl);
  const baseScale = Math.max(cropSize / image.naturalWidth, cropSize / image.naturalHeight);
  const renderedWidth = image.naturalWidth * baseScale * zoom;
  const renderedHeight = image.naturalHeight * baseScale * zoom;
  const imageLeft = (cropSize - renderedWidth) / 2 + offsetX;
  const imageTop = (cropSize - renderedHeight) / 2 + offsetY;

  const canvas = document.createElement('canvas');
  canvas.width = cropSize;
  canvas.height = cropSize;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Failed to prepare crop canvas.');
  }

  context.clearRect(0, 0, cropSize, cropSize);
  context.drawImage(image, imageLeft, imageTop, renderedWidth, renderedHeight);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((nextBlob) => {
      if (nextBlob) {
        resolve(nextBlob);
        return;
      }
      reject(new Error('Failed to export cropped image.'));
    }, 'image/png', 0.95);
  });

  return new File([blob], fileName, { type: 'image/png' });
}

// ── GitLab repo section ───────────────────────────────────────────────────────
function GitLabSection({ projectId, onReposChanged }: { projectId: string; onReposChanged?: (repos: string[]) => void }) {
  const [linkedRepos, setLinkedRepos] = React.useState<string[]>([]);
  const [linkedHost, setLinkedHost] = React.useState<string | null>(null);
  const [repoInput, setRepoInput] = React.useState('');
  const [tokenInput, setTokenInput] = React.useState('');
  const [savedToken, setSavedToken] = React.useState(false); // whether a token is already stored
  const [showToken, setShowToken] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return;
      const res = await fetch(`/api/gitlab/link?projectId=${encodeURIComponent(projectId)}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) return;
      const data = await res.json() as {
        repos?: string[];
        repoUrl?: string | null;
        host?: string | null;
        tokenSaved?: boolean;
      };
      const repos = data.repos ?? [];
      setLinkedRepos(repos);
      if (data.repoUrl) {
        try {
          setLinkedHost(new URL(data.repoUrl).origin);
        } catch {
          setLinkedHost(data.host ?? null);
        }
      } else {
        setLinkedHost(data.host ?? null);
      }
      setSavedToken(Boolean(data.tokenSaved));
    });
  }, [projectId]);

  const handleLink = async () => {
    const raw = repoInput.trim();
    if (!raw) return;
    setSaving(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setError('Not signed in — please refresh.'); return; }
      const body: Record<string, string> = { projectId, repoUrl: raw };
      if (tokenInput.trim()) body['token'] = tokenInput.trim();
      const res = await fetch('/api/gitlab/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify(body),
      });
      const data = await res.json() as { repoPath?: string; repoUrl?: string; repos?: string[]; error?: string };
      if (!res.ok) {
        setError(data.error ?? 'Failed to link repo');
      } else {
        const repos = data.repos ?? [];
        setLinkedRepos(repos);
        if (data.repoUrl) {
          try {
            setLinkedHost(new URL(data.repoUrl).origin);
          } catch {
            setLinkedHost(null);
          }
        }
        setRepoInput('');
        if (tokenInput.trim()) { setSavedToken(true); setTokenInput(''); }
        onReposChanged?.(repos);
      }
    } catch {
      setError('Network error — check server is running');
    } finally {
      setSaving(false);
    }
  };

  const handleUnlink = async (repo: string) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch(`/api/gitlab/link?projectId=${encodeURIComponent(projectId)}&repo=${encodeURIComponent(repo)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = await res.json() as { repos?: string[] };
      setLinkedRepos(data.repos ?? []);
      if ((data.repos ?? []).length === 0) setLinkedHost(null);
      onReposChanged?.(data.repos ?? []);
    } catch { /* ignore */ }
  };

  const inputCls = 'w-full px-4 py-2.5 bg-surface border border-border text-heading text-sm font-mono placeholder:text-muted/50 focus:outline-none focus:border-[#FC6D26]/50 transition-colors rounded';

  return (
    <div className="border border-border bg-surface p-6">
      <div className="flex items-center gap-2 mb-6">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" className="text-[#FC6D26]">
          <path d="M22.65 14.39L12 22.13 1.35 14.39a.84.84 0 01-.3-.94l1.22-3.78 2.44-7.51A.42.42 0 014.82 2a.43.43 0 01.58 0 .42.42 0 01.11.18l2.44 7.49h8.1l2.44-7.51A.42.42 0 0118.6 2a.43.43 0 01.58 0 .42.42 0 01.11.18l2.44 7.51 1.22 3.78a.84.84 0 01-.3.92z"/>
        </svg>
        <h3 className="font-sans text-sm font-bold text-heading">GitLab Repositories</h3>
        {linkedRepos.length > 0 && (
          <span className="text-[9px] px-1.5 py-0.5 bg-[#FC6D26]/10 text-[#FC6D26] rounded font-mono">connected</span>
        )}
      {savedToken && (
          <span className="text-[9px] px-1.5 py-0.5 bg-green-500/10 text-green-400 rounded font-mono">your token saved</span>
        )}
      </div>

      {linkedRepos.length > 0 && (
        <div className="space-y-2 mb-5">
          {linkedRepos.map((repo) => (
            <div key={repo} className="flex items-center gap-3 p-3 border border-[#FC6D26]/20 bg-[#FC6D26]/5 rounded">
              <div className="flex-1 min-w-0">
                <div className="text-xs text-heading font-mono truncate">{repo}</div>
                <div className="text-[10px] text-muted font-mono truncate mt-0.5">{linkedHost ? `${linkedHost}/${repo}` : repo}</div>
              </div>
              <button type="button" onClick={() => handleUnlink(repo)}
                className="px-2.5 py-1 border border-danger/30 text-danger text-[10px] tracking-wider uppercase hover:bg-danger/5 transition-colors rounded shrink-0">
                Disconnect
              </button>
            </div>
          ))}
          <p className="text-[11px] text-muted">Commits, README, and source files from the connected repo are included in AI insights and chat context.</p>
        </div>
      )}

      <div className="space-y-3 max-w-lg">
        {linkedRepos.length === 0 && (
          <p className="text-xs text-muted">Connect one GitLab repository so the AI can read commits, README, and source files.</p>
        )}

        {/* Personal access token */}
        <div>
          <label className="block text-[10px] text-muted font-mono mb-1 uppercase tracking-wider">
            Personal Access Token {savedToken && <span className="text-green-400 normal-case">(saved — enter new to replace)</span>}
          </label>
          <div className="relative">
            <input
              type={showToken ? 'text' : 'password'}
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder={savedToken ? '••••••••••••••••' : 'Paste your personal access token'}
              className={`${inputCls} pr-10`}
            />
            <button
              type="button"
              onClick={() => setShowToken((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-heading transition-colors"
              title={showToken ? 'Hide token' : 'Show token'}
            >
              {showToken
                ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              }
            </button>
          </div>
          <p className="text-[10px] text-muted mt-1">Create at GitLab → Settings → Access Tokens. Needs <span className="font-mono">read_repository</span> scope. The token is saved only for your Odyssey account.</p>
        </div>

        {/* Repo URL */}
        <div>
          <label className="block text-[10px] text-muted font-mono mb-1 uppercase tracking-wider">Repository URL</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={repoInput}
              onChange={(e) => setRepoInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleLink()}
              placeholder="https://gitlab.example.com/group/project-name"
              className={inputCls}
            />
            <button type="button" onClick={handleLink} disabled={saving || !repoInput.trim()}
              className="px-4 py-2.5 bg-[#FC6D26]/10 border border-[#FC6D26]/30 text-[#FC6D26] text-xs font-semibold tracking-wider uppercase hover:bg-[#FC6D26]/20 transition-colors rounded disabled:opacity-50 flex items-center gap-2 shrink-0">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Link size={14} />}
              Connect
            </button>
          </div>
          <p className="text-[10px] text-muted mt-1">Enter the full HTTPS URL for the GitLab project. Each connect adds another repo for this project.</p>
        </div>

        {error && <p className="text-xs text-danger font-mono">{error}</p>}
      </div>
    </div>
  );
}

// ── Project name / description editor ─────────────────────────────────────────
function ProjectNameForm({
  project,
  updateProject,
  isOwner,
  imageUploading,
  handleImageUpload,
}: {
  project: { id?: string; name: string; description?: string | null; start_date?: string | null; invite_code?: string | null; image_url?: string | null };
  updateProject: (updates: { name?: string; description?: string; start_date?: string | null; invite_code?: string; image_url?: string | null }) => Promise<unknown>;
  isOwner: boolean;
  imageUploading?: boolean;
  handleImageUpload?: (file: File, inputEl?: HTMLInputElement | null) => Promise<void> | void;
}) {
  const CROP_OFFSET_LIMIT = 180;
  const CROP_ZOOM_MIN = 1;
  const CROP_ZOOM_MAX = 3;
  const CROP_ZOOM_STEP = 0.08;
  const [name, setName] = React.useState(project.name);
  const [description, setDescription] = React.useState(project.description ?? '');
  const [startDate, setStartDate] = React.useState(project.start_date ?? '');
  const [inviteCode, setInviteCode] = React.useState(project.invite_code ?? '');
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [copiedInviteCode, setCopiedInviteCode] = React.useState(false);
  const [imageMenuOpen, setImageMenuOpen] = React.useState(false);
  const [editImageLoading, setEditImageLoading] = React.useState(false);
  const [cropDialogOpen, setCropDialogOpen] = React.useState(false);
  const [cropSourceUrl, setCropSourceUrl] = React.useState<string | null>(null);
  const [cropZoom, setCropZoom] = React.useState(1);
  const [cropOffsetX, setCropOffsetX] = React.useState(0);
  const [cropOffsetY, setCropOffsetY] = React.useState(0);
  const [cropSaving, setCropSaving] = React.useState(false);
  const [cropError, setCropError] = React.useState<string | null>(null);
  const [cropDragging, setCropDragging] = React.useState(false);
  const imageMenuRef = React.useRef<HTMLDivElement | null>(null);
  const projectImageInputRef = React.useRef<HTMLInputElement | null>(null);
  const cropDragStateRef = React.useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originOffsetX: number;
    originOffsetY: number;
  } | null>(null);
  const projectFingerprint = project.id ? getProjectFingerprint(project.id) : null;

  const dirty = name.trim() !== project.name
    || description.trim() !== (project.description ?? '')
    || startDate !== (project.start_date ?? '')
    || inviteCode !== (project.invite_code ?? '');

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    await updateProject({
      name: name.trim(),
      description: description.trim() || undefined,
      start_date: startDate || null,
      invite_code: inviteCode,
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleCopyInviteCode = async () => {
    if (!inviteCode) return;
    await navigator.clipboard.writeText(inviteCode);
    setCopiedInviteCode(true);
    setTimeout(() => setCopiedInviteCode(false), 1600);
  };

  React.useEffect(() => {
    if (!imageMenuOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!imageMenuRef.current?.contains(event.target as Node)) {
        setImageMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [imageMenuOpen]);

  React.useEffect(() => {
    if (!cropDragging) return;

    const clampCropOffset = (value: number) => Math.max(-CROP_OFFSET_LIMIT, Math.min(CROP_OFFSET_LIMIT, value));

    const handlePointerMove = (event: PointerEvent) => {
      const dragState = cropDragStateRef.current;
      if (!dragState || event.pointerId !== dragState.pointerId) return;
      setCropOffsetX(clampCropOffset(dragState.originOffsetX + (event.clientX - dragState.startX)));
      setCropOffsetY(clampCropOffset(dragState.originOffsetY + (event.clientY - dragState.startY)));
    };

    const handlePointerUp = (event: PointerEvent) => {
      const dragState = cropDragStateRef.current;
      if (!dragState || event.pointerId !== dragState.pointerId) return;
      cropDragStateRef.current = null;
      setCropDragging(false);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [CROP_OFFSET_LIMIT, cropDragging]);

  React.useEffect(() => {
    if (cropDialogOpen) return;
    cropDragStateRef.current = null;
    setCropDragging(false);
  }, [cropDialogOpen]);

  const handleReplaceProjectImage = () => {
    setImageMenuOpen(false);
    projectImageInputRef.current?.click();
  };

  const handleProjectImageFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await Promise.resolve(handleImageUpload?.(file, event.target));
    event.target.value = '';
  };

  const handleOpenImageEditor = async () => {
    if (!project.image_url) return;

    setEditImageLoading(true);
    setCropError(null);
    try {
      const dataUrl = await resolveImageSourceToDataUrl(project.image_url);
      setCropSourceUrl(dataUrl);
      setCropZoom(1);
      setCropOffsetX(0);
      setCropOffsetY(0);
      setCropDialogOpen(true);
      setImageMenuOpen(false);
    } catch (error) {
      setCropError(error instanceof Error ? error.message : 'Unable to load the current image for editing.');
    } finally {
      setEditImageLoading(false);
    }
  };

  const handleSaveCroppedImage = async () => {
    if (!cropSourceUrl) return;

    setCropSaving(true);
    setCropError(null);
    try {
      const nextFile = await createCroppedProjectImageFile(
        cropSourceUrl,
        cropZoom,
        cropOffsetX,
        cropOffsetY,
        `${(project.name || 'project').trim().replace(/\s+/g, '-').toLowerCase() || 'project'}-image.png`,
      );
      if (handleImageUpload) {
        await Promise.resolve(handleImageUpload(nextFile, projectImageInputRef.current));
      } else {
        const fallbackDataUrl = await readBlobAsDataUrl(nextFile);
        await updateProject({ image_url: fallbackDataUrl });
      }
      setCropDialogOpen(false);
    } catch (error) {
      setCropError(error instanceof Error ? error.message : 'Failed to save the cropped image.');
    } finally {
      setCropSaving(false);
    }
  };

  const handleCropPreviewPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (cropSaving || imageUploading) return;
    event.preventDefault();
    cropDragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originOffsetX: cropOffsetX,
      originOffsetY: cropOffsetY,
    };
    setCropDragging(true);
  };

  const handleCropPreviewWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (cropSaving || imageUploading) return;
    event.preventDefault();
    setCropZoom((currentZoom) => {
      const nextZoom = currentZoom + (event.deltaY < 0 ? CROP_ZOOM_STEP : -CROP_ZOOM_STEP);
      return Math.max(CROP_ZOOM_MIN, Math.min(CROP_ZOOM_MAX, Number(nextZoom.toFixed(2))));
    });
  };

  return (
    <div className="border border-border bg-surface p-6">
      <div className="flex items-center gap-2 mb-6">
        <Settings size={14} className="text-heading" />
        <h3 className="font-sans text-sm font-bold text-heading">Project Details</h3>
      </div>
      <form onSubmit={handleSave}>
        <div className="flex flex-col xl:flex-row gap-5 xl:items-stretch">
          <div className="flex flex-col gap-3 w-full xl:w-[26rem] shrink-0">
            {/* Project image + name side-by-side */}
            <div className="flex items-start gap-4">
              <div className="relative shrink-0" ref={imageMenuRef}>
                <button
                  type="button"
                  onClick={() => setImageMenuOpen((current) => !current)}
                  className="group relative flex h-16 w-16 items-center justify-center overflow-hidden rounded-lg border border-border bg-surface2 transition-colors hover:border-accent/35"
                  title={project.image_url ? 'Edit or replace project image' : 'Upload project image'}
                >
                  {project.image_url
                    ? <img src={project.image_url} alt="Project" className="w-full h-full object-cover" />
                    : <span className="text-xl font-bold text-muted/40">{project.name[0]?.toUpperCase()}</span>
                  }
                  <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/55 opacity-0 transition-opacity group-hover:opacity-100">
                    {imageUploading || editImageLoading
                      ? <Loader2 size={14} className="animate-spin text-white" />
                      : <Pencil size={14} className="text-white" />
                    }
                  </span>
                </button>
                <input
                  ref={projectImageInputRef}
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  disabled={imageUploading || cropSaving}
                  onChange={handleProjectImageFileChange}
                />
                {imageMenuOpen && (
                  <div className="absolute left-0 top-full z-20 mt-2 w-40 overflow-hidden rounded-lg border border-border bg-surface shadow-[0_18px_40px_rgba(15,23,42,0.18)]">
                    <button
                      type="button"
                      onClick={handleOpenImageEditor}
                      disabled={!project.image_url || editImageLoading}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-heading transition-colors hover:bg-surface2 disabled:cursor-not-allowed disabled:text-muted/50"
                    >
                      {editImageLoading ? <Loader2 size={14} className="animate-spin" /> : <Pencil size={14} />}
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={handleReplaceProjectImage}
                      disabled={imageUploading}
                      className="flex w-full items-center gap-2 border-t border-border px-3 py-2 text-left text-sm text-heading transition-colors hover:bg-surface2 disabled:cursor-not-allowed disabled:text-muted/50"
                    >
                      {imageUploading ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                      {project.image_url ? 'Replace' : 'Upload'}
                    </button>
                  </div>
                )}
                {project.image_url && (
                  <button type="button" title="Remove image"
                    onClick={() => updateProject({ image_url: null })}
                    className="absolute -bottom-1.5 -right-1.5 w-5 h-5 rounded-full bg-danger text-white flex items-center justify-center border border-surface hover:bg-danger/80 transition-colors">
                    <X size={9} />
                  </button>
                )}
              </div>
              <div className="flex-1">
                <label className="block text-[10px] tracking-[0.2em] uppercase text-muted mb-1.5">Project Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  title="Project name"
                  placeholder="Project name"
                  className="w-full px-3 py-2 bg-surface border border-border text-heading text-sm font-mono placeholder:text-muted/50 focus:outline-none focus:border-accent/50 transition-colors rounded"
                />
              </div>
            </div>
            <div>
              <label className="block text-[10px] tracking-[0.2em] uppercase text-muted mb-1.5">Start Date</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                title="Project start date"
                className="w-full px-3 py-2 bg-surface border border-border text-heading text-sm font-mono focus:outline-none focus:border-accent/50 transition-colors rounded"
              />
            </div>
            {projectFingerprint && (
              <div>
                <label className="block text-[10px] tracking-[0.2em] uppercase text-muted mb-1.5">Project Hash</label>
                <div className="w-full px-3 py-2 bg-surface2 border border-border text-heading text-sm font-mono rounded">
                  {projectFingerprint}
                </div>
                <p className="mt-1 text-[10px] text-muted">All users in the same project will see the same hash.</p>
              </div>
            )}
            {cropError && !cropDialogOpen && (
              <p className="text-[11px] text-danger">{cropError}</p>
            )}
            <div>
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <div className="flex items-center gap-3">
                  <label className="block text-[10px] tracking-[0.2em] uppercase text-muted">Project ID Code</label>
                  <button
                    type="button"
                    onClick={() => setInviteCode(generateProjectCode())}
                    className="text-[10px] font-mono text-accent hover:underline"
                  >
                    Generate
                  </button>
                </div>
              </div>
              <div className="flex items-stretch gap-2">
                <input
                  type="text"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(sanitizeProjectCode(e.target.value))}
                  title="Project ID code"
                  placeholder="Project ID code"
                  className="min-w-0 flex-1 px-3 py-2 bg-surface border border-border text-heading text-sm font-mono tracking-[0.12em] uppercase focus:outline-none focus:border-accent/50 transition-colors rounded"
                />
                {inviteCode.trim() && (
                  <button
                    type="button"
                    onClick={handleCopyInviteCode}
                    title="Copy project ID code"
                    className="shrink-0 inline-flex items-center justify-center gap-1.5 px-3 py-2 border border-border text-muted hover:text-heading hover:bg-surface2 text-[10px] font-semibold tracking-wider uppercase transition-colors rounded"
                  >
                    {copiedInviteCode ? <Check size={11} className="text-accent2" /> : <Copy size={11} />}
                    <span>{copiedInviteCode ? 'Copied' : 'Copy'}</span>
                  </button>
                )}
              </div>
              <p className="mt-1 text-[10px] text-muted">
                {PROJECT_CODE_LENGTH}-character join code. Changing it invalidates the old code immediately.
              </p>
            </div>
          </div>
          <div className="flex-1 flex flex-col pb-[20px]">
            <label className="block text-[10px] tracking-[0.2em] uppercase text-muted mb-1.5">Description (optional)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this project about?"
              className="flex-1 w-full px-3 py-2 bg-surface border border-border text-heading text-sm font-mono placeholder:text-muted/50 focus:outline-none focus:border-accent/50 transition-colors rounded resize-none"
            />
          </div>
        </div>
        <div className="mt-3">
          <button
            type="submit"
            disabled={saving || !dirty || !name.trim()}
            className="flex items-center gap-2 px-5 py-2 bg-accent/10 border border-accent/30 text-accent text-xs font-sans font-semibold tracking-wider uppercase hover:bg-accent/20 transition-colors rounded-md disabled:opacity-50"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : saved ? <CheckCircle size={12} /> : null}
            {saved ? 'Saved' : 'Save Changes'}
          </button>
        </div>
      </form>
      {cropDialogOpen && cropSourceUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(8,15,28,0.58)] p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-3xl border border-border bg-surface p-6 shadow-[0_24px_60px_rgba(15,23,42,0.28)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h4 className="font-sans text-sm font-bold text-heading">Edit Project Image</h4>
                <p className="mt-1 text-[11px] leading-relaxed text-muted">
                  Adjust the crop, then save to replace the current project image.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setCropDialogOpen(false);
                  setCropError(null);
                }}
                className="inline-flex h-8 w-8 items-center justify-center border border-border bg-surface2 text-muted transition-colors hover:text-heading"
                title="Close image editor"
              >
                <X size={14} />
              </button>
            </div>

            <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
              <div className="flex items-center justify-center border border-border bg-surface2 p-5">
                <div
                  className={`relative h-[22rem] w-[22rem] overflow-hidden border border-border bg-surface shadow-inner ${cropDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
                  onPointerDown={handleCropPreviewPointerDown}
                  onWheel={handleCropPreviewWheel}
                  style={{ touchAction: 'none' }}
                >
                  <img
                    src={cropSourceUrl}
                    alt="Project crop preview"
                    className="pointer-events-none absolute left-1/2 top-1/2 max-w-none select-none"
                    draggable={false}
                    style={{
                      width: `calc(100% * ${cropZoom})`,
                      height: `calc(100% * ${cropZoom})`,
                      objectFit: 'cover',
                      transform: `translate(calc(-50% + ${cropOffsetX}px), calc(-50% + ${cropOffsetY}px))`,
                    }}
                  />
                </div>
              </div>

              <div className="space-y-5">
                <div>
                  <label className="mb-2 block text-[10px] uppercase tracking-[0.18em] text-muted">Zoom</label>
                  <input
                    type="range"
                    min={CROP_ZOOM_MIN}
                    max={CROP_ZOOM_MAX}
                    step={0.01}
                    value={cropZoom}
                    onChange={(event) => setCropZoom(Number(event.target.value))}
                    className="w-full accent-[var(--color-accent)]"
                  />
                  <div className="mt-1 text-[11px] text-muted">{cropZoom.toFixed(2)}x</div>
                </div>
                <div>
                  <label className="mb-2 block text-[10px] uppercase tracking-[0.18em] text-muted">Horizontal Position</label>
                  <input
                    type="range"
                    min={-CROP_OFFSET_LIMIT}
                    max={CROP_OFFSET_LIMIT}
                    step={1}
                    value={cropOffsetX}
                    onChange={(event) => setCropOffsetX(Number(event.target.value))}
                    className="w-full accent-[var(--color-accent)]"
                  />
                </div>
                <div>
                  <label className="mb-2 block text-[10px] uppercase tracking-[0.18em] text-muted">Vertical Position</label>
                  <input
                    type="range"
                    min={-CROP_OFFSET_LIMIT}
                    max={CROP_OFFSET_LIMIT}
                    step={1}
                    value={cropOffsetY}
                    onChange={(event) => setCropOffsetY(Number(event.target.value))}
                    className="w-full accent-[var(--color-accent)]"
                  />
                </div>
                <p className="text-[11px] text-muted">
                  Drag the image preview to reposition it, scroll to zoom, or use the sliders for finer adjustment.
                </p>
                {cropError && (
                  <p className="text-[11px] text-danger">{cropError}</p>
                )}
                <div className="flex items-center gap-3 pt-2">
                  <button
                    type="button"
                    onClick={handleSaveCroppedImage}
                    disabled={cropSaving || imageUploading}
                    className="inline-flex items-center gap-2 border border-accent/30 bg-accent/10 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-accent transition-colors hover:bg-accent/16 disabled:opacity-50"
                  >
                    {cropSaving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                    Save Crop
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCropDialogOpen(false);
                      setCropError(null);
                    }}
                    className="inline-flex items-center gap-2 border border-border bg-surface2 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-heading transition-colors hover:bg-surface"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


export interface SettingsTabProps {
  project: {
    id: string;
    name: string;
    owner_id: string;
    description?: string | null;
    github_repo?: string | null;
    github_repos?: string[] | null;
    is_private?: boolean;
    invite_code?: string | null;
    start_date?: string | null;
    image_url?: string | null;
  };
  projectId: string;
  isOwner: boolean;
  members: MemberRow[];
  user: { id?: string; user_metadata?: { user_name?: string; avatar_url?: string; email?: string }; email?: string } | null;
  joinRequests: JoinRequest[];
  respondJoinRequest: (id: string, action: 'approve' | 'deny') => Promise<unknown>;
  refetchJoinRequests: () => void;
  inviteRole: 'member' | 'owner';
  setInviteRole: React.Dispatch<React.SetStateAction<'member' | 'owner'>>;
  inviteTab: 'username' | 'nps_email' | 'shared' | 'qr';
  setInviteTab: React.Dispatch<React.SetStateAction<'username' | 'nps_email' | 'shared' | 'qr'>>;
  memberSearch: string;
  setMemberSearch: React.Dispatch<React.SetStateAction<string>>;
  memberSearching: boolean;
  sharedInviteCandidates: SharedInviteCandidate[];
  sharedInviteLoading: boolean;
  repoInput: string;
  setRepoInput: React.Dispatch<React.SetStateAction<string>>;
  repoSaving: boolean;
  scanResults: { completed: string[]; suggested: { title: string; reason: string }[] } | null;
  events: OdysseyEvent[];
  auditFrom: string;
  setAuditFrom: React.Dispatch<React.SetStateAction<string>>;
  auditTo: string;
  setAuditTo: React.Dispatch<React.SetStateAction<string>>;
  auditPreset: '2W' | '1M' | '3M' | '6M' | 'Full' | 'custom';
  setAuditPreset: React.Dispatch<React.SetStateAction<'2W' | '1M' | '3M' | '6M' | 'Full' | 'custom'>>;
  auditType: string;
  setAuditType: React.Dispatch<React.SetStateAction<string>>;
  auditPage: number;
  setAuditPage: React.Dispatch<React.SetStateAction<number>>;
  AUDIT_PAGE_SIZE: number;
  imageUploading: boolean;
  projectLabels: { id: string; name: string; color: string; type: 'category' | 'loe' }[];
  editPromptFeature: PromptFeature | null;
  setEditPromptFeature: React.Dispatch<React.SetStateAction<PromptFeature | null>>;
  editPromptText: string;
  setEditPromptText: React.Dispatch<React.SetStateAction<string>>;
  resetPromptsTyped: string;
  setResetPromptsTyped: React.Dispatch<React.SetStateAction<string>>;
  resetPromptsModalOpen: boolean;
  setResetPromptsModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  deletingProject: boolean;
  leavingProject: boolean;
  goals: { id: string; title: string }[];
  updateProject: (updates: Record<string, unknown>) => Promise<unknown>;
  updateGoal: (id: string, updates: Record<string, unknown>) => Promise<unknown>;
  createGoal: (data: { title: string }) => Promise<unknown>;
  handleSaveRepo: () => void;
  handleRepoScan: () => void;
  scanLoading: boolean;
  handleInviteByIdentifier: () => Promise<void>;
  handleInviteSharedCollaborator: (userId: string) => Promise<void>;
  handleRemoveMember: (userId: string) => void;
  handlePromoteMember: (userId: string) => void;
  handleImageUpload: (file: File, inputEl?: HTMLInputElement | null) => void;
  handleExportAuditCSV: () => void;
  addLabel: (type: 'category' | 'loe', name: string, color: string) => Promise<unknown>;
  deleteLabel: (id: string) => Promise<void>;
  getPrompt: (feature: PromptFeature) => string | null | undefined;
  savePrompt: (feature: PromptFeature, text: string) => void;
  resetPrompt: (feature: PromptFeature) => void;
  resetAllPrompts: () => void;
  setDeleteModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setGitlabRepos: React.Dispatch<React.SetStateAction<string[]>>;
}

// ── Tab Visibility Section ────────────────────────────────────────────────────
function TabVisibilitySection({ projectId }: { projectId: string }) {
  const { isVisible, setTabVisible, lockedVisible } = useTabVisibility(projectId);
  const [updated, setUpdated] = React.useState(false);

  const handleUpdate = () => {
    // Changes propagate instantly via the custom event in useTabVisibility.
    // This button provides explicit confirmation feedback.
    window.dispatchEvent(new CustomEvent('odyssey:tab-visibility-changed', { detail: projectId }));
    setUpdated(true);
    setTimeout(() => setUpdated(false), 2000);
  };

  return (
    <div className="border border-border bg-surface p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Settings size={14} className="text-accent" />
          <h3 className="font-sans text-sm font-bold text-heading">Tab Visibility</h3>
        </div>
        <button
          type="button"
          onClick={handleUpdate}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider rounded border transition-all ${
            updated
              ? 'border-accent/30 bg-accent/10 text-accent'
              : 'border-border text-muted hover:bg-surface2 hover:text-heading'
          }`}
        >
          {updated ? <><Check size={11} /> Updated</> : 'Update'}
        </button>
      </div>
      <p className="text-xs text-muted mb-4">Choose which tabs appear in the navigation bar for this project. The default layout shows Overview, Timeline, Tasks, Activity, Coordination, Reports, Documents, and Settings, while optional tabs stay available here but start hidden.</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {ALL_TABS.map((tab) => {
          const locked = lockedVisible.includes(tab.id);
          const visible = isVisible(tab.id);
          return (
            <label
              key={tab.id}
              className={`flex items-center gap-2 px-3 py-2 border rounded cursor-pointer select-none transition-colors ${
                locked ? 'opacity-50 cursor-not-allowed border-border' :
                visible ? 'border-accent/30 bg-accent/5' : 'border-border hover:border-border/80'
              }`}
            >
              <input
                type="checkbox"
                checked={visible}
                disabled={locked}
                onChange={(e) => setTabVisible(tab.id, e.target.checked)}
                className="accent-[var(--color-accent)] w-3 h-3"
              />
              <span className="text-xs font-mono text-heading">{tab.label}</span>
              {locked && <span className="text-[9px] text-muted/60 font-mono ml-auto">always on</span>}
            </label>
          );
        })}
      </div>
    </div>
  );
}

function SettingsTab({
  project,
  projectId,
  isOwner,
  members,
  user,
  joinRequests,
  respondJoinRequest,
  refetchJoinRequests,
  inviteRole,
  setInviteRole,
  inviteTab,
  setInviteTab,
  memberSearch,
  setMemberSearch,
  memberSearching,
  sharedInviteCandidates,
  sharedInviteLoading,
  repoInput,
  setRepoInput,
  repoSaving,
  scanResults,
  events,
  auditFrom,
  setAuditFrom,
  auditTo,
  setAuditTo,
  auditPreset,
  setAuditPreset,
  auditType,
  setAuditType,
  auditPage,
  setAuditPage,
  AUDIT_PAGE_SIZE,
  imageUploading,
  projectLabels,
  editPromptFeature,
  setEditPromptFeature,
  editPromptText,
  setEditPromptText,
  resetPromptsTyped,
  setResetPromptsTyped,
  resetPromptsModalOpen,
  setResetPromptsModalOpen,
  deletingProject,
  leavingProject,
  goals,
  updateProject,
  updateGoal,
  createGoal,
  handleSaveRepo,
  handleRepoScan,
  scanLoading,
  handleInviteByIdentifier,
  handleInviteSharedCollaborator,
  handleRemoveMember,
  handlePromoteMember,
  handleImageUpload,
  handleExportAuditCSV,
  addLabel,
  deleteLabel,
  getPrompt,
  savePrompt,
  resetPrompt,
  resetAllPrompts,
  setDeleteModalOpen,
  setGitlabRepos,
}: SettingsTabProps) {
  const [memberActionError, setMemberActionError] = React.useState<string | null>(null);
  const [inviteError, setInviteError] = React.useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = React.useState<string | null>(null);
  const [sharedInviteOpen, setSharedInviteOpen] = React.useState(false);
  const [sharedInviteSearch, setSharedInviteSearch] = React.useState('');
  const [selectedSharedInviteKey, setSelectedSharedInviteKey] = React.useState<string | null>(null);
  const [sharedInviteSubmitting, setSharedInviteSubmitting] = React.useState(false);
  const [promotingMemberId, setPromotingMemberId] = React.useState<string | null>(null);
  const [removingMemberId, setRemovingMemberId] = React.useState<string | null>(null);
  const githubRepos = getGitHubRepos(project);
  const sharedInviteCandidateKey = React.useCallback(
    (candidate: SharedInviteCandidate) => `${candidate.id}:${candidate.project_id ?? 'none'}`,
    [],
  );
  const selectedSharedInvite = React.useMemo(
    () => sharedInviteCandidates.find((candidate) => sharedInviteCandidateKey(candidate) === selectedSharedInviteKey) ?? null,
    [selectedSharedInviteKey, sharedInviteCandidateKey, sharedInviteCandidates],
  );
  const filteredSharedInviteCandidates = React.useMemo(() => {
    const query = sharedInviteSearch.trim().toLowerCase();
    if (!query) return sharedInviteCandidates;
    return sharedInviteCandidates.filter((candidate) => {
      const haystack = [
        candidate.display_name,
        candidate.project_name,
        candidate.id,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [sharedInviteCandidates, sharedInviteSearch]);
  // ── Report Templates ──────────────────────────────────────────────────────
  const [templates, setTemplates] = React.useState<{
    id: string;
    templateType: 'docx' | 'pptx' | 'pdf';
    sourceFormat?: 'docx' | 'pptx' | 'pdf';
    filename: string;
    sizeBytes: number;
    storagePath: string;
    uploadedAt: string;
    documentId?: string | null;
    analysis?: {
      summary?: string;
      styleHints?: string[];
      layoutHints?: string[];
      fonts?: string[];
      palette?: string[];
      analysisConfidence?: 'low' | 'medium' | 'high';
      sourceFormat?: 'docx' | 'pptx' | 'pdf';
    } | null;
  }[]>([]);
  const [templateUploading, setTemplateUploading] = React.useState<'docx' | 'pptx' | 'pdf' | null>(null);
  const [templateError, setTemplateError] = React.useState<string | null>(null);
  const [labelError, setLabelError] = React.useState<string | null>(null);
  const [labelDeletingId, setLabelDeletingId] = React.useState<string | null>(null);
  const [labelSaving, setLabelSaving] = React.useState(false);
  const [newCategoryLabelName, setNewCategoryLabelName] = React.useState('');
  const [newCategoryLabelColor, setNewCategoryLabelColor] = React.useState('#6a9fd8');
  const [newLoeLabelName, setNewLoeLabelName] = React.useState('');
  const [newLoeLabelColor, setNewLoeLabelColor] = React.useState('#e0ab11');
  // One ref per template slot so the hidden inputs are stable across re-renders
  const tmplInputDocx = React.useRef<HTMLInputElement>(null);
  const tmplInputPptx = React.useRef<HTMLInputElement>(null);
  const tmplInputPdf  = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return;
      const res = await fetch(`/api/projects/${projectId}/report-templates`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.ok) {
        const d = await res.json();
        setTemplates(d.templates ?? []);
      }
    });
  }, [projectId]);

  React.useEffect(() => {
    setInviteError(null);
    setInviteSuccess(null);
    if (inviteTab !== 'shared') {
      setSharedInviteOpen(false);
      setSharedInviteSearch('');
      setSelectedSharedInviteKey(null);
    }
  }, [inviteTab]);

  React.useEffect(() => {
    if (!selectedSharedInviteKey) return;
    if (sharedInviteCandidates.some((candidate) => sharedInviteCandidateKey(candidate) === selectedSharedInviteKey)) return;
    setSelectedSharedInviteKey(null);
  }, [selectedSharedInviteKey, sharedInviteCandidateKey, sharedInviteCandidates]);

  const uploadTemplateInChunks = async (
    templateType: 'docx' | 'pptx' | 'pdf',
    file: File,
    accessToken: string,
  ) => {
    const totalChunks = Math.max(1, Math.ceil(file.size / REPORT_TEMPLATE_CHUNK_BYTES));
    const initRes = await fetch('/api/uploads/report-template/init', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        projectId,
        templateType,
        filename: file.name,
        mimeType: file.type || 'application/octet-stream',
        totalChunks,
      }),
    });

    if (!initRes.ok) {
      const fallback = initRes.status === 413
        ? 'Template upload was rejected before it reached Odyssey. Raise the reverse-proxy request limit or retry with a smaller file.'
        : 'Unable to start template upload.';
      throw new Error(await readTemplateUploadError(initRes, fallback));
    }

    const initData = await initRes.json() as { uploadId?: string; chunkSizeBytes?: number };
    const uploadId = initData.uploadId?.trim();
    if (!uploadId) throw new Error('Upload session did not start correctly.');
    const chunkSize = Math.max(32 * 1024, Math.min(Number(initData.chunkSizeBytes) || REPORT_TEMPLATE_CHUNK_BYTES, REPORT_TEMPLATE_CHUNK_BYTES));

    for (let chunkIndex = 0, start = 0; start < file.size; chunkIndex += 1, start += chunkSize) {
      const form = new FormData();
      form.append('uploadId', uploadId);
      form.append('chunkIndex', String(chunkIndex));
      form.append('file', file.slice(start, start + chunkSize), `${file.name}.part`);

      const chunkRes = await fetch('/api/uploads/report-template/chunk', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: form,
      });

      if (!chunkRes.ok) {
        const fallback = chunkRes.status === 413
          ? 'A template chunk still exceeded the proxy limit. Increase nginx client_max_body_size and retry.'
          : `Template upload failed on chunk ${chunkIndex + 1} of ${totalChunks}.`;
        throw new Error(await readTemplateUploadError(chunkRes, fallback));
      }
    }

    const completeRes = await fetch('/api/uploads/report-template/complete', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ uploadId }),
    });

    if (!completeRes.ok) {
      throw new Error(await readTemplateUploadError(completeRes, 'Unable to finalize template upload.'));
    }

    return completeRes.json();
  };

  const handleTemplateUpload = async (templateType: 'docx' | 'pptx' | 'pdf', file: File) => {
    setTemplateUploading(templateType);
    setTemplateError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      if (file.size <= 0) {
        throw new Error('Selected file is empty.');
      }

      const uploadResult = await uploadTemplateInChunks(templateType, file, session.access_token) as {
        template?: {
          id: string;
          templateType: 'docx' | 'pptx' | 'pdf';
          sourceFormat?: 'docx' | 'pptx' | 'pdf';
          filename: string;
          sizeBytes: number;
          storagePath: string;
          uploadedAt: string;
          documentId?: string | null;
          analysis?: {
            summary?: string;
            styleHints?: string[];
            layoutHints?: string[];
            fonts?: string[];
            palette?: string[];
            analysisConfidence?: 'low' | 'medium' | 'high';
            sourceFormat?: 'docx' | 'pptx' | 'pdf';
          } | null;
        };
      };

      if (uploadResult.template) {
        setTemplates((prev) => [...prev.filter((t) => t.templateType !== templateType), uploadResult.template!]);
      }
    } catch (err: unknown) {
      setTemplateError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setTemplateUploading(null);
    }
  };

  const handleTemplateDelete = async (id: string, templateType: 'docx' | 'pptx' | 'pdf') => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const res = await fetch('/api/uploads/report-template', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, eventId: id }),
    });
    if (res.ok) setTemplates((prev) => prev.filter((t) => t.templateType !== templateType));
  };

  const handleTemplateOpen = async (storagePath: string) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session || !storagePath) return;
    const res = await fetch('/api/uploads/sign', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ storagePath }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.url) {
      setTemplateError(data.error ?? 'Unable to open template file.');
      return;
    }
    window.open(data.url, '_blank', 'noopener,noreferrer');
  };

  const handleAddLabel = async (
    type: 'category' | 'loe',
    name: string,
    color: string,
    resetName: React.Dispatch<React.SetStateAction<string>>,
  ) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setLabelSaving(true);
    setLabelError(null);
    try {
      await addLabel(type, trimmed, color);
      resetName('');
    } catch (err) {
      setLabelError(err instanceof Error ? err.message : 'Unable to save label.');
    } finally {
      setLabelSaving(false);
    }
  };

  const handleDeleteLabel = async (id: string) => {
    setLabelDeletingId(id);
    setLabelError(null);
    try {
      await deleteLabel(id);
    } catch (err) {
      setLabelError(err instanceof Error ? err.message : 'Unable to delete label.');
    } finally {
      setLabelDeletingId(null);
    }
  };

  const promoteMember = async (userId: string) => {
    setMemberActionError(null);
    setPromotingMemberId(userId);
    try {
      await handlePromoteMember(userId);
    } catch (err) {
      setMemberActionError(err instanceof Error ? err.message : 'Unable to promote member.');
    } finally {
      setPromotingMemberId(null);
    }
  };

  const removeMember = async (userId: string) => {
    setMemberActionError(null);
    setRemovingMemberId(userId);
    try {
      await handleRemoveMember(userId);
    } catch (err) {
      setMemberActionError(err instanceof Error ? err.message : 'Unable to remove member.');
    } finally {
      setRemovingMemberId(null);
    }
  };

  const submitInvite = async () => {
    setInviteError(null);
    setInviteSuccess(null);
    try {
      if (inviteTab === 'shared') {
        if (!selectedSharedInvite) throw new Error('Choose a person first.');
        setSharedInviteSubmitting(true);
        await handleInviteSharedCollaborator(selectedSharedInvite.id);
        setInviteSuccess(`${selectedSharedInvite.display_name ?? 'Selected user'} was added to the project.`);
        setSelectedSharedInviteKey(null);
        setSharedInviteSearch('');
        setSharedInviteOpen(false);
        return;
      }

      await handleInviteByIdentifier();
      setInviteSuccess(inviteTab === 'username'
        ? 'User added to the project by Odyssey username.'
        : 'User added to the project by linked email.');
      setMemberSearch('');
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : 'Unable to invite that user.');
    } finally {
      setSharedInviteSubmitting(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Project Name & Description */}
      <ProjectNameForm project={project} updateProject={updateProject} isOwner={isOwner} imageUploading={imageUploading} handleImageUpload={handleImageUpload} />

      {/* Team Members + Invite Members to Project — side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Team Members — always show current user */}
        <div className="border border-border bg-surface p-6">
          <div className="flex items-center gap-2 mb-6">
            <Users size={14} className="text-accent2" />
            <h3 className="font-sans text-sm font-bold text-heading">
              Team Members ({1 + members.filter((m) => m.user_id !== user?.id).length})
            </h3>
          </div>
          {memberActionError && (
            <div className="mb-4 rounded border border-danger/30 bg-danger/5 px-3 py-2 text-[11px] text-danger">
              {memberActionError}
            </div>
          )}
          <div className="space-y-px border border-border bg-border">
            {/* Current user — always rendered first */}
            {user && (() => {
              const myRow = members.find((m) => m.user_id === user.id);
              const myRole = myRow?.role ?? (isOwner ? 'owner' : 'member');
              const myName = myRow?.profile?.display_name ?? user.user_metadata?.user_name ?? user.email ?? 'You';
              const myAvatar = myRow?.profile?.avatar_url ?? user.user_metadata?.avatar_url ?? null;
              const myRoleLabel = formatMemberRole(myRole);
              return (
                <div className="flex items-center gap-3 bg-surface px-4 py-3">
                  <UserAvatar
                    label={myName}
                    avatar={myAvatar}
                    className="w-7 h-7"
                    fallbackClassName="bg-accent/20 text-accent"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-heading font-medium truncate">
                      {myName} <span className="ml-1 text-[9px] text-muted">(you)</span>
                    </div>
                    <div className="text-[10px] text-muted">{myRoleLabel}</div>
                  </div>
                </div>
              );
            })()}
            {/* Other members from DB */}
            {members.filter((m) => m.user_id !== user?.id).map((m) => {
              const memberLabel = m.profile?.display_name ?? m.user_id;
              const roleLabel = formatMemberRole(m.role);
              return (
                <div key={m.user_id} className="flex items-center gap-3 bg-surface px-4 py-3 group">
                  <UserAvatar
                    label={memberLabel}
                    avatar={m.profile?.avatar_url ?? null}
                    className="w-7 h-7"
                    fallbackClassName="bg-accent2/20 text-accent2"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-heading font-medium truncate">{memberLabel}</div>
                    <div className="text-[10px] text-muted">{roleLabel}</div>
                  </div>
                  {isOwner && (
                    <div className="flex items-center gap-2 shrink-0">
                      {m.role !== 'owner' && (
                        <button
                          type="button"
                          onClick={() => { void promoteMember(m.user_id); }}
                          disabled={promotingMemberId === m.user_id || removingMemberId === m.user_id}
                          className="px-2 py-1 text-[9px] border border-accent3/30 text-accent3 rounded hover:bg-accent3/10 transition-colors uppercase tracking-wider disabled:opacity-50"
                          title="Promote member to owner"
                        >
                          {promotingMemberId === m.user_id ? 'Promoting…' : 'Make Owner'}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => { void removeMember(m.user_id); }}
                        disabled={promotingMemberId === m.user_id || removingMemberId === m.user_id}
                        className="p-1 text-muted hover:text-danger transition-colors disabled:opacity-50"
                        title="Remove member"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Invite Members to Project */}
        <div className="border border-border bg-surface p-6">
            <div className="flex items-center gap-2 mb-5">
              <UserPlus size={14} className="text-accent" />
              <h3 className="font-sans text-sm font-bold text-heading">Invite Members to Project</h3>
            </div>

            {/* Invite tabs */}
            <div className="flex items-center gap-px border border-border rounded overflow-hidden mb-5 w-fit">
              {(['shared', 'nps_email', 'username', 'qr'] as const).map((tab) => (
                <button key={tab} type="button" onClick={() => setInviteTab(tab)}
                  className={`px-3 py-1.5 text-[10px] font-semibold tracking-wider uppercase transition-colors ${inviteTab === tab ? 'bg-accent/10 text-accent' : 'text-muted hover:bg-surface2'}`}>
                  {tab === 'shared' ? 'In Common' : tab === 'nps_email' ? 'Email' : tab === 'username' ? 'Username' : 'QR Code'}
                </button>
              ))}
            </div>

            {(inviteTab === 'username' || inviteTab === 'nps_email' || inviteTab === 'shared') && (
              <div>
                {inviteTab !== 'shared' && (
                  <p className="text-[11px] text-muted mb-4">
                    {inviteTab === 'username'
                      ? 'Invite someone by the exact username they used when they joined Odyssey.'
                      : 'Invite someone by the email linked to their Odyssey Microsoft sign-in.'}
                  </p>
                )}
                <div className="flex items-center gap-2 mb-4">
                  <span className="text-[10px] tracking-[0.15em] uppercase text-muted">Invite as</span>
                  <div className="flex items-center gap-px border border-border rounded overflow-hidden">
                    {(['member', 'owner'] as const).map((r) => (
                      <button key={r} type="button" onClick={() => setInviteRole(r)}
                        className={`px-3 py-1 text-[10px] font-semibold tracking-wider uppercase transition-colors ${inviteRole === r ? 'bg-accent/10 text-accent' : 'text-muted hover:bg-surface2'}`}>
                        {r.charAt(0).toUpperCase() + r.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
                {inviteError && (
                  <div className="mb-4 rounded border border-danger/30 bg-danger/5 px-3 py-2 text-[11px] text-danger">
                    {inviteError}
                  </div>
                )}
                {inviteSuccess && (
                  <div className="mb-4 rounded border border-accent2/30 bg-accent2/10 px-3 py-2 text-[11px] text-heading">
                    {inviteSuccess}
                  </div>
                )}
                {inviteTab === 'shared' ? (
                  <div className="space-y-4 mb-4">
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setSharedInviteOpen((open) => !open)}
                        className="w-full flex items-center justify-between gap-3 px-3 py-2.5 bg-surface border border-border text-left text-sm rounded"
                      >
                        <div className="min-w-0">
                          <div className={`truncate ${selectedSharedInvite ? 'text-heading font-medium' : 'text-muted'}`}>
                            {selectedSharedInvite
                              ? (selectedSharedInvite.display_name ?? selectedSharedInvite.id)
                              : 'Choose from shared collaborators'}
                          </div>
                          {selectedSharedInvite && (
                            <div className="text-[11px] text-muted truncate mt-0.5">
                              {selectedSharedInvite.project_name ? `Shared project: ${selectedSharedInvite.project_name}` : 'Shared collaborator'}
                            </div>
                          )}
                        </div>
                        <ChevronRight size={14} className={`shrink-0 text-muted transition-transform ${sharedInviteOpen ? 'rotate-90' : ''}`} />
                      </button>
                      {sharedInviteOpen && (
                        <div className="absolute z-20 left-0 right-0 mt-2 rounded-xl border border-border bg-surface shadow-lg overflow-hidden">
                          <div className="p-3 border-b border-border">
                            <div className="relative">
                              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                              <input
                                value={sharedInviteSearch}
                                onChange={(e) => setSharedInviteSearch(e.target.value)}
                                placeholder="Search people or projects"
                                className="w-full pl-9 pr-3 py-2 rounded-lg border border-border bg-surface text-sm text-heading placeholder:text-muted/60 focus:outline-none focus:border-accent/40"
                              />
                            </div>
                          </div>
                          <div className="max-h-56 overflow-y-auto p-2">
                            {sharedInviteLoading ? (
                              <p className="px-3 py-4 text-xs text-muted">Loading shared collaborators…</p>
                            ) : filteredSharedInviteCandidates.length === 0 ? (
                              <p className="px-3 py-4 text-xs text-muted">No eligible people found.</p>
                            ) : filteredSharedInviteCandidates.map((candidate) => (
                              <button
                                key={sharedInviteCandidateKey(candidate)}
                                type="button"
                                onClick={() => {
                                  setSelectedSharedInviteKey(sharedInviteCandidateKey(candidate));
                                  setSharedInviteOpen(false);
                                }}
                                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors text-left ${
                                  selectedSharedInviteKey === sharedInviteCandidateKey(candidate) ? 'bg-accent/8 border border-accent/20' : 'hover:bg-surface2 border border-transparent'
                                }`}
                              >
                                <UserAvatar
                                  label={candidate.display_name ?? candidate.id}
                                  avatar={candidate.avatar_url}
                                  className="w-9 h-9"
                                  fallbackClassName="bg-accent/20 text-accent"
                                />
                                <div className="min-w-0">
                                  <p className="text-sm text-heading font-semibold truncate">{candidate.display_name ?? candidate.id}</p>
                                  <p className="text-[11px] text-muted truncate">
                                    {candidate.project_name ? `Shared project: ${candidate.project_name}` : 'Shared collaborator'}
                                  </p>
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    <button type="button" onClick={() => { void submitInvite(); }}
                      disabled={!selectedSharedInvite || sharedInviteSubmitting}
                      className="px-3 py-2 bg-accent/10 border border-accent/30 text-accent text-xs font-semibold tracking-wider uppercase hover:bg-accent/20 transition-colors rounded disabled:opacity-50 flex items-center gap-1.5">
                      {sharedInviteSubmitting ? <Loader2 size={12} className="animate-spin" /> : <UserPlus size={12} />}
                      Invite
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2 mb-4">
                    <input value={memberSearch} onChange={(e) => setMemberSearch(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && void submitInvite()}
                      placeholder={inviteTab === 'username' ? 'Odyssey username…' : 'name@nps.gov'}
                      className="flex-1 px-3 py-2 bg-surface border border-border text-heading text-sm font-mono placeholder:text-muted/50 focus:outline-none focus:border-accent/50 transition-colors rounded" />
                    <button type="button" onClick={() => { void submitInvite(); }}
                      disabled={memberSearching || memberSearch.trim().length < 1}
                      className="px-3 py-2 bg-accent/10 border border-accent/30 text-accent text-xs font-semibold tracking-wider uppercase hover:bg-accent/20 transition-colors rounded disabled:opacity-50 flex items-center gap-1.5">
                      {memberSearching ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
                      Invite
                    </button>
                  </div>
                )}
                {inviteTab !== 'shared' && (
                  <div className="rounded border border-dashed border-border px-4 py-3 text-[11px] text-muted">
                    {inviteTab === 'username'
                      ? 'This matches the Odyssey username exactly and immediately adds them to the project.'
                      : 'This matches the email they linked in Odyssey and immediately adds them to the project.'}
                  </div>
                )}
              </div>
            )}

            {inviteTab === 'qr' && projectId && project?.invite_code && (
              <div className="flex flex-col items-center gap-4">
                <p className="text-[11px] text-muted text-center">
                  Share this QR code. Anyone who scans it and authenticates will send a join request to the current project members.
                </p>
                <div className="p-4 bg-white rounded-xl shadow-lg">
                  <QRCodeSVG
                    value={toAbsoluteAppUrl(`/join?code=${encodeURIComponent(project.invite_code)}`)}
                    size={180}
                    level="H"
                    includeMargin={false}
                    imageSettings={{
                      src: withBasePath('/favicon.ico'),
                      height: 32,
                      width: 32,
                      excavate: true,
                    }}
                  />
                </div>
                <div className="flex flex-col items-center gap-1">
                  <span className="font-mono text-xs text-heading tracking-widest">{project.invite_code}</span>
                  <span className="text-[10px] text-muted">Regenerate the code in Project Details to invalidate this QR</span>
                </div>
              </div>
            )}

            {inviteTab === 'qr' && (!project?.invite_code) && (
              <p className="text-[11px] text-muted text-center py-6">
                Generate an Invite Code in Project Details first to enable QR sharing.
              </p>
            )}
        </div>
      </div>

      {/* Join Requests */}
      {joinRequests.length > 0 && (
        <div className="border border-border bg-surface p-6">
          <div className="flex items-center gap-2 mb-4">
            <UserPlus size={14} className="text-accent2" />
            <h3 className="font-sans text-sm font-bold text-heading">
              Join Requests
              <span className="ml-2 text-[10px] font-mono bg-accent2/10 text-accent2 px-1.5 py-0.5 rounded">
                {joinRequests.length}
              </span>
            </h3>
          </div>
          <div className="space-y-px border border-border bg-border">
            {joinRequests.map((req) => (
              <div key={req.id} className="flex items-center gap-3 bg-surface px-4 py-3">
                <UserAvatar
                  label={req.profile?.display_name ?? req.user_id}
                  avatar={req.profile?.avatar_url ?? null}
                  className="w-7 h-7"
                  fallbackClassName="bg-accent2/20 text-accent2"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-heading font-medium truncate">
                    {req.profile?.display_name ?? req.user_id}
                  </div>
                  <div className="text-[10px] text-muted">
                    {new Date(req.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => respondJoinRequest(req.id, 'approve').then(() => refetchJoinRequests())}
                    className="flex items-center gap-1 px-3 py-1 text-[10px] font-semibold border border-accent2/30 text-accent2 hover:bg-accent2/10 transition-colors rounded"
                  >
                    <Check size={10} />
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => respondJoinRequest(req.id, 'deny').then(() => refetchJoinRequests())}
                    className="flex items-center gap-1 px-3 py-1 text-[10px] font-semibold border border-border text-muted hover:text-danger hover:border-danger/30 transition-colors rounded"
                  >
                    <X size={10} />
                    Deny
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* GitHub Repository */}
      <div className="border border-border bg-surface p-6">
        <div className="flex items-center gap-2 mb-6">
          <Github size={14} className="text-heading" />
          <h3 className="font-sans text-sm font-bold text-heading">GitHub Repositories</h3>
        </div>

        {githubRepos.length > 0 ? (
          <div className="space-y-4">
            {githubRepos.map((repo, index) => (
              <div key={repo} className="flex items-center gap-3 p-4 border border-accent/20 bg-accent/5 rounded">
                <Github size={18} className="text-accent" />
                <div className="flex-1 min-w-0">
                  <a
                    href={`https://github.com/${repo}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-accent hover:underline font-mono"
                  >
                    {repo}
                  </a>
                  <div className="text-[10px] text-muted mt-0.5">{index === 0 ? 'Primary connected repository' : 'Connected repository'}</div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const nextRepos = githubRepos.filter((value) => value !== repo);
                    void updateProject({ github_repo: nextRepos[0] ?? null, github_repos: nextRepos });
                  }}
                  className="px-3 py-1.5 border border-danger/30 text-danger text-[10px] tracking-wider uppercase hover:bg-danger/5 transition-colors rounded"
                >
                  Disconnect
                </button>
              </div>
            ))}

            {scanResults && (
              <div className="space-y-3 mt-4 border-t border-border pt-4">
                {scanResults.completed.length > 0 && (
                  <div>
                    <h4 className="text-[10px] tracking-[0.15em] uppercase text-accent3 mb-2">Goals likely completed</h4>
                    <div className="space-y-1">
                      {scanResults.completed.map((id) => {
                        const g = goals.find((gl) => gl.id === id);
                        return g ? (
                          <div key={id} className="flex items-center gap-2 text-xs text-heading p-2 bg-accent3/5 rounded">
                            <CheckCircle size={12} className="text-accent3" />
                            <span>{g.title}</span>
                            <button
                              type="button"
                              onClick={() => updateGoal(id, { status: 'complete', progress: 100 })}
                              className="ml-auto text-[10px] text-accent3 hover:underline"
                            >
                              Mark complete
                            </button>
                          </div>
                        ) : null;
                      })}
                    </div>
                  </div>
                )}
                {scanResults.suggested.length > 0 && (
                  <div>
                    <h4 className="text-[10px] tracking-[0.15em] uppercase text-accent2 mb-2">Suggested new goals</h4>
                    <div className="space-y-1">
                      {scanResults.suggested.map((s, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs text-heading p-2 bg-accent2/5 rounded">
                          <Plus size={12} className="text-accent2" />
                          <div className="flex-1">
                            <span>{s.title}</span>
                            <span className="text-[10px] text-muted ml-2">— {s.reason}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => createGoal({ title: s.title })}
                            className="text-[10px] text-accent2 hover:underline"
                          >
                            Add
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : null}

        <div className="space-y-3 mt-4">
          <p className="text-xs text-muted">
            Connect one or more GitHub repositories to enable AI-powered goal analysis and activity tracking.
          </p>
          <div className="flex gap-2 max-w-md">
            <input
              value={repoInput}
              onChange={(e) => setRepoInput(e.target.value)}
              placeholder="https://github.com/owner/repo.git"
              className="flex-1 px-4 py-3 bg-surface border border-border text-heading text-sm font-mono placeholder:text-muted/50 focus:outline-none focus:border-accent/50 transition-colors rounded"
            />
            <button
              type="button"
              onClick={handleSaveRepo}
              disabled={repoSaving || !repoInput.trim()}
              className="px-4 py-3 bg-accent/10 border border-accent/30 text-accent text-xs font-semibold tracking-wider uppercase hover:bg-accent/20 transition-colors rounded disabled:opacity-50 flex items-center gap-2"
            >
              {repoSaving ? <Loader2 size={14} className="animate-spin" /> : <Link size={14} />}
              Add Repo
            </button>
          </div>
        </div>
      </div>

      {/* GitLab Repository */}
      <GitLabSection projectId={projectId!} onReposChanged={(repos) => setGitlabRepos(repos)} />

      {/* Report Templates */}
      <div className="border border-border bg-surface p-6">
          {/* Hidden file inputs — stable refs, never re-mounted */}
          <input ref={tmplInputDocx} type="file" accept=".docx,.pptx,.pdf" title="Word report template file" className="sr-only"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleTemplateUpload('docx', f); e.target.value = ''; }} />
          <input ref={tmplInputPptx} type="file" accept=".docx,.pptx,.pdf" title="PowerPoint template file" className="sr-only"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleTemplateUpload('pptx', f); e.target.value = ''; }} />
          <input ref={tmplInputPdf} type="file" accept=".docx,.pptx,.pdf" title="PDF report template file" className="sr-only"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleTemplateUpload('pdf', f); e.target.value = ''; }} />

          <div className="flex items-center gap-2 mb-2">
            <FileText size={14} className="text-heading" />
            <h3 className="font-sans text-sm font-bold text-heading">Report Templates</h3>
          </div>
          <p className="text-[11px] text-muted mb-5">
            Upload a template file for each report type. You can use DOCX, PPTX, or PDF as the source template. Odyssey will analyze the uploaded file's structure, typography, colors, and layout cues, then adapt that design language into the generated output format. Large templates are uploaded in smaller chunks so they can survive stricter proxy limits.
          </p>

          {templateError && (
            <p className="text-[11px] text-danger mb-3">{templateError}</p>
          )}

          <div className="flex flex-col gap-3">
            {([
              { type: 'docx' as const, label: 'Word Report (.docx)', ref: tmplInputDocx, hint: 'DOCX, PPTX, or PDF source' },
              { type: 'pptx' as const, label: 'PowerPoint (.pptx)', ref: tmplInputPptx, hint: 'DOCX, PPTX, or PDF source' },
              { type: 'pdf'  as const, label: 'PDF Report (.pdf)',  ref: tmplInputPdf,  hint: 'DOCX, PPTX, or PDF source' },
            ] as const).map(({ type, label, ref, hint }) => {
              const existing = templates.find((t) => t.templateType === type);
              const uploading = templateUploading === type;
              return (
                <div key={type} className="flex items-center justify-between gap-3 px-4 py-3 border border-border rounded bg-surface2/40">
                  <div className="flex items-center gap-3 min-w-0">
                    <FileText size={13} className="text-muted shrink-0" />
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold text-heading">{label}</p>
                      {existing ? (
                        <>
                          <p className="text-[10px] text-muted truncate">{existing.filename} · {(existing.sizeBytes / 1024).toFixed(0)} KB · source {String(existing.sourceFormat ?? existing.analysis?.sourceFormat ?? type).toUpperCase()}</p>
                          <p className="text-[10px] text-muted/80 truncate">
                            {existing.analysis?.summary ?? 'Saved to project storage and used during report generation.'}
                          </p>
                        </>
                      ) : (
                        <p className="text-[10px] text-muted">No template — {hint}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      title={existing ? `Replace ${label} template` : `Upload ${label} template`}
                      disabled={uploading}
                      onClick={() => ref.current?.click()}
                      className="flex items-center gap-1.5 px-3 py-1.5 border border-border text-muted hover:text-heading hover:bg-surface text-[10px] font-semibold tracking-wider uppercase transition-colors rounded disabled:opacity-40"
                    >
                      {uploading ? <Loader2 size={10} className="animate-spin" /> : <Plus size={10} />}
                      {uploading ? 'Uploading…' : existing ? 'Replace' : 'Upload'}
                    </button>
                    {existing && (
                      <>
                        <button
                          type="button"
                          title={`Open ${label} template`}
                          onClick={() => { void handleTemplateOpen(existing.storagePath); }}
                          className="flex items-center justify-center w-7 h-7 border border-border text-muted hover:text-heading hover:bg-surface transition-colors rounded"
                        >
                          <Download size={10} />
                        </button>
                        <button type="button"
                          title={`Remove ${label} template`}
                          onClick={() => handleTemplateDelete(existing.id, existing.templateType)}
                          className="flex items-center justify-center w-7 h-7 border border-danger/30 text-danger hover:bg-danger/5 transition-colors rounded">
                          <X size={10} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
      </div>

      {/* Task Labels — Categories & LOEs */}
      <div className="border border-border bg-surface p-6">
        <div className="flex items-center gap-2 mb-5">
          <Table size={14} className="text-heading" />
          <h3 className="font-sans text-sm font-bold text-heading">Task Labels</h3>
        </div>
        <p className="text-[11px] text-muted mb-5">
          Define project-specific categories and lines of effort. These appear in the task editor dropdowns.
        </p>
        {labelError && (
          <p className="text-[11px] text-danger mb-4">{labelError}</p>
        )}

        {/* Add new labels */}
        <div className="grid gap-4 mb-5 lg:grid-cols-2">
          <div className="space-y-2 rounded border border-border bg-surface2/30 p-4">
            <p className="text-[10px] tracking-[0.15em] uppercase text-muted">Add Category</p>
            <div className="flex items-center gap-2 flex-wrap">
              <input
                value={newCategoryLabelName}
                onChange={(e) => setNewCategoryLabelName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    void handleAddLabel('category', newCategoryLabelName, newCategoryLabelColor, setNewCategoryLabelName);
                  }
                }}
                placeholder="Category name…"
                className="min-w-0 flex-1 px-3 py-1.5 bg-surface border border-border text-heading text-xs font-mono placeholder:text-muted/50 focus:outline-none focus:border-accent/50 transition-colors rounded"
              />
              <LabelColorPicker value={newCategoryLabelColor} onChange={setNewCategoryLabelColor} />
              <button
                type="button"
                onClick={() => { void handleAddLabel('category', newCategoryLabelName, newCategoryLabelColor, setNewCategoryLabelName); }}
                disabled={!newCategoryLabelName.trim() || labelSaving}
                className="flex items-center gap-1.5 px-3 py-1.5 border border-accent/30 text-accent text-[10px] font-semibold tracking-wider uppercase hover:bg-accent/10 transition-colors rounded disabled:opacity-40"
              >
                {labelSaving ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />} Add
              </button>
            </div>
          </div>
          <div className="space-y-2 rounded border border-border bg-surface2/30 p-4">
            <p className="text-[10px] tracking-[0.15em] uppercase text-muted">Add LOE</p>
            <div className="flex items-center gap-2 flex-wrap">
              <input
                value={newLoeLabelName}
                onChange={(e) => setNewLoeLabelName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    void handleAddLabel('loe', newLoeLabelName, newLoeLabelColor, setNewLoeLabelName);
                  }
                }}
                placeholder="LOE name…"
                className="min-w-0 flex-1 px-3 py-1.5 bg-surface border border-border text-heading text-xs font-mono placeholder:text-muted/50 focus:outline-none focus:border-accent/50 transition-colors rounded"
              />
              <LabelColorPicker value={newLoeLabelColor} onChange={setNewLoeLabelColor} />
              <button
                type="button"
                onClick={() => { void handleAddLabel('loe', newLoeLabelName, newLoeLabelColor, setNewLoeLabelName); }}
                disabled={!newLoeLabelName.trim() || labelSaving}
                className="flex items-center gap-1.5 px-3 py-1.5 border border-accent/30 text-accent text-[10px] font-semibold tracking-wider uppercase hover:bg-accent/10 transition-colors rounded disabled:opacity-40"
              >
                {labelSaving ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />} Add
              </button>
            </div>
          </div>
        </div>

        {/* Existing labels by type */}
        {(['category', 'loe'] as const).map((type) => {
          const typeLabels = projectLabels.filter((l) => l.type === type);
          if (typeLabels.length === 0) return null;
          return (
            <div key={type} className="mb-4">
              <p className="text-[10px] tracking-[0.15em] uppercase text-muted mb-2">
                {type === 'category' ? 'Categories' : 'Lines of Effort'}
              </p>
              <div className="flex flex-wrap gap-2">
                {typeLabels.map((lbl) => (
                  <div key={lbl.id} className="flex items-center gap-1.5 px-2.5 py-1 rounded border border-border bg-surface2 group">
                    {/* eslint-disable-next-line react/forbid-dom-props */}
                    <span className="w-2.5 h-2.5 rounded-full shrink-0 block" title={lbl.color}
                      style={{ background: lbl.color }} />
                    <span className="text-xs text-heading font-mono">{lbl.name}</span>
                    <button
                      type="button"
                      title={`Remove ${lbl.name}`}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        void handleDeleteLabel(lbl.id);
                      }}
                      disabled={labelDeletingId === lbl.id}
                      className="text-muted hover:text-danger transition-colors ml-0.5 p-0.5 disabled:opacity-40"
                    >
                      {labelDeletingId === lbl.id ? <Loader2 size={10} className="animate-spin" /> : <X size={10} />}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        {projectLabels.length === 0 && (
          <p className="text-[11px] text-muted/60 italic">No labels yet. Add your first category or line of effort above.</p>
        )}
      </div>

      {/* Customize AI Prompts */}
      <div className="border border-border bg-surface p-6">
        <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <Sparkles size={14} className="text-accent" />
            <h3 className="font-sans text-sm font-bold text-heading">Customize AI Prompts</h3>
          </div>
          <button type="button" onClick={() => setResetPromptsModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-border text-muted hover:text-danger hover:border-danger/30 text-[10px] font-semibold tracking-wider uppercase transition-colors rounded">
            <RefreshCw size={10} /> Reset All to Default
          </button>
        </div>
        <p className="text-[11px] text-muted mb-5">
          Edit the system prompt used by each AI feature. Customized prompts are saved to this project only.
        </p>
        <div className="space-y-px border border-border bg-border">
          {(Object.keys(PROMPT_LABELS) as PromptFeature[]).map((feature) => {
            const isCustom = !!getPrompt(feature);
            return (
              <div key={feature} className="flex items-center gap-3 bg-surface px-4 py-3">
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-heading font-medium">{PROMPT_LABELS[feature]}</div>
                  {isCustom && <div className="text-[10px] text-accent mt-0.5">Custom prompt active</div>}
                  {!isCustom && <div className="text-[10px] text-muted mt-0.5">Using default prompt</div>}
                </div>
                <div className="flex items-center gap-2">
                  {isCustom && (
                    <button type="button" onClick={() => resetPrompt(feature)}
                      className="text-[10px] text-muted hover:text-danger transition-colors flex items-center gap-1">
                      <RefreshCw size={9} /> Reset
                    </button>
                  )}
                  <button type="button"
                    onClick={() => {
                      setEditPromptFeature(feature);
                      setEditPromptText(getPrompt(feature) ?? DEFAULT_PROMPTS[feature]);
                    }}
                    className="flex items-center gap-1.5 px-3 py-1 border border-border text-muted hover:text-heading hover:bg-surface2 text-[10px] font-semibold tracking-wider uppercase transition-colors rounded">
                    <Pencil size={9} /> Edit
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Tab Visibility */}
      <TabVisibilitySection projectId={projectId} />

      {/* Danger Zone */}
      <div className="border border-danger/30 bg-surface p-6">
        <div className="flex items-center gap-2 mb-4">
          <Trash2 size={14} className="text-danger" />
          <h3 className="font-sans text-sm font-bold text-danger">Danger Zone</h3>
        </div>
        <p className="text-xs text-muted mb-4">
          Remove this project from your view. If you are the only member, Odyssey will prompt you to delete it instead.
        </p>
        <button
          type="button"
          onClick={() => setDeleteModalOpen(true)}
          disabled={deletingProject || leavingProject}
          className="flex items-center gap-2 px-5 py-2 border border-danger/40 text-danger text-xs font-sans font-semibold tracking-wider uppercase hover:bg-danger/10 transition-colors rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {deletingProject || leavingProject ? <Loader2 size={12} className="animate-spin" /> : <LogOut size={12} />}
          {deletingProject ? 'Deleting...' : leavingProject ? 'Removing...' : 'Remove Project'}
        </button>
      </div>

      {/* Audit Log */}
      <div className="border border-border bg-surface p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <ClipboardList size={14} className="text-heading" />
            <h3 className="font-sans text-sm font-bold text-heading">Audit Log</h3>
            <span className="text-[10px] text-muted font-mono">({events.length} events)</span>
          </div>
          <button
            type="button"
            onClick={handleExportAuditCSV}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-border text-muted text-xs hover:text-heading hover:bg-surface2 transition-colors rounded font-mono"
          >
            <Download size={11} /> Export CSV
          </button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <input
            type="date"
            value={auditFrom}
            onChange={(e) => { setAuditFrom(e.target.value); setAuditPreset('custom'); }}
            title="From date"
            className="px-2 py-1 bg-surface2 border border-border text-heading text-xs font-mono focus:outline-none focus:border-accent/50 transition-colors rounded"
          />
          <span className="text-[10px] text-muted">to</span>
          <input
            type="date"
            value={auditTo}
            onChange={(e) => { setAuditTo(e.target.value); setAuditPreset('custom'); }}
            title="To date"
            className="px-2 py-1 bg-surface2 border border-border text-heading text-xs font-mono focus:outline-none focus:border-accent/50 transition-colors rounded"
          />
          {/* Presets */}
          {((['2W', '1M', '3M', '6M', 'Full'] as const).map((label) => (
            <button
              key={label}
              type="button"
              onClick={() => {
                const fmt = (d: Date) => d.toISOString().split('T')[0];
                const to = new Date();
                const from = new Date();
                if (label === '2W')        from.setDate(from.getDate() - 14);
                else if (label === '1M')   from.setMonth(from.getMonth() - 1);
                else if (label === '3M')   from.setMonth(from.getMonth() - 3);
                else if (label === '6M')   from.setMonth(from.getMonth() - 6);
                else if (label === 'Full') { setAuditFrom(project?.start_date ?? fmt(from)); setAuditTo(fmt(to)); setAuditPreset('Full'); return; }
                setAuditFrom(fmt(from));
                setAuditTo(fmt(to));
                setAuditPreset(label);
              }}
              className={`px-2.5 py-1 text-[10px] border rounded transition-colors font-mono ${
                auditPreset === label
                  ? 'bg-[var(--color-accent)] text-[var(--color-accent-fg)] border-[var(--color-accent)]'
                  : 'border-border text-muted hover:text-heading hover:bg-surface2'
              }`}
            >
              {label}
            </button>
          )))}
          <button
            type="button"
            onClick={() => setAuditPreset('custom')}
            className={`px-2.5 py-1 text-[10px] border rounded transition-colors font-mono ${
              auditPreset === 'custom'
                ? 'bg-[var(--color-accent)] text-[var(--color-accent-fg)] border-[var(--color-accent)]'
                : 'border-border text-muted hover:text-heading hover:bg-surface2'
            }`}
          >
            Custom
          </button>
          <select
            value={auditType}
            onChange={(e) => setAuditType(e.target.value)}
            title="Filter by event type"
            className="px-2 py-1 bg-surface2 border border-border text-heading text-xs font-mono focus:outline-none focus:border-accent/50 transition-colors rounded"
          >
            <option value="">All types</option>
            {[...new Set(events.map((e) => e.event_type))].sort().map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          {auditType && (
            <button type="button" onClick={() => setAuditType('')}
              className="text-[10px] text-muted hover:text-heading transition-colors">
              Clear type
            </button>
          )}
        </div>

        {/* Table */}
        {(() => {
          const filtered = events.filter((e) => {
            if (auditFrom && e.occurred_at < auditFrom) return false;
            if (auditTo && e.occurred_at > auditTo + 'T23:59:59Z') return false;
            if (auditType && e.event_type !== auditType) return false;
            return true;
          });
          const totalPages = Math.ceil(filtered.length / AUDIT_PAGE_SIZE);
          const paginated = filtered.slice(auditPage * AUDIT_PAGE_SIZE, (auditPage + 1) * AUDIT_PAGE_SIZE);

          return (
            <>
              <div className="overflow-x-auto border border-border rounded">
                <table className="w-full text-[10px] font-mono">
                  <thead>
                    <tr className="border-b border-border bg-surface2">
                      <th className="text-left px-3 py-2 text-muted uppercase tracking-wider">Timestamp</th>
                      <th className="text-left px-3 py-2 text-muted uppercase tracking-wider">Source</th>
                      <th className="text-left px-3 py-2 text-muted uppercase tracking-wider">Type</th>
                      <th className="text-left px-3 py-2 text-muted uppercase tracking-wider">Title</th>
                      <th className="text-left px-3 py-2 text-muted uppercase tracking-wider hidden md:table-cell">Summary</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {paginated.length === 0 ? (
                      <tr><td colSpan={5} className="px-3 py-6 text-center text-muted">No events match the current filters</td></tr>
                    ) : paginated.map((e) => (
                      <tr key={e.id} className="hover:bg-surface2 transition-colors">
                        <td className="px-3 py-2 text-muted whitespace-nowrap">{new Date(e.occurred_at).toLocaleString()}</td>
                        <td className="px-3 py-2 text-accent">{e.source}</td>
                        <td className="px-3 py-2 text-muted">{e.event_type}</td>
                        <td className="px-3 py-2 text-heading truncate max-w-[200px]">{e.title ?? '—'}</td>
                        <td className="px-3 py-2 text-muted truncate max-w-[200px] hidden md:table-cell">{e.summary ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-2">
                  <span className="text-[10px] text-muted font-mono">
                    {filtered.length} events · page {auditPage + 1}/{totalPages}
                  </span>
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={() => setAuditPage((p) => Math.max(0, p - 1))} disabled={auditPage === 0}
                      className="text-[10px] px-2 py-1 border border-border rounded hover:bg-surface2 disabled:opacity-40 transition-colors font-mono">
                      ← Prev
                    </button>
                    <button type="button" onClick={() => setAuditPage((p) => Math.min(totalPages - 1, p + 1))} disabled={auditPage >= totalPages - 1}
                      className="text-[10px] px-2 py-1 border border-border rounded hover:bg-surface2 disabled:opacity-40 transition-colors font-mono">
                      Next →
                    </button>
                  </div>
                </div>
              )}
            </>
          );
        })()}
      </div>

      {/* AI Prompt Edit Modal */}
      {editPromptFeature && (() => {
        const defaultText = DEFAULT_PROMPTS[editPromptFeature];
        const customText  = getPrompt(editPromptFeature);
        const isShowingDefault = editPromptText.trim() === defaultText.trim();
        const isCustomActive   = !!customText;

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="bg-surface border border-border rounded-lg shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh]">

              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
                <div className="flex items-center gap-2">
                  <Sparkles size={14} className="text-accent" />
                  <h2 className="font-sans text-sm font-bold text-heading">
                    {PROMPT_LABELS[editPromptFeature]}
                  </h2>
                  <span className={`text-[9px] font-semibold tracking-wider uppercase px-1.5 py-0.5 rounded ${isCustomActive ? 'bg-accent/10 text-accent' : 'bg-surface2 text-muted'}`}>
                    {isCustomActive ? 'Custom' : 'Default'}
                  </span>
                </div>
                <button type="button" title="Close" onClick={() => setEditPromptFeature(null)}
                  className="p-1 text-muted hover:text-heading transition-colors">
                  <X size={16} />
                </button>
              </div>

              {/* Body */}
              <div className="p-6 flex flex-col gap-4 overflow-y-auto flex-1">

                {/* Status banner */}
                {isCustomActive ? (
                  <div className="flex items-start gap-2 px-3 py-2 bg-accent/5 border border-accent/20 rounded text-[11px] text-accent">
                    <Sparkles size={11} className="mt-px shrink-0" />
                    This project is using a <strong>custom prompt</strong>. Edit below or restore the default.
                  </div>
                ) : (
                  <div className="flex items-start gap-2 px-3 py-2 bg-surface2 border border-border rounded text-[11px] text-muted">
                    <RefreshCw size={11} className="mt-px shrink-0" />
                    Showing the <strong>default prompt</strong>. Edit below to save a custom version for this project.
                  </div>
                )}

                {/* Editable textarea */}
                <div>
                  <label className="block text-[10px] tracking-[0.15em] uppercase text-muted mb-1.5">
                    {isCustomActive ? 'Your Custom Prompt' : 'Prompt (editing default)'}
                  </label>
                  <textarea
                    value={editPromptText}
                    onChange={(e) => setEditPromptText(e.target.value)}
                    rows={14}
                    title="AI prompt text"
                    placeholder="Enter prompt…"
                    className="w-full px-3 py-2.5 bg-surface2 border border-border text-heading text-xs font-mono focus:outline-none focus:border-accent/50 transition-colors rounded resize-y"
                  />
                </div>

                {/* Default prompt reference — shown when a custom prompt is active */}
                {isCustomActive && (
                  <details className="group">
                    <summary className="flex items-center gap-1.5 text-[10px] tracking-[0.15em] uppercase text-muted cursor-pointer select-none hover:text-heading transition-colors">
                      <ChevronRight size={10} className="group-open:rotate-90 transition-transform" />
                      View Default Prompt
                    </summary>
                    <pre className="mt-2 px-3 py-2.5 bg-surface2 border border-border text-muted text-[10px] font-mono rounded overflow-x-auto whitespace-pre-wrap leading-relaxed">
                      {defaultText}
                    </pre>
                  </details>
                )}
              </div>

              {/* Footer */}
              <div className="flex items-center gap-3 justify-between px-6 py-4 border-t border-border shrink-0 flex-wrap">
                <button type="button"
                  onClick={() => {
                    resetPrompt(editPromptFeature);
                    setEditPromptText(defaultText);
                  }}
                  disabled={isShowingDefault && !isCustomActive}
                  className="flex items-center gap-1.5 text-[10px] text-muted hover:text-danger transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
                  <RefreshCw size={10} /> Restore Default
                </button>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setEditPromptFeature(null)}
                    className="px-4 py-2 border border-border text-muted text-[10px] font-semibold tracking-wider uppercase hover:bg-surface2 transition-colors rounded">
                    Cancel
                  </button>
                  <button type="button"
                    onClick={() => {
                      const trimmed = editPromptText.trim();
                      if (!trimmed || trimmed === defaultText.trim()) {
                        resetPrompt(editPromptFeature);
                      } else {
                        savePrompt(editPromptFeature, trimmed);
                      }
                      setEditPromptFeature(null);
                    }}
                    className="px-4 py-2 bg-accent/10 border border-accent/30 text-accent text-[10px] font-semibold tracking-wider uppercase hover:bg-accent/20 transition-colors rounded">
                    {isShowingDefault && !isCustomActive ? 'Close' : 'Save Custom Prompt'}
                  </button>
                </div>
              </div>

            </div>
          </div>
        );
      })()}

      {/* Reset All Prompts Confirmation Modal */}
      {resetPromptsModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-surface border border-border rounded-lg shadow-2xl w-full max-w-sm p-6">
            <div className="flex items-center gap-2 mb-4">
              <RefreshCw size={14} className="text-danger" />
              <h2 className="font-sans text-sm font-bold text-heading">Reset All Prompts</h2>
            </div>
            <p className="text-xs text-muted mb-4">
              This will remove all custom prompts for this project and restore every AI feature to its default behavior.
              Type <span className="font-mono text-heading">reset</span> to confirm.
            </p>
            <input
              value={resetPromptsTyped}
              onChange={(e) => setResetPromptsTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && resetPromptsTyped === 'reset') {
                  resetAllPrompts(); setResetPromptsModalOpen(false); setResetPromptsTyped('');
                }
              }}
              placeholder="reset"
              className="w-full px-3 py-2 bg-surface2 border border-border text-heading text-sm font-mono placeholder:text-muted/40 focus:outline-none focus:border-danger/50 transition-colors rounded mb-4"
            />
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => { setResetPromptsModalOpen(false); setResetPromptsTyped(''); }}
                className="px-4 py-2 border border-border text-muted text-[10px] font-semibold tracking-wider uppercase hover:bg-surface2 transition-colors rounded">
                Cancel
              </button>
              <button type="button"
                disabled={resetPromptsTyped !== 'reset'}
                onClick={() => { resetAllPrompts(); setResetPromptsModalOpen(false); setResetPromptsTyped(''); }}
                className="px-4 py-2 border border-danger/40 text-danger text-[10px] font-semibold tracking-wider uppercase hover:bg-danger/10 transition-colors rounded disabled:opacity-40">
                Reset All
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default React.memo(SettingsTab);
