import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CornerDownLeft,
  FileSearch,
  FileText,
  Folder,
  FolderOpen,
  GraduationCap,
  GripVertical,
  History,
  Link2,
  Loader2,
  Network,
  Plus,
  AlertTriangle,
  Search,
  Settings2,
  SquarePen,
  Trash2,
  Users,
  Upload,
  X,
} from 'lucide-react';
import { useProjects } from '../hooks/useProjects';
import { useProfile } from '../hooks/useProfile';
import { useChatPanel } from '../lib/chat-panel';
import { supabase } from '../lib/supabase';
import type { Goal, OdysseyEvent } from '../types';
import WorkspaceTabBar from '../components/WorkspaceTabBar';
import FilterDropdown from '../components/FilterDropdown';
import {
  applyRemoteThesisDocument,
  buildNumberedLatexSource,
  DEFAULT_THESIS_EXAMPLE_PATH,
  fetchThesisDocument,
  getThesisWorkspaceActiveFile,
  parseThesisSourceUrl,
  saveThesisSources,
  signThesisSourceAttachment,
  uploadThesisDocumentAttachment,
  uploadThesisSourcePdf,
  type ParsedThesisSourceRecord,
  type ThesisWorkspaceFile,
  type ThesisSourceAttachment,
  readStoredThesisPaperSnapshot,
  THESIS_PAPER_STATE_EVENT,
  type ThesisPaperSnapshot,
} from '../lib/thesis-paper';
import { setStoredSidebarCollapsed } from '../lib/sidebar-state';
import { getCitationReferenceGuide, searchCitationReferenceChunks } from '../lib/citation-references';
import { getPublicationDatePlaceholder, normalizePublicationDate } from '../lib/citation-date';
import {
  buildSourceVenueDisplay,
  buildSourceVenueDisplayFromMetadata,
  looksLikeCompleteArticleVenue,
  normalizeBibliographyPages,
  type ParsedSourceVenueMetadata,
  type SourceVenueKind,
} from '../lib/bibliography-metadata';
import { lazyWithRetry } from '../lib/lazy-with-retry';
import { pushUndoAction } from '../lib/undo-manager';

const ThesisPaperTab = lazyWithRetry(() => import('../components/ThesisPaperTab'), 'thesis-paper-tab');
const ThesisKnowledgeTab = lazyWithRetry(() => import('../components/ThesisKnowledgeTab'), 'thesis-knowledge-tab');
const ThesisSettingsTab = lazyWithRetry(() => import('../components/ThesisSettingsTab'), 'thesis-settings-tab');
const PdfFieldCaptureModal = lazyWithRetry(() => import('../components/PdfFieldCaptureModal'), 'thesis-pdf-field-capture-modal');

type ThesisTabId = 'overview' | 'milestones' | 'sources' | 'documents' | 'graph' | 'paper' | 'settings';

type ThesisMilestoneTask = {
  id: string;
  label: string;
  completed: boolean;
};

type ThesisMilestone = {
  id: string;
  label: string;
  status: 'complete' | 'in_progress' | 'planned';
  progress: number;
  startDate: string;
  due: string;
  note: string;
  subTasks: ThesisMilestoneTask[];
  involvedPeople: string[];
  requiredDocuments: string[];
  linkedFilePaths: string[];
};

type ThesisLinkedFileTreeNode = {
  kind: 'folder' | 'file';
  id: string;
  name: string;
  path: string;
  fileId?: string;
  children: ThesisLinkedFileTreeNode[];
};

type SourceItem = {
  id: string;
  title: string;
  type: 'paper' | 'web' | 'dataset' | 'notes' | 'document';
  status: 'queued' | 'analyzed' | 'tagged';
  insight: string;
  librarySourceId?: string;
};

type SourceIntakeMethod = 'url' | 'pdf' | 'manual';

type SourceIntakeKind =
  | 'journal_article'
  | 'conference_paper'
  | 'book'
  | 'book_chapter'
  | 'government_report'
  | 'thesis_dissertation'
  | 'dataset'
  | 'interview_notes'
  | 'archive_record'
  | 'web_article'
  | 'documentation';

type SourceLibraryType = 'pdf' | 'link' | 'book' | 'paper' | 'report' | 'notes' | 'dataset';

export type BibliographyFormat = 'apa' | 'chicago' | 'ieee' | 'informs' | 'asme' | 'aiaa' | 'ams';

export type SourceLibraryItem = {
  id: string;
  citeKey: string;
  title: string;
  type: SourceLibraryType;
  acquisitionMethod: SourceIntakeMethod;
  sourceKind: SourceIntakeKind;
  status: SourceItem['status'];
  role: 'primary' | 'secondary' | 'contextual';
  verification: 'verified' | 'provisional' | 'restricted';
  chapterTarget: 'literature_review' | 'methods' | 'findings' | 'appendix';
  credit: string;
  venue: string;
  year: string;
  locator: string;
  citation: string;
  abstract: string;
  notes: string;
  tags: string[];
  addedOn: string;
  attachmentName: string;
  attachmentStoragePath: string;
  attachmentMimeType: string;
  attachmentUploadedAt: string;
};

type BibliographyReadiness = {
  status: 'ready' | 'manual';
  summary: string;
  details: string[];
  exactChanges: Array<{
    field: 'title' | 'credit' | 'venue' | 'year' | 'locator' | 'citation';
    label: string;
    suggestedValue: string;
    reason: string;
  }>;
  autoFixPatch: Partial<Pick<SourceLibraryItem, 'title' | 'credit' | 'venue' | 'year' | 'locator' | 'citation'>>;
};

function cloneSourceLibraryItem(source: SourceLibraryItem): SourceLibraryItem {
  return {
    ...source,
    tags: [...source.tags],
  };
}

type ThesisSupportingDocument = {
  id: string;
  title: string;
  description: string;
  contribution: string;
  extractedTextPreview: string;
  linkedSourceId: string | null;
  addedOn: string;
  attachmentName: string;
  attachmentStoragePath: string;
  attachmentMimeType: string;
  attachmentUploadedAt: string;
};

type ThesisMember = {
  id: string;
  name: string;
  role: string;
};

type ThesisDetails = {
  description: string;
  department: string;
  graduatingQuarter: string;
  citationFormat: BibliographyFormat;
  members: ThesisMember[];
};

type ThesisProfileSnapshot = {
  linkedProjectIds: string[];
  thesisDetails: ThesisDetails;
  milestones: ThesisMilestone[];
};

const tabs: { id: ThesisTabId; label: string; icon: typeof BookOpen }[] = [
  { id: 'overview', label: 'Overview', icon: GraduationCap },
  { id: 'milestones', label: 'Milestones', icon: CheckCircle2 },
  { id: 'sources', label: 'Sources', icon: Upload },
  { id: 'documents', label: 'Documents', icon: FileText },
  { id: 'graph', label: 'Knowledge', icon: Network },
  { id: 'paper', label: 'Latex', icon: FileText },
  { id: 'settings', label: 'Settings', icon: Settings2 },
];

function createMilestoneTask(label: string, completed = false): ThesisMilestoneTask {
  return {
    id: createSourceId('milestone-task'),
    label,
    completed,
  };
}

const DEFAULT_THESIS_MILESTONES: ThesisMilestone[] = [
  {
    id: 'thesis-decision',
    label: 'Thesis Decision',
    status: 'planned',
    progress: 0,
    startDate: '2026-01-05',
    due: '2026-01-16',
    note: 'Lock the topic, initial scope, and advisor alignment before formal proposal work starts.',
    subTasks: [
      createMilestoneTask('Confirm thesis topic'),
      createMilestoneTask('Align with advisor'),
      createMilestoneTask('Capture initial problem statement'),
    ],
    involvedPeople: ['Student', 'Thesis advisor'],
    requiredDocuments: ['Initial concept note'],
    linkedFilePaths: [],
  },
  {
    id: 'proposal-submission',
    label: 'Proposal Submission',
    status: 'planned',
    progress: 0,
    startDate: '2026-01-19',
    due: '2026-02-06',
    note: 'Prepare and submit the proposal package with the thesis question, approach, and expected deliverables.',
    subTasks: [
      createMilestoneTask('Draft proposal narrative'),
      createMilestoneTask('Assemble submission package'),
      createMilestoneTask('Submit to program office'),
    ],
    involvedPeople: ['Student', 'Thesis advisor', 'Program office'],
    requiredDocuments: ['Proposal memorandum', 'Initial bibliography'],
    linkedFilePaths: [],
  },
  {
    id: 'proposal-approval',
    label: 'Proposal Approval',
    status: 'planned',
    progress: 0,
    startDate: '2026-02-09',
    due: '2026-02-27',
    note: 'Address reviewer comments and secure formal approval to proceed on the approved thesis path.',
    subTasks: [
      createMilestoneTask('Collect proposal feedback'),
      createMilestoneTask('Revise scope if required'),
      createMilestoneTask('Receive approval decision'),
    ],
    involvedPeople: ['Student', 'Thesis advisor', 'Reviewer'],
    requiredDocuments: ['Updated proposal package', 'Approval routing sheet'],
    linkedFilePaths: [],
  },
  {
    id: 'research',
    label: 'Research',
    status: 'planned',
    progress: 0,
    startDate: '2026-03-02',
    due: '2026-05-15',
    note: 'Execute literature review, evidence collection, analysis, and supporting investigation work.',
    subTasks: [
      createMilestoneTask('Collect core sources'),
      createMilestoneTask('Analyze evidence'),
      createMilestoneTask('Record findings and gaps'),
    ],
    involvedPeople: ['Student', 'Thesis advisor', 'Subject matter experts'],
    requiredDocuments: ['Research notes', 'Evidence tables'],
    linkedFilePaths: [],
  },
  {
    id: 'thesis-draft',
    label: 'Thesis Draft',
    status: 'planned',
    progress: 0,
    startDate: '2026-05-18',
    due: '2026-06-19',
    note: 'Turn the research record into a full thesis draft with figures, citations, and front matter.',
    subTasks: [
      createMilestoneTask('Draft chapters'),
      createMilestoneTask('Integrate citations'),
      createMilestoneTask('Prepare figures and appendices'),
    ],
    involvedPeople: ['Student', 'Thesis advisor'],
    requiredDocuments: ['Working thesis draft'],
    linkedFilePaths: [],
  },
  {
    id: 'thesis-submission',
    label: 'Thesis Submission',
    status: 'planned',
    progress: 0,
    startDate: '2026-06-22',
    due: '2026-07-03',
    note: 'Finalize the draft and submit the formal thesis package for review.',
    subTasks: [
      createMilestoneTask('Finalize formatting'),
      createMilestoneTask('Run submission checklist'),
      createMilestoneTask('Submit thesis package'),
    ],
    involvedPeople: ['Student', 'Thesis advisor', 'Program office'],
    requiredDocuments: ['Final thesis draft', 'Submission checklist'],
    linkedFilePaths: [],
  },
  {
    id: 'review',
    label: 'Review',
    status: 'planned',
    progress: 0,
    startDate: '2026-07-06',
    due: '2026-07-24',
    note: 'Track reviewer comments, corrections, and final cleanup before approval.',
    subTasks: [
      createMilestoneTask('Collect review comments'),
      createMilestoneTask('Apply revisions'),
      createMilestoneTask('Prepare response notes'),
    ],
    involvedPeople: ['Student', 'Reviewer', 'Second reviewer', 'Thesis advisor'],
    requiredDocuments: ['Reviewer markup set', 'Revision response memo'],
    linkedFilePaths: [],
  },
  {
    id: 'approval',
    label: 'Approval',
    status: 'planned',
    progress: 0,
    startDate: '2026-07-27',
    due: '2026-08-07',
    note: 'Complete final approvals and archive the final accepted thesis package.',
    subTasks: [
      createMilestoneTask('Route approval signatures'),
      createMilestoneTask('Archive final files'),
      createMilestoneTask('Confirm program closeout'),
    ],
    involvedPeople: ['Student', 'Thesis advisor', 'Reviewer', 'Program office'],
    requiredDocuments: ['Approved thesis PDF', 'Signature page'],
    linkedFilePaths: [],
  },
];
const DEFAULT_THESIS_MILESTONE_IDS = new Set(DEFAULT_THESIS_MILESTONES.map((milestone) => milestone.id));

const LEGACY_SOURCE_QUEUE_IDS = new Set(['src-1', 'src-2', 'src-3', 'src-4']);
const LEGACY_SOURCE_LIBRARY_IDS = new Set(['lib-1', 'lib-2', 'lib-3', 'lib-4', 'lib-5', 'lib-6']);

const sourceIntakeMethods: {
  id: SourceIntakeMethod;
  label: string;
  hint: string;
  detail: string;
}[] = [
  {
    id: 'url',
    label: 'Paste URL',
    hint: 'Web pages, reports, manuals, repositories',
    detail: 'Capture source metadata from a live page, DOI landing page, digital archive, or repository record.',
  },
  {
    id: 'pdf',
    label: 'Upload PDF',
    hint: 'Articles, proceedings, theses, reports, chapters',
    detail: 'Bring in a local PDF so Odyssey can extract citation fields, quoted passages, and source evidence.',
  },
  {
    id: 'manual',
    label: 'Manual Entry',
    hint: 'Interviews, notes, books, internal records',
    detail: 'Use a structured intake when the source starts as a non-web record, personal communication, or manually keyed bibliography item.',
  },
];

const sourceIntakeKinds: {
  id: SourceIntakeKind;
  label: string;
  hint: string;
  bibtexTarget: string;
  recommendedMethods: SourceIntakeMethod[];
}[] = [
  {
    id: 'journal_article',
    label: 'Published Paper (Journal)',
    hint: 'Peer-reviewed journal papers and published articles that should save as an NPS `@article` entry.',
    bibtexTarget: '@article',
    recommendedMethods: ['url', 'pdf'],
  },
  {
    id: 'conference_paper',
    label: 'Published Paper (Conference)',
    hint: 'Conference papers, symposium papers, workshop papers, and proceedings entries that should save as `@inproceedings`.',
    bibtexTarget: '@inproceedings',
    recommendedMethods: ['url', 'pdf'],
  },
  {
    id: 'book',
    label: 'Book',
    hint: 'Whole books or monographs that should save as an NPS `@book` entry.',
    bibtexTarget: '@book',
    recommendedMethods: ['url', 'pdf', 'manual'],
  },
  {
    id: 'book_chapter',
    label: 'Book Chapter',
    hint: 'Edited-book chapters or contributed sections that should save as `@incollection`.',
    bibtexTarget: '@incollection',
    recommendedMethods: ['url', 'pdf'],
  },
  {
    id: 'government_report',
    label: 'Government / Technical Report',
    hint: 'Agency reports, RAND/GAO/CRS reports, lab studies, doctrine, or strategy documents that should save as `@techreport`.',
    bibtexTarget: '@techreport',
    recommendedMethods: ['url', 'pdf'],
  },
  {
    id: 'thesis_dissertation',
    label: 'Thesis / Dissertation',
    hint: 'Master’s theses and dissertations that should save as `@mastersthesis` or `@phdthesis`.',
    bibtexTarget: '@mastersthesis / @phdthesis',
    recommendedMethods: ['url', 'pdf', 'manual'],
  },
  {
    id: 'dataset',
    label: 'Dataset / Repository Item',
    hint: 'Datasets, repository records, and retrievable research artifacts that should save as `@misc`.',
    bibtexTarget: '@misc',
    recommendedMethods: ['url', 'manual'],
  },
  {
    id: 'interview_notes',
    label: 'Interview / Personal Communication',
    hint: 'Interviews, emails, advisor guidance, and meeting notes that map to `@misc` or `@unpublished` and often need manual review.',
    bibtexTarget: '@misc / @unpublished',
    recommendedMethods: ['manual', 'pdf'],
  },
  {
    id: 'archive_record',
    label: 'Archive / Collection Record',
    hint: 'Archive pages, accession records, institutional repository pages, and collection records that should save as `@misc`.',
    bibtexTarget: '@misc',
    recommendedMethods: ['url', 'pdf', 'manual'],
  },
  {
    id: 'web_article',
    label: 'Web Page / News / Blog',
    hint: 'Webpages, blog posts, news stories, and online articles that should save as an NPS `@misc` entry.',
    bibtexTarget: '@misc',
    recommendedMethods: ['url'],
  },
  {
    id: 'documentation',
    label: 'Manual / Standard / Documentation',
    hint: 'Standards, manuals, doctrine, API docs, and technical references that should save as `@manual`.',
    bibtexTarget: '@manual',
    recommendedMethods: ['url'],
  },
];

const chapterPlan = [
  { chapter: 'Introduction', status: 'Drafting', progress: 70, focus: 'Problem statement, stakes, and thesis contribution.' },
  { chapter: 'Literature Review', status: 'Active', progress: 54, focus: 'Competing schools of thought and evidence gaps.' },
  { chapter: 'Methodology', status: 'Outlined', progress: 38, focus: 'Source selection logic and analysis method.' },
  { chapter: 'Findings', status: 'Planned', progress: 22, focus: 'Theme-by-theme argument supported by extracted evidence.' },
  { chapter: 'Conclusion', status: 'Planned', progress: 12, focus: 'Implications, limitations, and follow-on research.' },
];

const THESIS_LINK_STORAGE_KEY = 'odyssey-thesis-linked-project';
const THESIS_SOURCE_LIBRARY_STORAGE_KEY = 'odyssey-thesis-source-library';
const THESIS_SOURCE_QUEUE_STORAGE_KEY = 'odyssey-thesis-source-queue';
const THESIS_DOCUMENT_LIBRARY_STORAGE_KEY = 'odyssey-thesis-document-library';
const THESIS_MILESTONES_STORAGE_KEY = 'odyssey-thesis-milestones';
const THESIS_DETAILS_STORAGE_KEY = 'odyssey-thesis-details';
const THESIS_SOURCE_SYNC_EVENT = 'odyssey:thesis-sources-updated';

const DEFAULT_THESIS_DESCRIPTION = 'This thesis examines how AI-enabled mission systems can be evaluated with enough rigor to support operational trust, especially when test evidence, human factors, and deployment readiness evolve at different speeds.';
const DEFAULT_THESIS_DETAILS: ThesisDetails = {
  description: DEFAULT_THESIS_DESCRIPTION,
  department: '',
  graduatingQuarter: '',
  citationFormat: 'ieee',
  members: createDefaultThesisMembers(),
};

const THESIS_MEMBER_ROLE_SUGGESTIONS = [
  'Author',
  'Advisor',
  'Reviewer',
  'Second Reviewer',
  'Co-Author',
  'Program Officer',
] as const;

const THESIS_DEPARTMENT_OPTIONS = [
  'Acquisition Research Program (ARP)',
  'Center for Homeland Defense and Security (CHDS)',
  'Cyber Systems and Operations (CSO/MACO)',
  'Defense Analysis (DA)',
  'Department of Acquisition, Finance, and Manpower (DAFM)',
  'Department of Applied Mathematics',
  'Department of Computer Science',
  'Department of Defense Analysis',
  'Department of Defense Management',
  'Department of Electrical and Computer Engineering',
  'Department of Information Sciences',
  'Department of Mechanical and Aerospace Engineering',
  'Department of Meteorology',
  'Department of Oceanography',
  'Department of Operations Research',
  'Department of Physics',
  'Department of Systems Engineering',
  'Electrical and Computer Engineering (ECE)',
  'Engineering',
  'Human Systems Integration (HSI)',
  'Information Sciences (IS)',
  'Institute for Regional and International Security (IRIS)',
  'Mechanical & Aerospace Engineering (MAE)',
  'Meteorology & Oceanography (METOC)',
  'Operations Research (OR)',
  'Physics (PH)',
  'Space Systems Academic Group (SSAG)',
  'Systems Engineering (SE)',
] as const;

const normalizeDepartmentOption = (option: string) =>
  option
    .replace(/^Department of /, '')
    .replace(/\s+\([^)]+\)$/, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .toLowerCase();

const departmentOptionKeys = new Set(
  THESIS_DEPARTMENT_OPTIONS.filter((option) => option.startsWith('Department of ')).map(normalizeDepartmentOption)
);

const SORTED_THESIS_DEPARTMENT_OPTIONS = THESIS_DEPARTMENT_OPTIONS.filter((option) => {
  if (option.startsWith('Department of ')) {
    return true;
  }

  return !departmentOptionKeys.has(normalizeDepartmentOption(option));
}).sort((left, right) => {
  const leftIsDepartment = left.startsWith('Department of ');
  const rightIsDepartment = right.startsWith('Department of ');

  if (leftIsDepartment !== rightIsDepartment) {
    return leftIsDepartment ? -1 : 1;
  }

  return left.localeCompare(right);
});

const BIBLIOGRAPHY_FORMAT_LABELS: Record<BibliographyFormat, string> = {
  apa: 'APA',
  chicago: 'Chicago',
  ieee: 'IEEE',
  informs: 'INFORMS',
  asme: 'ASME',
  aiaa: 'AIAA',
  ams: 'AMS',
};

const THESIS_CITATION_FORMAT_OPTIONS: BibliographyFormat[] = ['apa', 'chicago', 'ieee', 'informs', 'asme', 'aiaa', 'ams'];

const CITATION_REFERENCE_UI_EXAMPLES: Record<BibliographyFormat, {
  title: string;
  reference: string;
  inText?: string;
  note?: string;
}> = {
  apa: {
    title: 'Journal article example',
    reference: 'Sanico, G. F., & Kakinaka, M. (2008). Terrorism and deterrence policy with transnational support. Defence & Peace Economics, 19(2), 153-167. https://doi.org/10.1080/10242690701505419',
    inText: '(Sanico & Kakinaka, 2008)',
  },
  chicago: {
    title: 'Webpage example',
    reference: 'Federal Bureau of Investigation. 2017. "Forging Papers to Sell Fake Art." April 6, 2017. https://www.fbi.gov/news/stories/forging-papers-to-sell-fake-art.',
    inText: '(Federal Bureau of Investigation [FBI] 2017); later: (FBI 2017)',
  },
  ieee: {
    title: 'Journal article example',
    reference: '[1] G. Sanico and M. Kakinaka, "Terrorism and deterrence policy with transnational support," Def. Peace Econ., vol. 19, no. 2, pp. 153-167, Apr. 2008. Available: https://doi.org/10.1080/10242690701505419',
    note: 'In text, IEEE uses bracketed numbers in citation order, such as [1].',
  },
  informs: {
    title: 'Journal article example',
    reference: 'Sanico GF, Kakinaka M (2008) Terrorism and deterrence policy with transnational support. J. of Def. and Peace 19(2), https://doi.org/10.1080/10242690701505419.',
    inText: '(Sanico and Kakinaka 2008, p. 588)',
  },
  asme: {
    title: 'Journal article example',
    reference: '[3] Adams, Z., 2014, "Bending of an Infinite Beam on an Elastic Substrate," ASME J Appl. Mech., 3, pp. 221-228.',
    note: 'In text, ASME uses bracketed numbers in appearance order, such as [1] or [5-7].',
  },
  aiaa: {
    title: 'Journal article example',
    reference: '[2] Johnson, J. E., Lewis, M. J., and Starkey, R. P., "Multi-Objective Optimization of Earth-Entry Vehicle Heat Shields," Journal of Spacecraft and Rockets, Vol. 49, No. 1, 2012, pp. 38-50. https://doi.org/xx.xxxx/x.xxxxx',
    note: 'AIAA also uses numbered references and cites them in the order they appear.',
  },
  ams: {
    title: 'Thesis example',
    reference: 'Hirschberg, P., 1988: The saline flow into the Atlantic. M.S. thesis, Dept. of Oceanographic Studies, The Pennsylvania State University, 207 pp.',
    note: 'AMS examples usually keep the year immediately after the author and use a colon before the title.',
  },
};

const DEPARTMENT_CITATION_RECOMMENDATIONS: Array<{
  matchers: string[];
  format: BibliographyFormat;
  note: string;
}> = [
  {
    matchers: ['acquisition research program', 'arp', 'acquisition, finance, and manpower', 'dafm', 'defense management', 'human systems integration', 'hsi', 'information sciences', 'department of information sciences'],
    format: 'apa',
    note: 'APA is preferred for this department/program, though advisors may allow another style.',
  },
  {
    matchers: ['center for homeland defense and security', 'chds', 'defense analysis', 'department of defense analysis', 'iris', 'institute for regional and international security'],
    format: 'chicago',
    note: 'Chicago is the closest match to the department guidance shown for this program.',
  },
  {
    matchers: ['department of mechanical and aerospace engineering', 'mechanical & aerospace engineering', 'mae'],
    format: 'asme',
    note: 'ASME is the closest default match here; MAE guidance also allows AIAA or IEEE depending on advisor direction.',
  },
  {
    matchers: ['department of meteorology', 'department of oceanography', 'meteorology & oceanography', 'metoc'],
    format: 'ams',
    note: 'AMS is recommended for Meteorology and Oceanography programs based on the guidance provided.',
  },
  {
    matchers: ['cyber systems and operations', 'cso/maco', 'computer science', 'electrical and computer engineering', 'ece', 'engineering', 'applied mathematics', 'physics', 'ph', 'space systems academic group', 'ssag'],
    format: 'ieee',
    note: 'IEEE is the recommended technical citation format for this department/program in Odyssey.',
  },
  {
    matchers: ['operations research', 'department of operations research', 'or'],
    format: 'informs',
    note: 'INFORMS is recommended because some Operations Research advisors require it.',
  },
  {
    matchers: ['systems engineering', 'department of systems engineering', 'se'],
    format: 'ieee',
    note: 'Systems Engineering often uses Chicago Author-Date, but IEEE is the best match here and aligns with the LaTeX workflow.',
  },
];

function buildGraduatingQuarterOptions(startYear: number, endYear: number) {
  const seasons = ['SPRING', 'SUMMER', 'FALL', 'WINTER'] as const;
  const options: string[] = [];
  for (let year = startYear; year <= endYear; year += 1) {
    for (const season of seasons) {
      options.push(`${season} ${year}`);
    }
  }
  return options;
}

const THESIS_GRADUATING_QUARTER_OPTIONS = buildGraduatingQuarterOptions(2026, 2085);

function cloneMilestoneTask(task: ThesisMilestoneTask): ThesisMilestoneTask {
  return { ...task };
}

function deriveMilestoneState(milestone: ThesisMilestone): ThesisMilestone {
  const normalizedTasks = milestone.subTasks
    .map((task) => ({
      id: typeof task.id === 'string' && task.id.trim() ? task.id : createSourceId('milestone-task'),
      label: typeof task.label === 'string' ? task.label : '',
      completed: Boolean(task.completed),
    }));

  const completedEligibleTaskCount = normalizedTasks.filter((task) => task.label.trim().length > 0 && task.completed).length;
  const eligibleTaskCount = normalizedTasks.filter((task) => task.label.trim().length > 0).length;

  const progress = eligibleTaskCount > 0
    ? Math.round((completedEligibleTaskCount / eligibleTaskCount) * 100)
    : (milestone.status === 'complete' ? 100 : 0);
  const status: ThesisMilestone['status'] = progress >= 100
    ? 'complete'
    : progress > 0
      ? 'in_progress'
      : 'planned';

  return {
    ...milestone,
    status,
    progress,
    subTasks: normalizedTasks,
  };
}

function createDefaultThesisMilestones() {
  return DEFAULT_THESIS_MILESTONES.map((milestone) => deriveMilestoneState({
    ...milestone,
    subTasks: milestone.subTasks.map(cloneMilestoneTask),
    involvedPeople: [...milestone.involvedPeople],
    requiredDocuments: [...milestone.requiredDocuments],
    linkedFilePaths: [...milestone.linkedFilePaths],
  }));
}

function createCustomThesisMilestone(): ThesisMilestone {
  return deriveMilestoneState({
    id: createSourceId('milestone'),
    label: 'New Milestone',
    status: 'planned',
    progress: 0,
    startDate: '',
    due: '',
    note: '',
    subTasks: [],
    involvedPeople: [''],
    requiredDocuments: [''],
    linkedFilePaths: [],
  });
}

function createThesisMember(name = '', role = 'Author'): ThesisMember {
  return {
    id: createSourceId('thesis-member'),
    name,
    role,
  };
}

function createDefaultThesisMembers() {
  return [
    createThesisMember('', 'Author'),
    createThesisMember('', 'Advisor'),
    createThesisMember('', 'Reviewer'),
  ];
}

function parseStoredLinkedProjectIds(rawValue: string | null): string[] {
  if (!rawValue) return [];
  try {
    const parsed = JSON.parse(rawValue);
    if (Array.isArray(parsed)) {
      return parsed
        .map((value) => (typeof value === 'string' ? value.trim() : ''))
        .filter(Boolean);
    }
  } catch {
    const legacyValue = rawValue.trim();
    if (legacyValue) return [legacyValue];
  }
  return [];
}

function createSourceId(prefix: string) {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function slugCiteKeyPart(value: string) {
  const normalized = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || 'source';
}

function normalizeSourceCreditText(value: string) {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/\\&/g, '&')
    .replace(/([A-Za-z])-\s+([A-Za-z])/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[,;]+|[,;]+$/g, '');
}

function looksLikeOrganizationCredit(value: string) {
  const trimmed = normalizeSourceCreditText(value);
  if (!trimmed) return false;
  if (/[A-Z]{2,}/.test(trimmed) && !/[a-z]/.test(trimmed)) return true;
  return /\b(agency|department|office|committee|commission|command|center|centre|university|college|school|laboratory|lab|institute|administration|association|society|bureau|ministry|corps|navy|army|air force|marine|marines|government|council|press|publisher|organization|division|company|corporation|corp|inc|incorporated|llc|ltd|limited|plc|gmbh|group|holdings|systems|technologies|industries|international)\b/i.test(trimmed);
}

type ParsedCreditEntry =
  | {
      kind: 'person';
      givenName: string;
      familyName: string;
    }
  | {
      kind: 'organization';
      organizationName: string;
    };

