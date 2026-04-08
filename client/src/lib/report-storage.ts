import type { ReportFormat } from './chat-panel';
import { supabase } from './supabase';
import { renderReportFile, type ReportArtifactReference, type ReportContent } from './report-download';

type SaveGeneratedReportParams = {
  projectId: string;
  format: ReportFormat;
  report: ReportContent;
  provider?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
};

export async function saveGeneratedReportToProject({
  projectId,
  format,
  report,
  provider,
  dateFrom,
  dateTo,
}: SaveGeneratedReportParams): Promise<ReportArtifactReference | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return null;

  const rendered = await renderReportFile(report, format);
  const file = new File([rendered.blob], rendered.fileName, { type: rendered.mimeType });
  const form = new FormData();
  form.append('projectId', projectId);
  form.append('filename', rendered.fileName);
  form.append('title', report.title);
  form.append('summary', `Generated ${format.toUpperCase()} report saved to project documents`);
  form.append('metadataJson', JSON.stringify({
    generated_report: true,
    report_format: format,
    report_generated_at: report.generatedAt,
    report_provider: provider ?? null,
    template_id: report.template?.id ?? null,
    template_filename: report.template?.filename ?? null,
  }));
  form.append('file', file);

  const uploadResponse = await fetch('/api/uploads/local', {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}` },
    body: form,
  });

  if (!uploadResponse.ok) {
    const error = await uploadResponse.json().catch(() => ({ error: 'Unable to save generated report to project storage.' }));
    throw new Error(error.error ?? 'Unable to save generated report to project storage.');
  }

  const uploadPayload = await uploadResponse.json();
  const event = uploadPayload.event as {
    id?: string;
    occurred_at?: string;
    metadata?: { storage_path?: string };
  } | undefined;

  const artifact: ReportArtifactReference = {
    eventId: event?.id ?? null,
    storagePath: event?.metadata?.storage_path ?? null,
    filename: rendered.fileName,
    mimeType: rendered.mimeType,
    uploadedAt: event?.occurred_at ?? new Date().toISOString(),
  };

  const savedReportContent: ReportContent = {
    ...report,
    artifact,
  };

  const { error: saveError } = await supabase.from('saved_reports').insert({
    project_id: projectId,
    title: report.title,
    content: savedReportContent,
    format,
    date_range_from: dateFrom || null,
    date_range_to: dateTo || null,
    generated_at: new Date().toISOString(),
    provider: provider ?? null,
  });

  if (saveError) {
    throw new Error(saveError.message);
  }

  return artifact;
}