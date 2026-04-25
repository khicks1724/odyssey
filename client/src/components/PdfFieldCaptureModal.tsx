import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Check, ChevronLeft, ChevronRight, FileSearch, X } from 'lucide-react';
import { GlobalWorkerOptions, getDocument, TextLayer, type PDFDocumentProxy } from 'pdfjs-dist';
import { getPublicationDatePlaceholder, normalizePublicationDate } from '../lib/citation-date';
import 'pdfjs-dist/web/pdf_viewer.css';

GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

type CaptureFieldId = 'title' | 'credit' | 'contextField' | 'year' | 'locator';

type CaptureValues = {
  title: string;
  credit: string;
  contextField: string;
  year: string;
  locator: string;
};

type CaptureFieldDefinition = {
  id: CaptureFieldId;
  label: string;
  hint: string;
  multiline?: boolean;
  placeholder: string;
};

type CaptureMetadata = {
  pageNumber: number | null;
  preview: string;
};

type CaptureMetadataMap = Record<CaptureFieldId, CaptureMetadata>;

type BoxRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type PdfFieldCaptureModalProps = {
  file: File;
  bibliographyFormat: string;
  values: CaptureValues;
  creditLabel: string;
  contextLabel: string;
  onApply: (values: CaptureValues) => void;
  onClose: () => void;
};

type PdfSelectionPageProps = {
  pdfDocument: PDFDocumentProxy;
  pageNumber: number;
  onRenderMeta: (pageNumber: number, textItemCount: number) => void;
  onCaptureRegion: (pageNumber: number, extractedText: string) => void;
  registerPageNode: (pageNumber: number, node: HTMLDivElement | null) => void;
};

const PAGE_TARGET_WIDTH = 920;
const BOX_CAPTURE_MIN_SIZE = 10;
const LINE_GROUPING_THRESHOLD = 8;

const EMPTY_CAPTURE_METADATA: CaptureMetadataMap = {
  title: { pageNumber: null, preview: '' },
  credit: { pageNumber: null, preview: '' },
  contextField: { pageNumber: null, preview: '' },
  year: { pageNumber: null, preview: '' },
  locator: { pageNumber: null, preview: '' },
};