function joinWithOxfordComma(values: string[]) {
  if (values.length <= 1) return values[0] ?? '';
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(', ')}, and ${values.at(-1)}`;
}

function formatParsedCreditEntry(entry: ParsedCreditEntry) {
  if (entry.kind === 'organization') return entry.organizationName;
  return normalizeSourceCreditText(`${entry.givenName} ${entry.familyName}`);
}

function invertSurnameFirstCreditName(value: string) {
  const normalized = normalizeSourceCreditText(value);
  const parts = normalized.split(/\s*,\s*/).filter(Boolean);
  if (parts.length === 2) {
    return normalizeSourceCreditText(`${parts[1]} ${parts[0]}`);
  }
  return normalized;
}

function countCreditWords(value: string) {
  return normalizeSourceCreditText(value).split(/\s+/).filter(Boolean).length;
}

function isLikelySurnameFirstCreditSequence(parts: string[]) {
  if (parts.length < 4 || parts.length % 2 !== 0) return false;
  const familyParts = parts.filter((_, index) => index % 2 === 0);
  const givenParts = parts.filter((_, index) => index % 2 === 1);
  const mostlyShortFamilyNames = familyParts.filter((part) => countCreditWords(part) <= 2).length >= Math.ceil(familyParts.length * 0.8);
  const mostlyShortGivenNames = givenParts.filter((part) => countCreditWords(part) <= 3).length >= Math.ceil(givenParts.length * 0.8);
  const manyFullNamesAlreadyPresent = parts.filter((part) => countCreditWords(part) >= 2).length > Math.floor(parts.length / 2);
  return mostlyShortFamilyNames && mostlyShortGivenNames && !manyFullNamesAlreadyPresent;
}

function parsePersonCreditSegment(value: string): ParsedCreditEntry | null {
  const normalized = invertSurnameFirstCreditName(value);
  if (!normalized) return null;
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  if (words.length === 1) {
    return {
      kind: 'person',
      givenName: '',
      familyName: words[0],
    };
  }
  return {
    kind: 'person',
    givenName: words.slice(0, -1).join(' '),
    familyName: words.at(-1) ?? '',
  };
}

function parseSourceCreditEntries(value: string): ParsedCreditEntry[] {
  const normalized = normalizeSourceCreditText(value);
  if (!normalized) return [];
  if (looksLikeOrganizationCredit(normalized) || /^https?:\/\//i.test(normalized)) {
    return [{ kind: 'organization', organizationName: normalized }];
  }

  const semicolonParts = normalized
    .split(/\s*;\s*|\s*\n+\s*/)
    .map((part) => normalizeSourceCreditText(part))
    .filter(Boolean);
  if (semicolonParts.length > 1) {
    return semicolonParts
      .map((part) => parsePersonCreditSegment(part))
      .filter((entry): entry is ParsedCreditEntry => Boolean(entry));
  }

  const commaExpandedParts = normalized
    .replace(/\s*,?\s*(?:and|&)\s+/gi, ', ')
    .replace(/\s*,\s*,+/g, ', ')
    .split(/\s*,\s*/)
    .map((part) => normalizeSourceCreditText(part))
    .filter(Boolean);

  if (isLikelySurnameFirstCreditSequence(commaExpandedParts)) {
    const entries: ParsedCreditEntry[] = [];
    for (let index = 0; index < commaExpandedParts.length; index += 2) {
      const family = commaExpandedParts[index];
      const given = commaExpandedParts[index + 1];
      if (!family || !given) continue;
      const entry = parsePersonCreditSegment(`${given} ${family}`);
      if (entry) entries.push(entry);
    }
    if (entries.length > 0) return entries;
  }

  if (commaExpandedParts.length > 1) {
    return commaExpandedParts
      .map((part) => parsePersonCreditSegment(part))
      .filter((entry): entry is ParsedCreditEntry => Boolean(entry));
  }

  const conjunctionParts = normalized
    .split(/\s+(?:and|&)\s+/i)
    .map((part) => normalizeSourceCreditText(part))
    .filter(Boolean);
  if (conjunctionParts.length > 1) {
    return conjunctionParts
      .map((part) => parsePersonCreditSegment(part))
      .filter((entry): entry is ParsedCreditEntry => Boolean(entry));
  }

  const singleEntry = parsePersonCreditSegment(normalized);
  return singleEntry ? [singleEntry] : [];
}

function serializeSourceCreditEntries(entries: ParsedCreditEntry[]) {
  const normalizedEntries = entries
    .map((entry) => {
      if (entry.kind === 'organization') {
        const organizationName = normalizeSourceCreditText(entry.organizationName);
        return organizationName ? { kind: 'organization' as const, organizationName } : null;
      }
      const givenName = normalizeSourceCreditText(entry.givenName);
      const familyName = normalizeSourceCreditText(entry.familyName);
      if (!givenName && !familyName) return null;
      return {
        kind: 'person' as const,
        givenName,
        familyName,
      };
    })
    .filter((entry): entry is ParsedCreditEntry => Boolean(entry));

  if (normalizedEntries.length === 1 && normalizedEntries[0].kind === 'organization') {
    return normalizedEntries[0].organizationName;
  }

  return normalizedEntries
    .filter((entry): entry is Extract<ParsedCreditEntry, { kind: 'person' }> => entry.kind === 'person')
    .map((entry) => formatParsedCreditEntry(entry))
    .filter(Boolean)
    .join('; ');
}

function extractCreditPeople(value: string) {
  return parseSourceCreditEntries(value)
    .filter((entry): entry is Extract<ParsedCreditEntry, { kind: 'person' }> => entry.kind === 'person')
    .map((entry) => formatParsedCreditEntry(entry));
}

function normalizeSourceCreditValue(value: string) {
  const normalized = normalizeSourceCreditText(value);
  if (!normalized) return '';
  const uniqueEntries = parseSourceCreditEntries(normalized).filter((entry, index, collection) => {
    const label = formatParsedCreditEntry(entry);
    return label && collection.findIndex((candidate) => formatParsedCreditEntry(candidate) === label) === index;
  });
  return serializeSourceCreditEntries(uniqueEntries) || normalized;
}

function formatSourceCreditDisplay(value: string) {
  const entries = parseSourceCreditEntries(value);
  if (entries.length === 0) return normalizeSourceCreditText(value);
  if (entries.length === 1 && entries[0].kind === 'organization') {
    return entries[0].organizationName;
  }
  return joinWithOxfordComma(entries.map((entry) => formatParsedCreditEntry(entry)));
}

function getPrimaryCreditKeyPart(value: string) {
  const normalized = normalizeSourceCreditValue(value);
  if (!normalized) return 'source';
  if (looksLikeOrganizationCredit(normalized)) {
    return slugCiteKeyPart(normalized.split(/\s+/)[0] ?? normalized);
  }

  const firstPerson = normalized.split(/\s*;\s*/).find(Boolean) ?? normalized;
  const surname = firstPerson.split(/\s+/).filter(Boolean).at(-1) ?? firstPerson;
  return slugCiteKeyPart(surname);
}

function buildSourceCiteKey(
  source: Pick<SourceLibraryItem, 'title' | 'credit' | 'year'>,
  existingKeys: Set<string>,
) {
  const normalizedCredit = normalizeSourceCreditValue(source.credit);
  const normalizedTitle = source.title.trim();
  const authorPart = normalizedCredit ? getPrimaryCreditKeyPart(normalizedCredit) : 'source';
  const yearPart = source.year.match(/\b\d{4}\b/)?.[0] ?? 'nd';
  const titlePart = slugCiteKeyPart(
    normalizedTitle
      .split(/\s+/)
      .map((word) => word.replace(/[^A-Za-z0-9]/g, ''))
      .find((word) => word.length >= 3) ?? normalizedTitle
  );
  const baseKey = [authorPart, yearPart, titlePart].filter(Boolean).join('_') || `source_${yearPart}`;
  let candidate = baseKey;
  let suffix = 2;
  while (existingKeys.has(candidate)) {
    candidate = `${baseKey}_${suffix}`;
    suffix += 1;
  }
  existingKeys.add(candidate);
  return candidate;
}

function readSourceLibraryItems(value: unknown, fallback: SourceLibraryItem[] = []): SourceLibraryItem[] {
  if (!Array.isArray(value)) return fallback;
  const usedCiteKeys = new Set<string>();
  const items = value
    .filter((item): item is SourceLibraryItem => Boolean(item && typeof item === 'object'))
    .reduce<SourceLibraryItem[]>((collection, item) => {
      if (LEGACY_SOURCE_LIBRARY_IDS.has(item.id)) return collection;
      const citeKey = typeof item.citeKey === 'string' && item.citeKey.trim()
        ? item.citeKey.trim()
        : buildSourceCiteKey(item, usedCiteKeys);
      usedCiteKeys.add(citeKey);
      collection.push({
        ...item,
        citeKey,
        credit: normalizeSourceCreditValue(typeof item.credit === 'string' ? item.credit : ''),
        status: item.status === 'analyzed' ? 'analyzed' : 'tagged',
        attachmentName: typeof item.attachmentName === 'string' ? item.attachmentName : '',
        attachmentStoragePath: typeof item.attachmentStoragePath === 'string' ? item.attachmentStoragePath : '',
        attachmentMimeType: typeof item.attachmentMimeType === 'string' ? item.attachmentMimeType : '',
        attachmentUploadedAt: typeof item.attachmentUploadedAt === 'string' ? item.attachmentUploadedAt : '',
      });
      return collection;
    }, []);
  return items.length > 0 ? items : fallback;
}

function readSourceQueueItems(value: unknown, fallback: SourceItem[] = []): SourceItem[] {
  void value;
  return fallback.length > 0 ? fallback : [];
}

function parseStoredSourceLibrary(rawValue: string | null): SourceLibraryItem[] {
  if (!rawValue) return [];
  try {
    const parsed = JSON.parse(rawValue);
    return readSourceLibraryItems(parsed);
  } catch {
    return [];
  }
}

function readMilestoneItems(value: unknown, fallback = createDefaultThesisMilestones()): ThesisMilestone[] {
  if (!Array.isArray(value)) return fallback;

  const sanitizeList = (input: unknown, defaultItems: string[] = []) => {
    const sanitized = Array.isArray(input)
      ? input
        .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
        .filter(Boolean)
      : [...defaultItems];
    return sanitized.length > 0 ? sanitized : (defaultItems.length > 0 ? [...defaultItems] : ['']);
  };

  const sanitizeTasks = (input: unknown, defaultItems: ThesisMilestoneTask[] = []) => {
    if (!Array.isArray(input)) {
      return defaultItems.map(cloneMilestoneTask);
    }

    const normalized = input
      .map((entry) => {
        if (typeof entry === 'string') {
          const label = entry.trim();
          return label ? createMilestoneTask(label) : null;
        }
        if (entry && typeof entry === 'object') {
          const raw = entry as { id?: unknown; label?: unknown; completed?: unknown };
          const label = typeof raw.label === 'string' ? raw.label.trim() : '';
          if (!label) return null;
          return {
            id: typeof raw.id === 'string' && raw.id.trim() ? raw.id : createSourceId('milestone-task'),
            label,
            completed: Boolean(raw.completed),
          } satisfies ThesisMilestoneTask;
        }
        return null;
      })
      .filter((task): task is ThesisMilestoneTask => Boolean(task));

    return normalized.length > 0 ? normalized : defaultItems.map(cloneMilestoneTask);
  };

  const sanitizeMilestone = (
    parsed: Partial<ThesisMilestone> & { id: string },
    fallbackMilestone?: ThesisMilestone,
  ): ThesisMilestone => deriveMilestoneState({
    id: parsed.id,
    label: typeof parsed.label === 'string' && parsed.label.trim()
      ? parsed.label.trim()
      : fallbackMilestone?.label ?? 'New Milestone',
    status: parsed.status === 'complete' || parsed.status === 'in_progress' || parsed.status === 'planned'
      ? parsed.status
      : fallbackMilestone?.status ?? 'planned',
    progress: typeof parsed.progress === 'number'
      ? Math.min(100, Math.max(0, Math.round(parsed.progress)))
      : fallbackMilestone?.progress ?? 0,
    startDate: typeof parsed.startDate === 'string'
      ? parsed.startDate
      : fallbackMilestone?.startDate ?? '',
    due: typeof parsed.due === 'string'
      ? parsed.due
      : fallbackMilestone?.due ?? '',
    note: typeof parsed.note === 'string'
      ? parsed.note
      : fallbackMilestone?.note ?? '',
    subTasks: sanitizeTasks(parsed.subTasks, fallbackMilestone?.subTasks ?? []),
    involvedPeople: sanitizeList(parsed.involvedPeople, fallbackMilestone?.involvedPeople ?? []),
    requiredDocuments: sanitizeList(parsed.requiredDocuments, fallbackMilestone?.requiredDocuments ?? []),
    linkedFilePaths: Array.isArray(parsed.linkedFilePaths)
      ? parsed.linkedFilePaths
        .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
        .filter(Boolean)
      : [...(fallbackMilestone?.linkedFilePaths ?? [])],
  });

  const parsedById = new Map(
    value
      .filter((item): item is Partial<ThesisMilestone> & { id: string } => Boolean(item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string'))
      .map((item) => [item.id, item]),
  );

  const mergedDefaults = fallback.map((defaultMilestone) => {
    const parsed = parsedById.get(defaultMilestone.id);
    if (!parsed) {
      return deriveMilestoneState({
        ...defaultMilestone,
        subTasks: defaultMilestone.subTasks.map(cloneMilestoneTask),
        involvedPeople: [...defaultMilestone.involvedPeople],
        requiredDocuments: [...defaultMilestone.requiredDocuments],
        linkedFilePaths: [...defaultMilestone.linkedFilePaths],
      });
    }
    return sanitizeMilestone(parsed, defaultMilestone);
  });

  const customMilestones = value
    .filter((item): item is Partial<ThesisMilestone> & { id: string } => Boolean(item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string'))
    .filter((item) => !DEFAULT_THESIS_MILESTONE_IDS.has(item.id))
    .map((item) => sanitizeMilestone(item));

  return [...mergedDefaults, ...customMilestones];
}

function parseStoredMilestones(rawValue: string | null): ThesisMilestone[] {
  if (!rawValue) return createDefaultThesisMilestones();
  try {
    return readMilestoneItems(JSON.parse(rawValue));
  } catch {
    return createDefaultThesisMilestones();
  }
}

function readThesisMembers(value: unknown, fallback = createDefaultThesisMembers()): ThesisMember[] {
  if (!Array.isArray(value)) return fallback;
  const members = value
    .filter((entry): entry is ThesisMember => Boolean(entry && typeof entry === 'object'))
    .map((entry) => ({
      id: typeof entry.id === 'string' && entry.id.trim() ? entry.id : createSourceId('thesis-member'),
      name: typeof entry.name === 'string' ? entry.name : '',
      role: typeof entry.role === 'string' && entry.role.trim() ? entry.role : 'Author',
    }))
    .filter((entry) => entry.name.trim().length > 0 || entry.role.trim().length > 0);
  return members.length > 0 ? members : fallback;
}

function parseStoredThesisDetails(rawValue: string | null) {
  const fallback = DEFAULT_THESIS_DETAILS;
  if (!rawValue) return fallback;
  try {
    const parsed = JSON.parse(rawValue) as { description?: unknown; department?: unknown; graduatingQuarter?: unknown; citationFormat?: unknown; members?: unknown };
    return {
      description: typeof parsed.description === 'string' && parsed.description.trim()
        ? parsed.description
        : fallback.description,
      department: typeof parsed.department === 'string'
        ? parsed.department
        : fallback.department,
      graduatingQuarter: typeof parsed.graduatingQuarter === 'string'
        ? parsed.graduatingQuarter
        : fallback.graduatingQuarter,
      citationFormat: isBibliographyFormat(parsed.citationFormat)
        ? parsed.citationFormat
        : fallback.citationFormat,
      members: readThesisMembers(parsed.members, fallback.members),
    };
  } catch {
    return fallback;
  }
}

function readProfileThesisPageSnapshot(value: unknown): ThesisProfileSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const parsed = value as {
    linkedProjectIds?: unknown;
    thesisDetails?: unknown;
    milestones?: unknown;
  };
  const parsedDetails = parsed.thesisDetails && typeof parsed.thesisDetails === 'object'
    ? parsed.thesisDetails as {
      description?: unknown;
      department?: unknown;
      graduatingQuarter?: unknown;
      citationFormat?: unknown;
      members?: unknown;
    }
    : null;

  return {
    linkedProjectIds: Array.isArray(parsed.linkedProjectIds)
      ? parsed.linkedProjectIds
        .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
        .filter(Boolean)
      : [],
    thesisDetails: {
      description: typeof parsedDetails?.description === 'string' && parsedDetails.description.trim()
        ? parsedDetails.description
        : DEFAULT_THESIS_DETAILS.description,
      department: typeof parsedDetails?.department === 'string'
        ? parsedDetails.department
        : DEFAULT_THESIS_DETAILS.department,
      graduatingQuarter: typeof parsedDetails?.graduatingQuarter === 'string'
        ? parsedDetails.graduatingQuarter
        : DEFAULT_THESIS_DETAILS.graduatingQuarter,
      citationFormat: isBibliographyFormat(parsedDetails?.citationFormat)
        ? parsedDetails.citationFormat
        : DEFAULT_THESIS_DETAILS.citationFormat,
      members: readThesisMembers(parsedDetails?.members, DEFAULT_THESIS_DETAILS.members),
    },
    milestones: readMilestoneItems(parsed.milestones),
  };
}

function parseStoredSourceQueue(rawValue: string | null): SourceItem[] {
  if (!rawValue) return [];
  try {
    const parsed = JSON.parse(rawValue);
    return readSourceQueueItems(parsed);
  } catch {
    return [];
  }
}

function readSupportingDocumentItems(value: unknown, fallback: ThesisSupportingDocument[] = []): ThesisSupportingDocument[] {
  if (!Array.isArray(value)) return fallback;
  const items = value
    .filter((item): item is ThesisSupportingDocument => Boolean(item && typeof item === 'object'))
    .map((item) => ({
      ...item,
      extractedTextPreview: typeof item.extractedTextPreview === 'string' ? item.extractedTextPreview : '',
      linkedSourceId: typeof item.linkedSourceId === 'string' && item.linkedSourceId.trim() ? item.linkedSourceId : null,
      attachmentName: typeof item.attachmentName === 'string' ? item.attachmentName : '',
      attachmentStoragePath: typeof item.attachmentStoragePath === 'string' ? item.attachmentStoragePath : '',
      attachmentMimeType: typeof item.attachmentMimeType === 'string' ? item.attachmentMimeType : '',
      attachmentUploadedAt: typeof item.attachmentUploadedAt === 'string' ? item.attachmentUploadedAt : '',
    }))
    .filter((item) => typeof item.id === 'string' && typeof item.title === 'string');
  return items.length > 0 ? items : fallback;
}

function parseStoredSupportingDocuments(rawValue: string | null): ThesisSupportingDocument[] {
  if (!rawValue) return [];
  try {
    const parsed = JSON.parse(rawValue);
    return readSupportingDocumentItems(parsed);
  } catch {
    return [];
  }
}

function mapSourceKindToLibraryType(method: SourceIntakeMethod, kind: SourceIntakeKind): SourceLibraryType {
  if (kind === 'book') return 'book';
  if (kind === 'dataset') return 'dataset';
  if (kind === 'interview_notes') return 'notes';
  if (kind === 'thesis_dissertation') return method === 'url' ? 'link' : 'paper';
  if (kind === 'conference_paper') return method === 'url' ? 'link' : 'paper';
  if (kind === 'documentation' || kind === 'web_article') return 'link';
  if (kind === 'government_report' || kind === 'archive_record') return method === 'url' ? 'link' : 'report';
  if (kind === 'book_chapter') return 'book';
  if (method === 'url') return 'link';
  return 'paper';
}

function statusTone(status: ThesisMilestone['status']) {
  if (status === 'complete') return 'thesis-milestone-status thesis-milestone-status--complete';
  if (status === 'in_progress') return 'thesis-milestone-status thesis-milestone-status--in-progress';
  return 'thesis-milestone-status thesis-milestone-status--planned';
}

function formatShortDate(value: string | null | undefined) {
  if (!value) return 'No date';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'No date';
  return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatLongDate(value: string | null | undefined) {
  if (!value) return 'No date';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'No date';
  return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function getMilestoneNextPendingTask(milestone: ThesisMilestone) {
  return milestone.subTasks.find((task) => task.label.trim().length > 0 && !task.completed) ?? null;
}

function getMilestoneCompletedTaskCount(milestone: ThesisMilestone) {
  return milestone.subTasks.filter((task) => task.label.trim().length > 0 && task.completed).length;
}

function getMilestoneEligibleTaskCount(milestone: ThesisMilestone) {
  return milestone.subTasks.filter((task) => task.label.trim().length > 0).length;
}

function getThesisLinkedFileParentPath(path: string) {
  const segments = path.split('/');
  segments.pop();
  return segments.join('/');
}

function buildThesisLinkedFileTree(files: ThesisWorkspaceFile[]) {
  const root: ThesisLinkedFileTreeNode[] = [];
  const folderMap = new Map<string, ThesisLinkedFileTreeNode>();

  const ensureFolderNode = (folderPath: string) => {
    if (folderMap.has(folderPath)) return folderMap.get(folderPath)!;

    const segments = folderPath.split('/');
    const folderName = segments[segments.length - 1] ?? folderPath;
    const node: ThesisLinkedFileTreeNode = {
      kind: 'folder',
      id: `linked-folder:${folderPath}`,
      name: folderName,
      path: folderPath,
      children: [],
    };

    const parentPath = getThesisLinkedFileParentPath(folderPath);
    if (parentPath) {
      ensureFolderNode(parentPath).children.push(node);
    } else {
      root.push(node);
    }
    folderMap.set(folderPath, node);
    return node;
  };

  for (const file of files) {
    const filePath = file.path;
    const fileName = filePath.split('/').pop() ?? filePath;
    const parentPath = getThesisLinkedFileParentPath(filePath);
    const node: ThesisLinkedFileTreeNode = {
      kind: 'file',
      id: `linked-file:${file.id}`,
      fileId: file.id,
      name: fileName,
      path: filePath,
      children: [],
    };

    if (parentPath) {
      ensureFolderNode(parentPath).children.push(node);
    } else {
      root.push(node);
    }
  }

  const sortNodes = (nodes: ThesisLinkedFileTreeNode[]) => {
    nodes.sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === 'folder' ? -1 : 1;
      return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
    });
    for (const node of nodes) {
      if (node.children.length > 0) sortNodes(node.children);
    }
  };

  sortNodes(root);
  return root;
}

function getMilestoneProgressFillStyle(progress: number) {
  return {
    width: `${progress}%`,
    background: 'linear-gradient(90deg, color-mix(in srgb, var(--color-accent2) 26%, transparent), color-mix(in srgb, var(--color-accent2) 88%, black 4%))',
  } as const;
}

function formatRelativeDate(value: string | null | undefined) {
  if (!value) return 'No timestamp';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'No timestamp';

  const diffDays = Math.round((parsed.getTime() - Date.now()) / 86_400_000);
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'tomorrow';
  if (diffDays === -1) return 'yesterday';
  if (diffDays > 1) return `in ${diffDays} days`;
  return `${Math.abs(diffDays)} days ago`;
}

function normalizeGoalStatus(status: Goal['status']) {
  return status.replace(/_/g, ' ');
}

function getNumberedLatexExcerpt(source: string, lineStart: number, lineEnd: number) {
  const lines = source.split('\n');
  if (lines.length === 0) return '1 | ';
  const start = Math.max(1, Math.min(lineStart, lines.length));
  const end = Math.max(start, Math.min(lineEnd, lines.length));
  const width = String(lines.length).length;
  return lines
    .slice(start - 1, end)
    .map((line, index) => `${String(start + index).padStart(width, ' ')} | ${line}`)
    .join('\n');
}

function formatSourceLabel(value: string) {
  if (value === 'journal_article') return 'Published Paper (Journal)';
  if (value === 'conference_paper') return 'Published Paper (Conference)';
  if (value === 'government_report') return 'Government / Technical Report';
  if (value === 'thesis_dissertation') return 'Thesis / Dissertation';
  if (value === 'interview_notes') return 'Interview / Personal Communication';
  if (value === 'archive_record') return 'Archive / Collection Record';
  if (value === 'web_article') return 'Web Page / News / Blog';
  return value.replace(/_/g, ' ');
}

function getSourceKindBibtexTarget(kind: SourceIntakeKind | null) {
  switch (kind) {
    case 'journal_article':
      return '@article';
    case 'conference_paper':
      return '@inproceedings';
    case 'book':
      return '@book';
    case 'book_chapter':
      return '@incollection';
    case 'government_report':
      return '@techreport';
    case 'thesis_dissertation':
      return '@mastersthesis / @phdthesis';
    case 'documentation':
      return '@manual';
    case 'dataset':
    case 'archive_record':
    case 'web_article':
      return '@misc';
    case 'interview_notes':
      return '@misc / @unpublished';
    default:
      return '@misc';
  }
}

function truncateResourceText(value: string | null | undefined, limit: number) {
  const normalized = (value ?? '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function buildSearchableText(parts: Array<string | null | undefined | string[]>) {
  return parts
    .flatMap((part) => Array.isArray(part) ? part : [part])
    .map((part) => part ?? '')
    .join(' ')
    .toLowerCase();
}

function getDepartmentCitationRecommendation(department: string) {
  const normalized = department.trim().toLowerCase();
  if (!normalized) return null;
  return DEPARTMENT_CITATION_RECOMMENDATIONS.find(({ matchers }) => (
    matchers.some((matcher) => normalized.includes(matcher))
  )) ?? null;
}

function getCitationReferenceQueryForSourceKind(kind: SourceIntakeKind | null) {
  if (kind === 'conference_paper') return 'conference paper proceedings symposium workshop inproceedings';
  if (kind === 'book') return 'book monograph publisher edition';
  if (kind === 'government_report') return 'government report military directive doctrine memorandum technical report';
  if (kind === 'thesis_dissertation') return 'thesis dissertation calhoun proquest institutional archive';
  if (kind === 'documentation') return 'manual standard doctrine handbook technical documentation';
  if (kind === 'dataset') return 'data set database repository working paper retrievable record';
  if (kind === 'interview_notes') return 'personal communication interview email unpublished source not retrievable';
  if (kind === 'archive_record') return 'archive collection accession institutional repository finding aid';
  if (kind === 'book_chapter') return 'book chapter edited book page range quotation';
  if (kind === 'web_article') return 'website webpage online source url news blog';
  return 'journal article website government report thesis dissertation figures tables page numbers';
}

function getCitationReferencePdfUrl(fileName: string) {
  return `/citation-references/${encodeURIComponent(fileName)}`;
}

function formatCitationReferenceGuideLabel(fileName: string) {
  return fileName.replace(/\.pdf$/i, '');
}

function isBibliographyFormat(value: unknown): value is BibliographyFormat {
  return value === 'apa'
    || value === 'chicago'
    || value === 'ieee'
    || value === 'informs'
    || value === 'asme'
    || value === 'aiaa'
    || value === 'ams';
}

function isHttpUrl(value: string) {
  return /^https?:\/\//i.test(value.trim());
}

function normalizeCitationLocator(value: string) {
  return value.trim()
    .replace(/^available\s*:\s*/i, '')
    .replace(/[<>]+/g, '')
    .trim();
}

function withTerminalPeriod(value: string) {
  const normalized = value.trim();
  if (!normalized) return '';
  return /[.?!]$/.test(normalized) ? normalized : `${normalized}.`;
}

function looksLikeDoiLocator(value: string) {
  const normalized = value.trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '');
  return /^10\.\d{4,9}\/\S+$/i.test(normalized);
}

function looksLikeBibtexEntry(value: string) {
  return /^\s*@\w+\s*\{[\s\S]+\}\s*$/i.test(value.trim());
}

function normalizeBibliographyWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeDoiLocatorValue(value: string) {
  const normalized = value.trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '');
  return /^10\.\d{4,9}\/\S+$/i.test(normalized) ? `https://doi.org/${normalized}` : value.trim();
}

function normalizeBibliographyPersonText(value: string) {
  return value
    .replace(/\\&/g, '&')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[,;]+|[,;]+$/g, '')
    .trim();
}

function normalizeBibliographyDisplayName(value: string) {
  const normalized = normalizeBibliographyPersonText(value);
  const parts = normalized.split(/\s*,\s*/).filter(Boolean);
  if (parts.length === 2) return `${parts[1]} ${parts[0]}`.trim();
  return normalized;
}

function extractBibliographyPeople(value: string) {
  const normalized = normalizeBibliographyPersonText(value);
  if (!normalized) return [];

  const conjunctionParts = normalized
    .split(/\s+(?:and|&)\s+/i)
    .map((part) => normalizeBibliographyDisplayName(part))
    .filter(Boolean);
  if (conjunctionParts.length > 1) return conjunctionParts;

  const semicolonParts = normalized
    .split(/\s*;\s*|\s*\n+\s*/)
    .map((part) => normalizeBibliographyDisplayName(part))
    .filter(Boolean);
  if (semicolonParts.length > 1) return semicolonParts;

  const commaParts = normalized
    .split(/\s*,\s*/)
    .map((part) => normalizeBibliographyPersonText(part))
    .filter(Boolean);
  if (commaParts.length > 1 && commaParts.every((part) => part.split(/\s+/).filter(Boolean).length >= 2)) {
    return commaParts.map((part) => normalizeBibliographyDisplayName(part));
  }

  if (commaParts.length >= 4 && commaParts.length % 2 === 0) {
    const pairedNames: string[] = [];
    for (let index = 0; index < commaParts.length; index += 2) {
      const family = commaParts[index];
      const given = commaParts[index + 1];
      if (!family || !given) continue;
      pairedNames.push(`${given} ${family}`.trim());
    }
    if (pairedNames.length > 1) return pairedNames;
  }

  return [normalizeBibliographyDisplayName(normalized)];
}

function normalizeBibtexFieldDisplayValue(value: string) {
  return normalizeBibliographyWhitespace(
    value
      .replace(/^\{+|\}+$/g, '')
      .replace(/\\"/g, '"')
      .replace(/\\&/g, '&'),
  );
}

function extractBibtexFieldValue(entry: string, field: string) {
  const match = entry.match(new RegExp(`\\b${field}\\s*=\\s*(\\{(?:[^{}]|\\{[^{}]*\\})*\\}|\"[^\"]*\")`, 'i'));
  if (!match?.[1]) return '';
  return normalizeBibtexFieldDisplayValue(match[1]);
}

function buildJournalVenueFromBibtex(entry: string) {
  const journal = extractBibtexFieldValue(entry, 'journal');
  const volume = extractBibtexFieldValue(entry, 'volume');
  const number = extractBibtexFieldValue(entry, 'number');
  const pages = normalizeBibliographyPages(extractBibtexFieldValue(entry, 'pages'));
  if (!journal) return '';
  const parts = [journal];
  if (volume && number) {
    parts.push(`${volume} (${number})`);
  } else if (volume) {
    parts.push(volume);
  }
  if (pages) {
    parts.push(`pp. ${pages}`);
  }
  return parts.join(', ');
}

function buildVenueMetadataFromBibtex(
  sourceKind: SourceVenueKind,
  entry: string,
): ParsedSourceVenueMetadata {
  return {
    raw: '',
    normalized: '',
    journal: extractBibtexFieldValue(entry, 'journal'),
    booktitle: extractBibtexFieldValue(entry, 'booktitle'),
    publisher: extractBibtexFieldValue(entry, 'publisher'),
    organization: extractBibtexFieldValue(entry, 'organization'),
    institution: extractBibtexFieldValue(entry, 'institution'),
    school: extractBibtexFieldValue(entry, 'school'),
    howpublished: extractBibtexFieldValue(entry, 'howpublished'),
    volume: extractBibtexFieldValue(entry, 'volume'),
    number: extractBibtexFieldValue(entry, 'number'),
    pages: normalizeBibliographyPages(extractBibtexFieldValue(entry, 'pages')),
    edition: extractBibtexFieldValue(entry, 'edition'),
    series: extractBibtexFieldValue(entry, 'series'),
    reportNumber: extractBibtexFieldValue(entry, 'number'),
    articleNumber: '',
  };
}

function sanitizeBibtexCitationText(entry: string) {
  const authorValue = extractBibtexFieldValue(entry, 'author');
  const normalizedAuthors = extractBibliographyPeople(authorValue).join(' and ');
  let nextEntry = entry;
  if (normalizedAuthors) {
    nextEntry = nextEntry.replace(
      /\bauthor\s*=\s*(\{(?:[^{}]|\{[^{}]*\})*\}|"[^"]*")/i,
      `author = {${normalizedAuthors}}`,
    );
  }
  nextEntry = nextEntry.replace(
    /\n\s*note\s*=\s*\{[\s\S]*?(?:Chapter target:|Verification:|Use this source to support)[\s\S]*?\},?/gi,
    '',
  );
  return nextEntry
    .replace(/\n{3,}/g, '\n\n')
    .replace(/,\n(\s*\})/g, '\n$1')
    .trim();
}