function sanitizeSelectionText(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeLocatorValue(value: string) {
  return sanitizeSelectionText(value)
    .replace(/^available\s*:\s*/i, '')
    .replace(/[<>]+/g, '')
    .trim();
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function buildBoxRect(startX: number, startY: number, endX: number, endY: number): BoxRect {
  const left = Math.min(startX, endX);
  const top = Math.min(startY, endY);
  return {
    left,
    top,
    width: Math.abs(endX - startX),
    height: Math.abs(endY - startY),
  };
}

function rectsOverlap(a: BoxRect, b: BoxRect) {
  return !(
    a.left + a.width < b.left
    || b.left + b.width < a.left
    || a.top + a.height < b.top
    || b.top + b.height < a.top
  );
}

function extractTextFromRegion(textLayerNode: HTMLDivElement, pageSurfaceNode: HTMLDivElement, region: BoxRect) {
  const pageRect = pageSurfaceNode.getBoundingClientRect();
  const spans = Array.from(textLayerNode.querySelectorAll('span'));

  const hits = spans.flatMap((span, index) => {
    const text = sanitizeSelectionText(span.textContent ?? '');
    if (!text) return [];

    const spanRect = span.getBoundingClientRect();
    if (spanRect.width <= 0 || spanRect.height <= 0) return [];

    const relativeRect: BoxRect = {
      left: spanRect.left - pageRect.left,
      top: spanRect.top - pageRect.top,
      width: spanRect.width,
      height: spanRect.height,
    };
    if (!rectsOverlap(region, relativeRect)) return [];

    return [{
      index,
      text,
      left: relativeRect.left,
      top: relativeRect.top,
    }];
  });

  if (hits.length === 0) return '';

  hits.sort((a, b) => {
    if (Math.abs(a.top - b.top) <= LINE_GROUPING_THRESHOLD) {
      return a.left - b.left || a.index - b.index;
    }
    return a.top - b.top;
  });

  const lines: { top: number; parts: string[] }[] = [];
  for (const hit of hits) {
    const currentLine = lines.at(-1);
    if (!currentLine || Math.abs(hit.top - currentLine.top) > LINE_GROUPING_THRESHOLD) {
      lines.push({ top: hit.top, parts: [hit.text] });
      continue;
    }
    currentLine.parts.push(hit.text);
  }

  return sanitizeSelectionText(
    lines
      .map((line) => line.parts.join(' '))
      .join(' '),
  );
}

function PdfSelectionPage({
  pdfDocument,
  pageNumber,
  onRenderMeta,
  onCaptureRegion,
  registerPageNode,
}: PdfSelectionPageProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const pageSurfaceRef = useRef<HTMLDivElement | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const [pageHeight, setPageHeight] = useState(0);
  const [pageWidth, setPageWidth] = useState(0);
  const [dragRect, setDragRect] = useState<BoxRect | null>(null);

  useEffect(() => {
    let cancelled = false;
    let activeTextLayer: TextLayer | null = null;
    let activeRenderTask: { cancel: () => void; promise: Promise<unknown> } | null = null;

    const renderPage = async () => {
      const page = await pdfDocument.getPage(pageNumber);
      if (cancelled) return;

      // Some scanned PDFs arrive with a 180-degree page rotation flag even
      // though users expect the intake preview to stay upright.
      const normalizedRotation = page.rotate === 180 ? 0 : page.rotate;
      const baseViewport = page.getViewport({ scale: 1, rotation: normalizedRotation });
      const scale = Math.min(1.8, PAGE_TARGET_WIDTH / baseViewport.width);
      const viewport = page.getViewport({ scale, rotation: normalizedRotation });

      setPageWidth(viewport.width);
      setPageHeight(viewport.height);

      const canvas = canvasRef.current;
      const textLayerNode = textLayerRef.current;
      if (!canvas || !textLayerNode) return;

      const context = canvas.getContext('2d');
      if (!context) return;

      const outputScale = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * outputScale);
      canvas.height = Math.floor(viewport.height * outputScale);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      textLayerNode.style.width = `${viewport.width}px`;
      textLayerNode.style.height = `${viewport.height}px`;
      textLayerNode.style.setProperty('--scale-factor', `${viewport.scale}`);

      activeRenderTask = page.render({
        canvas: null,
        canvasContext: context,
        viewport,
        transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
      });
      await activeRenderTask.promise;
      if (cancelled) return;

      const textContent = await page.getTextContent();
      if (cancelled) return;
      onRenderMeta(pageNumber, textContent.items.length);

      textLayerNode.innerHTML = '';
      activeTextLayer = new TextLayer({
        container: textLayerNode,
        textContentSource: textContent,
        viewport,
      });
      await activeTextLayer.render();
      if (cancelled) {
        activeTextLayer.cancel();
      }
    };

    void renderPage();
    return () => {
      cancelled = true;
      activeRenderTask?.cancel();
      activeTextLayer?.cancel();
    };
  }, [onRenderMeta, pageNumber, pdfDocument]);

  const getLocalPoint = (clientX: number, clientY: number) => {
    const surface = pageSurfaceRef.current;
    if (!surface) return null;
    const rect = surface.getBoundingClientRect();
    return {
      x: clamp(clientX - rect.left, 0, rect.width),
      y: clamp(clientY - rect.top, 0, rect.height),
    };
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const point = getLocalPoint(event.clientX, event.clientY);
    if (!point) return;

    dragStartRef.current = point;
    setDragRect({ left: point.x, top: point.y, width: 0, height: 0 });
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = dragStartRef.current;
    if (!start) return;
    const point = getLocalPoint(event.clientX, event.clientY);
    if (!point) return;
    setDragRect(buildBoxRect(start.x, start.y, point.x, point.y));
  };

  const finishCapture = (clientX: number, clientY: number) => {
    const start = dragStartRef.current;
    const textLayerNode = textLayerRef.current;
    const pageSurfaceNode = pageSurfaceRef.current;
    dragStartRef.current = null;

    if (!start || !textLayerNode || !pageSurfaceNode) {
      setDragRect(null);
      return;
    }

    const point = getLocalPoint(clientX, clientY);
    if (!point) {
      setDragRect(null);
      return;
    }

    const finalRect = buildBoxRect(start.x, start.y, point.x, point.y);
    setDragRect(null);

    if (finalRect.width < BOX_CAPTURE_MIN_SIZE || finalRect.height < BOX_CAPTURE_MIN_SIZE) {
      return;
    }

    const extractedText = extractTextFromRegion(textLayerNode, pageSurfaceNode, finalRect);
    onCaptureRegion(pageNumber, extractedText);
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    finishCapture(event.clientX, event.clientY);
  };

  const handlePointerCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragStartRef.current = null;
    setDragRect(null);
  };

  return (
    <div
      ref={(node) => registerPageNode(pageNumber, node)}
      data-page-number={pageNumber}
      className="mx-auto w-full max-w-[58rem] scroll-mt-6"
    >
      <div className="mb-2 flex items-center justify-between gap-3 text-[10px] font-mono uppercase tracking-[0.18em] text-muted">
        <span>Page {pageNumber}</span>
        <span>{Math.round(pageWidth)} x {Math.round(pageHeight)}</span>
      </div>
      <div
        ref={pageSurfaceRef}
        className="relative overflow-hidden border border-border bg-white shadow-[0_18px_42px_rgba(15,23,42,0.24)] select-none"
        style={{ minHeight: pageHeight || 280 }}
      >
        <canvas ref={canvasRef} className="block max-w-full" />
        <div ref={textLayerRef} className="textLayer absolute inset-0 overflow-hidden" />
        <div
          className="absolute inset-0 z-20 cursor-crosshair touch-none"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
        />
        {dragRect && (
          <div
            className="pointer-events-none absolute z-30 border-2 border-accent bg-accent/12 shadow-[0_0_0_1px_rgba(255,255,255,0.45)]"
            style={{
              left: dragRect.left,
              top: dragRect.top,
              width: dragRect.width,
              height: dragRect.height,
            }}
          />
        )}
      </div>
    </div>
  );
}