function deriveBibliographyAutoFixPatch(
  source: Pick<SourceLibraryItem, 'sourceKind' | 'title' | 'credit' | 'venue' | 'year' | 'locator' | 'citation'>,
) {
  const patch: Partial<Pick<SourceLibraryItem, 'title' | 'credit' | 'venue' | 'year' | 'locator' | 'citation'>> = {};

  if (looksLikeDoiLocator(source.locator) && source.locator.trim() !== normalizeDoiLocatorValue(source.locator)) {
    patch.locator = normalizeDoiLocatorValue(source.locator);
  }

  if (!looksLikeBibtexEntry(source.citation)) {
    return patch;
  }

  const sanitizedCitation = sanitizeBibtexCitationText(source.citation);
  if (sanitizedCitation && sanitizedCitation !== source.citation.trim()) {
    patch.citation = sanitizedCitation;
  }

  const citationTitle = extractBibtexFieldValue(source.citation, 'title');
  if (citationTitle && citationTitle !== source.title.trim()) {
    patch.title = citationTitle.replace(/\.\s*$/, '');
  }

  const citationAuthors = extractBibliographyPeople(extractBibtexFieldValue(source.citation, 'author')).join(', ');
  if (citationAuthors && citationAuthors !== source.credit.trim()) {
    patch.credit = citationAuthors;
  }

  const citationYear = extractBibtexFieldValue(source.citation, 'year');
  if (citationYear && citationYear !== source.year.trim()) {
    patch.year = citationYear;
  }

  const citationLocator = extractBibtexFieldValue(source.citation, 'doi')
    || extractBibtexFieldValue(source.citation, 'url');
  if (citationLocator) {
    const normalizedLocator = normalizeDoiLocatorValue(citationLocator);
    if (normalizedLocator !== source.locator.trim()) {
      patch.locator = normalizedLocator;
    }
  }

  if (source.sourceKind === 'journal_article') {
    const citationVenue = buildJournalVenueFromBibtex(source.citation);
    if (citationVenue && citationVenue !== source.venue.trim()) {
      patch.venue = citationVenue;
    }
  } else {
    const citationVenue = buildSourceVenueDisplayFromMetadata(
      source.sourceKind as SourceVenueKind,
      buildVenueMetadataFromBibtex(source.sourceKind as SourceVenueKind, source.citation),
    );
    if (citationVenue && citationVenue !== source.venue.trim()) {
      patch.venue = citationVenue;
    }
  }

  return patch;
}

function getNpsBibliographyReadiness(
  source: Pick<SourceLibraryItem, 'sourceKind' | 'title' | 'credit' | 'venue' | 'year' | 'locator' | 'citation'>,
): BibliographyReadiness {
  const details: string[] = [];
  const exactChanges: BibliographyReadiness['exactChanges'] = [];
  const locator = source.locator.trim();
  const venue = source.venue.trim();
  const autoFixPatch = deriveBibliographyAutoFixPatch(source);

  if (!source.title.trim()) {
    details.push('Add the source title.');
    exactChanges.push({
      field: 'title',
      label: 'Title',
      suggestedValue: 'Enter the full source title exactly as published.',
      reason: 'The bibliography entry cannot be generated without a title.',
    });
  }
  if (!source.credit.trim()) {
    details.push('Add the author, editor, organization, or other credit line.');
    exactChanges.push({
      field: 'credit',
      label: 'Credit',
      suggestedValue: 'Enter the author list or responsible organization.',
      reason: 'NPS bibliography output needs an author or organization field.',
    });
  }
  if (!source.year.trim()) {
    details.push('Add the publication date or year.');
    exactChanges.push({
      field: 'year',
      label: 'Year',
      suggestedValue: 'Enter the publication year, for example `2012`.',
      reason: 'The bibliography entry needs a publication year.',
    });
  }

  switch (source.sourceKind) {
    case 'journal_article':
      if (!looksLikeCompleteArticleVenue(venue)) {
        details.push('This option targets `@article`. Enter the journal title plus volume, issue, and page range in a pattern like "IEEE Transactions on ..., 61 (6), pp. 1625-1635".');
        exactChanges.push({
          field: 'venue',
          label: 'Venue / publisher',
          suggestedValue: autoFixPatch.venue || `${venue || 'Journal title'}, <volume> (<issue>), pp. <start>-<end>`,
          reason: 'For `@article`, the context field should carry the journal title, volume, issue, and page range.',
        });
      }
      break;
    case 'conference_paper':
      if (!venue) {
        details.push('Conference papers target `@inproceedings`. Enter the proceedings or conference title in the context field.');
        exactChanges.push({
          field: 'venue',
          label: 'Venue / publisher',
          suggestedValue: 'Enter the proceedings or conference title.',
          reason: 'This value maps to the BibTeX `booktitle` field.',
        });
      } else if (!/\b(conference|proceedings|symposium|workshop|meeting)\b/i.test(venue)) {
        details.push('Conference papers target `@inproceedings`. Include the proceedings or conference title so the `booktitle` field can be generated cleanly.');
        exactChanges.push({
          field: 'venue',
          label: 'Venue / publisher',
          suggestedValue: autoFixPatch.venue || venue,
          reason: 'The context should name the conference or proceedings explicitly.',
        });
      }
      break;
    case 'book':
      if (!venue) {
        details.push('Books target `@book`. Enter the publisher in the context field.');
        exactChanges.push({
          field: 'venue',
          label: 'Venue / publisher',
          suggestedValue: 'Enter the publisher name.',
          reason: 'This value maps to the BibTeX `publisher` field.',
        });
      }
      break;
    case 'book_chapter':
      details.push('Book chapters target `@incollection`. You will usually still need manual `references.bib` cleanup for editor name(s), publisher, and page range because the intake form only captures one context field.');
      break;
    case 'government_report':
      details.push('Government and technical reports target `@techreport`. Include the report number and issuing institution in the context field, then verify them in `references.bib`.');
      break;
    case 'thesis_dissertation':
      details.push('Theses and dissertations target `@mastersthesis` or `@phdthesis`. Enter the school, department, archive, or database name in the context field and verify the final degree type in `references.bib`.');
      break;
    case 'dataset':
      details.push('Dataset and repository items target `@misc`. Include the repository name plus version, release label, or accession identifier in the context field and verify those manually in `references.bib`.');
      break;
    case 'interview_notes':
      details.push('Interviews and personal communications usually map to `@misc` or `@unpublished`. Verify whether the source should appear in `references.bib` at all or should remain an in-text personal communication only.');
      break;
    case 'archive_record':
      details.push('Archive and collection records target `@misc`. Include the collection name, accession identifier, and holding institution, then verify them manually in `references.bib`.');
      break;
    case 'documentation':
      details.push('Manuals, standards, and documentation target `@manual`. Include the standard number, manual identifier, or publishing organization in the context field and verify the final wording in `references.bib`.');
      break;
    case 'web_article':
      details.push('Web pages, news stories, and blogs target `@misc`. Include the website or publisher name in the context field.');
      break;
    default:
      break;
  }

  if (!locator) {
    details.push('Add a DOI, landing page URL, or other retrievable locator.');
    exactChanges.push({
      field: 'locator',
      label: 'Available at',
      suggestedValue: autoFixPatch.locator || 'https://doi.org/... or a stable source URL',
      reason: 'The bibliography entry should include a retrievable DOI or URL.',
    });
  } else if (!isHttpUrl(locator) && !looksLikeDoiLocator(locator) && source.sourceKind !== 'interview_notes') {
    details.push('Use a DOI or retrievable URL when possible so the NPS bibliography entry has a valid locator.');
    exactChanges.push({
      field: 'locator',
      label: 'Available at',
      suggestedValue: autoFixPatch.locator || locator,
      reason: 'This field should be a DOI URL or a stable retrievable link.',
    });
  }

  if (details.length === 0) {
    return {
      status: 'ready',
      summary: 'This source is structurally compatible with the current Odyssey to NPS bibliography workflow.',
      details: [
        'You can still refine the final wording in `references.bib`, but this source should not require extra structural fields for the common NPS workflow.',
      ],
      exactChanges: [],
      autoFixPatch,
    };
  }

  return {
    status: 'manual',
    summary: Object.keys(autoFixPatch).length > 0
      ? 'Odyssey can fix the common field issues it detected, and will list anything that still needs manual review.'
      : 'This source will save, but it still needs specific field cleanup before it fully matches the NPS guide.',
    details,
    exactChanges,
    autoFixPatch,
  };
}

function formatBibliographyEntry(source: SourceLibraryItem, format: BibliographyFormat) {
  const locator = normalizeCitationLocator(source.locator);
  const creditDisplay = formatSourceCreditDisplay(source.credit);
  const venueDisplay = buildSourceVenueDisplay(source.sourceKind as SourceVenueKind, source.venue);
  if (format === 'chicago') {
    return `${creditDisplay}. "${source.title}." ${venueDisplay} (${source.year}). ${withTerminalPeriod(locator)}`.trim();
  }
  if (format === 'ieee') {
    const citationPrefix = `${creditDisplay}, "${source.title}," ${venueDisplay}, ${source.year}.`.trim();
    if (!locator) return citationPrefix;
    return `${citationPrefix} ${isHttpUrl(locator) ? `Available: ${locator}` : withTerminalPeriod(locator)}`.trim();
  }
  if (format === 'informs') {
    return `${creditDisplay} (${source.year}), "${source.title}," ${venueDisplay}, ${withTerminalPeriod(locator)}`.trim();
  }
  if (format === 'asme' || format === 'aiaa' || format === 'ams') {
    return `${creditDisplay}, "${source.title}," ${venueDisplay}, ${source.year}. ${withTerminalPeriod(locator)}`.trim();
  }
  return `${creditDisplay} (${source.year}). ${source.title}. ${venueDisplay}. ${withTerminalPeriod(locator)}`.trim();
}

function CreditFieldEditor({
  value,
  label,
  onChange,
}: {
  value: string;
  label: string;
  onChange: (nextValue: string) => void;
}) {
  const [modeOverride, setModeOverride] = useState<'people' | 'organization' | null>(null);

  const parsedEntries = useMemo(() => parseSourceCreditEntries(value), [value]);
  const personEntries = useMemo(
    () => parsedEntries.filter((entry): entry is Extract<ParsedCreditEntry, { kind: 'person' }> => entry.kind === 'person'),
    [parsedEntries],
  );
  const autoDetectedMode = useMemo<'people' | 'organization' | null>(() => {
    if (parsedEntries.length === 1 && parsedEntries[0]?.kind === 'organization') return 'organization';
    if (personEntries.length > 1) return 'people';
    return null;
  }, [parsedEntries, personEntries]);
  const structuredMode = modeOverride ?? autoDetectedMode;
  const [personDraftEntries, setPersonDraftEntries] = useState<{ kind: 'person'; givenName: string; familyName: string }[]>([]);

  useEffect(() => {
    if (structuredMode !== 'people' || personEntries.length === 0) return;
    const nextSerialized = serializeSourceCreditEntries(personEntries);
    const currentSerialized = serializeSourceCreditEntries(personDraftEntries);
    if (currentSerialized !== nextSerialized) {
      setPersonDraftEntries(personEntries);
    }
  }, [structuredMode, personEntries, personDraftEntries]);

  const detectedPeopleCount = personDraftEntries.length;

  const updatePersonEntry = (index: number, field: 'givenName' | 'familyName', nextValue: string) => {
    const nextEntries = personDraftEntries.map((entry, entryIndex) => (
      entryIndex === index ? { ...entry, [field]: nextValue } : entry
    ));
    setPersonDraftEntries(nextEntries);
    onChange(serializeSourceCreditEntries(nextEntries));
  };

  const removePersonEntry = (index: number) => {
    const nextEntries = personDraftEntries.filter((_, entryIndex) => entryIndex !== index);
    setPersonDraftEntries(nextEntries);
    onChange(serializeSourceCreditEntries(nextEntries));
  };

  const addPersonEntry = () => {
    setModeOverride('people');
    setPersonDraftEntries((current) => {
      const nextEntries = [...current, { kind: 'person' as const, givenName: '', familyName: '' }];
      onChange(serializeSourceCreditEntries(nextEntries));
      return nextEntries;
    });
  };

  const switchToOrganization = () => {
    setModeOverride('organization');
    setPersonDraftEntries([]);
    onChange(value.trim() || '');
  };

  const switchToPeople = () => {
    setModeOverride('people');
    if (personEntries.length > 0) {
      setPersonDraftEntries(personEntries);
      onChange(serializeSourceCreditEntries(personEntries));
      return;
    }
    setPersonDraftEntries([]);
    onChange('');
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted font-mono">{label}</span>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {structuredMode === 'organization' ? (
            <button
              type="button"
              onClick={switchToPeople}
              className="inline-flex items-center gap-1 border border-border bg-surface px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted transition-colors hover:border-accent hover:text-accent"
            >
              <Users size={11} />
              Switch To People
            </button>
          ) : (
            <button
              type="button"
              onClick={switchToOrganization}
              className="inline-flex items-center gap-1 border border-border bg-surface px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted transition-colors hover:border-accent hover:text-accent"
            >
              <FileText size={11} />
              Use Organization
            </button>
          )}
          <button
            type="button"
            onClick={addPersonEntry}
            className="inline-flex items-center gap-1 border border-accent/30 bg-accent/10 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-accent transition-colors hover:bg-accent/15"
          >
            <Plus size={11} />
            Add Author
          </button>
        </div>
      </div>

      {structuredMode === 'organization' ? (
        <textarea
          rows={3}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Enter the responsible organization or issuing body."
          className="w-full resize-y border border-border bg-surface px-4 py-3 text-sm text-heading outline-none transition-colors placeholder:text-muted/70 focus:border-accent"
        />
      ) : structuredMode === 'people' ? (
        <div className="space-y-3">
          {detectedPeopleCount > 0 && (
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] text-muted">
                {detectedPeopleCount} contributor{detectedPeopleCount === 1 ? '' : 's'}. Edit any name before saving.
              </p>
              <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted">
                Saved as structured author list
              </p>
            </div>
          )}
          <div className="grid grid-cols-1 gap-2 xl:grid-cols-3">
            {personDraftEntries.map((entry, index) => (
              <div
                key={index}
                className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2rem] gap-1.5 border border-border bg-surface2/30 px-2 py-2 items-end"
              >
                <label className="space-y-1 min-w-0">
                  <span className="text-[9px] font-mono uppercase tracking-[0.14em] text-muted">First</span>
                  <input
                    type="text"
                    value={entry.givenName}
                    onChange={(event) => updatePersonEntry(index, 'givenName', event.target.value)}
                    placeholder="Grace"
                    className="h-8 w-full border border-border bg-surface px-2.5 text-sm text-heading outline-none transition-colors placeholder:text-muted/70 focus:border-accent"
                  />
                </label>
                <label className="space-y-1 min-w-0">
                  <span className="text-[9px] font-mono uppercase tracking-[0.14em] text-muted">Last</span>
                  <input
                    type="text"
                    value={entry.familyName}
                    onChange={(event) => updatePersonEntry(index, 'familyName', event.target.value)}
                    placeholder="Hopper"
                    className="h-8 w-full border border-border bg-surface px-2.5 text-sm text-heading outline-none transition-colors placeholder:text-muted/70 focus:border-accent"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => removePersonEntry(index)}
                  className="inline-flex h-8 w-8 items-center justify-center border border-border bg-surface text-muted transition-colors hover:border-danger/40 hover:text-danger"
                  aria-label={`Remove contributor ${index + 1}`}
                  title={`Remove contributor ${index + 1}`}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <textarea
          rows={3}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Paste or capture the full author line. Odyssey will split individual contributors below."
          className="w-full resize-y border border-border bg-surface px-4 py-3 text-sm text-heading outline-none transition-colors placeholder:text-muted/70 focus:border-accent"
        />
      )}
    </div>
  );
}