export default function PdfFieldCaptureModal({
  file,
  bibliographyFormat,
  values,
  creditLabel,
  contextLabel,
  onApply,
  onClose,
}: PdfFieldCaptureModalProps) {
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [capturedValues, setCapturedValues] = useState<CaptureValues>(values);
  const [captureMetadata, setCaptureMetadata] = useState<CaptureMetadataMap>(EMPTY_CAPTURE_METADATA);
  const [activeFieldId, setActiveFieldId] = useState<CaptureFieldId>('title');
  const [captureNotice, setCaptureNotice] = useState<string | null>(null);
  const [pageTextCounts, setPageTextCounts] = useState<Record<number, number>>({});
  const [currentPage, setCurrentPage] = useState(1);
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const fieldListRef = useRef<HTMLDivElement | null>(null);
  const pageNodesRef = useRef<Record<number, HTMLDivElement | null>>({});
  const fieldCardRefs = useRef<Record<CaptureFieldId, HTMLDivElement | null>>({
    title: null,
    credit: null,
    contextField: null,
    year: null,
    locator: null,
  });

  const fields = useMemo<CaptureFieldDefinition[]>(() => ([
    {
      id: 'title',
      label: 'Working title',
      hint: 'Draw a box around the article, report, or document title directly on the PDF.',
      placeholder: 'Source title as it should appear in the bibliography',
    },
    {
      id: 'credit',
      label: creditLabel,
      hint: 'Draw a box around the author line, issuing organization, or responsible party.',
      placeholder: creditLabel,
    },
    {
      id: 'contextField',
      label: contextLabel,
      hint: 'Draw a box around the journal, report number, conference, repository, or source venue.',
      placeholder: contextLabel,
    },
    {
      id: 'year',
      label: 'Publication date',
      hint: 'Draw a box around the publication date text. Odyssey will clean symbols and normalize it to the thesis citation style.',
      placeholder: getPublicationDatePlaceholder(bibliographyFormat),
    },
    {
      id: 'locator',
      label: 'Available at',
      hint: 'Draw a box around the DOI, repository URL, or Available link so Odyssey can append it to IEEE citations.',
      placeholder: 'https://doi.org/... or https://...',
    },
  ]), [bibliographyFormat, contextLabel, creditLabel]);

  useEffect(() => {
    setCapturedValues(values);
  }, [values]);

  useEffect(() => {
    let cancelled = false;
    let activeDocument: PDFDocumentProxy | null = null;

    const loadPdf = async () => {
      setLoading(true);
      setLoadError(null);
      setPageTextCounts({});
      setCurrentPage(1);
      setCaptureMetadata(EMPTY_CAPTURE_METADATA);
      try {
        const buffer = await file.arrayBuffer();
        if (cancelled) return;
        const documentProxy = await getDocument({ data: buffer }).promise;
        if (cancelled) {
          await documentProxy.destroy();
          return;
        }
        activeDocument = documentProxy;
        setPdfDocument(documentProxy);
        setPageCount(documentProxy.numPages);
      } catch (error) {
        if (cancelled) return;
        setPdfDocument(null);
        setPageCount(0);
        setLoadError(error instanceof Error ? error.message : 'Failed to open the PDF viewer.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadPdf();
    return () => {
      cancelled = true;
      if (activeDocument) {
        void activeDocument.destroy();
      }
    };
  }, [file]);

  useEffect(() => {
    const firstUnfilledField = fields.find((field) => !capturedValues[field.id].trim());
    if (firstUnfilledField) {
      setActiveFieldId(firstUnfilledField.id);
    }
  }, [capturedValues, fields]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !pageCount) return;

    const handleScroll = () => {
      const marker = viewer.scrollTop + 96;
      let visiblePage = 1;
      for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
        const pageNode = pageNodesRef.current[pageNumber];
        if (pageNode && pageNode.offsetTop <= marker) {
          visiblePage = pageNumber;
        }
      }
      setCurrentPage(visiblePage);
    };

    handleScroll();
    viewer.addEventListener('scroll', handleScroll, { passive: true });
    return () => viewer.removeEventListener('scroll', handleScroll);
  }, [pageCount]);

  useEffect(() => {
    if (!captureNotice) return;
    const timeoutId = window.setTimeout(() => setCaptureNotice(null), 3200);
    return () => window.clearTimeout(timeoutId);
  }, [captureNotice]);

  useEffect(() => {
    const container = fieldListRef.current;
    const activeCard = fieldCardRefs.current[activeFieldId];
    if (!container || !activeCard) return;

    const frameId = window.requestAnimationFrame(() => {
      const containerRect = container.getBoundingClientRect();
      const cardRect = activeCard.getBoundingClientRect();
      const topPadding = 12;
      const bottomPadding = 12;
      const cardTop = activeCard.offsetTop;
      const nextScrollTop = Math.max(0, cardTop - topPadding);
      const cardAboveView = cardRect.top < containerRect.top + topPadding;
      const cardBelowView = cardRect.bottom > containerRect.bottom - bottomPadding;

      if (cardAboveView || cardBelowView) {
        container.scrollTo({
          top: nextScrollTop,
          behavior: 'smooth',
        });
      }
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [activeFieldId]);

  const completedCount = fields.filter((field) => capturedValues[field.id].trim()).length;
  const activeField = fields.find((field) => field.id === activeFieldId) ?? fields[0];
  const selectablePages = Object.keys(pageTextCounts).length;
  const hasSelectableText = Object.values(pageTextCounts).some((count) => count > 0);
  const showScannedPdfNotice = !loading && pdfDocument && selectablePages === pageCount && !hasSelectableText;

  const updateFieldValue = (fieldId: CaptureFieldId, nextValue: string, options?: { normalize?: boolean }) => {
    const shouldNormalize = options?.normalize ?? false;
    const normalizedValue = fieldId === 'year'
      ? (shouldNormalize ? normalizePublicationDate(nextValue, bibliographyFormat) : nextValue)
      : fieldId === 'locator'
        ? (shouldNormalize ? normalizeLocatorValue(nextValue) : nextValue)
        : nextValue;
    setCapturedValues((current) => {
      const nextValues = { ...current, [fieldId]: normalizedValue };
      onApply(nextValues);
      return nextValues;
    });
  };

  const clearFieldValue = (fieldId: CaptureFieldId) => {
    updateFieldValue(fieldId, '');
    setCaptureMetadata((current) => ({
      ...current,
      [fieldId]: { pageNumber: null, preview: '' },
    }));
    setActiveFieldId(fieldId);
  };

  const scrollToPage = useCallback((pageNumber: number) => {
    const pageNode = pageNodesRef.current[pageNumber];
    if (!pageNode) return;
    setCurrentPage(pageNumber);
    pageNode.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const handleRegionCapture = useCallback((pageNumber: number, extractedText: string) => {
    if (!extractedText) {
      setCaptureNotice(`No selectable text was found inside the box on page ${pageNumber}.`);
      return;
    }

    const activeField = fields.find((field) => field.id === activeFieldId);

    const normalizedCapture = activeFieldId === 'year'
      ? normalizePublicationDate(extractedText, bibliographyFormat)
      : activeFieldId === 'locator'
        ? normalizeLocatorValue(extractedText)
        : extractedText;

    setCapturedValues((current) => {
      const nextValues = { ...current, [activeFieldId]: normalizedCapture };
      onApply(nextValues);
      const activeIndex = fields.findIndex((field) => field.id === activeFieldId);
      const nextField = fields.slice(activeIndex + 1).find((field) => !nextValues[field.id].trim())
        ?? fields.find((field) => !nextValues[field.id].trim());
      if (nextField) {
        setActiveFieldId(nextField.id);
      }
      return nextValues;
    });

    setCaptureMetadata((current) => ({
      ...current,
      [activeFieldId]: {
        pageNumber,
        preview: normalizedCapture,
      },
    }));

    setCaptureNotice(`${activeField?.label ?? 'Field'} captured from a box on page ${pageNumber}.`);
  }, [activeFieldId, bibliographyFormat, fields, onApply]);

  const handleRenderMeta = useCallback((pageNumber: number, textItemCount: number) => {
    setPageTextCounts((current) => (
      current[pageNumber] === textItemCount
        ? current
        : { ...current, [pageNumber]: textItemCount }
    ));
  }, []);

  const handleRegisterPageNode = useCallback((pageNumber: number, node: HTMLDivElement | null) => {
    pageNodesRef.current[pageNumber] = node;
  }, []);

  return (
    <div className="fixed inset-0 z-[70] bg-[rgba(2,6,23,0.96)]">
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex items-center justify-between gap-4 border-b border-border bg-surface px-5 py-4">
          <div className="min-w-0">
            <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted">PDF Field Capture</p>
            <h3 className="truncate text-sm font-semibold text-heading">{file.name}</h3>
            <p className="mt-1 text-xs text-muted">
              Draw a bounding box over the PDF to extract text into the active citation field. You can still refine every field directly in this workspace before applying it back to intake.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                onApply(capturedValues);
                onClose();
              }}
              className="inline-flex items-center gap-2 border border-accent/30 bg-accent/10 px-3 py-2 text-xs font-semibold text-accent transition-colors hover:bg-accent/15"
            >
              <Check size={14} />
              Apply And Close
            </button>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-10 w-10 items-center justify-center border border-border bg-surface2 text-heading transition-colors hover:bg-surface"
              aria-label="Close PDF field capture"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[24rem_minmax(0,1fr)]">
          <aside className="border-b border-border bg-surface xl:min-h-0 xl:border-b-0 xl:border-r">
            <div className="flex h-full min-h-0 flex-col">
              <div className="border-b border-border px-5 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted">Capture progress</p>
                    <p className="mt-1 text-lg font-semibold text-heading">{completedCount} of {fields.length} fields mapped</p>
                  </div>
                  <div className="inline-flex h-10 w-10 items-center justify-center border border-border bg-surface2 text-accent">
                    <FileSearch size={16} />
                  </div>
                </div>
                <div className="mt-3 h-2 overflow-hidden border border-border bg-surface2">
                  <div
                    className="h-full bg-[linear-gradient(90deg,var(--color-accent),var(--color-accent2))] transition-[width] duration-300"
                    style={{ width: `${(completedCount / fields.length) * 100}%` }}
                  />
                </div>
                <p className="mt-3 text-xs leading-relaxed text-muted">
                  Work top to bottom. Click a field, draw a box around the matching content in the PDF, then review or refine the extracted text here.
                </p>
                {showScannedPdfNotice && (
                  <div className="mt-3 border border-danger/30 bg-danger/5 px-3 py-3 text-xs leading-relaxed text-danger">
                    This PDF does not appear to expose selectable text. Odyssey can still preview the document, but box extraction will not work reliably until the file is OCR-enabled. You can still complete the citation fields manually in this panel.
                  </div>
                )}
              </div>

              <div ref={fieldListRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
                <div className="space-y-3">
                  {fields.map((field) => {
                    const active = field.id === activeFieldId;
                    const value = capturedValues[field.id];
                    const metadata = captureMetadata[field.id];

                    return (
                      <div
                        key={field.id}
                        ref={(node) => {
                          fieldCardRefs.current[field.id] = node;
                        }}
                        className={`border p-3 transition-colors ${
                          active
                            ? 'border-accent bg-accent/10'
                            : value.trim()
                              ? 'border-accent2/30 bg-surface2/45'
                              : 'border-border bg-surface2/20'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <button
                            type="button"
                            onClick={() => setActiveFieldId(field.id)}
                            className="min-w-0 flex-1 text-left"
                          >
                            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-heading">{field.label}</p>
                            <p className="mt-1 text-xs leading-relaxed text-muted">{field.hint}</p>
                          </button>
                          <div className="flex items-center gap-2">
                            {value.trim() && (
                              <button
                                type="button"
                                onClick={() => clearFieldValue(field.id)}
                                className="inline-flex h-7 w-7 items-center justify-center border border-border bg-surface text-muted transition-colors hover:border-danger/40 hover:text-danger"
                                aria-label={`Clear ${field.label}`}
                                title={`Clear ${field.label}`}
                              >
                                <X size={12} />
                              </button>
                            )}
                            {value.trim() ? (
                              <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center border border-accent2/30 bg-accent2/10 text-accent2">
                                <Check size={12} />
                              </span>
                            ) : (
                              <span className={`inline-flex h-7 w-7 shrink-0 items-center justify-center border ${active ? 'border-accent/40 text-accent' : 'border-border text-muted'}`}>
                                <ArrowRight size={12} />
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="mt-3 space-y-2">
                          {field.multiline ? (
                            <textarea
                              value={value}
                              onChange={(event) => updateFieldValue(field.id, event.target.value)}
                              rows={4}
                              placeholder={field.placeholder}
                              className="w-full resize-y border border-border bg-surface px-3 py-2 text-sm text-heading outline-none transition-colors placeholder:text-muted/70 focus:border-accent"
                            />
                          ) : (
                            <input
                              type="text"
                              value={value}
                              onChange={(event) => updateFieldValue(field.id, event.target.value)}
                              onBlur={(event) => updateFieldValue(field.id, event.target.value, { normalize: field.id === 'year' || field.id === 'locator' })}
                              placeholder={field.placeholder}
                              className="w-full border border-border bg-surface px-3 py-2 text-sm text-heading outline-none transition-colors placeholder:text-muted/70 focus:border-accent"
                            />
                          )}

                          {metadata.preview && (
                            <div className="border border-border bg-surface/80 px-3 py-2">
                              <div className="flex items-center justify-between gap-3 text-[10px] font-mono uppercase tracking-[0.16em] text-muted">
                                <span>Last capture</span>
                                <span>{metadata.pageNumber ? `Page ${metadata.pageNumber}` : 'Current page'}</span>
                              </div>
                              <p className="mt-2 text-xs leading-relaxed text-heading">
                                {metadata.preview}
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </aside>

          <div className="min-h-0 bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.14),_transparent_28%),var(--color-bg)]">
            <div className="flex h-full min-h-0 flex-col">
              <div className="border-b border-border bg-surface/70 px-5 py-3 backdrop-blur">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted">Active field</p>
                    <p className="mt-1 text-sm font-semibold text-heading">{activeField.label}</p>
                    <p className="mt-1 text-xs text-muted">{activeField.hint}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="inline-flex items-center gap-2 border border-border bg-surface px-3 py-2 text-xs text-heading">
                      <span className="text-muted">Page</span>
                      <span className="font-semibold">{currentPage}</span>
                      <span className="text-muted">of {pageCount || 1}</span>
                    </div>
                    {captureNotice && (
                      <div className="border border-accent2/30 bg-accent2/10 px-3 py-2 text-xs text-accent2">
                        {captureNotice}
                      </div>
                    )}
                  </div>
                </div>

                {pageCount > 1 && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => scrollToPage(Math.max(1, currentPage - 1))}
                      disabled={currentPage <= 1}
                      className="inline-flex h-9 w-9 items-center justify-center border border-border bg-surface2 text-heading transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-45"
                      aria-label="Go to previous PDF page"
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <div className="flex max-w-full flex-1 gap-2 overflow-x-auto pb-1">
                      {Array.from({ length: pageCount }, (_, index) => {
                        const pageNumber = index + 1;
                        const active = pageNumber === currentPage;
                        const pageHasText = pageTextCounts[pageNumber] > 0;
                        return (
                          <button
                            key={pageNumber}
                            type="button"
                            onClick={() => scrollToPage(pageNumber)}
                            className={`inline-flex min-w-[2.5rem] items-center justify-center border px-3 py-2 text-xs font-semibold transition-colors ${
                              active
                                ? 'border-accent bg-accent text-[var(--color-accent-fg)]'
                                : pageHasText
                                  ? 'border-border bg-surface text-heading hover:bg-surface2'
                                  : 'border-border bg-surface2/60 text-muted hover:bg-surface2'
                            }`}
                            aria-label={`Go to PDF page ${pageNumber}`}
                          >
                            {pageNumber}
                          </button>
                        );
                      })}
                    </div>
                    <button
                      type="button"
                      onClick={() => scrollToPage(Math.min(pageCount, currentPage + 1))}
                      disabled={currentPage >= pageCount}
                      className="inline-flex h-9 w-9 items-center justify-center border border-border bg-surface2 text-heading transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-45"
                      aria-label="Go to next PDF page"
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                )}
              </div>

              <div ref={viewerRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-6">
                {loading ? (
                  <div className="flex h-full min-h-[24rem] items-center justify-center border border-border bg-surface2/25 text-sm text-muted">
                    Opening PDF preview...
                  </div>
                ) : loadError ? (
                  <div className="border border-danger/30 bg-danger/5 px-4 py-4 text-sm text-danger">
                    {loadError}
                  </div>
                ) : pdfDocument ? (
                  <div className="space-y-8">
                    {Array.from({ length: pageCount }, (_, index) => (
                      <PdfSelectionPage
                        key={`${file.name}-${index + 1}`}
                        pdfDocument={pdfDocument}
                        pageNumber={index + 1}
                        onRenderMeta={handleRenderMeta}
                        onCaptureRegion={handleRegionCapture}
                        registerPageNode={handleRegisterPageNode}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