export default function ThesisPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const initializedLinkRef = useRef(false);
  const sourcesHydratedRef = useRef(false);
  const projectPickerRef = useRef<HTMLDivElement>(null);
  const thesisPdfInputRef = useRef<HTMLInputElement>(null);
  const thesisDocumentInputRef = useRef<HTMLInputElement>(null);
  const thesisDocumentEditorRef = useRef<HTMLDivElement>(null);
  const { projects, loading: projectsLoading } = useProjects();
  const { profile, loading: profileLoading, updateProfile } = useProfile();
  const { register, unregister } = useChatPanel();
  const thesisProfileHydratedRef = useRef(false);
  const thesisProfileSaveSignatureRef = useRef<string | null>(null);
  const [activeTab, setActiveTab] = useState<ThesisTabId>('overview');
  const [thesisDetails, setThesisDetails] = useState(() => (
    typeof window === 'undefined'
      ? DEFAULT_THESIS_DETAILS
      : parseStoredThesisDetails(window.localStorage.getItem(THESIS_DETAILS_STORAGE_KEY))
  ));
  const { description, department, graduatingQuarter, citationFormat, members } = thesisDetails;
  const [linkedProjectIds, setLinkedProjectIds] = useState<string[]>([]);
  const [linkedGoals, setLinkedGoals] = useState<Goal[]>([]);
  const [linkedEvents, setLinkedEvents] = useState<OdysseyEvent[]>([]);
  const [linkedContextLoading, setLinkedContextLoading] = useState(false);
  const [linkedContextError, setLinkedContextError] = useState<string | null>(null);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [departmentPickerOpen, setDepartmentPickerOpen] = useState(false);
  const [graduatingQuarterPickerOpen, setGraduatingQuarterPickerOpen] = useState(false);
  const [citationFormatPickerOpen, setCitationFormatPickerOpen] = useState(false);
  const [memberRolePickerOpenId, setMemberRolePickerOpenId] = useState<string | null>(null);
  const [memberRoleEditingId, setMemberRoleEditingId] = useState<string | null>(null);
  const [milestones, setMilestones] = useState<ThesisMilestone[]>(() => (
    typeof window === 'undefined'
      ? createDefaultThesisMilestones()
      : parseStoredMilestones(window.localStorage.getItem(THESIS_MILESTONES_STORAGE_KEY))
  ));
  const [selectedMilestoneId, setSelectedMilestoneId] = useState<string | null>(null);
  const [paperSnapshot, setPaperSnapshot] = useState<ThesisPaperSnapshot>(() => readStoredThesisPaperSnapshot());
  const [sourceIntakeMethod, setSourceIntakeMethod] = useState<SourceIntakeMethod>('url');
  const [sourceIntakeKind, setSourceIntakeKind] = useState<SourceIntakeKind | null>(null);
  const [sourceUrl, setSourceUrl] = useState('');
  const [sourceAccessUrl, setSourceAccessUrl] = useState('');
  const [uploadedPdfName, setUploadedPdfName] = useState('');
  const [uploadedPdfFile, setUploadedPdfFile] = useState<File | null>(null);
  const [parsedUrlSource, setParsedUrlSource] = useState<ParsedThesisSourceRecord | null>(null);
  const [pdfFieldCaptureOpen, setPdfFieldCaptureOpen] = useState(false);
  const [sourceIntakeOpen, setSourceIntakeOpen] = useState(false);
  const [urlAutofillStatus, setUrlAutofillStatus] = useState<'idle' | 'parsing' | 'ready' | 'error'>('idle');
  const [urlAutofillError, setUrlAutofillError] = useState<string | null>(null);
  const [manualSourceText, setManualSourceText] = useState('');
  const [sourceTitle, setSourceTitle] = useState('');
  const [sourceCredit, setSourceCredit] = useState('');
  const [sourceContextField, setSourceContextField] = useState('');
  const [sourceYear, setSourceYear] = useState('');
  const [verificationState, setVerificationState] = useState<'verified' | 'provisional' | 'restricted'>('verified');
  const [sourceRole, setSourceRole] = useState<'primary' | 'secondary' | 'contextual'>('secondary');
  const [chapterTarget, setChapterTarget] = useState<'literature_review' | 'methods' | 'findings' | 'appendix'>('literature_review');
  const [researchUseNote, setResearchUseNote] = useState('Use this source to support the literature review and identify reusable claims for later drafting.');
  const [sourceLibrary, setSourceLibrary] = useState<SourceLibraryItem[]>(() => (
    typeof window === 'undefined'
      ? []
      : parseStoredSourceLibrary(window.localStorage.getItem(THESIS_SOURCE_LIBRARY_STORAGE_KEY))
  ));
  const [sourceQueueItems, setSourceQueueItems] = useState<SourceItem[]>(() => (
    typeof window === 'undefined'
      ? []
      : parseStoredSourceQueue(window.localStorage.getItem(THESIS_SOURCE_QUEUE_STORAGE_KEY))
  ));
  const [supportingDocuments, setSupportingDocuments] = useState<ThesisSupportingDocument[]>(() => (
    typeof window === 'undefined'
      ? []
      : parseStoredSupportingDocuments(window.localStorage.getItem(THESIS_DOCUMENT_LIBRARY_STORAGE_KEY))
  ));
  const [queueRequestPending, setQueueRequestPending] = useState(false);
  const [libraryAttachmentOpening, setLibraryAttachmentOpening] = useState(false);
  const [queueNotice, setQueueNotice] = useState<string | null>(null);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [uploadedDocumentFile, setUploadedDocumentFile] = useState<File | null>(null);
  const [uploadedDocumentName, setUploadedDocumentName] = useState('');
  const [documentTitle, setDocumentTitle] = useState('');
  const [documentDescription, setDocumentDescription] = useState('');
  const [documentContribution, setDocumentContribution] = useState('');
  const [documentLinkedSourceId, setDocumentLinkedSourceId] = useState('');
  const [documentSavePending, setDocumentSavePending] = useState(false);
  const [documentNotice, setDocumentNotice] = useState<string | null>(null);
  const [documentError, setDocumentError] = useState<string | null>(null);
  const [documentAttachmentOpeningId, setDocumentAttachmentOpeningId] = useState<string | null>(null);
  const [citationReferenceViewer, setCitationReferenceViewer] = useState<{ title: string; url: string } | null>(null);
  const [selectedLibrarySourceId, setSelectedLibrarySourceId] = useState<string | null>(null);
  const [selectedLibrarySourceDraft, setSelectedLibrarySourceDraft] = useState<SourceLibraryItem | null>(null);
  const [selectedLibrarySourceUndoStack, setSelectedLibrarySourceUndoStack] = useState<SourceLibraryItem[]>([]);
  const [selectedLibrarySourceRedoStack, setSelectedLibrarySourceRedoStack] = useState<SourceLibraryItem[]>([]);
  const [pendingLibrarySourceDelete, setPendingLibrarySourceDelete] = useState<SourceLibraryItem | null>(null);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [editingDocumentId, setEditingDocumentId] = useState<string | null>(null);
  const [librarySort, setLibrarySort] = useState<'recent' | 'title' | 'year' | 'type' | 'status'>('recent');
  const [libraryEditMode, setLibraryEditMode] = useState(false);
  const [librarySearch, setLibrarySearch] = useState('');
  const [documentSearch, setDocumentSearch] = useState('');
  const [libraryTypeFilters, setLibraryTypeFilters] = useState<string[]>([]);
  const [libraryRoleFilters, setLibraryRoleFilters] = useState<string[]>([]);
  const [libraryChapterFilters, setLibraryChapterFilters] = useState<string[]>([]);
  const [libraryVerificationFilters, setLibraryVerificationFilters] = useState<string[]>([]);
  const [bibliographyFormat, setBibliographyFormat] = useState<BibliographyFormat>(() => thesisDetails.citationFormat);
  const [draggingMilestoneTask, setDraggingMilestoneTask] = useState<{ milestoneId: string; taskId: string } | null>(null);
  const [milestoneTaskDropTarget, setMilestoneTaskDropTarget] = useState<{
    milestoneId: string;
    taskId: string;
    position: 'before' | 'after';
  } | null>(null);
  const [linkedFileTreeOpenFolders, setLinkedFileTreeOpenFolders] = useState<Record<string, boolean>>({});

  const updateThesisRoute = (updates: Partial<Record<'tab' | 'source' | 'document', string | null>>) => {
    const params = new URLSearchParams(location.search);
    for (const [key, value] of Object.entries(updates)) {
      if (!value) {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    }
    const nextSearch = params.toString();
    navigate({ pathname: '/thesis', search: nextSearch ? `?${nextSearch}` : '' }, { replace: true });
  };

  const handleTabChange = (tabId: ThesisTabId) => {
    setActiveTab(tabId);
    updateThesisRoute({
      tab: tabId,
      source: tabId === 'sources' ? new URLSearchParams(location.search).get('source') : null,
      document: tabId === 'documents' ? new URLSearchParams(location.search).get('document') : null,
    });
    if (tabId === 'paper') {
      setStoredSidebarCollapsed(true);
    }
  };

  const routeProjectId = useMemo(() => {
    const queryProjectId = new URLSearchParams(location.search).get('projectId');
    if (queryProjectId) return queryProjectId;
    if (location.state && typeof location.state === 'object' && 'projectId' in location.state) {
      const value = (location.state as { projectId?: unknown }).projectId;
      if (typeof value === 'string' && value.trim().length > 0) return value;
    }
    return null;
  }, [location.search, location.state]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const requestedTab = params.get('tab');
    if (requestedTab === 'overview' || requestedTab === 'milestones' || requestedTab === 'sources' || requestedTab === 'documents' || requestedTab === 'graph' || requestedTab === 'paper' || requestedTab === 'settings') {
      setActiveTab(requestedTab);
    }
  }, [location.search]);

  const overallProgress = useMemo(() => {
    if (milestones.length === 0) return 0;
    return Math.round(milestones.reduce((sum, item) => sum + item.progress, 0) / milestones.length);
  }, [milestones]);
  const selectedMilestone = useMemo(
    () => milestones.find((milestone) => milestone.id === selectedMilestoneId) ?? null,
    [milestones, selectedMilestoneId],
  );
  const latexExplorerFiles = useMemo(
    () => [...(paperSnapshot.workspace?.files ?? [])].sort((left, right) => left.path.localeCompare(right.path)),
    [paperSnapshot.workspace?.files],
  );
  const latexExplorerFileTree = useMemo(
    () => buildThesisLinkedFileTree(latexExplorerFiles),
    [latexExplorerFiles],
  );
  const thesisProfileSnapshot = useMemo<ThesisProfileSnapshot>(() => ({
    linkedProjectIds,
    thesisDetails,
    milestones,
  }), [linkedProjectIds, thesisDetails, milestones]);

  const updateMilestone = <K extends keyof ThesisMilestone>(milestoneId: string, field: K, value: ThesisMilestone[K]) => {
    setMilestones((currentMilestones) => currentMilestones.map((milestone) => (
      milestone.id === milestoneId
        ? deriveMilestoneState({ ...milestone, [field]: value })
        : milestone
    )));
  };

  const updateMilestoneListItem = (
    milestoneId: string,
    field: 'involvedPeople' | 'requiredDocuments',
    index: number,
    value: string,
  ) => {
    setMilestones((currentMilestones) => currentMilestones.map((milestone) => {
      if (milestone.id !== milestoneId) return milestone;
      const nextItems = [...milestone[field]];
      nextItems[index] = value;
      return deriveMilestoneState({ ...milestone, [field]: nextItems });
    }));
  };

  const addMilestoneListItem = (
    milestoneId: string,
    field: 'involvedPeople' | 'requiredDocuments',
  ) => {
    setMilestones((currentMilestones) => currentMilestones.map((milestone) => (
      milestone.id === milestoneId
        ? deriveMilestoneState({ ...milestone, [field]: [...milestone[field], ''] })
        : milestone
    )));
  };

  const removeMilestoneListItem = (
    milestoneId: string,
    field: 'involvedPeople' | 'requiredDocuments',
    index: number,
  ) => {
    const milestone = milestones.find((item) => item.id === milestoneId);
    const removedValue = milestone?.[field][index];
    if (!milestone || typeof removedValue !== 'string') return;

    pushUndoAction({
      label: `Deleted ${field === 'involvedPeople' ? 'milestone person' : 'required document'} from ${milestone.label}`,
      undo: () => {
        setMilestones((currentMilestones) => currentMilestones.map((currentMilestone) => {
          if (currentMilestone.id !== milestoneId) return currentMilestone;
          const currentItems = [...currentMilestone[field]];
          const baseItems = currentItems.length === 1 && currentItems[0] === '' ? [] : currentItems;
          baseItems.splice(Math.min(index, baseItems.length), 0, removedValue);
          return deriveMilestoneState({ ...currentMilestone, [field]: baseItems });
        }));
      },
    });

    setMilestones((currentMilestones) => currentMilestones.map((milestone) => {
      if (milestone.id !== milestoneId) return milestone;
      const nextItems = milestone[field].filter((_, itemIndex) => itemIndex !== index);
      return deriveMilestoneState({ ...milestone, [field]: nextItems.length > 0 ? nextItems : [''] });
    }));
  };

  const updateMilestoneTaskLabel = (milestoneId: string, taskId: string, value: string) => {
    setMilestones((currentMilestones) => currentMilestones.map((milestone) => {
      if (milestone.id !== milestoneId) return milestone;
      return deriveMilestoneState({
        ...milestone,
        subTasks: milestone.subTasks.map((task) => (
          task.id === taskId
            ? { ...task, label: value }
            : task
        )),
      });
    }));
  };

  const addMilestoneTask = (milestoneId: string) => {
    setMilestones((currentMilestones) => currentMilestones.map((milestone) => (
      milestone.id === milestoneId
        ? deriveMilestoneState({ ...milestone, subTasks: [...milestone.subTasks, createMilestoneTask('New sub-task')] })
        : milestone
    )));
  };

  const removeMilestoneTask = (milestoneId: string, taskId: string) => {
    const milestone = milestones.find((item) => item.id === milestoneId);
    const removedTaskIndex = milestone?.subTasks.findIndex((task) => task.id === taskId) ?? -1;
    const removedTask = removedTaskIndex >= 0 ? milestone?.subTasks[removedTaskIndex] ?? null : null;
    if (!milestone || !removedTask) return;

    pushUndoAction({
      label: `Deleted sub-task from ${milestone.label}`,
      undo: () => {
        setMilestones((currentMilestones) => currentMilestones.map((currentMilestone) => {
          if (currentMilestone.id !== milestoneId) return currentMilestone;
          const nextTasks = [...currentMilestone.subTasks];
          nextTasks.splice(Math.min(removedTaskIndex, nextTasks.length), 0, removedTask);
          return deriveMilestoneState({ ...currentMilestone, subTasks: nextTasks });
        }));
      },
    });

    setMilestones((currentMilestones) => currentMilestones.map((milestone) => {
      if (milestone.id !== milestoneId) return milestone;
      return deriveMilestoneState({
        ...milestone,
        subTasks: milestone.subTasks.filter((task) => task.id !== taskId),
      });
    }));
  };

  const reorderMilestoneTask = (
    milestoneId: string,
    draggedTaskId: string,
    targetTaskId: string,
    position: 'before' | 'after',
  ) => {
    if (draggedTaskId === targetTaskId && position === 'before') return;
    setMilestones((currentMilestones) => currentMilestones.map((milestone) => {
      if (milestone.id !== milestoneId) return milestone;
      const sourceIndex = milestone.subTasks.findIndex((task) => task.id === draggedTaskId);
      const targetIndex = milestone.subTasks.findIndex((task) => task.id === targetTaskId);
      if (sourceIndex < 0 || targetIndex < 0) return milestone;

      const nextTasks = [...milestone.subTasks];
      const [draggedTask] = nextTasks.splice(sourceIndex, 1);
      if (!draggedTask) return milestone;

      let insertionIndex = targetIndex;
      if (sourceIndex < targetIndex) {
        insertionIndex -= 1;
      }
      if (position === 'after') {
        insertionIndex += 1;
      }
      insertionIndex = Math.max(0, Math.min(insertionIndex, nextTasks.length));
      nextTasks.splice(insertionIndex, 0, draggedTask);
      return deriveMilestoneState({ ...milestone, subTasks: nextTasks });
    }));
  };

  const clearMilestoneTaskDragState = () => {
    setDraggingMilestoneTask(null);
    setMilestoneTaskDropTarget(null);
  };

  useEffect(() => {
    if (!selectedMilestone) return;
    setLinkedFileTreeOpenFolders((current) => {
      const next = { ...current };
      let changed = false;
      for (const filePath of selectedMilestone.linkedFilePaths) {
        const segments = filePath.split('/');
        for (let index = 1; index < segments.length; index += 1) {
          const folderPath = segments.slice(0, index).join('/');
          if (next[folderPath] !== true) {
            next[folderPath] = true;
            changed = true;
          }
        }
      }
      return changed ? next : current;
    });
  }, [selectedMilestone]);

  const toggleLinkedFileTreeFolder = (folderPath: string) => {
    setLinkedFileTreeOpenFolders((current) => ({
      ...current,
      [folderPath]: !(current[folderPath] ?? false),
    }));
  };

  const renderLinkedFileTreeNodes = (nodes: ThesisLinkedFileTreeNode[], depth = 0) => nodes.map((node) => {
    if (!selectedMilestone) return null;
    if (node.kind === 'folder') {
      const isOpen = linkedFileTreeOpenFolders[node.path] ?? false;
      return (
        <div key={node.id}>
          <button
            type="button"
            onClick={() => toggleLinkedFileTreeFolder(node.path)}
            className="flex w-full items-center gap-2 border border-border bg-surface px-3 py-2 text-left transition-colors hover:bg-surface2"
            style={{ paddingLeft: `${depth * 1.1 + 0.75}rem` }}
            aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${node.path}`}
          >
            {isOpen ? <ChevronDown size={14} className="shrink-0 text-muted" /> : <ChevronRight size={14} className="shrink-0 text-muted" />}
            {isOpen ? <FolderOpen size={14} className="shrink-0 text-accent2" /> : <Folder size={14} className="shrink-0 text-accent2" />}
            <span className="truncate text-sm font-medium text-heading">{node.name}</span>
            <span className="ml-auto text-[10px] font-mono uppercase tracking-[0.14em] text-muted">
              {node.children.length}
            </span>
          </button>
          {isOpen && (
            <div className="mt-2 space-y-2">
              {renderLinkedFileTreeNodes(node.children, depth + 1)}
            </div>
          )}
        </div>
      );
    }

    const linked = selectedMilestone.linkedFilePaths.includes(node.path);
    return (
      <label
        key={node.id}
        className={`flex cursor-pointer items-start gap-3 border px-3 py-3 transition-colors ${linked ? 'border-accent2/40 bg-accent2/8' : 'border-border bg-surface hover:bg-surface2'}`}
        style={{ marginLeft: `${depth * 1.1}rem` }}
      >
        <input
          type="checkbox"
          checked={linked}
          onChange={() => toggleMilestoneLinkedFile(selectedMilestone.id, node.path)}
          className="mt-0.5 h-4 w-4 rounded border-border accent-[var(--color-accent2)]"
        />
        <FileText size={14} className="mt-0.5 shrink-0 text-accent2" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-heading">{node.name}</span>
          <span className="mt-1 block break-all text-xs text-muted">{node.path}</span>
        </span>
      </label>
    );
  });

  const toggleMilestoneTaskCompletion = (milestoneId: string, taskId: string) => {
    setMilestones((currentMilestones) => currentMilestones.map((milestone) => {
      if (milestone.id !== milestoneId) return milestone;
      return deriveMilestoneState({
        ...milestone,
        subTasks: milestone.subTasks.map((task) => (
          task.id === taskId
            ? { ...task, completed: !task.completed }
            : task
        )),
      });
    }));
  };

  const toggleMilestoneCompletionWithoutTasks = (milestoneId: string) => {
    setMilestones((currentMilestones) => currentMilestones.map((milestone) => {
      if (milestone.id !== milestoneId) return milestone;
      return deriveMilestoneState({
        ...milestone,
        status: milestone.status === 'complete' ? 'planned' : 'complete',
      });
    }));
  };

  const toggleMilestoneLinkedFile = (milestoneId: string, filePath: string) => {
    setMilestones((currentMilestones) => currentMilestones.map((milestone) => {
      if (milestone.id !== milestoneId) return milestone;
      const linkedFilePaths = milestone.linkedFilePaths.includes(filePath)
        ? milestone.linkedFilePaths.filter((path) => path !== filePath)
        : [...milestone.linkedFilePaths, filePath];
      return deriveMilestoneState({ ...milestone, linkedFilePaths });
    }));
  };

  const setThesisDescription = (value: string) => {
    setThesisDetails((current) => ({ ...current, description: value }));
  };

  const setThesisDepartment = (value: string) => {
    const recommendation = getDepartmentCitationRecommendation(value);
    setThesisDetails((current) => ({
      ...current,
      department: value,
      citationFormat: recommendation?.format ?? current.citationFormat,
    }));
    if (recommendation) {
      setBibliographyFormat(recommendation.format);
    }
  };

  const setThesisGraduatingQuarter = (value: string) => {
    setThesisDetails((current) => ({ ...current, graduatingQuarter: value }));
  };

  const setThesisCitationFormat = (value: BibliographyFormat) => {
    setThesisDetails((current) => ({ ...current, citationFormat: value }));
    setBibliographyFormat(value);
  };

  const addThesisMember = () => {
    setThesisDetails((current) => ({
      ...current,
      members: [...current.members, createThesisMember('', 'Author')],
    }));
  };

  const updateThesisMember = (memberId: string, field: 'name' | 'role', value: string) => {
    setThesisDetails((current) => ({
      ...current,
      members: current.members.map((member) => (
        member.id === memberId
          ? { ...member, [field]: value }
          : member
      )),
    }));
  };

  const removeThesisMember = (memberId: string) => {
    const memberIndex = thesisDetails.members.findIndex((member) => member.id === memberId);
    const removedMember = memberIndex >= 0 ? thesisDetails.members[memberIndex] ?? null : null;
    if (!removedMember) return;

    pushUndoAction({
      label: `Deleted thesis member ${removedMember.name.trim() || removedMember.role.trim() || 'member'}`,
      undo: () => {
        setThesisDetails((current) => {
          const currentMembers = current.members.length === 1
            && current.members[0]
            && !current.members[0].name.trim()
            && current.members[0].role.trim() === 'Author'
            ? []
            : [...current.members];
          currentMembers.splice(Math.min(memberIndex, currentMembers.length), 0, removedMember);
          return {
            ...current,
            members: currentMembers,
          };
        });
      },
    });

    setThesisDetails((current) => {
      const nextMembers = current.members.filter((member) => member.id !== memberId);
      return {
        ...current,
        members: nextMembers.length > 0 ? nextMembers : [createThesisMember('', 'Author')],
      };
    });
  };

  const linkedProjects = useMemo(
    () => linkedProjectIds
      .map((projectId) => projects.find((project) => project.id === projectId) ?? null)
      .filter((project): project is NonNullable<typeof project> => Boolean(project)),
    [linkedProjectIds, projects],
  );
  const primaryLinkedProject = linkedProjects[0] ?? null;
  const linkedProjectNameById = useMemo(
    () => Object.fromEntries(linkedProjects.map((project) => [project.id, project.name])),
    [linkedProjects],
  );
  const activeTabLabel = useMemo(
    () => tabs.find((tab) => tab.id === activeTab)?.label ?? 'Overview',
    [activeTab],
  );
  const selectedSourceMethod = useMemo(
    () => sourceIntakeMethods.find((method) => method.id === sourceIntakeMethod) ?? sourceIntakeMethods[0],
    [sourceIntakeMethod],
  );
  const selectedSourceKind = useMemo(
    () => sourceIntakeKinds.find((kind) => kind.id === sourceIntakeKind) ?? null,
    [sourceIntakeKind],
  );
  const sourceKindCreditLabel = useMemo(() => {
    if (sourceIntakeKind === 'conference_paper') return 'Author or presenter';
    if (sourceIntakeKind === 'book') return 'Author or editor';
    if (sourceIntakeKind === 'dataset') return 'Owning lab or repository';
    if (sourceIntakeKind === 'interview_notes') return 'Interviewee, advisor, or correspondent';
    if (sourceIntakeKind === 'archive_record') return 'Author, archive, or collection owner';
    if (sourceIntakeKind === 'government_report') return 'Issuing organization or author';
    if (sourceIntakeKind === 'thesis_dissertation') return 'Author';
    if (sourceIntakeKind === 'documentation') return 'Publisher, standards body, or authoring team';
    return 'Author, editor, or lead researcher';
  }, [sourceIntakeKind]);
  const sourceKindContextLabel = useMemo(() => {
    if (sourceIntakeKind === 'conference_paper') return 'Conference or proceedings title';
    if (sourceIntakeKind === 'book') return 'Publisher';
    if (sourceIntakeKind === 'dataset') return 'Dataset version, DOI, or release window';
    if (sourceIntakeKind === 'interview_notes') return 'Interview date, medium, or session note';
    if (sourceIntakeKind === 'archive_record') return 'Collection, accession ID, or holding institution';
    if (sourceIntakeKind === 'government_report') return 'Report number, institution, or series';
    if (sourceIntakeKind === 'thesis_dissertation') return 'School, department, archive, or database';
    if (sourceIntakeKind === 'documentation') return 'Manual number, standard, or documentation site';
    return 'Journal, publisher, conference, or source venue';
  }, [sourceIntakeKind]);
  const sourceKindVerificationLabel = useMemo(() => {
    if (sourceIntakeKind === 'conference_paper') return 'Proceedings and publication status';
    if (sourceIntakeKind === 'book') return 'Edition and publication status';
    if (sourceIntakeKind === 'dataset') return 'Reuse and provenance status';
    if (sourceIntakeKind === 'interview_notes') return 'Consent and attribution status';
    if (sourceIntakeKind === 'archive_record') return 'Archive verification status';
    if (sourceIntakeKind === 'government_report') return 'Document provenance status';
    if (sourceIntakeKind === 'thesis_dissertation') return 'Degree and archive status';
    if (sourceIntakeKind === 'documentation') return 'Version and source status';
    return 'Review and citation status';
  }, [sourceIntakeKind]);
  const activeParsedSource = sourceIntakeMethod === 'url' ? parsedUrlSource : null;
  const sourceLocatorValue = useMemo(() => {
    if (sourceIntakeMethod === 'url') return sourceUrl.trim();
    if (sourceIntakeMethod === 'pdf') return sourceAccessUrl.trim() || uploadedPdfName.trim();
    return manualSourceText.trim();
  }, [manualSourceText, sourceAccessUrl, sourceIntakeMethod, sourceUrl, uploadedPdfName]);
  const sourceHasMetadata = sourceTitle.trim().length > 0;
  const sourceReadyForQueue = Boolean(sourceIntakeKind) && sourceLocatorValue.length > 0 && sourceHasMetadata;
  const publicationDatePlaceholder = useMemo(
    () => getPublicationDatePlaceholder(bibliographyFormat),
    [bibliographyFormat],
  );
  const intakeCitationPreview = useMemo(() => {
    const title = sourceTitle.trim();
    const credit = sourceCredit.trim();
    const venue = sourceContextField.trim();
    const year = sourceYear.trim();
    const locator = sourceIntakeMethod === 'url'
      ? sourceUrl.trim()
      : sourceIntakeMethod === 'pdf'
        ? sourceAccessUrl.trim() || uploadedPdfName.trim()
        : manualSourceText.trim();
    if (!title && !credit && !venue && !year) return '';

    return formatBibliographyEntry({
      id: 'intake-preview',
      citeKey: 'intake_preview',
      title,
      type: sourceIntakeMethod === 'pdf' ? 'pdf' : sourceIntakeMethod === 'url' ? 'link' : 'notes',
      acquisitionMethod: sourceIntakeMethod,
      sourceKind: sourceIntakeKind ?? 'journal_article',
      status: 'tagged',
      role: 'primary',
      verification: 'provisional',
      chapterTarget: 'literature_review',
      credit,
      venue,
      year,
      locator,
      citation: '',
      abstract: '',
      notes: '',
      tags: [],
      addedOn: '',
      attachmentName: uploadedPdfName.trim(),
      attachmentStoragePath: '',
      attachmentMimeType: '',
      attachmentUploadedAt: '',
    }, bibliographyFormat).trim();
  }, [
    bibliographyFormat,
    manualSourceText,
    sourceContextField,
    sourceCredit,
    sourceAccessUrl,
    sourceIntakeKind,
    sourceIntakeMethod,
    sourceTitle,
    sourceUrl,
    sourceYear,
    uploadedPdfName,
  ]);
  const intakeBibliographyReadiness = useMemo(() => getNpsBibliographyReadiness({
    sourceKind: sourceIntakeKind ?? 'journal_article',
    title: sourceTitle,
    credit: sourceCredit,
    venue: sourceContextField,
    year: sourceYear,
    locator: sourceLocatorValue,
    citation: '',
  }), [
    sourceContextField,
    sourceCredit,
    sourceIntakeKind,
    sourceLocatorValue,
    sourceTitle,
    sourceYear,
  ]);
  const sourceNextRequirement = useMemo(() => {
    if (!sourceIntakeKind) return 'Select the source type so the correct bibliography questions can appear.';
    if (!sourceLocatorValue) {
      if (sourceIntakeMethod === 'url') return 'Paste the source URL or DOI landing page.';
      if (sourceIntakeMethod === 'pdf') return 'Upload the PDF you want extracted and indexed.';
      return 'Paste the notes or source summary so the record has ingestible content.';
    }
    if (!sourceTitle.trim()) return 'Add a working bibliography title for this source.';
    if (!sourceCredit.trim()) return `Provide the ${sourceKindCreditLabel.toLowerCase()}.`;
    if (!sourceContextField.trim()) return `Provide the ${sourceKindContextLabel.toLowerCase()}.`;
    if (!sourceYear.trim()) return 'Add the publication date.';
    return 'Ready to confirm and save this citation to the library.';
  }, [
    sourceContextField,
    sourceCredit,
    sourceIntakeKind,
    sourceIntakeMethod,
    sourceKindContextLabel,
    sourceKindCreditLabel,
    sourceLocatorValue,
    sourceTitle,
    sourceYear,
  ]);
  const sourceFlowSteps = useMemo(() => ([
    {
      label: 'Acquisition',
      detail: selectedSourceMethod.label,
      complete: true,
    },
    {
      label: 'Source type',
      detail: selectedSourceKind?.label ?? 'Choose a source type',
      complete: Boolean(sourceIntakeKind),
    },
    {
      label: 'Source record',
      detail: sourceLocatorValue || 'Add the source URL, PDF, or notes',
      complete: sourceLocatorValue.length > 0,
    },
    {
      label: 'Bibliography fields',
      detail: sourceHasMetadata ? 'Core citation fields captured' : 'Fill the required citation metadata',
      complete: sourceHasMetadata,
    },
  ]), [
    selectedSourceKind,
    selectedSourceMethod.label,
    sourceHasMetadata,
    sourceIntakeKind,
    sourceLocatorValue,
  ]);
  const sourceCompletedStepCount = useMemo(
    () => sourceFlowSteps.filter((step) => step.complete).length,
    [sourceFlowSteps],
  );
  const sourceProgressPercent = useMemo(
    () => Math.round((sourceCompletedStepCount / sourceFlowSteps.length) * 100),
    [sourceCompletedStepCount, sourceFlowSteps.length],
  );
  useEffect(() => {
    setSourceYear((current) => (current.trim() ? normalizePublicationDate(current, bibliographyFormat) : current));
  }, [bibliographyFormat]);
  const activeCitationReferenceGuide = useMemo(
    () => getCitationReferenceGuide(citationFormat),
    [citationFormat],
  );
  const citationReferenceContextQuery = useMemo(() => {
    return getCitationReferenceQueryForSourceKind(sourceIntakeKind);
  }, [sourceIntakeKind]);
  const citationReferenceMatches = useMemo(
    () => searchCitationReferenceChunks(citationFormat, citationReferenceContextQuery, 6),
    [citationFormat, citationReferenceContextQuery],
  );
  const citationReferencePdfLinks = useMemo(
    () => activeCitationReferenceGuide.guides.map((guide) => ({
      id: guide.id,
      fileName: guide.fileName,
      url: getCitationReferencePdfUrl(guide.fileName),
    })),
    [activeCitationReferenceGuide.guides],
  );
  const citationReferenceUiExample = useMemo(
    () => CITATION_REFERENCE_UI_EXAMPLES[citationFormat],
    [citationFormat],
  );
  const selectedLibrarySource = useMemo(
    () => sourceLibrary.find((source) => source.id === selectedLibrarySourceId) ?? null,
    [selectedLibrarySourceId, sourceLibrary],
  );
  const editableLibrarySource = selectedLibrarySourceDraft ?? selectedLibrarySource;
  const selectedLibrarySourceDirty = useMemo(
    () => Boolean(
      selectedLibrarySource
      && selectedLibrarySourceDraft
      && JSON.stringify(selectedLibrarySourceDraft) !== JSON.stringify(selectedLibrarySource),
    ),
    [selectedLibrarySource, selectedLibrarySourceDraft],
  );
  const selectedLibrarySourceReadiness = useMemo(
    () => (editableLibrarySource ? getNpsBibliographyReadiness(editableLibrarySource) : null),
    [editableLibrarySource],
  );
  const libraryFilterSections = useMemo(() => ([
    {
      key: 'type',
      label: 'Type',
      options: Array.from(new Set(sourceLibrary.map((source) => source.type)))
        .sort()
        .map((value) => ({ value, label: value })),
      selected: libraryTypeFilters,
    },
    {
      key: 'role',
      label: 'Role',
      options: Array.from(new Set(sourceLibrary.map((source) => source.role)))
        .sort()
        .map((value) => ({ value, label: formatSourceLabel(value) })),
      selected: libraryRoleFilters,
    },
    {
      key: 'chapter',
      label: 'Chapter',
      options: Array.from(new Set(sourceLibrary.map((source) => source.chapterTarget)))
        .sort()
        .map((value) => ({ value, label: formatSourceLabel(value) })),
      selected: libraryChapterFilters,
    },
    {
      key: 'verification',
      label: 'Verification',
      options: Array.from(new Set(sourceLibrary.map((source) => source.verification)))
        .sort()
        .map((value) => ({ value, label: formatSourceLabel(value) })),
      selected: libraryVerificationFilters,
    },
  ]), [libraryChapterFilters, libraryRoleFilters, libraryTypeFilters, libraryVerificationFilters, sourceLibrary]);
  const visibleLibrarySources = useMemo(() => {
    const normalizedSearch = librarySearch.trim().toLowerCase();
    const filtered = sourceLibrary.filter((source) => {
      if (libraryTypeFilters.length > 0 && !libraryTypeFilters.includes(source.type)) return false;
      if (libraryRoleFilters.length > 0 && !libraryRoleFilters.includes(source.role)) return false;
      if (libraryChapterFilters.length > 0 && !libraryChapterFilters.includes(source.chapterTarget)) return false;
      if (libraryVerificationFilters.length > 0 && !libraryVerificationFilters.includes(source.verification)) return false;
      if (normalizedSearch) {
        const haystack = buildSearchableText([
          source.title,
          source.credit,
          source.venue,
          source.year,
          source.locator,
          source.citation,
          source.abstract,
          source.notes,
          source.type,
          source.role,
          source.verification,
          source.chapterTarget,
          source.tags,
        ]);
        if (!haystack.includes(normalizedSearch)) return false;
      }
      return true;
    });

    return [...filtered].sort((left, right) => {
      if (librarySort === 'title') return left.title.localeCompare(right.title);
      if (librarySort === 'year') return right.year.localeCompare(left.year);
      if (librarySort === 'type') return left.type.localeCompare(right.type) || left.title.localeCompare(right.title);
      if (librarySort === 'status') return left.status.localeCompare(right.status) || left.title.localeCompare(right.title);
      return right.addedOn.localeCompare(left.addedOn);
    });
  }, [libraryChapterFilters, libraryRoleFilters, librarySearch, librarySort, libraryTypeFilters, libraryVerificationFilters, sourceLibrary]);
  const visibleSupportingDocuments = useMemo(() => {
    const normalizedSearch = documentSearch.trim().toLowerCase();
    const filtered = supportingDocuments.filter((document) => {
      if (!normalizedSearch) return true;
      const linkedSourceTitle = document.linkedSourceId
        ? sourceLibrary.find((source) => source.id === document.linkedSourceId)?.title ?? ''
        : '';
      const haystack = buildSearchableText([
        document.title,
        document.description,
        document.contribution,
        document.attachmentName,
        document.extractedTextPreview,
        linkedSourceTitle,
      ]);
      return haystack.includes(normalizedSearch);
    });

    return [...filtered].sort((left, right) => right.addedOn.localeCompare(left.addedOn) || left.title.localeCompare(right.title));
  }, [documentSearch, sourceLibrary, supportingDocuments]);
  const editingDocument = useMemo(
    () => (editingDocumentId ? supportingDocuments.find((document) => document.id === editingDocumentId) ?? null : null),
    [editingDocumentId, supportingDocuments],
  );
  const documentReadyToSave = Boolean(
    (editingDocumentId || uploadedDocumentFile)
    && documentTitle.trim()
    && documentDescription.trim()
    && documentContribution.trim(),
  );
  const departmentCitationRecommendation = useMemo(
    () => getDepartmentCitationRecommendation(department),
    [department],
  );

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (projectPickerRef.current && !projectPickerRef.current.contains(event.target as Node)) {
        setProjectPickerOpen(false);
      }
      const target = event.target as HTMLElement | null;
      if (!target?.closest('[data-thesis-selector="true"]')) {
        setDepartmentPickerOpen(false);
        setGraduatingQuarterPickerOpen(false);
        setCitationFormatPickerOpen(false);
        setMemberRolePickerOpenId(null);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, []);

  useEffect(() => {
    const syncPaperSnapshot = () => {
      setPaperSnapshot(readStoredThesisPaperSnapshot());
    };

    const handlePaperState = (event: Event) => {
      const detail = (event as CustomEvent<ThesisPaperSnapshot>).detail;
      if (detail) {
        setPaperSnapshot(detail);
        return;
      }
      syncPaperSnapshot();
    };

    const handleStorage = (event: StorageEvent) => {
      if (!event.key || event.key.startsWith('odyssey-thesis-paper')) {
        syncPaperSnapshot();
        return;
      }
      if (event.key === THESIS_MILESTONES_STORAGE_KEY) {
        setMilestones(parseStoredMilestones(event.newValue));
        return;
      }
      if (event.key === THESIS_DETAILS_STORAGE_KEY) {
        const parsedDetails = parseStoredThesisDetails(event.newValue);
        setThesisDetails(parsedDetails);
        setBibliographyFormat(parsedDetails.citationFormat);
      }
    };

    window.addEventListener(THESIS_PAPER_STATE_EVENT, handlePaperState as EventListener);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener(THESIS_PAPER_STATE_EVENT, handlePaperState as EventListener);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  useEffect(() => {
    window.localStorage.setItem(THESIS_SOURCE_LIBRARY_STORAGE_KEY, JSON.stringify(sourceLibrary));
  }, [sourceLibrary]);

  useEffect(() => {
    window.localStorage.setItem(THESIS_MILESTONES_STORAGE_KEY, JSON.stringify(milestones));
  }, [milestones]);

  useEffect(() => {
    window.localStorage.setItem(THESIS_DETAILS_STORAGE_KEY, JSON.stringify(thesisDetails));
  }, [thesisDetails]);

  useEffect(() => {
    if (profileLoading || thesisProfileHydratedRef.current) return;

    thesisProfileHydratedRef.current = true;
    const snapshot = readProfileThesisPageSnapshot(profile?.thesis_page_snapshot);
    if (!snapshot) return;

    thesisProfileSaveSignatureRef.current = JSON.stringify(snapshot);
    setThesisDetails(snapshot.thesisDetails);
    setBibliographyFormat(snapshot.thesisDetails.citationFormat);
    setMilestones(snapshot.milestones);
    setLinkedProjectIds(snapshot.linkedProjectIds);

    window.localStorage.setItem(THESIS_DETAILS_STORAGE_KEY, JSON.stringify(snapshot.thesisDetails));
    window.localStorage.setItem(THESIS_MILESTONES_STORAGE_KEY, JSON.stringify(snapshot.milestones));
    if (snapshot.linkedProjectIds.length > 0) {
      window.localStorage.setItem(THESIS_LINK_STORAGE_KEY, JSON.stringify(snapshot.linkedProjectIds));
    } else {
      window.localStorage.removeItem(THESIS_LINK_STORAGE_KEY);
    }
  }, [profile?.thesis_page_snapshot, profileLoading]);

  useEffect(() => {
    window.localStorage.setItem(THESIS_SOURCE_QUEUE_STORAGE_KEY, JSON.stringify(sourceQueueItems));
  }, [sourceQueueItems]);

  useEffect(() => {
    window.localStorage.setItem(THESIS_DOCUMENT_LIBRARY_STORAGE_KEY, JSON.stringify(supportingDocuments));
  }, [supportingDocuments]);

  useEffect(() => {
    if (!citationReferenceViewer) return undefined;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setCitationReferenceViewer(null);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [citationReferenceViewer]);

  useEffect(() => {
    if (!sourcesHydratedRef.current) return;

    const timeoutId = window.setTimeout(() => {
      void saveThesisSources({
        sourceLibrary,
        sourceQueueItems,
        thesisDocuments: supportingDocuments,
      }).catch(() => {
        // Keep the local snapshot even if remote source persistence is temporarily unavailable.
      });
    }, 350);

    return () => window.clearTimeout(timeoutId);
  }, [sourceLibrary, sourceQueueItems, supportingDocuments]);

  useEffect(() => {
    if (profileLoading || !profile || !thesisProfileHydratedRef.current) return;

    const nextSignature = JSON.stringify(thesisProfileSnapshot);
    if (nextSignature === thesisProfileSaveSignatureRef.current) return;

    const timeoutId = window.setTimeout(() => {
      void updateProfile({ thesis_page_snapshot: thesisProfileSnapshot })
        .then(() => {
          thesisProfileSaveSignatureRef.current = nextSignature;
        })
        .catch(() => {
          // Keep the local snapshot even if remote profile persistence is temporarily unavailable.
        });
    }, 400);

    return () => window.clearTimeout(timeoutId);
  }, [profile, profileLoading, thesisProfileSnapshot, updateProfile]);

  useEffect(() => {
    const handleSourceSync = (event: Event) => {
      const detail = (event as CustomEvent<{ sourceLibrary?: unknown; sourceQueueItems?: unknown; thesisDocuments?: unknown }>).detail;
      if (detail?.sourceLibrary) {
        setSourceLibrary(readSourceLibraryItems(detail.sourceLibrary));
      }
      if (detail?.sourceQueueItems) {
        setSourceQueueItems(readSourceQueueItems(detail.sourceQueueItems));
      }
      if (detail?.thesisDocuments) {
        setSupportingDocuments(readSupportingDocumentItems(detail.thesisDocuments));
      }
    };

    window.addEventListener(THESIS_SOURCE_SYNC_EVENT, handleSourceSync as EventListener);
    return () => window.removeEventListener(THESIS_SOURCE_SYNC_EVENT, handleSourceSync as EventListener);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const sourceId = params.get('source');
    const documentId = params.get('document');

    if (sourceId) {
      setLibrarySearch('');
      if (sourceLibrary.some((source) => source.id === sourceId)) {
        setActiveTab('sources');
        setSelectedLibrarySourceId(sourceId);
      }
    }

    if (documentId) {
      setDocumentSearch('');
      if (supportingDocuments.some((document) => document.id === documentId)) {
        setActiveTab('documents');
        setSelectedDocumentId(documentId);
      }
    }
  }, [location.search, sourceLibrary, supportingDocuments]);

  useEffect(() => {
    if (!selectedLibrarySourceId) {
      setSelectedLibrarySourceDraft(null);
      setSelectedLibrarySourceUndoStack([]);
      setSelectedLibrarySourceRedoStack([]);
      return;
    }

    const source = sourceLibrary.find((item) => item.id === selectedLibrarySourceId);
    if (!source) {
      setSelectedLibrarySourceDraft(null);
      setSelectedLibrarySourceUndoStack([]);
      setSelectedLibrarySourceRedoStack([]);
      return;
    }

    setSelectedLibrarySourceDraft(cloneSourceLibraryItem(source));
    setSelectedLibrarySourceUndoStack([]);
    setSelectedLibrarySourceRedoStack([]);
  }, [selectedLibrarySourceId]);

  useEffect(() => {
    if (!selectedDocumentId || activeTab !== 'documents') return;
    const element = document.getElementById(`thesis-document-${selectedDocumentId}`);
    if (!element) return;
    window.requestAnimationFrame(() => {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }, [activeTab, selectedDocumentId, visibleSupportingDocuments]);

  useEffect(() => {
    if (!editingDocumentId) return;
    if (editingDocument) return;
    resetSupportingDocumentEditor();
  }, [editingDocument, editingDocumentId]);

  useEffect(() => {
    let cancelled = false;

    const loadRemotePaper = async () => {
      try {
        const remoteDocument = await fetchThesisDocument();
        if (cancelled || !remoteDocument) return;

        const remoteSnapshot = remoteDocument.snapshot && typeof remoteDocument.snapshot === 'object'
          ? remoteDocument.snapshot as {
            sourceLibrary?: unknown;
            sourceQueueItems?: unknown;
            thesisDocuments?: unknown;
          }
          : null;
        if (remoteSnapshot?.sourceLibrary) {
          setSourceLibrary(readSourceLibraryItems(remoteSnapshot.sourceLibrary));
        }
        if (remoteSnapshot?.sourceQueueItems) {
          setSourceQueueItems(readSourceQueueItems(remoteSnapshot.sourceQueueItems));
        }
        if (remoteSnapshot?.thesisDocuments) {
          setSupportingDocuments(readSupportingDocumentItems(remoteSnapshot.thesisDocuments));
        }

        const localSnapshot = readStoredThesisPaperSnapshot();
        const remoteUpdatedAt = new Date(remoteDocument.updatedAt).getTime();
        if (!localSnapshot.updatedAt || remoteUpdatedAt >= localSnapshot.updatedAt || !localSnapshot.draft.trim()) {
          const snapshot = applyRemoteThesisDocument(remoteDocument);
          setPaperSnapshot(snapshot);
        }
      } catch {
        // Keep the local thesis workspace snapshot when the remote fetch is unavailable.
      } finally {
        if (!cancelled) {
          sourcesHydratedRef.current = true;
        }
      }
    };

    void loadRemotePaper();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (projectsLoading) return;

    const hasProject = (projectId: string) => projects.some((project) => project.id === projectId);
    const requestedProjectId = routeProjectId?.trim() || null;

    if (!initializedLinkRef.current) {
      initializedLinkRef.current = true;
      const storedProjectIds = parseStoredLinkedProjectIds(window.localStorage.getItem(THESIS_LINK_STORAGE_KEY))
        .filter(hasProject);
      const nextProjectIds = requestedProjectId && hasProject(requestedProjectId)
        ? [requestedProjectId, ...storedProjectIds.filter((projectId) => projectId !== requestedProjectId)]
        : storedProjectIds;
      setLinkedProjectIds(nextProjectIds);
      if (nextProjectIds.length > 0) {
        window.localStorage.setItem(THESIS_LINK_STORAGE_KEY, JSON.stringify(nextProjectIds));
      } else {
        window.localStorage.removeItem(THESIS_LINK_STORAGE_KEY);
      }
      if (requestedProjectId) {
        navigate('/thesis', { replace: true });
      }
      return;
    }

    const validLinkedProjectIds = linkedProjectIds.filter(hasProject);
    if (validLinkedProjectIds.length !== linkedProjectIds.length) {
      setLinkedProjectIds(validLinkedProjectIds);
      if (validLinkedProjectIds.length > 0) {
        window.localStorage.setItem(THESIS_LINK_STORAGE_KEY, JSON.stringify(validLinkedProjectIds));
      } else {
        window.localStorage.removeItem(THESIS_LINK_STORAGE_KEY);
      }
    }
  }, [linkedProjectIds, navigate, projects, projectsLoading, routeProjectId]);

  useEffect(() => {
    let cancelled = false;

    async function loadLinkedContext() {
      if (linkedProjectIds.length === 0) {
        setLinkedGoals([]);
        setLinkedEvents([]);
        setLinkedContextError(null);
        setLinkedContextLoading(false);
        return;
      }

      setLinkedContextLoading(true);
      setLinkedContextError(null);

      const [{ data: goalData, error: goalsError }, { data: eventData, error: eventsError }] = await Promise.all([
        supabase
          .from('goals')
          .select('*')
          .in('project_id', linkedProjectIds)
          .order('created_at', { ascending: false }),
        supabase
          .from('events')
          .select('*')
          .in('project_id', linkedProjectIds)
          .order('occurred_at', { ascending: false })
          .limit(12),
      ]);

      if (cancelled) return;

      if (goalsError || eventsError) {
        setLinkedGoals([]);
        setLinkedEvents([]);
        setLinkedContextError(goalsError?.message ?? eventsError?.message ?? 'Failed to load linked project context.');
        setLinkedContextLoading(false);
        return;
      }

      setLinkedGoals(goalData ?? []);
      setLinkedEvents(eventData ?? []);
      setLinkedContextLoading(false);
    }

    void loadLinkedContext();

    return () => {
      cancelled = true;
    };
  }, [linkedProjectIds]);

  const linkedGoalStats = useMemo(() => {
    const completed = linkedGoals.filter((goal) => goal.status === 'complete').length;
    const active = linkedGoals.filter((goal) => goal.status !== 'complete').length;
    const dueSoon = linkedGoals.filter((goal) => {
      if (!goal.deadline || goal.status === 'complete') return false;
      const diffDays = (new Date(goal.deadline).getTime() - Date.now()) / 86_400_000;
      return diffDays >= 0 && diffDays <= 14;
    }).length;
    const averageProgress = linkedGoals.length > 0
      ? Math.round(linkedGoals.reduce((sum, goal) => sum + goal.progress, 0) / linkedGoals.length)
      : 0;

    return { completed, active, dueSoon, averageProgress };
  }, [linkedGoals]);

  const linkedProjectRollups = useMemo(() => {
    return linkedProjects.map((project) => {
      const projectGoals = linkedGoals.filter((goal) => goal.project_id === project.id);
      const active = projectGoals.filter((goal) => goal.status !== 'complete').length;
      const completed = projectGoals.filter((goal) => goal.status === 'complete').length;
      const averageProgress = projectGoals.length > 0
        ? Math.round(projectGoals.reduce((sum, goal) => sum + goal.progress, 0) / projectGoals.length)
        : 0;
      const nextDueGoal = [...projectGoals]
        .filter((goal) => goal.status !== 'complete' && Boolean(goal.deadline))
        .sort((left, right) => new Date(left.deadline ?? 0).getTime() - new Date(right.deadline ?? 0).getTime())[0] ?? null;
      const latestEvent = [...linkedEvents]
        .filter((event) => event.project_id === project.id)
        .sort((left, right) => new Date(right.occurred_at).getTime() - new Date(left.occurred_at).getTime())[0] ?? null;

      return {
        id: project.id,
        name: project.name,
        active,
        completed,
        averageProgress,
        nextDueGoal,
        latestEvent,
      };
    });
  }, [linkedEvents, linkedGoals, linkedProjects]);

  const linkedFocusGoals = useMemo(() => {
    return [...linkedGoals]
      .filter((goal) => goal.status !== 'complete')
      .sort((left, right) => {
        if (left.deadline && right.deadline) return new Date(left.deadline).getTime() - new Date(right.deadline).getTime();
        if (left.deadline) return -1;
        if (right.deadline) return 1;
        return right.progress - left.progress;
      })
      .slice(0, 6);
  }, [linkedGoals]);

  const recentLinkedActivity = useMemo(
    () => [...linkedEvents]
      .sort((left, right) => new Date(right.occurred_at).getTime() - new Date(left.occurred_at).getTime())
      .slice(0, 6),
    [linkedEvents],
  );

  const linkedContextCards = useMemo(() => {
    if (linkedProjects.length === 0) return [];

    return [
      {
        id: 'projects',
        label: 'Linked Projects',
        value: `${linkedProjects.length}`,
        tone: 'text-heading',
        detail: 'Project workspaces currently feeding live execution context into the thesis workspace.',
      },
      {
        id: 'execution',
        label: 'Execution Signal',
        value: `${linkedGoalStats.averageProgress}%`,
        tone: 'text-accent',
        detail: 'Average progress across all linked project tasks flowing into the thesis workspace.',
      },
      {
        id: 'pressure',
        label: 'Open Task Pressure',
        value: `${linkedGoalStats.active}`,
        tone: 'text-accent2',
        detail: 'Live tasks across linked projects still shaping evidence, argument scope, or delivery timing.',
      },
      {
        id: 'activity',
        label: 'Recent Activity',
        value: `${linkedEvents.length}`,
        tone: 'text-accent3',
        detail: 'Fresh multi-project execution events available as context for research notes and planning.',
      },
    ];
  }, [linkedEvents.length, linkedGoalStats.active, linkedGoalStats.averageProgress, linkedProjects.length]);

  const thesisWorkspaceContext = useMemo(() => {
    const memberLines = members.length > 0
      ? members
        .map((member) => `- ${member.name.trim() || 'Unnamed member'}: ${member.role.trim() || 'Author'}`)
        .join('\n')
      : '- No thesis members listed yet.';
    const milestoneLines = milestones
      .map((milestone) => `- ${milestone.label}: ${milestone.status.replace('_', ' ')}, ${milestone.progress}% complete, due ${milestone.due}. ${milestone.note}`)
      .join('\n');
    const focusTaskLines = linkedFocusGoals.length > 0
      ? linkedFocusGoals
        .map((goal) => `- ${goal.title} [${linkedProjectNameById[goal.project_id] ?? 'Linked project'}]: ${normalizeGoalStatus(goal.status)}, ${goal.progress}% complete, due ${formatShortDate(goal.deadline)}. ${goal.description?.trim() || 'No description provided.'}`)
        .join('\n')
      : '- No active linked project tasks are currently selected for thesis focus.';
    const recentActivityLines = linkedEvents.length > 0
      ? linkedEvents
        .slice(0, 6)
        .map((event) => `- ${event.title?.trim() || 'Project update'} [${linkedProjectNameById[event.project_id] ?? 'Linked project'}]: ${event.summary?.trim() || `${event.source} ${event.event_type.replace(/_/g, ' ')}`}. Occurred ${formatRelativeDate(event.occurred_at)}.`)
        .join('\n')
      : '- No recent linked project activity yet.';
    const linkedProjectLines = linkedProjects.length > 0
      ? linkedProjects
        .map((project) => `- ${project.name}: ${project.description?.trim() || 'No project description available.'}`)
        .join('\n')
      : '- None linked.';
    const sourceQueueLines = sourceQueueItems.length > 0
      ? sourceQueueItems
        .slice(0, 8)
        .map((source) => `- ${source.title}: ${source.status}. ${truncateResourceText(source.insight, 180)}`)
        .join('\n')
      : '- No queued source items.';
    const sourceLibraryLines = sourceLibrary.length > 0
      ? sourceLibrary
        .map((source) => {
          const link = `/thesis?tab=sources&source=${encodeURIComponent(source.id)}`;
          const summary = truncateResourceText(source.abstract || source.notes || source.citation, 180);
          return `- [${source.id}] ${source.title} | ${source.type} | ${source.credit} | ${source.year} | ${source.venue} | available at: ${truncateResourceText(source.locator, 100)}${summary ? ` | summary: ${summary}` : ''} | Odyssey link: ${link}`;
        })
        .join('\n')
      : '- No saved sources in the thesis library yet.';
    const documentLines = supportingDocuments.length > 0
      ? supportingDocuments
        .map((document) => {
          const link = `/thesis?tab=documents&document=${encodeURIComponent(document.id)}`;
          const linkedSource = document.linkedSourceId
            ? sourceLibrary.find((source) => source.id === document.linkedSourceId)?.title ?? document.linkedSourceId
            : 'None';
          const preview = truncateResourceText(document.extractedTextPreview, 180);
          return `- [${document.id}] ${document.title} | file: ${document.attachmentName || 'No attachment name'} | contribution: ${truncateResourceText(document.contribution, 140)} | description: ${truncateResourceText(document.description, 140)} | linked source: ${linkedSource}${preview ? ` | text preview: ${preview}` : ''} | Odyssey link: ${link}`;
        })
        .join('\n')
      : '- No supporting documents saved yet.';
    const chapterLines = chapterPlan
      .map((chapter) => `- ${chapter.chapter}: ${chapter.status}, ${chapter.progress}% ready. ${chapter.focus}`)
      .join('\n');
    const citationReferenceLines = citationReferenceMatches.length > 0
      ? citationReferenceMatches
        .map((match) => `- ${match.guideTitle}${'title' in match && match.title ? ` | ${match.title}` : ''}: ${truncateResourceText(match.text, 420)}`)
        .join('\n')
      : '- No citation reference guidance matched the current format and source context.';
    const activeWorkspaceFile = getThesisWorkspaceActiveFile(paperSnapshot.workspace);
    const activePaperPath = activeWorkspaceFile?.path ?? paperSnapshot.activeFilePath ?? DEFAULT_THESIS_EXAMPLE_PATH;
    const activePaperSource = activeWorkspaceFile?.content ?? paperSnapshot.draft ?? '';
    const activePaperStats = {
      lineCount: activePaperSource.length > 0 ? activePaperSource.split('\n').length : 1,
      wordCount: activePaperSource.trim().length > 0 ? activePaperSource.trim().split(/\s+/).length : 0,
    };
    const workspaceFileLines = paperSnapshot.workspace?.files?.length
      ? paperSnapshot.workspace.files.map((file) => `- ${file.path}`).join('\n')
      : `- ${DEFAULT_THESIS_EXAMPLE_PATH}`;
    const numberedPaperDraft = buildNumberedLatexSource(activePaperSource);
    const editorSelection = paperSnapshot.editorState?.selection;
    const editorViewport = paperSnapshot.editorState?.viewport;
    const editorContextSection = [
      `- Active file: ${activePaperPath}`,
      paperSnapshot.editorState
        ? `- Cursor: line ${paperSnapshot.editorState.cursorLineNumber}, column ${paperSnapshot.editorState.cursorColumn}`
        : '- Cursor: unavailable',
      editorSelection
        ? `- Selection: lines ${editorSelection.startLineNumber}-${editorSelection.endLineNumber}, columns ${editorSelection.startColumn}-${editorSelection.endColumn}`
        : '- Selection: none',
      editorSelection?.selectedText
        ? `- Selected text:\n${editorSelection.selectedText}`
        : '- Selected text: none',
      editorViewport
        ? `- Visible lines: ${editorViewport.firstLineNumber}-${editorViewport.lastLineNumber} (center ${editorViewport.centerLineNumber})`
        : '- Visible lines: unavailable',
      editorViewport
        ? `- Visible source excerpt:\n${getNumberedLatexExcerpt(activePaperSource, editorViewport.firstLineNumber, editorViewport.lastLineNumber)}`
        : '- Visible source excerpt: unavailable',
    ].join('\n');
    const paperPreviewSection = [
      `- Preview status: ${paperSnapshot.previewStatus}`,
      paperSnapshot.renderError ? `- Preview error: ${paperSnapshot.renderError}` : '- Preview error: none',
      `- Draft stats: ${activePaperStats.lineCount} lines, ${activePaperStats.wordCount} words`,
      paperSnapshot.previewText
        ? `- Preview text:\n${paperSnapshot.previewText}`
        : '- Preview text: unavailable',
    ].join('\n');

    return `THESIS WORKSPACE
Current tab: ${activeTabLabel}
Thesis description: ${description}
Thesis department: ${department || 'Not selected'}
Graduating quarter: ${graduatingQuarter || 'Not selected'}
Citation format: ${BIBLIOGRAPHY_FORMAT_LABELS[citationFormat]}
Citation reference guides: ${activeCitationReferenceGuide.guides.map((guide) => guide.title).join(', ')}
Thesis members:
${memberLines}
Overall thesis progress: ${overallProgress}%

Milestones:
${milestoneLines}

Linked projects (${linkedProjects.length}):
${linkedProjectLines}

Linked project execution summary:
- Average linked task progress: ${linkedGoalStats.averageProgress}%
- Open linked tasks: ${linkedGoalStats.active}
- Completed linked tasks: ${linkedGoalStats.completed}
- Linked tasks due within 14 days: ${linkedGoalStats.dueSoon}

Priority linked tasks:
${focusTaskLines}

Recent linked project activity:
${recentActivityLines}

Source intake queue:
${sourceQueueLines}

Source library:
${sourceLibraryLines}

Supporting documents:
${documentLines}

Chapter pipeline:
${chapterLines}

Citation reference guidance:
${citationReferenceLines}

THESIS PAPER PREVIEW:
${paperPreviewSection}

THESIS WORKSPACE FILES:
${workspaceFileLines}

THESIS PAPER EDITOR STATE:
${editorContextSection}

THESIS PAPER SOURCE WITH LINE NUMBERS (${activePaperPath}):
${numberedPaperDraft || '1 | '}

Thesis AI should help with literature synthesis, argument structure, methodology framing, chapter drafting, LaTeX paper authoring, defense preparation, and translating linked project execution into thesis-relevant analysis. Prioritize advice that fits the current thesis tab: ${activeTabLabel}.`;
  }, [
    activeTabLabel,
    activeCitationReferenceGuide.guides,
    citationReferenceMatches,
    citationFormat,
    department,
    description,
    graduatingQuarter,
    linkedEvents,
    linkedFocusGoals,
    linkedGoalStats.active,
    linkedGoalStats.averageProgress,
    linkedGoalStats.completed,
    linkedGoalStats.dueSoon,
    linkedProjectNameById,
    linkedProjects,
    overallProgress,
    paperSnapshot,
    members,
    supportingDocuments,
    sourceLibrary,
    sourceQueueItems,
  ]);

  useEffect(() => {
    register({
      projectId: primaryLinkedProject?.id ?? null,
      projectName: primaryLinkedProject?.name ?? null,
      onGoalMutated: null,
      mode: 'thesis',
      panelTitle: 'Thesis AI',
      panelSubtitle: null,
      workspaceContext: thesisWorkspaceContext,
      inputPlaceholder: linkedProjects.length > 0
        ? 'Ask about claims, structure, evidence, drafting, or defense prep…'
        : 'Link projects in the thesis workspace to start Thesis AI…',
      allowProjectSwitching: false,
    });
    return () => { unregister(); };
  }, [activeTabLabel, linkedProjects.length, primaryLinkedProject, register, thesisWorkspaceContext, unregister]);

  const toggleLinkedProject = (projectId: string) => {
    setLinkedProjectIds((current) => {
      const nextProjectIds = current.includes(projectId)
        ? current.filter((id) => id !== projectId)
        : [...current, projectId];
      if (nextProjectIds.length > 0) {
        window.localStorage.setItem(THESIS_LINK_STORAGE_KEY, JSON.stringify(nextProjectIds));
      } else {
        window.localStorage.removeItem(THESIS_LINK_STORAGE_KEY);
      }
      return nextProjectIds;
    });
  };

  const clearLinkedProjects = () => {
    setLinkedProjectIds([]);
    window.localStorage.removeItem(THESIS_LINK_STORAGE_KEY);
    setProjectPickerOpen(false);
    navigate('/thesis', { replace: true });
  };

  const handlePdfUpload = async (file: File | null | undefined) => {
    setQueueNotice(null);
    setQueueError(null);
    if (!file) {
      setUploadedPdfName('');
      setUploadedPdfFile(null);
      setPdfFieldCaptureOpen(false);
      return;
    }

    setUploadedPdfName(file.name);
    setUploadedPdfFile(file);
    setPdfFieldCaptureOpen(true);
    setSourceTitle('');
    setSourceAccessUrl('');
  };

  const resetSourceIntake = () => {
    setSourceIntakeMethod('url');
    setSourceIntakeKind(null);
    setSourceUrl('');
    setSourceAccessUrl('');
    setUploadedPdfName('');
    setUploadedPdfFile(null);
    setParsedUrlSource(null);
    setPdfFieldCaptureOpen(false);
    setUrlAutofillStatus('idle');
    setUrlAutofillError(null);
    setManualSourceText('');
    setSourceTitle('');
    setSourceCredit('');
    setSourceContextField('');
    setSourceYear('');
    setVerificationState('verified');
    setSourceRole('secondary');
    setChapterTarget('literature_review');
    setResearchUseNote('Use this source to support the literature review and identify reusable claims for later drafting.');
    setQueueNotice(null);
    setQueueError(null);
  };

  const handleDocumentFileSelected = (file: File | null | undefined) => {
    setDocumentNotice(null);
    setDocumentError(null);
    if (!file) {
      setUploadedDocumentFile(null);
      setUploadedDocumentName('');
      return;
    }

    setUploadedDocumentFile(file);
    setUploadedDocumentName(file.name);
    setDocumentTitle((current) => current.trim() || file.name.replace(/\.[^.]+$/, ''));
  };

  const resetSupportingDocumentEditor = () => {
    setEditingDocumentId(null);
    setUploadedDocumentFile(null);
    setUploadedDocumentName('');
    setDocumentTitle('');
    setDocumentDescription('');
    setDocumentContribution('');
    setDocumentLinkedSourceId('');
  };

  const openSupportingDocumentEditor = (document: ThesisSupportingDocument) => {
    setDocumentNotice(null);
    setDocumentError(null);
    setSelectedDocumentId(document.id);
    setEditingDocumentId(document.id);
    setUploadedDocumentFile(null);
    setUploadedDocumentName(document.attachmentName);
    setDocumentTitle(document.title);
    setDocumentDescription(document.description);
    setDocumentContribution(document.contribution);
    setDocumentLinkedSourceId(document.linkedSourceId ?? '');
    updateThesisRoute({ tab: 'documents', document: document.id, source: null });
    window.requestAnimationFrame(() => {
      thesisDocumentEditorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  useEffect(() => {
    if (sourceIntakeMethod !== 'url') {
      setParsedUrlSource(null);
      setUrlAutofillStatus('idle');
      setUrlAutofillError(null);
      return;
    }

    const normalizedUrl = sourceUrl.trim();
    if (!normalizedUrl) {
      setParsedUrlSource(null);
      setUrlAutofillStatus('idle');
      setUrlAutofillError(null);
      return;
    }

    if (!/^https?:\/\//i.test(normalizedUrl)) {
      setParsedUrlSource(null);
      setUrlAutofillStatus('idle');
      setUrlAutofillError(null);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setUrlAutofillStatus('parsing');
      setUrlAutofillError(null);

      void parseThesisSourceUrl(normalizedUrl)
        .then((parsed) => {
          if (cancelled) return;
          setParsedUrlSource(parsed);
          setUrlAutofillStatus('ready');
          if (parsed.sourceKind) setSourceIntakeKind(parsed.sourceKind as SourceIntakeKind);
          setSourceTitle(parsed.title?.trim() || parsed.filename || normalizedUrl);
          setSourceCredit((current) => normalizeSourceCreditValue(parsed.credit?.trim() || current));
          setSourceContextField((current) => parsed.contextField?.trim() || current);
          setSourceYear((current) => {
            const nextValue = parsed.year?.trim();
            return nextValue ? normalizePublicationDate(nextValue, bibliographyFormat) : current;
          });
          setResearchUseNote((current) => current.trim() || parsed.summary?.trim() || parsed.abstract?.trim() || current);
        })
        .catch((error) => {
          if (cancelled) return;
          setParsedUrlSource(null);
          setUrlAutofillStatus('error');
          setUrlAutofillError(error instanceof Error ? error.message : 'Failed to parse the URL.');
        });
    }, 450);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [bibliographyFormat, sourceIntakeMethod, sourceUrl]);

  const handleConfirmSource = async () => {
    setQueueNotice(null);
    setQueueError(null);

    if (!sourceIntakeKind || !sourceReadyForQueue) {
      setQueueError('Complete the required source fields before saving the source.');
      return;
    }

    const normalizedTitle = sourceTitle.trim();
    const normalizedCredit = normalizeSourceCreditValue(sourceCredit);
    const normalizedContext = sourceContextField.trim();
    const normalizedYear = sourceYear.trim();
    const normalizedLocator = sourceLocatorValue.trim();
    const normalizedUseNote = researchUseNote.trim();
    const today = new Date().toISOString().slice(0, 10);
    const libraryType = mapSourceKindToLibraryType(sourceIntakeMethod, sourceIntakeKind);
    const keywordTags = activeParsedSource?.keywords ?? [];
    const workflowNote = [
      `Chapter target: ${formatSourceLabel(chapterTarget)}.`,
      `Verification: ${formatSourceLabel(verificationState)}.`,
    ].join(' ');
    const combinedNotes = [normalizedUseNote, workflowNote]
      .filter((value, index, array) => value && array.indexOf(value) === index)
      .join('\n\n');
    let attachment: ThesisSourceAttachment | null = null;

    setQueueRequestPending(true);
    try {
      if (sourceIntakeMethod === 'pdf' && uploadedPdfFile) {
        attachment = await uploadThesisSourcePdf(uploadedPdfFile);
      }

      const citeKey = buildSourceCiteKey({
        title: normalizedTitle,
        credit: normalizedCredit,
        year: normalizedYear,
      }, new Set(sourceLibrary.map((item) => item.citeKey)));

      const nextLibraryItem: SourceLibraryItem = {
      id: createSourceId('lib'),
      citeKey,
      title: normalizedTitle,
      type: libraryType,
      acquisitionMethod: sourceIntakeMethod,
      sourceKind: sourceIntakeKind,
      status: 'tagged',
      role: sourceRole,
      verification: verificationState,
      chapterTarget,
      credit: normalizedCredit,
      venue: normalizedContext,
      year: normalizedYear,
      locator: normalizedLocator,
      citation: '',
      abstract: activeParsedSource?.abstract?.trim() || activeParsedSource?.summary?.trim() || normalizedUseNote,
      notes: combinedNotes,
      tags: keywordTags,
      addedOn: today,
      attachmentName: attachment?.name ?? '',
      attachmentStoragePath: attachment?.storagePath ?? '',
      attachmentMimeType: attachment?.mimeType ?? '',
      attachmentUploadedAt: attachment?.uploadedAt ?? '',
      };
      setSourceLibrary((current) => readSourceLibraryItems([nextLibraryItem, ...current.filter((item) => item.id !== nextLibraryItem.id)]));
      setSourceQueueItems([]);
      setSourceIntakeOpen(false);
      resetSourceIntake();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save the source to the library.';
      setQueueError(sourceIntakeMethod === 'pdf' ? `PDF upload failed: ${message}` : message);
    } finally {
      setQueueRequestPending(false);
    }
  };

  const handleSaveSupportingDocument = async () => {
    setDocumentNotice(null);
    setDocumentError(null);

    if (!documentReadyToSave) {
      setDocumentError(editingDocumentId
        ? 'Fill in the title, description, and thesis contribution before saving the document.'
        : 'Upload a document and fill in the title, description, and thesis contribution first.');
      return;
    }

    if (editingDocumentId) {
      const existingDocument = supportingDocuments.find((document) => document.id === editingDocumentId);
      if (!existingDocument) {
        setDocumentError('That document could not be found anymore.');
        setEditingDocumentId(null);
        return;
      }

      const nextDocument: ThesisSupportingDocument = {
        ...existingDocument,
        title: documentTitle.trim(),
        description: documentDescription.trim(),
        contribution: documentContribution.trim(),
        linkedSourceId: documentLinkedSourceId.trim() || null,
      };

      setSupportingDocuments((current) => current.map((document) => (
        document.id === nextDocument.id ? nextDocument : document
      )));
      setSelectedDocumentId(nextDocument.id);
      setDocumentNotice(`Saved changes to "${nextDocument.title}".`);
      resetSupportingDocumentEditor();
      return;
    }

    if (!uploadedDocumentFile) {
      setDocumentError('Upload a document and fill in the title, description, and thesis contribution first.');
      return;
    }

    setDocumentSavePending(true);
    try {
      const attachment = await uploadThesisDocumentAttachment(uploadedDocumentFile);
      const nextDocument: ThesisSupportingDocument = {
        id: createSourceId('doc'),
        title: documentTitle.trim(),
        description: documentDescription.trim(),
        contribution: documentContribution.trim(),
        extractedTextPreview: attachment.extractedTextPreview?.trim() || '',
        linkedSourceId: documentLinkedSourceId.trim() || null,
        addedOn: new Date().toISOString().slice(0, 10),
        attachmentName: attachment.name,
        attachmentStoragePath: attachment.storagePath,
        attachmentMimeType: attachment.mimeType,
        attachmentUploadedAt: attachment.uploadedAt,
      };
      setSupportingDocuments((current) => [nextDocument, ...current]);
      setDocumentNotice(`Saved "${nextDocument.title}" to thesis documents.`);
      resetSupportingDocumentEditor();
    } catch (error) {
      setDocumentError(error instanceof Error ? error.message : 'Failed to upload the thesis document.');
    } finally {
      setDocumentSavePending(false);
    }
  };

  const openSignedThesisAttachment = async (
    storagePath: string,
    openSignedUrl: (path: string) => Promise<string>,
    onError: (message: string) => void,
  ) => {
    const popup = window.open('about:blank', '_blank');
    if (popup) {
      popup.opener = null;
      popup.document.title = 'Opening attachment...';
      popup.document.body.innerHTML = '<div style="font-family: sans-serif; padding: 24px; color: #334155;">Opening attachment...</div>';
    }
    try {
      const url = await openSignedUrl(storagePath);
      if (popup && !popup.closed) {
        popup.location.href = url;
      } else {
        const link = document.createElement('a');
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        link.remove();
      }
    } catch (error) {
      popup?.close();
      onError(error instanceof Error ? error.message : 'Failed to open the thesis attachment.');
    }
  };

  const handleOpenLibraryAttachment = async (source: SourceLibraryItem) => {
    if (!source.attachmentStoragePath) return;
    setLibraryAttachmentOpening(true);
    try {
      await openSignedThesisAttachment(
        source.attachmentStoragePath,
        signThesisSourceAttachment,
        (message) => setQueueError(message || 'Failed to open the attached PDF.'),
      );
    } finally {
      setLibraryAttachmentOpening(false);
    }
  };

  const handleOpenSupportingDocument = async (document: ThesisSupportingDocument) => {
    if (!document.attachmentStoragePath) return;
    setDocumentAttachmentOpeningId(document.id);
    try {
      await openSignedThesisAttachment(
        document.attachmentStoragePath,
        signThesisSourceAttachment,
        (message) => setDocumentError(message || 'Failed to open the attached document.'),
      );
    } finally {
      setDocumentAttachmentOpeningId(null);
    }
  };

  const openLibrarySourceEditor = (sourceId: string) => {
    if (selectedLibrarySourceId && selectedLibrarySourceId !== sourceId && selectedLibrarySource && selectedLibrarySourceDraft
      && JSON.stringify(selectedLibrarySourceDraft) !== JSON.stringify(selectedLibrarySource)
      && !window.confirm('Discard unsaved source edits?')) {
      return;
    }
    setSelectedLibrarySourceId(sourceId);
    setLibrarySearch('');
    updateThesisRoute({ tab: 'sources', source: sourceId, document: null });
  };

  const updateLibrarySourceDraft = <K extends keyof SourceLibraryItem>(field: K, value: SourceLibraryItem[K]) => {
    setSelectedLibrarySourceDraft((current) => {
      if (!current) return current;
      const nextValue = field === 'credit'
        ? normalizeSourceCreditValue(String(value))
        : value;
      if (current[field] === nextValue) {
        return current;
      }
      setSelectedLibrarySourceUndoStack((history) => [...history, cloneSourceLibraryItem(current)]);
      setSelectedLibrarySourceRedoStack([]);
      return { ...current, [field]: nextValue };
    });
  };

  const saveSelectedLibrarySourceDraft = () => {
    if (!selectedLibrarySource || !selectedLibrarySourceDraft) return;
    if (JSON.stringify(selectedLibrarySourceDraft) === JSON.stringify(selectedLibrarySource)) return;

    const nextSource = cloneSourceLibraryItem({
      ...selectedLibrarySourceDraft,
      credit: normalizeSourceCreditValue(selectedLibrarySourceDraft.credit),
    });
    const previousTitle = selectedLibrarySource.title;

    setSourceLibrary((current) => current.map((source) => (
      source.id === nextSource.id ? nextSource : source
    )));

    if (previousTitle !== nextSource.title) {
      setSourceQueueItems((current) => current.map((item) => (
        item.librarySourceId === nextSource.id || item.title === previousTitle
          ? { ...item, title: nextSource.title }
          : item
      )));
    }

    setSelectedLibrarySourceDraft(nextSource);
    setSelectedLibrarySourceUndoStack([]);
    setSelectedLibrarySourceRedoStack([]);
  };

  const closeSelectedLibrarySourceEditor = () => {
    if (selectedLibrarySourceDirty && !window.confirm('Discard unsaved source edits?')) {
      return;
    }
    setSelectedLibrarySourceId(null);
    updateThesisRoute({ source: null });
  };

  const applyLibrarySourceAutoFix = (
    patch: Partial<Pick<SourceLibraryItem, 'title' | 'credit' | 'venue' | 'year' | 'locator' | 'citation'>>,
  ) => {
    if (Object.keys(patch).length === 0) return;
    setSelectedLibrarySourceDraft((current) => {
      if (!current) return current;
      const nextSource = cloneSourceLibraryItem({
        ...current,
        ...patch,
        credit: patch.credit ? normalizeSourceCreditValue(patch.credit) : current.credit,
      });
      if (JSON.stringify(nextSource) === JSON.stringify(current)) {
        return current;
      }
      setSelectedLibrarySourceUndoStack((history) => [...history, cloneSourceLibraryItem(current)]);
      setSelectedLibrarySourceRedoStack([]);
      return nextSource;
    });
  };

  useEffect(() => {
    if (!selectedLibrarySourceDraft) return undefined;

    function handleSelectedLibrarySourceKeyDown(event: KeyboardEvent) {
      const isModifierPressed = event.metaKey || event.ctrlKey;
      if (!isModifierPressed) return;

      const normalizedKey = event.key.toLowerCase();
      if (normalizedKey === 's') {
        event.preventDefault();
        saveSelectedLibrarySourceDraft();
        return;
      }

      if (normalizedKey === 'z' && !event.shiftKey) {
        if (selectedLibrarySourceUndoStack.length === 0) return;
        event.preventDefault();
        setSelectedLibrarySourceDraft((current) => {
          if (!current) return current;
          const previous = selectedLibrarySourceUndoStack[selectedLibrarySourceUndoStack.length - 1];
          setSelectedLibrarySourceUndoStack((history) => history.slice(0, -1));
          setSelectedLibrarySourceRedoStack((history) => [...history, cloneSourceLibraryItem(current)]);
          return cloneSourceLibraryItem(previous);
        });
        return;
      }

      if ((normalizedKey === 'z' && event.shiftKey) || normalizedKey === 'y') {
        if (selectedLibrarySourceRedoStack.length === 0) return;
        event.preventDefault();
        setSelectedLibrarySourceDraft((current) => {
          if (!current) return current;
          const next = selectedLibrarySourceRedoStack[selectedLibrarySourceRedoStack.length - 1];
          setSelectedLibrarySourceRedoStack((history) => history.slice(0, -1));
          setSelectedLibrarySourceUndoStack((history) => [...history, cloneSourceLibraryItem(current)]);
          return cloneSourceLibraryItem(next);
        });
      }
    }

    window.addEventListener('keydown', handleSelectedLibrarySourceKeyDown);
    return () => window.removeEventListener('keydown', handleSelectedLibrarySourceKeyDown);
  }, [saveSelectedLibrarySourceDraft, selectedLibrarySourceDraft, selectedLibrarySourceRedoStack, selectedLibrarySourceUndoStack]);

  useEffect(() => {
    if (!pendingLibrarySourceDelete) return undefined;

    const handlePendingSourceDeleteKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        cancelDeleteLibrarySource();
      }
    };

    window.addEventListener('keydown', handlePendingSourceDeleteKeyDown);
    return () => window.removeEventListener('keydown', handlePendingSourceDeleteKeyDown);
  }, [pendingLibrarySourceDelete]);

  const deleteLibrarySource = (source: SourceLibraryItem) => {
    const sourceIndex = sourceLibrary.findIndex((item) => item.id === source.id);
    const previousQueueItems = sourceQueueItems;
    const previousDocuments = supportingDocuments;
    const wasSelected = selectedLibrarySourceId === source.id;
    const sourceRouteActive = new URLSearchParams(location.search).get('source') === source.id;

    pushUndoAction({
      label: `Deleted source ${source.title}`,
      undo: () => {
        setSourceLibrary((current) => {
          if (current.some((item) => item.id === source.id)) return current;
          const next = [...current];
          next.splice(sourceIndex >= 0 ? Math.min(sourceIndex, next.length) : next.length, 0, source);
          return next;
        });
        setSourceQueueItems(previousQueueItems);
        setSupportingDocuments(previousDocuments);
        if (wasSelected) {
          setSelectedLibrarySourceId(source.id);
        }
        if (sourceRouteActive) {
          updateThesisRoute({ source: source.id });
        }
      },
    });

    setSourceLibrary((current) => current.filter((item) => item.id !== source.id));
    setSourceQueueItems((current) => current.filter((item) => (
      item.librarySourceId !== source.id && item.title !== source.title
    )));
    setSupportingDocuments((current) => current.map((item) => (
      item.linkedSourceId === source.id
        ? { ...item, linkedSourceId: null }
        : item
    )));
    setPendingLibrarySourceDelete((current) => (current?.id === source.id ? null : current));
    if (selectedLibrarySourceId === source.id) {
      setSelectedLibrarySourceId(null);
    }
    if (new URLSearchParams(location.search).get('source') === source.id) {
      updateThesisRoute({ source: null });
    }
  };

  const requestDeleteLibrarySource = (source: SourceLibraryItem) => {
    setPendingLibrarySourceDelete(source);
  };

  const cancelDeleteLibrarySource = () => {
    setPendingLibrarySourceDelete(null);
  };

  const confirmDeleteLibrarySource = () => {
    if (!pendingLibrarySourceDelete) return;
    deleteLibrarySource(pendingLibrarySourceDelete);
  };

  const deleteSupportingDocument = (documentId: string) => {
    const documentIndex = supportingDocuments.findIndex((item) => item.id === documentId);
    const removedDocument = documentIndex >= 0 ? supportingDocuments[documentIndex] ?? null : null;
    const wasSelected = selectedDocumentId === documentId;
    const routeActive = new URLSearchParams(location.search).get('document') === documentId;
    if (!removedDocument) return;

    pushUndoAction({
      label: `Deleted supporting document ${removedDocument.title}`,
      undo: () => {
        setSupportingDocuments((current) => {
          if (current.some((item) => item.id === documentId)) return current;
          const next = [...current];
          next.splice(Math.min(documentIndex, next.length), 0, removedDocument);
          return next;
        });
        if (wasSelected) {
          setSelectedDocumentId(documentId);
        }
        if (routeActive) {
          updateThesisRoute({ document: documentId });
        }
      },
    });

    setSupportingDocuments((current) => current.filter((item) => item.id !== documentId));
    if (editingDocumentId === documentId) {
      resetSupportingDocumentEditor();
    }
    if (selectedDocumentId === documentId) {
      setSelectedDocumentId(null);
    }
    if (new URLSearchParams(location.search).get('document') === documentId) {
      updateThesisRoute({ document: null });
    }
  };

  const handleAddMilestone = () => {
    const nextMilestone = createCustomThesisMilestone();
    setMilestones((currentMilestones) => [...currentMilestones, nextMilestone]);
    setSelectedMilestoneId(nextMilestone.id);
  };

  const handleDeleteMilestone = (milestoneId: string) => {
    const milestoneIndex = milestones.findIndex((milestone) => milestone.id === milestoneId);
    const removedMilestone = milestoneIndex >= 0 ? milestones[milestoneIndex] ?? null : null;
    if (!removedMilestone) return;

    pushUndoAction({
      label: `Deleted milestone ${removedMilestone.label}`,
      undo: () => {
        setMilestones((currentMilestones) => {
          if (currentMilestones.some((milestone) => milestone.id === milestoneId)) return currentMilestones;
          const nextMilestones = [...currentMilestones];
          nextMilestones.splice(Math.min(milestoneIndex, nextMilestones.length), 0, removedMilestone);
          return nextMilestones;
        });
        setSelectedMilestoneId(milestoneId);
      },
    });

    setMilestones((currentMilestones) => currentMilestones.filter((milestone) => milestone.id !== milestoneId));
    if (selectedMilestoneId === milestoneId) {
      setSelectedMilestoneId(null);
    }
  };

  return (
    <div className="app-page-width app-page-width--ultra mx-auto max-w-7xl px-8 pb-8 pt-5">
      <div className="mb-6 grid grid-cols-1 items-end gap-x-8 gap-y-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          <p className="text-[11px] tracking-[0.25em] uppercase text-accent mb-2 font-mono">Thesis Workspace</p>
          <h1 className="font-sans text-3xl font-extrabold text-heading tracking-tight">Research, Analysis, and Delivery</h1>
          <p className="mt-1 max-w-[90rem] text-sm leading-relaxed text-muted">
            Organize source material, structure AI-assisted analysis, and track the work needed to turn research into a presentable thesis.
          </p>
        </div>

        <div className="w-full max-w-[320px] justify-self-end self-center">
          <div ref={projectPickerRef} className="relative">
            <button
              type="button"
              onClick={() => !projectsLoading && setProjectPickerOpen((open) => !open)}
              className="flex h-11 w-full items-center justify-between gap-3 border border-border bg-surface px-4 text-left text-heading transition-colors hover:bg-surface2 focus:outline-none focus:border-accent"
            >
              <span className="truncate font-sans text-[0.92rem] font-semibold leading-none">
                {projectsLoading
                  ? 'Loading Projects...'
                  : linkedProjects.length > 0
                    ? linkedProjects.length === 1
                      ? `${linkedProjects[0].name} Linked`
                      : `${linkedProjects.length} Projects Linked`
                    : 'No Project Linked'}
              </span>
              <ChevronDown size={16} className={`shrink-0 text-accent transition-transform ${projectPickerOpen ? 'rotate-180' : ''}`} />
            </button>
            {projectPickerOpen && !projectsLoading && (
              <div className="absolute left-0 right-0 top-full z-20 mt-2 border border-border bg-surface shadow-2xl">
                <div className="max-h-72 overflow-y-auto">
                  {projects.map((project) => {
                    const selected = linkedProjectIds.includes(project.id);
                    return (
                      <button
                        key={project.id}
                        type="button"
                        onClick={() => toggleLinkedProject(project.id)}
                        className="flex w-full items-start gap-3 border-b border-border px-4 py-3 text-left transition-colors hover:bg-surface2"
                      >
                        <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center border ${selected ? 'border-accent bg-accent text-[var(--color-accent-fg)]' : 'border-border bg-surface'}`}>
                          {selected && <Check size={11} />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-heading">{project.name}</span>
                          <span className="mt-1 block text-xs leading-relaxed text-muted">
                            {project.description?.trim() || 'No description available.'}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-center justify-between gap-3 px-5 py-3">
                  <span className="text-[11px] font-mono uppercase tracking-[0.18em] text-accent">
                    {linkedProjectIds.length === 0 ? 'No project linked' : `${linkedProjectIds.length} linked`}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={clearLinkedProjects}
                      className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-heading transition-colors hover:text-accent"
                    >
                      Clear
                    </button>
                    <button
                      type="button"
                      onClick={() => setProjectPickerOpen(false)}
                      className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-accent transition-colors hover:opacity-80"
                    >
                      Done
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <WorkspaceTabBar
        tabs={tabs}
        activeTab={activeTab}
        onChange={handleTabChange}
        stretch
        className="mb-5"
      />

      {activeTab === 'overview' && (
        <div className="space-y-8">
          <div className="border border-border bg-surface p-6">
            <div className="flex items-center justify-between gap-4 mb-5 flex-wrap">
              <div className="flex items-center gap-2">
                <Link2 size={14} className="text-accent3" />
                <h2 className="font-sans text-sm font-bold text-heading">Linked Odyssey Context</h2>
              </div>
              {linkedProjects.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {linkedProjects.map((project) => (
                    <button
                      key={project.id}
                      type="button"
                      onClick={() => navigate(`/projects/${project.id}`)}
                      className="inline-flex items-center gap-2 px-3 py-2 border border-accent3/30 text-accent3 text-[10px] font-semibold tracking-wider uppercase hover:bg-accent3/5 transition-colors"
                    >
                      <ArrowUpRight size={12} />
                      {project.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {linkedProjects.length === 0 && (
              <div className="border border-dashed border-border bg-surface2/40 px-5 py-6 text-sm text-muted leading-relaxed">
                Link one or more projects to pull their task inventory, deadlines, and recent activity into this thesis workspace. That gives the thesis page live execution context while keeping direct routes back to each project for edits and follow-through.
              </div>
            )}

            {linkedProjects.length > 0 && linkedContextLoading && (
              <div className="border border-border bg-surface2/40 px-5 py-6 text-sm text-muted">
                Loading linked project tasks and activity...
              </div>
            )}

            {linkedProjects.length > 0 && linkedContextError && (
              <div className="border border-danger/30 bg-danger/5 px-5 py-6 text-sm text-danger">
                {linkedContextError}
              </div>
            )}

            {linkedProjects.length > 0 && !linkedContextLoading && !linkedContextError && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-px border border-border bg-border sm:grid-cols-2 xl:grid-cols-4">
                  {linkedContextCards.map((card) => (
                    <div key={card.id} className="bg-surface">
                      <div
                        className="p-4"
                      >
                        <p className="mb-1.5 text-[10px] font-mono tracking-[0.18em] uppercase text-muted">{card.label}</p>
                        <p className={`text-2xl font-bold ${card.tone}`}>{card.value}</p>
                        <p className="mt-1.5 text-xs leading-relaxed text-muted">{card.detail}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="border border-border bg-surface p-5">
            <div className="mb-3 flex flex-wrap items-start gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <GraduationCap size={14} className="text-accent" />
                  <h2 className="font-sans text-sm font-bold text-heading">Thesis Details</h2>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(20rem,0.85fr)]">
              <div>
                <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div className="relative" data-thesis-selector="true">
                    <label className="mb-2 block text-[10px] uppercase tracking-[0.2em] text-muted">Department</label>
                    <button
                      type="button"
                      onClick={() => {
                        setDepartmentPickerOpen((current) => !current);
                        setGraduatingQuarterPickerOpen(false);
                        setCitationFormatPickerOpen(false);
                      }}
                      className="flex w-full items-center justify-between gap-3 border border-border bg-surface2 px-4 py-3 text-left text-sm text-heading transition-colors hover:border-accent/35 hover:bg-surface focus:outline-none focus:border-accent"
                    >
                      <span className={`truncate ${department ? 'text-heading' : 'text-muted'}`}>
                        {department || 'Select department'}
                      </span>
                      <ChevronDown
                        size={14}
                        className={`shrink-0 text-accent transition-transform ${departmentPickerOpen ? 'rotate-180' : ''}`}
                      />
                    </button>
                    {departmentPickerOpen && (
                      <div className="absolute left-0 right-0 top-full z-20 mt-2 overflow-hidden border border-border bg-surface shadow-[0_18px_40px_rgba(15,23,42,0.18)]">
                        <div className="max-h-72 overflow-y-auto">
                          {SORTED_THESIS_DEPARTMENT_OPTIONS.map((option) => (
                            <button
                              key={option}
                              type="button"
                              onClick={() => {
                                setThesisDepartment(option);
                                setDepartmentPickerOpen(false);
                              }}
                              className={`flex w-full items-center justify-between px-4 py-3 text-left text-sm transition-colors ${
                                department === option
                                  ? 'bg-accent/10 text-heading'
                                  : 'text-heading hover:bg-surface2'
                              }`}
                            >
                              <span className="pr-4">{option}</span>
                              {department === option && <Check size={14} className="shrink-0 text-accent" />}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="relative" data-thesis-selector="true">
                    <label className="mb-2 block text-[10px] uppercase tracking-[0.2em] text-muted">Graduating Quarter</label>
                    <button
                      type="button"
                      onClick={() => {
                        setGraduatingQuarterPickerOpen((current) => !current);
                        setDepartmentPickerOpen(false);
                        setCitationFormatPickerOpen(false);
                      }}
                      className="flex w-full items-center justify-between gap-3 border border-border bg-surface2 px-4 py-3 text-left text-sm text-heading transition-colors hover:border-accent/35 hover:bg-surface focus:outline-none focus:border-accent"
                    >
                      <span className={`truncate ${graduatingQuarter ? 'text-heading' : 'text-muted'}`}>
                        {graduatingQuarter || 'Select quarter'}
                      </span>
                      <ChevronDown
                        size={14}
                        className={`shrink-0 text-accent transition-transform ${graduatingQuarterPickerOpen ? 'rotate-180' : ''}`}
                      />
                    </button>
                    {graduatingQuarterPickerOpen && (
                      <div className="absolute left-0 right-0 top-full z-20 mt-2 overflow-hidden border border-border bg-surface shadow-[0_18px_40px_rgba(15,23,42,0.18)]">
                        <div className="max-h-72 overflow-y-auto">
                          {THESIS_GRADUATING_QUARTER_OPTIONS.map((option) => (
                            <button
                              key={option}
                              type="button"
                              onClick={() => {
                                setThesisGraduatingQuarter(option);
                                setGraduatingQuarterPickerOpen(false);
                              }}
                              className={`flex w-full items-center justify-between px-4 py-3 text-left text-sm transition-colors ${
                                graduatingQuarter === option
                                  ? 'bg-accent/10 text-heading'
                                  : 'text-heading hover:bg-surface2'
                              }`}
                            >
                              <span>{option}</span>
                              {graduatingQuarter === option && <Check size={14} className="shrink-0 text-accent" />}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="relative" data-thesis-selector="true">
                    <label className="mb-2 block text-[10px] uppercase tracking-[0.2em] text-muted">Citation Format</label>
                    <button
                      type="button"
                      onClick={() => {
                        setCitationFormatPickerOpen((current) => !current);
                        setDepartmentPickerOpen(false);
                        setGraduatingQuarterPickerOpen(false);
                      }}
                      className="flex w-full items-center justify-between gap-3 border border-border bg-surface2 px-4 py-3 text-left text-sm text-heading transition-colors hover:border-accent/35 hover:bg-surface focus:outline-none focus:border-accent"
                    >
                      <span className="truncate text-heading">
                        {BIBLIOGRAPHY_FORMAT_LABELS[citationFormat]}
                      </span>
                      <ChevronDown
                        size={14}
                        className={`shrink-0 text-accent transition-transform ${citationFormatPickerOpen ? 'rotate-180' : ''}`}
                      />
                    </button>
                    {citationFormatPickerOpen && (
                      <div className="absolute left-0 right-0 top-full z-20 mt-2 overflow-hidden border border-border bg-surface shadow-[0_18px_40px_rgba(15,23,42,0.18)]">
                        <div className="max-h-72 overflow-y-auto">
                          {THESIS_CITATION_FORMAT_OPTIONS.map((option) => (
                            <button
                              key={option}
                              type="button"
                              onClick={() => {
                                setThesisCitationFormat(option);
                                setCitationFormatPickerOpen(false);
                              }}
                              className={`flex w-full items-center justify-between px-4 py-3 text-left text-sm transition-colors ${
                                citationFormat === option
                                  ? 'bg-accent/10 text-heading'
                                  : 'text-heading hover:bg-surface2'
                              }`}
                            >
                              <span>{BIBLIOGRAPHY_FORMAT_LABELS[option]}</span>
                              {citationFormat === option && <Check size={14} className="shrink-0 text-accent" />}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                <div className="mb-3 border border-border bg-surface2/50 px-4 py-3">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted">Recommended Citation Style</p>
                      <p className="mt-1 text-sm text-heading">
                        {departmentCitationRecommendation
                          ? `${BIBLIOGRAPHY_FORMAT_LABELS[departmentCitationRecommendation.format]} suggested for ${department}.`
                          : 'Select a department or program to get a suggested citation style.'}
                      </p>
                      {departmentCitationRecommendation && (
                        <p className="mt-1 text-xs leading-relaxed text-muted">{departmentCitationRecommendation.note}</p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2 lg:justify-end">
                    {citationReferencePdfLinks.map((guide) => (
                      <button
                        key={guide.id}
                        type="button"
                        onClick={() => setCitationReferenceViewer({
                          title: formatCitationReferenceGuideLabel(guide.fileName),
                          url: guide.url,
                        })}
                        className="inline-flex items-center gap-2 border border-border bg-surface px-3 py-2 text-xs text-heading transition-colors hover:border-accent/35 hover:bg-surface"
                      >
                        <FileText size={12} className="text-accent" />
                        <span>{formatCitationReferenceGuideLabel(guide.fileName)}</span>
                        <ArrowUpRight size={12} className="text-muted" />
                      </button>
                    ))}
                    </div>
                  </div>
                </div>
                <label className="block text-[10px] tracking-[0.2em] uppercase text-muted mb-2">Working Description</label>
                <textarea
                  value={description}
                  onChange={(event) => setThesisDescription(event.target.value)}
                  rows={4}
                  className="w-full px-4 py-3 bg-surface2 border border-border text-sm text-heading leading-relaxed resize-y focus:outline-none focus:border-accent/40"
                />
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Users size={14} className="text-accent2" />
                    <label className="text-[10px] tracking-[0.2em] uppercase text-muted">Members</label>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted">
                      {members.length} total
                    </span>
                    <button
                      type="button"
                      onClick={addThesisMember}
                      className="inline-flex h-6 items-center gap-2 border border-accent bg-accent px-2 text-surface transition-colors hover:bg-accent/90 focus:outline-none focus:ring-1 focus:ring-accent/35"
                      aria-label="Add member"
                    >
                      <span className="inline-flex h-6 w-4 items-center justify-center">
                        <Plus size={11} />
                      </span>
                      <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-surface">
                        Add Member
                      </span>
                    </button>
                  </div>
                </div>
                <div className="space-y-3">
                  {members.map((member, index) => (
                    <div key={member.id} className="border border-border bg-surface2 p-3">
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_14rem_auto]">
                        <input
                          type="text"
                          value={member.name}
                          onChange={(event) => updateThesisMember(member.id, 'name', event.target.value)}
                          placeholder={`Member ${index + 1} name`}
                          className="w-full border border-border bg-surface px-3 py-2 text-sm text-heading outline-none focus:border-accent"
                        />
                        <div className="relative" data-thesis-selector="true">
                          {memberRoleEditingId === member.id ? (
                            <input
                              type="text"
                              value={member.role}
                              autoFocus
                              onChange={(event) => updateThesisMember(member.id, 'role', event.target.value)}
                              onBlur={() => setMemberRoleEditingId((current) => (current === member.id ? null : current))}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === 'Escape') {
                                  setMemberRoleEditingId(null);
                                }
                              }}
                              placeholder="Custom role"
                              className="w-full border border-accent bg-surface px-3 py-2 text-sm text-heading outline-none"
                            />
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => setMemberRolePickerOpenId((current) => (current === member.id ? null : member.id))}
                                onDoubleClick={() => {
                                  setMemberRolePickerOpenId(null);
                                  setMemberRoleEditingId(member.id);
                                }}
                                title="Double-click to type a custom role"
                                className="flex w-full items-center justify-between gap-3 border border-border bg-surface px-3 py-2 text-left text-sm text-heading transition-colors hover:border-accent/35 hover:bg-surface2 focus:outline-none focus:border-accent"
                              >
                                <span className="truncate">{member.role || 'Select role'}</span>
                                <ChevronDown
                                  size={14}
                                  className={`shrink-0 text-accent transition-transform ${memberRolePickerOpenId === member.id ? 'rotate-180' : ''}`}
                                />
                              </button>
                              {memberRolePickerOpenId === member.id && (
                                <div className="absolute left-0 right-0 top-full z-20 mt-2 overflow-hidden border border-border bg-surface shadow-[0_18px_40px_rgba(15,23,42,0.18)]">
                                  <div className="border-b border-border bg-surface2/70 px-3 py-2 text-[10px] font-mono uppercase tracking-[0.16em] text-muted">
                                    Select role or double-click field to type
                                  </div>
                                  <div className="max-h-64 overflow-y-auto">
                                    {THESIS_MEMBER_ROLE_SUGGESTIONS.map((role) => (
                                      <button
                                        key={role}
                                        type="button"
                                        onClick={() => {
                                          updateThesisMember(member.id, 'role', role);
                                          setMemberRolePickerOpenId(null);
                                        }}
                                        className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors ${
                                          member.role === role
                                            ? 'bg-accent/10 text-heading'
                                            : 'text-heading hover:bg-surface2'
                                        }`}
                                      >
                                        <span>{role}</span>
                                        {member.role === role && <Check size={14} className="text-accent" />}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => removeThesisMember(member.id)}
                          className="inline-flex items-center justify-center border border-border bg-surface px-3 py-2 text-muted transition-colors hover:bg-surface hover:text-heading"
                          aria-label={`Remove ${member.name || `member ${index + 1}`}`}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-5">
              <div className="flex items-center justify-between gap-4 mb-2">
                <span className="text-[10px] tracking-[0.18em] uppercase text-muted font-mono">Thesis Progress</span>
                <span className="text-sm font-semibold text-heading">{overallProgress}%</span>
              </div>
              <div className="h-3 bg-surface2 border border-border overflow-hidden">
                <div className="h-full" style={getMilestoneProgressFillStyle(overallProgress)} />
              </div>
            </div>
          </div>

        </div>
      )}

      {activeTab === 'milestones' && (
        <div className="space-y-8">
          <div className="border border-border bg-surface p-6">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <CheckCircle2 size={14} className="text-accent2" />
                <h2 className="font-sans text-sm font-bold text-heading">Milestones</h2>
              </div>
              <button
                type="button"
                onClick={handleAddMilestone}
                className="inline-flex items-center gap-2 border border-accent/30 bg-accent/8 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-accent transition-colors hover:bg-accent/12"
              >
                <Plus size={13} />
                Add Milestone
              </button>
            </div>
            <p className="mb-5 text-xs leading-relaxed text-muted">
              New thesis workspaces start with the standard milestone set. Open any card to edit it fully, or add custom milestones for extra gates and submissions.
            </p>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
              {milestones.map((item, milestoneIndex) => {
                const nextPendingTask = getMilestoneNextPendingTask(item);
                const completedTaskCount = getMilestoneCompletedTaskCount(item);
                const eligibleTaskCount = getMilestoneEligibleTaskCount(item);
                const hasNextMilestone = milestoneIndex < milestones.length - 1;
                const wrapsToNextRow = hasNextMilestone && (milestoneIndex + 1) % 4 === 0;
                return (
                <div
                  key={item.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedMilestoneId(item.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setSelectedMilestoneId(item.id);
                    }
                  }}
                  className={`thesis-milestone-card ${item.status === 'complete' ? 'thesis-milestone-card--complete' : ''} flex min-h-[15.5rem] cursor-pointer flex-col border border-border p-4 text-left transition-[background-color,border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-accent/30 focus:outline-none focus:ring-1 focus:ring-accent/35`}
                >
                  <div className="mb-3 flex items-center justify-between gap-3 text-[10px] font-mono uppercase tracking-[0.16em] text-muted">
                    <div className="inline-flex items-center gap-2">
                      <span className="inline-flex h-7 min-w-7 items-center justify-center border border-border bg-surface2/70 px-2 text-heading">
                        {String(milestoneIndex + 1).padStart(2, '0')}
                      </span>
                      <span>Step</span>
                    </div>
                    {hasNextMilestone && (
                      <div className="hidden xl:inline-flex items-center gap-2 text-muted">
                        <span className="h-px w-8 bg-border" />
                        {wrapsToNextRow ? <CornerDownLeft size={12} /> : <ArrowRight size={12} />}
                      </div>
                    )}
                  </div>
                  <div className="mb-3 flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-heading">{item.label}</p>
                      <p className="mt-1 text-xs leading-relaxed text-muted">{item.note || 'No milestone summary added yet.'}</p>
                    </div>
                    <span className={`shrink-0 px-2 py-1 border text-[10px] font-mono uppercase ${statusTone(item.status)}`}>
                      {item.status.replace('_', ' ')}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-[11px] text-muted">
                    <div>
                      <p className="font-mono uppercase tracking-[0.16em]">Start</p>
                      <p className="mt-1 text-heading">{formatLongDate(item.startDate)}</p>
                    </div>
                    <div>
                      <p className="font-mono uppercase tracking-[0.16em]">Due</p>
                      <p className="mt-1 text-heading">{formatLongDate(item.due)}</p>
                    </div>
                  </div>
                  <div className="mt-auto pt-4">
                    <div className="thesis-milestone-card-panel mb-3 border border-border px-3 py-3">
                      {nextPendingTask ? (
                        <div className="flex items-start gap-3">
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              toggleMilestoneTaskCompletion(item.id, nextPendingTask.id);
                            }}
                            className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center border border-accent2/35 bg-surface text-accent2 transition-colors hover:bg-accent2/10"
                            aria-label={`Mark ${nextPendingTask.label} complete`}
                          >
                            <Check size={13} />
                          </button>
                          <div className="min-w-0">
                            <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted">Next sub-task</p>
                            <p className="mt-1 text-xs leading-relaxed text-heading">{nextPendingTask.label}</p>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-start gap-3">
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              toggleMilestoneCompletionWithoutTasks(item.id);
                            }}
                            className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center border border-accent2/35 bg-surface text-accent2 transition-colors hover:bg-accent2/10"
                            aria-label={item.status === 'complete' ? 'Mark milestone incomplete' : 'Mark milestone complete'}
                          >
                            <Check size={13} />
                          </button>
                          <div className="min-w-0">
                            <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted">Completion</p>
                            <p className="mt-1 text-xs leading-relaxed text-heading">
                              {item.status === 'complete' ? 'Marked complete. Click to reset if needed.' : 'No sub-tasks. Click the check to mark this milestone complete.'}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="mb-2 flex items-center justify-between text-[11px] text-muted">
                      <span>{item.progress}% complete</span>
                      <span>{eligibleTaskCount > 0 ? `${completedTaskCount}/${eligibleTaskCount} tasks` : 'Direct completion'}</span>
                      <span>{DEFAULT_THESIS_MILESTONE_IDS.has(item.id) ? 'Default' : 'Custom'}</span>
                    </div>
                    <div className="h-2 bg-surface border border-border overflow-hidden">
                      <div className="h-full" style={getMilestoneProgressFillStyle(item.progress)} />
                    </div>
                  </div>
                </div>
              );})}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'sources' && (
        <>
        <div className="space-y-8">
          {sourceIntakeOpen && (
          <div className="border border-border bg-surface p-6 xl:p-8">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between mb-6">
              <div>
                <div className="flex items-center gap-2">
                  <Upload size={14} className="text-accent" />
                  <h2 className="font-sans text-sm font-bold text-heading">Source Intake</h2>
                </div>
                <p className="text-sm text-muted mt-2 max-w-3xl">
                  Work left to right through source acquisition, citation capture, and thesis routing. Each required follow-up field appears only after the previous intake decision is made.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  resetSourceIntake();
                  setSourceIntakeOpen(false);
                }}
                className="inline-flex h-10 items-center gap-2 border border-border bg-surface px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted transition-colors hover:bg-surface2 hover:text-heading"
              >
                <X size={14} />
                Close Intake
              </button>
            </div>

            <div className="mb-6 border border-border bg-surface2/50 px-5 py-4">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div className="max-w-3xl">
                  <p className="text-[10px] tracking-[0.18em] uppercase text-muted font-mono">Citation Reference Guide</p>
                  <h3 className="mt-1 text-sm font-semibold text-heading">
                    Open the NPS {BIBLIOGRAPHY_FORMAT_LABELS[citationFormat]} guide and use one working example
                  </h3>
                  <p className="mt-2 text-xs leading-relaxed text-muted">
                    Use the PDF for the full rules. The short example below is just a quick pattern to copy while you fill in the source fields.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 xl:max-w-[28rem] xl:justify-end">
                  {citationReferencePdfLinks.map((guide) => (
                    <button
                      key={guide.id}
                      type="button"
                      onClick={() => setCitationReferenceViewer({
                        title: formatCitationReferenceGuideLabel(guide.fileName),
                        url: guide.url,
                      })}
                      className="inline-flex items-center gap-2 border border-border bg-surface px-3 py-2 text-xs text-heading transition-colors hover:border-accent/35 hover:bg-surface"
                    >
                      <FileText size={12} className="text-accent" />
                      <span>{formatCitationReferenceGuideLabel(guide.fileName)}</span>
                      <ArrowUpRight size={12} className="text-muted" />
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-4 border border-border bg-surface px-4 py-4">
                <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted">Quick Example</p>
                <p className="mt-1 text-sm font-semibold text-heading">{citationReferenceUiExample.title}</p>
                <pre className="mt-3 whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-muted">
                  {citationReferenceUiExample.reference}
                </pre>
                {citationReferenceUiExample.inText && (
                  <p className="mt-3 text-xs text-muted">
                    In text: <span className="font-mono text-heading">{citationReferenceUiExample.inText}</span>
                  </p>
                )}
                {citationReferenceUiExample.note && (
                  <p className="mt-2 text-xs text-muted">{citationReferenceUiExample.note}</p>
                )}
              </div>
            </div>

            <div className="sticky top-0 z-20 mb-6 border border-border bg-surface/95 px-5 py-4 backdrop-blur">
              <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                <div>
                  <p className="text-[10px] tracking-[0.18em] uppercase text-muted font-mono">Source entry progress</p>
                  <p className="mt-1 text-sm font-semibold text-heading">{sourceNextRequirement}</p>
                </div>
                <div className="text-sm font-semibold text-heading">
                  {sourceProgressPercent}% complete
                </div>
              </div>
              <div className="mt-3 h-3 overflow-hidden border border-border bg-surface">
                <div
                  className="h-full bg-[linear-gradient(90deg,var(--color-accent),var(--color-accent2))] transition-[width] duration-300"
                  style={{ width: `${sourceProgressPercent}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-muted">
                {sourceCompletedStepCount} of {sourceFlowSteps.length} intake steps complete.
              </p>
            </div>

            <div className="space-y-4">
                <div className="border border-border bg-surface2/40 p-5">
                  <div className="flex items-center justify-between gap-4 mb-4">
                    <div>
                      <p className="text-[10px] tracking-[0.18em] uppercase text-muted font-mono">Step 01</p>
                      <h3 className="text-sm font-semibold text-heading mt-1">Choose How The Source Enters</h3>
                    </div>
                    <span className="text-[10px] uppercase tracking-[0.18em] text-muted font-mono">{selectedSourceMethod.label}</span>
                  </div>
                  <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                    {sourceIntakeMethods.map((method) => {
                      const active = method.id === sourceIntakeMethod;
                      return (
                        <button
                          key={method.id}
                          type="button"
                          onClick={() => setSourceIntakeMethod(method.id)}
                          className={`border px-4 py-3 text-left transition-colors ${
                            active
                              ? 'border-accent bg-accent/10'
                              : 'border-border bg-surface hover:bg-surface2/70'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-semibold text-heading">{method.label}</p>
                            {active && <Check size={12} className="text-accent" />}
                          </div>
                          <p className="mt-2 text-[11px] text-muted">{method.hint}</p>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="border border-border bg-surface2/40 p-5">
                  <div className="flex items-center justify-between gap-4 mb-4">
                    <div>
                      <p className="text-[10px] tracking-[0.18em] uppercase text-muted font-mono">Step 02</p>
                      <h3 className="text-sm font-semibold text-heading mt-1">Classify The Source Type</h3>
                    </div>
                    <span className="text-[10px] uppercase tracking-[0.18em] text-muted font-mono">Required for bibliography fields</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                    {sourceIntakeKinds.map((kind) => {
                      const active = kind.id === sourceIntakeKind;
                      const recommended = kind.recommendedMethods.includes(sourceIntakeMethod);
                      return (
                        <button
                          key={kind.id}
                          type="button"
                          onClick={() => setSourceIntakeKind(kind.id)}
                          className={`border p-4 text-left transition-colors ${
                            active
                              ? 'border-accent bg-accent/10'
                              : 'border-border bg-surface hover:bg-surface2/70'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-semibold text-heading">{kind.label}</p>
                            <div className="flex items-center gap-2">
                              <span className="border border-border bg-surface2 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-heading font-mono">
                                {kind.bibtexTarget}
                              </span>
                              <span className={`text-[10px] uppercase tracking-[0.18em] font-mono ${
                                recommended ? 'text-accent2' : 'text-muted'
                              }`}>
                                {recommended ? 'Best fit' : 'Allowed'}
                              </span>
                            </div>
                          </div>
                          <p className="text-xs text-muted mt-2 leading-relaxed">{kind.hint}</p>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className={`border p-5 ${sourceIntakeKind ? 'border-border bg-surface2/40' : 'border-dashed border-border bg-surface2/20'}`}>
                  <div className="flex items-center justify-between gap-4 mb-4">
                    <div>
                      <p className="text-[10px] tracking-[0.18em] uppercase text-muted font-mono">Step 03</p>
                      <h3 className="text-sm font-semibold text-heading mt-1">Attach The Source Record</h3>
                    </div>
                    <span className="text-[10px] uppercase tracking-[0.18em] text-muted font-mono">
                      {sourceIntakeMethod === 'url' ? 'URL capture' : sourceIntakeMethod === 'pdf' ? 'PDF upload' : 'Manual notes'}
                    </span>
                  </div>
                  <div className="space-y-4">
                    {!sourceIntakeKind && (
                      <p className="text-sm text-muted">Choose the NPS bibliography shape first or let Odyssey infer whether this should behave like an article, proceedings paper, book, report, thesis, manual, or `@misc` web source.</p>
                    )}
                      {sourceIntakeMethod === 'url' && (
                        <div className="space-y-2">
                          <label htmlFor="source-url" className="text-xs font-semibold uppercase tracking-[0.18em] text-muted font-mono">Source URL</label>
                          <input
                            id="source-url"
                            type="url"
                            value={sourceUrl}
                            onChange={(event) => setSourceUrl(event.target.value)}
                            placeholder="https://doi.org/... or https://archive.org/..."
                            className="w-full border border-border bg-surface px-4 py-3 text-sm text-heading placeholder:text-muted/70 outline-none focus:border-accent"
                          />
                          <p className="text-xs text-muted">Use the landing page, DOI resolver, archive snapshot, or repository page you want cited later in the thesis bibliography.</p>
                          {urlAutofillStatus === 'parsing' && (
                            <div className="border border-accent/30 bg-accent/5 px-4 py-3 text-sm text-heading">
                              <div className="flex items-center gap-2">
                                <Loader2 size={14} className="animate-spin text-accent" />
                                Inspecting the URL, extracting bibliography metadata, and inferring the source type...
                              </div>
                            </div>
                          )}
                          {urlAutofillStatus === 'error' && urlAutofillError && (
                            <div className="border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
                              {urlAutofillError}
                            </div>
                          )}
                          {parsedUrlSource && urlAutofillStatus === 'ready' && (
                            <div className="border border-accent2/30 bg-accent2/5 px-4 py-4">
                              <div className="flex items-start justify-between gap-4">
                                <div>
                                  <p className="text-[10px] uppercase tracking-[0.18em] text-accent2 font-mono">URL Autofill Ready</p>
                                  <p className="text-sm font-semibold text-heading mt-1">
                                    {parsedUrlSource.title || sourceUrl}
                                  </p>
                                  <p className="text-xs text-muted mt-1">
                                    {[
                                      parsedUrlSource.sourceTypeLabel,
                                      parsedUrlSource.credit,
                                      parsedUrlSource.year,
                                      parsedUrlSource.contextField,
                                    ].filter(Boolean).join(' · ') || 'Review the extracted fields below before saving the source.'}
                                  </p>
                                </div>
                                <span className="border border-accent2/30 bg-surface px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-accent2 font-mono">
                                  {parsedUrlSource.sourceTypeLabel || 'Web source'}
                                </span>
                              </div>
                              {(parsedUrlSource.abstract || parsedUrlSource.summary) && (
                                <p className="text-xs text-muted mt-3 leading-relaxed">
                                  {parsedUrlSource.abstract || parsedUrlSource.summary}
                                </p>
                              )}
                              {parsedUrlSource.keywords.length > 0 && (
                                <div className="mt-3 flex flex-wrap gap-2">
                                  {parsedUrlSource.keywords.map((keyword) => (
                                    <span
                                      key={keyword}
                                      className="border border-border bg-surface px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-muted font-mono"
                                    >
                                      {keyword}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {sourceIntakeMethod === 'pdf' && (
                        <div className="space-y-3">
                          <input
                            ref={thesisPdfInputRef}
                            type="file"
                            accept=".pdf,application/pdf"
                            hidden
                            tabIndex={-1}
                            aria-hidden="true"
                            onChange={(event) => {
                              void handlePdfUpload(event.target.files?.[0]);
                              event.target.value = '';
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => thesisPdfInputRef.current?.click()}
                            className="block w-full border border-dashed border-border bg-surface px-4 py-5 text-left cursor-pointer hover:bg-surface2/80 transition-colors"
                          >
                            <span className="block text-sm font-semibold text-heading">Upload PDF</span>
                            <span className="block text-xs text-muted mt-1">Choose a paper, scanned chapter, or exported report for extraction.</span>
                          </button>
                          <div className="border border-border bg-surface px-4 py-3">
                            <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-mono">Selected file</p>
                            <p className="text-sm text-heading mt-1">{uploadedPdfName || 'No PDF selected yet'}</p>
                          </div>
                          {uploadedPdfFile && (
                            <div className="flex flex-wrap gap-3">
                              <button
                                type="button"
                                onClick={() => setPdfFieldCaptureOpen(true)}
                                className="inline-flex items-center gap-2 border border-accent/30 bg-accent/10 px-3 py-2 text-xs font-semibold text-accent transition-colors hover:bg-accent/15"
                              >
                                <FileSearch size={13} />
                                Open PDF Field Mapper
                              </button>
                              <p className="self-center text-xs text-muted">
                                Full-screen mapping lets you drag over the PDF to capture each citation field directly from the source.
                              </p>
                            </div>
                          )}
                          {uploadedPdfFile && intakeCitationPreview && sourceHasMetadata && (
                            <div className="border border-accent2/30 bg-accent2/5 px-4 py-4">
                              <div className="flex items-start justify-between gap-4">
                                <div>
                                  <p className="text-[10px] uppercase tracking-[0.18em] text-accent2 font-mono">Mapped Citation Preview</p>
                                  <p className="mt-1 text-sm font-semibold text-heading">
                                    {sourceTitle.trim() || uploadedPdfName}
                                  </p>
                                  <p className="mt-1 text-xs text-muted">
                                    Confirmed from the PDF field mapper. Any edits below update this citation immediately.
                                  </p>
                                </div>
                                <span className="border border-accent2/30 bg-surface px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-accent2 font-mono">
                                  {bibliographyFormat.toUpperCase()}
                                </span>
                              </div>
                              <div className="mt-3 border border-accent2/20 bg-surface px-4 py-4">
                                <p className="text-sm leading-relaxed text-heading">
                                  {intakeCitationPreview}
                                </p>
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {sourceIntakeMethod === 'manual' && (
                        <div className="space-y-2">
                          <label htmlFor="manual-source" className="text-xs font-semibold uppercase tracking-[0.18em] text-muted font-mono">Notes or source summary</label>
                          <textarea
                            id="manual-source"
                            value={manualSourceText}
                            onChange={(event) => setManualSourceText(event.target.value)}
                            rows={5}
                            placeholder="Paste meeting notes, a transcript excerpt, advisor guidance, or a structured summary of the source."
                            className="w-full border border-border bg-surface px-4 py-3 text-sm text-heading placeholder:text-muted/70 outline-none focus:border-accent resize-y"
                          >
                          </textarea>
                          <p className="text-xs text-muted">Manual intake works for notes, interviews, private documents, or sources that do not begin as a public URL.</p>
                        </div>
                      )}
                  </div>
                </div>

                <div className={`border p-5 ${sourceLocatorValue ? 'border-border bg-surface2/40' : 'border-dashed border-border bg-surface2/20'}`}>
                  <div className="flex items-center justify-between gap-4 mb-4">
                    <div>
                      <p className="text-[10px] tracking-[0.18em] uppercase text-muted font-mono">Step 04</p>
                      <h3 className="text-sm font-semibold text-heading mt-1">Capture Bibliography Metadata</h3>
                    </div>
                    <span className="text-[10px] uppercase tracking-[0.18em] text-muted font-mono">{selectedSourceKind?.label ?? 'Waiting on type'}</span>
                  </div>
                  {!sourceLocatorValue ? (
                    <p className="text-sm text-muted">Add the source record first. Once Odyssey knows what it is ingesting, the required bibliography fields unlock here.</p>
                  ) : (
                    <div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <label className="space-y-2">
                          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted font-mono">Working title</span>
                          <input
                            type="text"
                            value={sourceTitle}
                            onChange={(event) => setSourceTitle(event.target.value)}
                            placeholder="Source title as it should appear in the bibliography"
                            className="w-full border border-border bg-surface px-4 py-3 text-sm text-heading placeholder:text-muted/70 outline-none focus:border-accent"
                          />
                        </label>
                        <div className="space-y-2 md:col-span-2">
                          <CreditFieldEditor
                            value={sourceCredit}
                            label={sourceKindCreditLabel}
                            onChange={(nextValue) => setSourceCredit(normalizeSourceCreditValue(nextValue))}
                          />
                        </div>
                        <label className="space-y-2">
                          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted font-mono">{sourceKindContextLabel}</span>
                          <input
                            type="text"
                            value={sourceContextField}
                            onChange={(event) => setSourceContextField(event.target.value)}
                            placeholder={sourceKindContextLabel}
                            className="w-full border border-border bg-surface px-4 py-3 text-sm text-heading placeholder:text-muted/70 outline-none focus:border-accent"
                          />
                        </label>
                        {sourceIntakeMethod === 'pdf' && (
                          <label className="space-y-2">
                            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted font-mono">Access URL</span>
                            <input
                              type="url"
                              value={sourceAccessUrl}
                              onChange={(event) => setSourceAccessUrl(event.target.value)}
                              placeholder="https://doi.org/... or repository URL"
                              className="w-full border border-border bg-surface px-4 py-3 text-sm text-heading placeholder:text-muted/70 outline-none focus:border-accent"
                            />
                          </label>
                        )}
                        <label className="space-y-2">
                          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted font-mono">Publication date</span>
                          <div className="flex flex-col gap-3 md:flex-row md:items-start">
                            <div className="w-full max-w-[16rem] space-y-2">
                              <input
                                type="text"
                                value={sourceYear}
                                onChange={(event) => setSourceYear(event.target.value)}
                                onBlur={(event) => setSourceYear(normalizePublicationDate(event.target.value, bibliographyFormat))}
                                placeholder={publicationDatePlaceholder}
                                className="w-full border border-border bg-surface px-4 py-3 text-sm text-heading placeholder:text-muted/70 outline-none focus:border-accent"
                              />
                              <p className="text-[11px] text-muted">
                                Auto-normalized to {bibliographyFormat.toUpperCase()} date styling.
                              </p>
                            </div>
                            <button
                              type="button"
                              disabled={!sourceReadyForQueue || queueRequestPending}
                              onClick={() => {
                                void handleConfirmSource();
                              }}
                              className={`inline-flex min-h-[2.75rem] w-full items-center justify-center self-start border px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.18em] transition-colors md:mt-[1.7rem] md:w-[16rem] ${
                                sourceReadyForQueue && !queueRequestPending
                                  ? 'border-accent bg-accent text-white hover:bg-accent/90'
                                  : 'border-border bg-surface text-muted cursor-not-allowed'
                              }`}
                            >
                              {queueRequestPending ? 'Confirming...' : 'Confirm Citation'}
                            </button>
                          </div>
                        </label>
                      </div>
                      <div className={`mt-4 border px-4 py-4 ${
                        intakeBibliographyReadiness.status === 'ready'
                          ? 'border-accent2/30 bg-accent2/6'
                          : 'border-amber-500/30 bg-amber-500/8'
                      }`}>
                        <div className="flex items-start gap-3">
                          {intakeBibliographyReadiness.status === 'ready' ? (
                            <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-accent2" />
                          ) : (
                            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" />
                          )}
                          <div className="min-w-0">
                            <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted">NPS bibliography readiness</p>
                            <p className="mt-1 text-sm font-semibold text-heading">{intakeBibliographyReadiness.summary}</p>
                            <div className="mt-3 space-y-2 text-xs leading-relaxed text-muted">
                              {intakeBibliographyReadiness.details.map((detail) => (
                                <p key={detail}>{detail}</p>
                              ))}
                            </div>
                            <p className="mt-3 text-xs text-muted">
                              Rendering still requires both pieces: a BibTeX entry in `references.bib` and a matching citation command in a `.tex` file.
                            </p>
                          </div>
                        </div>
                      </div>
                      {(queueNotice || queueError) && (
                        <div className="mt-4 space-y-3">
                          {queueNotice && (
                            <div className="border border-accent2/30 bg-accent2/5 px-4 py-3 text-sm text-accent2">
                              {queueNotice}
                            </div>
                          )}
                          {queueError && (
                            <div className="border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
                              {queueError}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="border border-border bg-surface p-6">
            <div className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-start xl:gap-6">
              <div className="xl:max-w-[42rem] xl:flex-1">
                <div className="flex items-center gap-2">
                  <BookOpen size={14} className="text-accent2" />
                  <h2 className="font-sans text-sm font-bold text-heading">Sources Library</h2>
                </div>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center xl:justify-start">
                <label className="flex h-11 min-w-[19rem] items-center gap-2 border border-border bg-surface px-4 text-xs text-muted">
                  <Search size={16} className="text-accent" />
                  <input
                    type="search"
                    value={librarySearch}
                    onChange={(event) => setLibrarySearch(event.target.value)}
                    placeholder="Search sources"
                    className="w-full bg-transparent text-sm text-heading outline-none placeholder:text-muted"
                  />
                </label>
                <label className="flex h-11 items-center gap-3 text-[10px] uppercase tracking-[0.18em] text-muted font-mono">
                  <span className="shrink-0">Sort by</span>
                  <select
                    value={librarySort}
                    onChange={(event) => setLibrarySort(event.target.value as typeof librarySort)}
                    className="h-11 min-w-40 border border-border bg-surface2 px-4 text-[11px] text-heading outline-none focus:border-accent"
                  >
                    <option value="recent">Recently added</option>
                    <option value="title">Title</option>
                    <option value="year">Year</option>
                    <option value="type">Type</option>
                    <option value="status">Status</option>
                  </select>
                </label>
                <FilterDropdown
                  placeholder="Filter sources"
                  sections={libraryFilterSections}
                  buttonClassName="h-11 min-w-[13rem] px-4 py-0 text-[11px]"
                  onChange={(sectionKey, selected) => {
                    if (sectionKey === 'type') setLibraryTypeFilters(selected);
                    if (sectionKey === 'role') setLibraryRoleFilters(selected);
                    if (sectionKey === 'chapter') setLibraryChapterFilters(selected);
                    if (sectionKey === 'verification') setLibraryVerificationFilters(selected);
                  }}
                />
                {sourceLibrary.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setLibraryEditMode((current) => !current)}
                    className={`inline-flex h-11 items-center gap-2 border px-4 text-[10px] font-semibold tracking-[0.18em] transition-colors ${
                      libraryEditMode
                        ? 'border-accent bg-accent text-[var(--color-accent-fg)]'
                        : 'border-border bg-surface text-muted hover:bg-surface2 hover:text-heading'
                    }`}
                  >
                    <SquarePen size={14} />
                    {libraryEditMode ? 'Done editing' : 'Edit Sources'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSourceIntakeOpen(true)}
                  className="inline-flex h-11 items-center gap-2 border border-accent bg-accent px-4 text-[10px] font-semibold tracking-[0.18em] text-[var(--color-accent-fg)] transition-colors hover:bg-accent/90"
                >
                  <Plus size={14} />
                  Add A Source
                </button>
              </div>
            </div>

            <div className="border border-border bg-surface2/40">
              <div className={`grid gap-4 border-b border-border px-4 py-3 text-[10px] uppercase tracking-[0.18em] text-muted font-mono ${
                libraryEditMode
                  ? 'grid-cols-[minmax(0,1.6fr)_minmax(0,0.75fr)_minmax(0,0.75fr)_minmax(0,0.75fr)_minmax(0,0.75fr)_minmax(0,0.9fr)]'
                  : 'grid-cols-[minmax(0,1.6fr)_minmax(0,0.75fr)_minmax(0,0.75fr)_minmax(0,0.75fr)_minmax(0,0.75fr)]'
              }`}>
                <span>Source</span>
                <span>Type</span>
                <span>Role</span>
                <span>Chapter</span>
                <span>Status</span>
                {libraryEditMode && <span>Actions</span>}
              </div>
              <div className="divide-y divide-border">
                {visibleLibrarySources.map((source) => (
                  <div
                    key={source.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => openLibrarySourceEditor(source.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        openLibrarySourceEditor(source.id);
                      }
                    }}
                    className={`grid gap-4 px-4 py-4 text-left transition-colors hover:bg-surface ${
                      libraryEditMode
                        ? 'grid-cols-[minmax(0,1.6fr)_minmax(0,0.75fr)_minmax(0,0.75fr)_minmax(0,0.75fr)_minmax(0,0.75fr)_minmax(0,0.9fr)]'
                        : 'grid-cols-[minmax(0,1.6fr)_minmax(0,0.75fr)_minmax(0,0.75fr)_minmax(0,0.75fr)_minmax(0,0.75fr)]'
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-heading truncate">{source.title}</p>
                      <p className="text-xs text-muted mt-1 truncate">{source.credit} · {source.year} · {source.venue}</p>
                    </div>
                    <div className="text-xs text-muted uppercase tracking-[0.14em] font-mono">{source.type}</div>
                    <div className="text-xs text-muted">{formatSourceLabel(source.role)}</div>
                    <div className="text-xs text-muted">{formatSourceLabel(source.chapterTarget)}</div>
                    <div>
                      <span className={`inline-flex px-2 py-1 text-[10px] font-mono uppercase border ${
                        source.status === 'analyzed'
                          ? 'border-accent2/30 bg-accent2/10 text-accent2'
                          : source.status === 'tagged'
                            ? 'border-accent3/30 bg-accent3/10 text-accent3'
                            : 'border-border bg-surface text-muted'
                      }`}>
                        {source.status}
                      </span>
                    </div>
                    {libraryEditMode && (
                      <div className="flex items-start gap-2">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            openLibrarySourceEditor(source.id);
                          }}
                          className="inline-flex items-center gap-1.5 border border-border bg-surface px-2.5 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted transition-colors hover:bg-surface2 hover:text-heading"
                        >
                          <SquarePen size={12} />
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            requestDeleteLibrarySource(source);
                          }}
                          className="inline-flex items-center gap-1.5 border border-danger/30 bg-danger/8 px-2.5 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-danger transition-colors hover:bg-danger/12"
                        >
                          <Trash2 size={12} />
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                ))}
                {visibleLibrarySources.length === 0 && (
                  <div className="px-4 py-8 text-sm text-muted">
                    {sourceLibrary.length === 0
                      ? 'No sources have been added to this thesis workspace yet. Upload a PDF, paste a URL, or save a manual citation to populate the library.'
                      : 'No sources match the current search and filter set.'}
                  </div>
                )}
              </div>
            </div>
          </div>

          {editableLibrarySource && selectedLibrarySource && (
            <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm">
              <div className="flex h-screen w-screen flex-col bg-surface">
                <div className="sticky top-0 z-10 border-b border-border bg-surface/95 px-6 py-5 backdrop-blur">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-mono">
                        {getSourceKindBibtexTarget(editableLibrarySource.sourceKind)} · {formatSourceLabel(editableLibrarySource.sourceKind)}
                      </p>
                      <h3 className="mt-1 text-xl font-semibold text-heading">{editableLibrarySource.title}</h3>
                      <p className="mt-2 text-sm text-muted">{formatSourceCreditDisplay(editableLibrarySource.credit)} · {editableLibrarySource.year} · {editableLibrarySource.venue}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={saveSelectedLibrarySourceDraft}
                        disabled={!selectedLibrarySourceDirty}
                        className={`hidden items-center gap-2 border px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] transition-colors md:inline-flex ${
                          selectedLibrarySourceDirty
                            ? 'border-accent bg-accent text-[var(--color-accent-fg)] hover:bg-accent/90'
                            : 'border-border bg-surface2 text-muted'
                        }`}
                        title="Save source edits to the thesis record"
                      >
                        <Check size={14} />
                        {selectedLibrarySourceDirty ? 'Save changes' : 'Saved to thesis'}
                      </button>
                      <button
                        type="button"
                        onClick={() => requestDeleteLibrarySource(selectedLibrarySource)}
                        className="inline-flex items-center gap-2 border border-danger/30 bg-danger/8 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-danger transition-colors hover:bg-danger/12"
                      >
                        <Trash2 size={14} />
                        Delete source
                      </button>
                      <button
                        type="button"
                        onClick={closeSelectedLibrarySourceEditor}
                        className="inline-flex h-10 w-10 items-center justify-center border border-border text-muted transition-colors hover:bg-surface2 hover:text-heading"
                        aria-label="Close source editor"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto px-6 py-6">
                  <div className="space-y-6">
                    <div className="border border-border bg-surface2/40 p-5">
                      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <SquarePen size={14} className="text-accent" />
                          <h4 className="text-sm font-semibold text-heading">Source Metadata</h4>
                        </div>
                        {editableLibrarySource.attachmentStoragePath && (
                          <button
                            type="button"
                            onClick={() => { void handleOpenLibraryAttachment(selectedLibrarySource); }}
                            disabled={libraryAttachmentOpening}
                            className="inline-flex items-center gap-2 border border-accent/30 bg-accent/10 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-accent transition-colors hover:bg-accent/15 disabled:opacity-60"
                          >
                            <FileText size={12} />
                            {libraryAttachmentOpening ? 'Opening PDF...' : 'Open PDF'}
                          </button>
                        )}
                      </div>
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <label className="space-y-2">
                        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted font-mono">Title</span>
                        <input
                          type="text"
                          value={editableLibrarySource.title}
                          onChange={(event) => updateLibrarySourceDraft('title', event.target.value)}
                          className="w-full border border-border bg-surface2 px-4 py-3 text-sm text-heading outline-none focus:border-accent"
                        />
                      </label>
                      <div className="space-y-2 md:col-span-2">
                        <CreditFieldEditor
                          value={editableLibrarySource.credit}
                          label="Credit"
                          onChange={(nextValue) => updateLibrarySourceDraft('credit', normalizeSourceCreditValue(nextValue))}
                        />
                      </div>
                      <label className="space-y-2">
                        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted font-mono">Venue / publisher</span>
                        <input
                          type="text"
                          value={editableLibrarySource.venue}
                          onChange={(event) => updateLibrarySourceDraft('venue', event.target.value)}
                          className="w-full border border-border bg-surface2 px-4 py-3 text-sm text-heading outline-none focus:border-accent"
                        />
                      </label>
                      <label className="space-y-2">
                        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted font-mono">Year</span>
                        <input
                          type="text"
                          value={editableLibrarySource.year}
                          onChange={(event) => updateLibrarySourceDraft('year', event.target.value)}
                          className="w-full border border-border bg-surface2 px-4 py-3 text-sm text-heading outline-none focus:border-accent"
                        />
                      </label>
                    </div>

                        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] xl:items-end">
                          <div>
                            <label className="space-y-2">
                              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted font-mono">Type</span>
                              <select
                                value={editableLibrarySource.type}
                                onChange={(event) => updateLibrarySourceDraft('type', event.target.value as SourceLibraryType)}
                                className="w-full border border-border bg-surface2 px-3 py-2.5 text-sm text-heading outline-none focus:border-accent"
                              >
                                <option value="pdf">PDF</option>
                                <option value="link">Link</option>
                                <option value="book">Book</option>
                                <option value="paper">Paper</option>
                                <option value="report">Report</option>
                                <option value="notes">Notes</option>
                                <option value="dataset">Dataset</option>
                              </select>
                            </label>
                          </div>

                          <label className="space-y-2 block">
                            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted font-mono">Available at</span>
                            <input
                              type="url"
                              value={editableLibrarySource.locator}
                              onChange={(event) => updateLibrarySourceDraft('locator', event.target.value)}
                              placeholder="https://doi.org/... or source URL"
                              className="w-full border border-border bg-surface2 px-4 py-2.5 text-sm text-heading outline-none focus:border-accent"
                            />
                          </label>
                        </div>

                        <label className="mt-4 space-y-2 block">
                      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted font-mono">Thesis use notes</span>
                      <textarea
                        rows={5}
                        value={editableLibrarySource.notes}
                        onChange={(event) => updateLibrarySourceDraft('notes', event.target.value)}
                        className="w-full border border-border bg-surface2 px-4 py-3 text-sm text-heading outline-none focus:border-accent resize-y"
                      >
                      </textarea>
                    </label>
                    </div>
                  </div>

                  <div className="mt-6 border border-border bg-surface2/40 p-5">
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-mono">NPS bibliography readiness</p>
                        <h4 className="mt-1 text-sm font-semibold text-heading">
                          {selectedLibrarySourceReadiness?.summary}
                        </h4>
                      </div>
                    </div>
                    {selectedLibrarySourceReadiness && (
                      <div className={`border px-4 py-4 ${
                        selectedLibrarySourceReadiness.status === 'ready'
                          ? 'border-accent2/30 bg-accent2/6'
                          : 'border-amber-500/30 bg-amber-500/8'
                      }`}>
                        <div className="flex items-start gap-3">
                          {selectedLibrarySourceReadiness.status === 'ready' ? (
                            <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-accent2" />
                          ) : (
                            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" />
                          )}
                          <div className="min-w-0 space-y-2 text-xs leading-relaxed text-muted">
                            {selectedLibrarySourceReadiness.details.map((detail) => (
                              <p key={detail}>{detail}</p>
                            ))}
                            {selectedLibrarySourceReadiness.exactChanges.length > 0 && (
                              <div className="mt-3 space-y-2 border-t border-border/60 pt-3">
                                <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted">Exact changes</p>
                                {selectedLibrarySourceReadiness.exactChanges.map((change) => (
                                  <div key={`${change.field}-${change.reason}`} className="border border-border/70 bg-surface/70 px-3 py-3">
                                    <p className="font-semibold text-heading">{change.label}</p>
                                    <p className="mt-1">{change.reason}</p>
                                    <p className="mt-2 font-mono text-[11px] text-heading break-words">{change.suggestedValue}</p>
                                  </div>
                                ))}
                              </div>
                            )}
                            {Object.keys(selectedLibrarySourceReadiness.autoFixPatch).length > 0 && (
                              <div className="pt-2">
                                <button
                                  type="button"
                                  onClick={() => applyLibrarySourceAutoFix(selectedLibrarySourceReadiness.autoFixPatch)}
                                  className="inline-flex items-center gap-2 border border-accent/30 bg-accent/10 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-accent transition-colors hover:bg-accent/15"
                                >
                                  Apply Odyssey Autofix
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="mt-6 border border-border bg-surface2/40 p-5">
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-mono">Generated Bibliography</p>
                        <h4 className="mt-1 text-sm font-semibold text-heading">Preview and citation output</h4>
                      </div>
                      <div className="flex items-center gap-3">
                        <select
                          value={bibliographyFormat}
                          onChange={(event) => setThesisCitationFormat(event.target.value as BibliographyFormat)}
                          className="border border-border bg-surface px-3 py-2 text-[11px] text-heading outline-none focus:border-accent"
                        >
                          <option value="apa">APA</option>
                          <option value="chicago">Chicago</option>
                          <option value="ieee">IEEE</option>
                          <option value="informs">INFORMS</option>
                          <option value="asme">ASME</option>
                          <option value="aiaa">AIAA</option>
                          <option value="ams">AMS</option>
                        </select>
                        </div>
                    </div>
                    <div className="border border-border bg-surface px-5 py-5">
                      <p className="mb-2 text-[10px] uppercase tracking-[0.18em] text-muted font-mono">{bibliographyFormat.toUpperCase()}</p>
                      <p className="text-sm leading-relaxed text-heading">
                        {formatBibliographyEntry(editableLibrarySource, bibliographyFormat)}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
        </>
      )}

      {activeTab === 'documents' && (
        <div className="space-y-8">
          <div className="border border-border bg-surface p-6 xl:p-8">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between mb-6">
              <div>
                <div className="flex items-center gap-2">
                  <FileText size={14} className="text-accent" />
                  <h2 className="font-sans text-sm font-bold text-heading">Supporting Documents</h2>
                </div>
                <p className="text-sm text-muted mt-2 max-w-3xl">
                  Upload internal notes, drafts, scans, datasets, advisor memos, or any other supporting file. Each document carries a description of what it is and what it contributes to in the thesis, with an optional link back to a source record.
                </p>
              </div>
            </div>

            <input
              ref={thesisDocumentInputRef}
              type="file"
              hidden
              tabIndex={-1}
              aria-hidden="true"
              onChange={(event) => {
                handleDocumentFileSelected(event.target.files?.[0]);
                event.target.value = '';
              }}
            />

            <div className="space-y-6">
              <div ref={thesisDocumentEditorRef} className="border border-border bg-surface2/40 p-5">
                <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-mono">{editingDocumentId ? 'Edit document' : 'Add document'}</p>
                    <h3 className="mt-1 text-sm font-semibold text-heading">
                      {editingDocumentId ? 'Update metadata and source link' : 'Upload and describe the file'}
                    </h3>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {!editingDocumentId && (
                      <button
                        type="button"
                        onClick={() => thesisDocumentInputRef.current?.click()}
                        className="inline-flex items-center gap-2 self-start border border-border bg-surface px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-heading transition-colors hover:bg-surface2"
                      >
                        <Upload size={14} />
                        Upload file
                      </button>
                    )}
                    {editingDocumentId && (
                      <button
                        type="button"
                        onClick={() => {
                          setDocumentNotice(null);
                          setDocumentError(null);
                          resetSupportingDocumentEditor();
                        }}
                        className="inline-flex items-center gap-2 self-start border border-border bg-surface px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-heading transition-colors hover:bg-surface2"
                      >
                        <X size={14} />
                        Cancel edit
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 xl:grid-cols-6">
                  <div className="space-y-2 xl:col-span-2">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted font-mono">
                        {editingDocumentId ? 'Attached file' : 'Selected file'}
                      </span>
                      {!editingDocumentId && uploadedDocumentName && (
                        <button
                          type="button"
                          onClick={() => handleDocumentFileSelected(null)}
                          className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted transition-colors hover:text-heading"
                        >
                          <X size={11} />
                          Clear
                        </button>
                      )}
                    </div>
                    <div className="flex h-[50px] items-center border border-border bg-surface px-4">
                      <p className="w-full truncate text-sm text-heading">
                        {uploadedDocumentName || (editingDocumentId ? 'No attached file name available' : 'No document selected yet')}
                      </p>
                    </div>
                    {editingDocumentId && (
                      <p className="text-xs text-muted">
                        Editing updates the saved metadata and linked source for this upload.
                      </p>
                    )}
                  </div>

                  <label className="block space-y-2 xl:col-span-2">
                    <span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted font-mono">Document title</span>
                    <input
                      type="text"
                      value={documentTitle}
                      onChange={(event) => setDocumentTitle(event.target.value)}
                      placeholder="Advisor memo on methodology constraints"
                      className="w-full border border-border bg-surface px-4 py-3 text-sm text-heading outline-none focus:border-accent"
                    />
                  </label>

                  <label className="block space-y-2 xl:col-span-2">
                    <span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted font-mono">Link to source</span>
                    <select
                      value={documentLinkedSourceId}
                      onChange={(event) => setDocumentLinkedSourceId(event.target.value)}
                      className="w-full border border-border bg-surface px-4 py-3 text-sm text-heading outline-none focus:border-accent"
                    >
                      <option value="">No linked source</option>
                      {sourceLibrary.map((source) => (
                        <option key={source.id} value={source.id}>
                          {source.title}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block space-y-2 xl:col-span-3">
                    <span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted font-mono">What this document is</span>
                    <textarea
                      rows={3}
                      value={documentDescription}
                      onChange={(event) => setDocumentDescription(event.target.value)}
                      placeholder="Describe the file itself so it is useful in the thesis workspace."
                      className="w-full resize-y border border-border bg-surface px-4 py-3 text-sm text-heading outline-none focus:border-accent"
                    >
                    </textarea>
                  </label>

                  <label className="block space-y-2 xl:col-span-3">
                    <span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted font-mono">What it contributes to</span>
                    <textarea
                      rows={3}
                      value={documentContribution}
                      onChange={(event) => setDocumentContribution(event.target.value)}
                      placeholder="Explain how this file informs a chapter, argument, method, or interpretation."
                      className="w-full resize-y border border-border bg-surface px-4 py-3 text-sm text-heading outline-none focus:border-accent"
                    >
                    </textarea>
                  </label>
                </div>

                {(documentNotice || documentError) && (
                  <div className="mt-4 space-y-3">
                    {documentNotice && (
                      <div className="border border-accent2/30 bg-accent2/8 px-4 py-3 text-sm text-accent2">
                        {documentNotice}
                      </div>
                    )}
                    {documentError && (
                      <div className="border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
                        {documentError}
                      </div>
                    )}
                  </div>
                )}

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs text-muted">
                    Saved documents stay searchable in this tab and are exposed to Thesis AI with their metadata and extracted preview when the file can be parsed.
                  </p>
                  <button
                    type="button"
                    onClick={() => { void handleSaveSupportingDocument(); }}
                    disabled={!documentReadyToSave || documentSavePending}
                    className="inline-flex h-11 items-center justify-center gap-2 border border-accent bg-accent px-5 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-accent-fg)] transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {documentSavePending ? <Loader2 size={14} className="animate-spin" /> : editingDocumentId ? <SquarePen size={14} /> : <Upload size={14} />}
                    {editingDocumentId ? 'Save changes' : 'Save document'}
                  </button>
                </div>
              </div>

              <div className="border border-border bg-surface2/40 p-5">
                <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="flex items-center gap-2">
                    <Link2 size={14} className="text-accent2" />
                    <h3 className="text-sm font-semibold text-heading">Saved documents</h3>
                  </div>
                  <label className="flex min-w-[16rem] items-center gap-2 border border-border bg-surface px-3 py-2 text-xs text-muted">
                    <Search size={14} className="text-accent" />
                    <input
                      type="search"
                      value={documentSearch}
                      onChange={(event) => setDocumentSearch(event.target.value)}
                      placeholder="Search documents"
                      className="w-full bg-transparent text-sm text-heading outline-none placeholder:text-muted"
                    />
                  </label>
                </div>

                <div className="space-y-3">
                  {visibleSupportingDocuments.length > 0 ? visibleSupportingDocuments.map((document) => {
                    const linkedSource = document.linkedSourceId
                      ? sourceLibrary.find((source) => source.id === document.linkedSourceId) ?? null
                      : null;
                    const isHighlighted = selectedDocumentId === document.id;
                    const isEditing = editingDocumentId === document.id;
                    return (
                      <div
                        key={document.id}
                        id={`thesis-document-${document.id}`}
                        role="button"
                        tabIndex={0}
                        onClick={() => openSupportingDocumentEditor(document)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            openSupportingDocumentEditor(document);
                          }
                        }}
                        className={`border bg-surface px-4 py-3 text-left transition-colors ${
                          isEditing
                            ? 'border-accent shadow-[inset_0_0_0_1px_rgba(30,58,95,0.22)]'
                            : isHighlighted
                              ? 'border-accent/40 shadow-[inset_0_0_0_1px_rgba(30,58,95,0.18)]'
                              : 'border-border hover:border-accent/30'
                        }`}
                      >
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                              <p className="truncate text-sm font-semibold text-heading">{document.title}</p>
                              <span className="text-[10px] uppercase tracking-[0.18em] text-muted font-mono">{document.addedOn}</span>
                              {isEditing && (
                                <span className="border border-accent/20 bg-accent/8 px-2 py-0.5 text-[10px] font-mono uppercase tracking-[0.14em] text-accent">
                                  Editing
                                </span>
                              )}
                            </div>
                            <p className="mt-0.5 truncate text-xs text-muted">{document.attachmentName}</p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                openSupportingDocumentEditor(document);
                              }}
                              className="inline-flex items-center gap-2 border border-border bg-surface2 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-heading transition-colors hover:bg-surface"
                            >
                              <SquarePen size={12} />
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                setSelectedDocumentId(document.id);
                                updateThesisRoute({ tab: 'documents', document: document.id, source: null });
                                void handleOpenSupportingDocument(document);
                              }}
                              disabled={documentAttachmentOpeningId === document.id}
                              className="inline-flex items-center gap-2 border border-accent/30 bg-accent/10 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-accent transition-colors hover:bg-accent/15 disabled:opacity-60"
                            >
                              {documentAttachmentOpeningId === document.id ? <Loader2 size={12} className="animate-spin" /> : <FileText size={12} />}
                              Open file
                            </button>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                deleteSupportingDocument(document.id);
                              }}
                              className="inline-flex items-center gap-2 border border-danger/30 bg-danger/8 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-danger transition-colors hover:bg-danger/12"
                            >
                              <Trash2 size={12} />
                              Delete
                            </button>
                          </div>
                        </div>

                        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
                          <div className="text-xs leading-relaxed text-muted">
                            <span className="font-semibold text-heading">Description:</span> {document.description}
                          </div>
                          <div className="text-xs leading-relaxed text-muted">
                            <span className="font-semibold text-heading">Contribution:</span> {document.contribution}
                          </div>
                        </div>

                        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted">
                          <span>
                            <span className="font-semibold text-heading">Linked source:</span>{' '}
                            {linkedSource ? linkedSource.title : 'None'}
                          </span>
                          {document.extractedTextPreview && (
                            <span className="max-w-full">
                              <span className="font-semibold text-heading">Text preview:</span>{' '}
                              {truncateResourceText(document.extractedTextPreview, 180)}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  }) : (
                    <div className="border border-dashed border-border bg-surface px-4 py-6 text-sm text-muted">
                      {supportingDocuments.length === 0
                        ? 'No supporting documents yet. Upload files here to preserve non-bibliographic thesis context.'
                        : 'No documents match the current search.'}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'graph' && (
        <Suspense
          fallback={(
            <div className="flex items-center justify-center gap-2 border border-border bg-surface px-6 py-16 text-xs text-muted">
              <Loader2 size={14} className="animate-spin" />
              Loading knowledge workspace…
            </div>
          )}
        >
          <ThesisKnowledgeTab
            sourceLibrary={sourceLibrary}
            supportingDocuments={supportingDocuments}
            linkedProjects={linkedProjects.map((project) => ({
              id: project.id,
              name: project.name,
              description: project.description,
              github_repo: project.github_repo,
              github_repos: project.github_repos,
            }))}
            linkedGoals={linkedGoals.map((goal) => ({
              id: goal.id,
              project_id: goal.project_id,
              title: goal.title,
              description: goal.description ?? null,
              deadline: goal.deadline,
              status: goal.status,
              progress: goal.progress,
              category: goal.category,
              loe: goal.loe,
            }))}
            linkedEvents={linkedEvents.map((event) => ({
              id: event.id,
              project_id: event.project_id,
              source: event.source,
              event_type: event.event_type,
              title: event.title,
              summary: event.summary,
              occurred_at: event.occurred_at,
            }))}
          />
        </Suspense>
      )}

      {activeTab === 'paper' && (
        <Suspense
          fallback={(
            <div className="flex items-center justify-center gap-2 border border-border bg-surface px-6 py-16 text-xs text-muted">
              <Loader2 size={14} className="animate-spin" />
              Loading paper workspace…
            </div>
          )}
        >
          <ThesisPaperTab
            sourceLibrary={sourceLibrary}
            bibliographyFormat={bibliographyFormat}
          />
        </Suspense>
      )}

      {activeTab === 'settings' && (
        <Suspense
          fallback={(
            <div className="flex items-center justify-center gap-2 border border-border bg-surface px-6 py-16 text-xs text-muted">
              <Loader2 size={14} className="animate-spin" />
              Loading thesis settings…
            </div>
          )}
        >
          <ThesisSettingsTab
            paperSnapshotUpdatedAt={paperSnapshot.updatedAt}
            linkedProjects={linkedProjects.map((project) => ({ id: project.id, name: project.name }))}
            workspaceFiles={paperSnapshot.workspace?.files.map((file) => ({ id: file.id, path: file.path })) ?? []}
          />
        </Suspense>
      )}

      {pdfFieldCaptureOpen && uploadedPdfFile && (
        <Suspense
          fallback={(
            <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[rgba(2,6,23,0.96)]">
              <div className="border border-border bg-surface px-5 py-4 text-sm text-muted">
                Opening PDF field mapper...
              </div>
            </div>
          )}
        >
          <PdfFieldCaptureModal
            file={uploadedPdfFile}
            bibliographyFormat={bibliographyFormat}
            values={{
              title: sourceTitle,
              credit: sourceCredit,
              contextField: sourceContextField,
              year: sourceYear,
              locator: sourceAccessUrl,
            }}
            creditLabel={sourceKindCreditLabel}
            contextLabel={sourceKindContextLabel}
            onApply={(captured) => {
              setSourceTitle(captured.title);
              setSourceCredit(normalizeSourceCreditValue(captured.credit));
              setSourceContextField(captured.contextField);
              setSourceYear(captured.year);
              setSourceAccessUrl(captured.locator);
            }}
            onClose={() => setPdfFieldCaptureOpen(false)}
          />
        </Suspense>
      )}

      {citationReferenceViewer && (
        <div className="fixed inset-0 z-[60] flex flex-col bg-[rgba(2,6,23,0.94)]">
          <div className="flex items-center justify-between gap-4 border-b border-border bg-surface px-5 py-4">
            <div className="min-w-0">
              <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted">Citation Reference PDF</p>
              <h3 className="truncate text-sm font-semibold text-heading">{citationReferenceViewer.title}</h3>
            </div>
            <div className="flex items-center gap-2">
              <a
                href={citationReferenceViewer.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 border border-border bg-surface2 px-3 py-2 text-xs text-heading transition-colors hover:bg-surface"
              >
                <ArrowUpRight size={12} className="text-accent" />
                Open in New Tab
              </a>
              <button
                type="button"
                onClick={() => setCitationReferenceViewer(null)}
                className="inline-flex h-10 w-10 items-center justify-center border border-border bg-surface2 text-heading transition-colors hover:bg-surface"
                aria-label="Close citation reference viewer"
              >
                <X size={16} />
              </button>
            </div>
          </div>
          <div className="min-h-0 flex-1 bg-black p-3">
            <iframe
              title={citationReferenceViewer.title}
              src={citationReferenceViewer.url}
              className="h-full w-full border border-border bg-white"
            />
          </div>
        </div>
      )}

      {pendingLibrarySourceDelete && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm"
          onMouseDown={cancelDeleteLibrarySource}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-source-delete-title"
            className="w-full max-w-md border border-border bg-surface shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="border-b border-border bg-surface2 px-5 py-4">
              <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-danger">Confirm Delete</p>
              <h3 id="confirm-source-delete-title" className="mt-1 text-base font-semibold text-heading">
                Delete this source?
              </h3>
            </div>
            <div className="px-5 py-4">
              <p className="text-sm text-muted">
                <span className="font-semibold text-heading">{pendingLibrarySourceDelete.title}</span> will be removed from this thesis source library.
              </p>
              <p className="mt-2 text-sm text-muted">
                This affects linked source references here, but you can still undo it immediately after deletion.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-4">
              <button
                type="button"
                onClick={cancelDeleteLibrarySource}
                className="inline-flex items-center justify-center border border-border bg-surface2 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-heading transition-colors hover:bg-surface"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDeleteLibrarySource}
                className="inline-flex items-center gap-2 border border-danger/30 bg-danger/10 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-danger transition-colors hover:bg-danger/14"
              >
                <Trash2 size={12} />
                Delete Source
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedMilestone && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm"
          onClick={() => setSelectedMilestoneId(null)}
        >
          <div
            className="mx-auto flex h-screen w-full max-w-6xl flex-col bg-surface"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sticky top-0 z-10 border-b border-border bg-surface/95 px-6 py-5 backdrop-blur">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-mono">
                    {DEFAULT_THESIS_MILESTONE_IDS.has(selectedMilestone.id) ? 'Default milestone' : 'Custom milestone'}
                  </p>
                  <h3 className="mt-1 text-xl font-semibold text-heading">{selectedMilestone.label}</h3>
                  <p className="mt-2 text-sm text-muted">
                    Start {formatLongDate(selectedMilestone.startDate)} · Due {formatLongDate(selectedMilestone.due)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleDeleteMilestone(selectedMilestone.id)}
                    className="inline-flex items-center gap-2 border border-danger/30 bg-danger/8 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-danger transition-colors hover:bg-danger/12"
                  >
                    <Trash2 size={14} />
                    Delete milestone
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedMilestoneId(null)}
                    className="inline-flex h-10 w-10 items-center justify-center border border-border text-muted transition-colors hover:bg-surface2 hover:text-heading"
                    aria-label="Close milestone editor"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-6">
              <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
                <div className="space-y-4">
                  <div className="border border-border bg-surface2/40 p-5">
                    <div className="mb-4 flex items-center gap-2">
                      <SquarePen size={14} className="text-accent" />
                      <h4 className="text-sm font-semibold text-heading">Milestone Details</h4>
                    </div>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <label className="space-y-2 md:col-span-2">
                        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted font-mono">Milestone Name</span>
                        <input
                          type="text"
                          value={selectedMilestone.label}
                          onChange={(event) => updateMilestone(selectedMilestone.id, 'label', event.target.value)}
                          className="w-full border border-border bg-surface2 px-4 py-3 text-sm text-heading outline-none focus:border-accent"
                        />
                      </label>
                      <label className="space-y-2">
                        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted font-mono">Start Date</span>
                        <input
                          type="date"
                          value={selectedMilestone.startDate}
                          onChange={(event) => updateMilestone(selectedMilestone.id, 'startDate', event.target.value)}
                          className="w-full border border-border bg-surface2 px-4 py-3 text-sm text-heading outline-none focus:border-accent"
                        />
                      </label>
                      <label className="space-y-2">
                        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted font-mono">Due Date</span>
                        <input
                          type="date"
                          value={selectedMilestone.due}
                          onChange={(event) => updateMilestone(selectedMilestone.id, 'due', event.target.value)}
                          className="w-full border border-border bg-surface2 px-4 py-3 text-sm text-heading outline-none focus:border-accent"
                        />
                      </label>
                      <div className="space-y-3">
                        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted font-mono">Status</span>
                        <div
                          className={`inline-flex min-h-[2.75rem] min-w-[8.5rem] items-center justify-center border px-4 py-2.5 text-xs font-mono uppercase tracking-[0.16em] ${statusTone(selectedMilestone.status)}`}
                        >
                          {selectedMilestone.status.replace('_', ' ')}
                        </div>
                      </div>
                      <div className="space-y-2">
                        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted font-mono">Progress</span>
                        <div className="border border-border bg-surface px-3 py-2.5">
                          <div className="mb-1.5 flex items-center justify-between text-sm text-heading">
                            <span>{selectedMilestone.progress}% complete</span>
                            <span className="text-xs text-muted">
                              {getMilestoneEligibleTaskCount(selectedMilestone) > 0
                                ? `${getMilestoneCompletedTaskCount(selectedMilestone)}/${getMilestoneEligibleTaskCount(selectedMilestone)} tasks complete`
                                : (selectedMilestone.status === 'complete' ? 'Marked complete' : 'Awaiting completion')}
                            </span>
                          </div>
                          <div className="h-2 overflow-hidden border border-border bg-surface2">
                            <div className="h-full" style={getMilestoneProgressFillStyle(selectedMilestone.progress)} />
                          </div>
                        </div>
                      </div>
                      <label className="space-y-2 md:col-span-2">
                        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted font-mono">Summary</span>
                        <textarea
                          value={selectedMilestone.note}
                          onChange={(event) => updateMilestone(selectedMilestone.id, 'note', event.target.value)}
                          rows={2}
                          className="w-full resize-y border border-border bg-surface2 px-4 py-3 text-sm leading-relaxed text-heading outline-none focus:border-accent"
                        />
                      </label>
                    </div>
                  </div>

                  <div className="border border-border bg-surface2/40 p-5">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div>
                        <h4 className="text-sm font-semibold text-heading">Sub-Tasks / Events</h4>
                        <p className="mt-1 text-xs text-muted">Track the concrete work and milestone events that must happen before closeout.</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => addMilestoneTask(selectedMilestone.id)}
                        className="inline-flex items-center gap-1.5 border border-border bg-surface px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-heading transition-colors hover:bg-surface2"
                      >
                        <Plus size={12} />
                        Add
                      </button>
                    </div>
                    {selectedMilestone.subTasks.length > 0 ? (
                      <div className="space-y-3">
                        {selectedMilestone.subTasks.map((subTask) => (
                          <div
                            key={subTask.id}
                            className="relative"
                            onDragOver={(event) => {
                              if (draggingMilestoneTask?.milestoneId !== selectedMilestone.id || draggingMilestoneTask.taskId === subTask.id) {
                                return;
                              }
                              event.preventDefault();
                              const bounds = event.currentTarget.getBoundingClientRect();
                              const position = event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after';
                              setMilestoneTaskDropTarget({
                                milestoneId: selectedMilestone.id,
                                taskId: subTask.id,
                                position,
                              });
                            }}
                            onDrop={(event) => {
                              event.preventDefault();
                              if (draggingMilestoneTask?.milestoneId !== selectedMilestone.id || draggingMilestoneTask.taskId === subTask.id) {
                                clearMilestoneTaskDragState();
                                return;
                              }
                              const target = milestoneTaskDropTarget;
                              const position = target?.milestoneId === selectedMilestone.id && target.taskId === subTask.id
                                ? target.position
                                : 'before';
                              reorderMilestoneTask(selectedMilestone.id, draggingMilestoneTask.taskId, subTask.id, position);
                              clearMilestoneTaskDragState();
                            }}
                          >
                            {milestoneTaskDropTarget?.milestoneId === selectedMilestone.id
                              && milestoneTaskDropTarget.taskId === subTask.id
                              && milestoneTaskDropTarget.position === 'before'
                              && draggingMilestoneTask?.taskId !== subTask.id && (
                              <div className="absolute inset-x-0 -top-1.5 h-0.5 bg-accent" />
                            )}
                            <div className={`flex items-start gap-2 ${draggingMilestoneTask?.milestoneId === selectedMilestone.id && draggingMilestoneTask.taskId === subTask.id ? 'opacity-60' : ''}`}>
                              <button
                                type="button"
                                draggable
                                onDragStart={(event) => {
                                  setDraggingMilestoneTask({ milestoneId: selectedMilestone.id, taskId: subTask.id });
                                  setMilestoneTaskDropTarget(null);
                                  event.dataTransfer.effectAllowed = 'move';
                                  event.dataTransfer.setData('text/plain', subTask.id);
                                }}
                                onDragEnd={clearMilestoneTaskDragState}
                                className="inline-flex h-11 w-11 shrink-0 items-center justify-center border border-border bg-surface text-muted transition-colors hover:bg-surface2 hover:text-heading cursor-grab active:cursor-grabbing"
                                aria-label="Drag to reorder sub-task"
                                title="Drag to reorder"
                              >
                                <GripVertical size={14} />
                              </button>
                              <button
                                type="button"
                                onClick={() => toggleMilestoneTaskCompletion(selectedMilestone.id, subTask.id)}
                                className={`mt-0.5 inline-flex h-11 w-11 shrink-0 items-center justify-center border transition-colors ${subTask.completed ? 'border-accent2/35 bg-accent2/12 text-accent2' : 'border-border bg-surface text-muted hover:bg-surface2 hover:text-heading'}`}
                                aria-label={subTask.completed ? 'Mark sub-task incomplete' : 'Mark sub-task complete'}
                              >
                                <Check size={14} />
                              </button>
                              <input
                                type="text"
                                value={subTask.label}
                                onChange={(event) => updateMilestoneTaskLabel(selectedMilestone.id, subTask.id, event.target.value)}
                                className={`min-w-0 flex-1 border px-4 py-3 text-sm outline-none focus:border-accent ${subTask.completed ? 'border-accent2/20 bg-accent2/6 text-muted line-through' : 'border-border bg-surface2 text-heading'}`}
                                placeholder="Add a milestone sub-task or event"
                              />
                              <button
                                type="button"
                                onClick={() => removeMilestoneTask(selectedMilestone.id, subTask.id)}
                                className="inline-flex h-11 w-11 items-center justify-center border border-border bg-surface text-muted transition-colors hover:bg-surface2 hover:text-heading"
                                aria-label="Remove sub-task"
                              >
                                <X size={14} />
                              </button>
                            </div>
                            {milestoneTaskDropTarget?.milestoneId === selectedMilestone.id
                              && milestoneTaskDropTarget.taskId === subTask.id
                              && milestoneTaskDropTarget.position === 'after'
                              && draggingMilestoneTask?.taskId !== subTask.id && (
                              <div className="absolute inset-x-0 -bottom-1.5 h-0.5 bg-accent" />
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="border border-dashed border-border bg-surface px-4 py-4 text-sm text-muted">
                        No sub-tasks yet. Add sub-tasks above, or leave this milestone without sub-tasks and use the card checkmark to mark it complete directly.
                      </div>
                    )}
                  </div>

                </div>

                <div className="space-y-6">
                  <div className="border border-border bg-surface2/40 p-5">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <div>
                        <h4 className="text-sm font-semibold text-heading">Who Is Involved</h4>
                        <p className="mt-1 text-xs text-muted">Advisor, reviewer, second reviewer, student, and any other participants.</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => addMilestoneListItem(selectedMilestone.id, 'involvedPeople')}
                        className="inline-flex items-center gap-1.5 border border-border bg-surface px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-heading transition-colors hover:bg-surface2"
                      >
                        <Plus size={12} />
                        Add
                      </button>
                    </div>
                    <div className="space-y-3">
                      {selectedMilestone.involvedPeople.map((person, index) => (
                        <div key={`${selectedMilestone.id}-person-${index}`} className="flex items-start gap-2">
                          <input
                            type="text"
                            value={person}
                            onChange={(event) => updateMilestoneListItem(selectedMilestone.id, 'involvedPeople', index, event.target.value)}
                            className="min-w-0 flex-1 border border-border bg-surface2 px-4 py-3 text-sm text-heading outline-none focus:border-accent"
                            placeholder="Add a person or role"
                          />
                          <button
                            type="button"
                            onClick={() => removeMilestoneListItem(selectedMilestone.id, 'involvedPeople', index)}
                            className="inline-flex h-11 w-11 items-center justify-center border border-border bg-surface text-muted transition-colors hover:bg-surface2 hover:text-heading"
                            aria-label="Remove involved person"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="border border-border bg-surface2/40 p-5">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <div>
                        <h4 className="text-sm font-semibold text-heading">Required Documents</h4>
                        <p className="mt-1 text-xs text-muted">List the documents that must be included with the milestone submission.</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => addMilestoneListItem(selectedMilestone.id, 'requiredDocuments')}
                        className="inline-flex items-center gap-1.5 border border-border bg-surface px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-heading transition-colors hover:bg-surface2"
                      >
                        <Plus size={12} />
                        Add
                      </button>
                    </div>
                    <div className="space-y-3">
                      {selectedMilestone.requiredDocuments.map((requiredDocument, index) => (
                        <div key={`${selectedMilestone.id}-required-${index}`} className="flex items-start gap-2">
                          <input
                            type="text"
                            value={requiredDocument}
                            onChange={(event) => updateMilestoneListItem(selectedMilestone.id, 'requiredDocuments', index, event.target.value)}
                            className="min-w-0 flex-1 border border-border bg-surface2 px-4 py-3 text-sm text-heading outline-none focus:border-accent"
                            placeholder="Add a required document"
                          />
                          <button
                            type="button"
                            onClick={() => removeMilestoneListItem(selectedMilestone.id, 'requiredDocuments', index)}
                            className="inline-flex h-11 w-11 items-center justify-center border border-border bg-surface text-muted transition-colors hover:bg-surface2 hover:text-heading"
                            aria-label="Remove required document"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="border border-border bg-surface2/40 p-5">
                    <div className="mb-4 flex items-center gap-2">
                      <FileText size={14} className="text-accent2" />
                      <h4 className="text-sm font-semibold text-heading">Linked LaTeX Explorer Files</h4>
                    </div>
                    <p className="mb-4 text-xs leading-relaxed text-muted">
                      Link any file from the LaTeX explorer so the milestone explicitly points at the files that support or satisfy it.
                    </p>
                    <div className="mb-4 flex flex-wrap gap-2">
                      {selectedMilestone.linkedFilePaths.length > 0 ? selectedMilestone.linkedFilePaths.map((filePath) => (
                        <span
                          key={`${selectedMilestone.id}-${filePath}`}
                          className="inline-flex items-center border border-accent2/30 bg-accent2/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-accent2"
                        >
                          {filePath}
                        </span>
                      )) : (
                        <span className="text-xs text-muted">No LaTeX explorer files linked yet.</span>
                      )}
                    </div>
                    {latexExplorerFiles.length > 0 ? (
                      <div className="max-h-[34rem] space-y-2 overflow-y-auto pr-1">
                        {renderLinkedFileTreeNodes(latexExplorerFileTree)}
                      </div>
                    ) : (
                      <div className="border border-dashed border-border bg-surface px-4 py-5 text-sm text-muted">
                        No LaTeX explorer files are available yet. Add files in the thesis paper explorer first, then link them here.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
