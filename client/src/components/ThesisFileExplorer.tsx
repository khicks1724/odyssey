import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Trash2,
  X,
} from 'lucide-react';
import {
  createThesisWorkspaceFile,
  getThesisWorkspaceActiveFile,
  normalizeThesisWorkspacePath,
  type ThesisWorkspace,
  type ThesisWorkspaceFile,
  type ThesisWorkspaceFolder,
} from '../lib/thesis-paper';
import {
  EXPLORER_TEMPLATE_DEFINITIONS,
  type ExplorerTemplateDefinition,
} from '../generated/explorer-templates';

type ExplorerDraftMode = 'new-file' | 'new-folder' | 'rename';

interface ExplorerDraftState {
  mode: ExplorerDraftMode;
  targetKind: 'file' | 'folder' | null;
  targetId: string | null;
  targetPath: string | null;
  parentPath: string;
  value: string;
}

interface ExplorerNode {
  kind: 'file' | 'folder';
  id: string;
  name: string;
  path: string;
  children: ExplorerNode[];
}

interface ExplorerMoveState {
  kind: 'file' | 'folder';
  id: string;
  name: string;
  path: string;
}

interface ExplorerMoveValidation {
  ok: boolean;
  nextPath?: string;
  error?: string;
  noOp?: boolean;
}

interface ExplorerImportedFile {
  path: string;
  content: string;
  encoding: 'utf-8' | 'base64';
  mimeType: string | null;
}

interface ExplorerImportedDrop {
  files: ExplorerImportedFile[];
  folders: string[];
  rootNames: string[];
}

type DataTransferItemWithEntry = DataTransferItem & {
  webkitGetAsEntry?: () => FileSystemEntry | null;
};

interface ThesisFileExplorerProps {
  collapsed: boolean;
  workspace: ThesisWorkspace;
  activeFileId: string | null;
  selectedNodeId: string | null;
  savedFileIds: ReadonlySet<string>;
  onOpenFile: (fileId: string) => void;
  onWorkspaceChange: (
    workspace: ThesisWorkspace,
    options?: {
      openFileId?: string | null;
      selectedNodeId?: string | null;
    },
  ) => void;
  onSelectedNodeIdChange: (nodeId: string | null) => void;
  onToggleCollapsed: () => void;
  onDeleteSelectionSnapshot?: (
    workspace: ThesisWorkspace,
    options: {
      selectedNodeId: string | null;
    },
  ) => void;
}

type ExplorerToolbarTooltipTone = 'default';

const THESIS_EXPLORER_OPEN_FOLDERS_STORAGE_KEY = 'odyssey-thesis-explorer-open-folders';

function getParentPath(path: string) {
  const segments = path.split('/');
  segments.pop();
  return segments.join('/');
}

function getFolderNodeId(path: string) {
  return `folder:${path}`;
}

function splitFileName(name: string) {
  const dotIndex = name.lastIndexOf('.');
  if (dotIndex <= 0) return { base: name, extension: '' };
  return {
    base: name.slice(0, dotIndex),
    extension: name.slice(dotIndex),
  };
}

function buildExplorerTree(workspace: ThesisWorkspace) {
  const root: ExplorerNode[] = [];
  const folderMap = new Map<string, ExplorerNode>();

  const ensureFolderNode = (folderPath: string) => {
    if (folderMap.has(folderPath)) return folderMap.get(folderPath)!;

    const segments = folderPath.split('/');
    const folderName = segments[segments.length - 1] ?? folderPath;
    const node: ExplorerNode = {
      kind: 'folder',
      id: getFolderNodeId(folderPath),
      name: folderName,
      path: folderPath,
      children: [],
    };

    const parentPath = getParentPath(folderPath);
    if (parentPath) {
      ensureFolderNode(parentPath).children.push(node);
    } else {
      root.push(node);
    }
    folderMap.set(folderPath, node);
    return node;
  };

  for (const folder of workspace.folders) {
    ensureFolderNode(folder.path);
  }

  for (const file of workspace.files) {
    const filePath = normalizeThesisWorkspacePath(file.path);
    const fileName = filePath.split('/').pop() ?? filePath;
    const parentPath = getParentPath(filePath);
    const node: ExplorerNode = {
      kind: 'file',
      id: file.id,
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

  const sortNodes = (nodes: ExplorerNode[]) => {
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

function addExplorerFolderAncestors(folderMap: Map<string, ThesisWorkspaceFolder>, folderPath: string) {
  const segments = folderPath.split('/');
  for (let index = 1; index <= segments.length; index += 1) {
    const ancestorPath = segments.slice(0, index).join('/');
    if (!folderMap.has(ancestorPath)) {
      folderMap.set(ancestorPath, { id: `folder-${ancestorPath}`, path: ancestorPath });
    }
  }
}

function uniquePath(basePath: string, reserved: Set<string>) {
  if (!reserved.has(basePath)) return basePath;
  const fileName = basePath.split('/').pop() ?? basePath;
  const parentPath = getParentPath(basePath);
  const { base, extension } = splitFileName(fileName);
  let index = 2;
  while (true) {
    const candidateName = `${base} ${index}${extension}`;
    const candidatePath = parentPath ? `${parentPath}/${candidateName}` : candidateName;
    if (!reserved.has(candidatePath)) return candidatePath;
    index += 1;
  }
}

function rebuildWorkspace(
  files: ThesisWorkspaceFile[],
  folders: ThesisWorkspaceFolder[],
  activeFileId: string | null,
) {
  const folderMap = new Map<string, ThesisWorkspaceFolder>();
  for (const folder of folders) {
    folderMap.set(folder.path, folder);
  }
  for (const file of files) {
    const parentPath = getParentPath(file.path);
    if (parentPath) addExplorerFolderAncestors(folderMap, parentPath);
  }

  return {
    files: [...files].sort((left, right) => left.path.localeCompare(right.path, undefined, { sensitivity: 'base' })),
    folders: [...folderMap.values()].sort((left, right) => left.path.localeCompare(right.path, undefined, { sensitivity: 'base' })),
    activeFileId,
  } satisfies ThesisWorkspace;
}

function validateMove(workspace: ThesisWorkspace, dragState: ExplorerMoveState, destinationPath: string): ExplorerMoveValidation {
  if (dragState.kind === 'file') {
    const nextPath = destinationPath ? `${destinationPath}/${dragState.name}` : dragState.name;
    if (nextPath === dragState.path) {
      return { ok: false, noOp: true };
    }

    const filePaths = new Set(workspace.files.filter((file) => file.id !== dragState.id).map((file) => file.path));
    const folderPaths = new Set(workspace.folders.map((folder) => folder.path));
    if (filePaths.has(nextPath) || folderPaths.has(nextPath)) {
      return { ok: false, error: 'A file or folder with that name already exists.' };
    }

    return { ok: true, nextPath };
  }

  if (destinationPath === dragState.path || destinationPath.startsWith(`${dragState.path}/`)) {
    return { ok: false, error: 'Cannot move a folder into itself.' };
  }

  const nextPath = destinationPath ? `${destinationPath}/${dragState.name}` : dragState.name;
  if (nextPath === dragState.path) {
    return { ok: false, noOp: true };
  }

  const fromPrefix = `${dragState.path}/`;
  const filePaths = new Set(workspace.files.filter((file) => !file.path.startsWith(fromPrefix)).map((file) => file.path));
  const folderPaths = new Set(
    workspace.folders
      .filter((folder) => folder.path !== dragState.path && !folder.path.startsWith(fromPrefix))
      .map((folder) => folder.path),
  );

  if (filePaths.has(nextPath) || folderPaths.has(nextPath)) {
    return { ok: false, error: 'A file or folder with that name already exists.' };
  }

  return { ok: true, nextPath };
}

function remapFolderOpenState(current: Record<string, boolean>, fromPath: string, toPath: string) {
  const next: Record<string, boolean> = {};
  const fromPrefix = `${fromPath}/`;
  const toPrefix = `${toPath}/`;

  for (const [folderPath, isOpen] of Object.entries(current)) {
    if (folderPath === fromPath) {
      next[toPath] = isOpen;
      continue;
    }
    if (folderPath.startsWith(fromPrefix)) {
      next[`${toPrefix}${folderPath.slice(fromPrefix.length)}`] = isOpen;
      continue;
    }
    next[folderPath] = isOpen;
  }

  return next;
}

const TEXT_FILE_EXTENSIONS = new Set([
  'bib', 'bst', 'c', 'cc', 'cls', 'cpp', 'css', 'csv', 'h', 'hpp', 'html', 'ini', 'java',
  'js', 'json', 'md', 'py', 'r', 'rb', 'rs', 'sh', 'sql', 'sty', 'tex', 'toml', 'ts', 'tsx',
  'txt', 'xml', 'yaml', 'yml',
]);

const MIME_TYPE_BY_EXTENSION: Record<string, string> = {
  bib: 'application/x-bibtex',
  bst: 'text/plain',
  cls: 'text/plain',
  css: 'text/css',
  csv: 'text/csv',
  gif: 'image/gif',
  html: 'text/html',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  js: 'text/javascript',
  json: 'application/json',
  md: 'text/markdown',
  pdf: 'application/pdf',
  png: 'image/png',
  py: 'text/x-python',
  sh: 'text/x-shellscript',
  sql: 'text/plain',
  svg: 'image/svg+xml',
  sty: 'text/plain',
  tex: 'application/x-tex',
  toml: 'text/plain',
  ts: 'text/typescript',
  tsx: 'text/typescript',
  txt: 'text/plain',
  webp: 'image/webp',
  xml: 'application/xml',
  yaml: 'application/yaml',
  yml: 'application/yaml',
};

function getFileExtension(name: string) {
  const lastDot = name.lastIndexOf('.');
  return lastDot >= 0 ? name.slice(lastDot + 1).toLowerCase() : '';
}

function inferMimeType(name: string, browserMimeType: string) {
  const normalizedBrowserMimeType = browserMimeType.trim().toLowerCase();
  if (normalizedBrowserMimeType) return normalizedBrowserMimeType;
  return MIME_TYPE_BY_EXTENSION[getFileExtension(name)] ?? null;
}

function isLikelyUtf8Text(bytes: Uint8Array) {
  const sample = bytes.subarray(0, Math.min(bytes.length, 4096));
  if (sample.length === 0) return true;

  let suspiciousByteCount = 0;
  for (const value of sample) {
    if (value === 0) return false;
    const isControlCharacter = value < 32 && value !== 9 && value !== 10 && value !== 13;
    if (isControlCharacter) suspiciousByteCount += 1;
  }

  return suspiciousByteCount / sample.length < 0.02;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return window.btoa(binary);
}

function isTextLikeFile(name: string, mimeType: string | null, bytes: Uint8Array) {
  if (mimeType?.startsWith('text/')) return true;
  if (mimeType && /(json|xml|yaml|javascript|typescript|x-tex|markdown|svg)/.test(mimeType)) return true;
  const extension = getFileExtension(name);
  if (TEXT_FILE_EXTENSIONS.has(extension)) return true;
  return isLikelyUtf8Text(bytes);
}

function isExternalFileDrag(event: ReactDragEvent<HTMLElement>) {
  return Array.from(event.dataTransfer.items ?? []).some((item) => item.kind === 'file');
}

function normalizeImportedRelativePath(path: string) {
  return path
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .join('/');
}

async function readImportedFile(file: File, relativePath: string) {
  const normalizedPath = normalizeImportedRelativePath(relativePath || file.name);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mimeType = inferMimeType(file.name, file.type);

  if (isTextLikeFile(file.name, mimeType, bytes)) {
    return {
      path: normalizedPath,
      content: new TextDecoder('utf-8', { fatal: false }).decode(bytes),
      encoding: 'utf-8',
      mimeType,
    } satisfies ExplorerImportedFile;
  }

  return {
    path: normalizedPath,
    content: bytesToBase64(bytes),
    encoding: 'base64',
    mimeType,
  } satisfies ExplorerImportedFile;
}

function readLegacyEntryFile(entry: FileSystemFileEntry) {
  return new Promise<File>((resolve, reject) => {
    entry.file(resolve, reject);
  });
}

async function readLegacyDirectoryEntries(entry: FileSystemDirectoryEntry) {
  const reader = entry.createReader();
  const entries: FileSystemEntry[] = [];

  while (true) {
    const chunk = await new Promise<FileSystemEntry[]>((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
    if (chunk.length === 0) break;
    entries.push(...chunk);
  }

  return entries;
}

async function collectLegacyDroppedEntries(
  entry: FileSystemEntry,
  currentPath: string,
  imported: ExplorerImportedDrop,
) {
  if (entry.isDirectory) {
    imported.folders.push(currentPath);
    const directoryEntries = await readLegacyDirectoryEntries(entry as FileSystemDirectoryEntry);
    directoryEntries.sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }));
    for (const child of directoryEntries) {
      await collectLegacyDroppedEntries(child, normalizeImportedRelativePath(`${currentPath}/${child.name}`), imported);
    }
    return;
  }

  if (!entry.isFile) return;
  const file = await readLegacyEntryFile(entry as FileSystemFileEntry);
  imported.files.push(await readImportedFile(file, currentPath));
}

async function readDroppedExplorerItems(dataTransfer: DataTransfer): Promise<ExplorerImportedDrop> {
  const imported: ExplorerImportedDrop = {
    files: [],
    folders: [],
    rootNames: [],
  };
  const rootNames = new Set<string>();
  const entryItems = Array.from(dataTransfer.items ?? [])
    .filter((item) => item.kind === 'file')
    .map((item) => (item as DataTransferItemWithEntry).webkitGetAsEntry?.() ?? null)
    .filter((entry): entry is FileSystemEntry => Boolean(entry));

  if (entryItems.length > 0) {
    for (const entry of entryItems) {
      const rootPath = normalizeImportedRelativePath(entry.name);
      if (!rootPath) continue;
      if (!rootNames.has(rootPath)) {
        rootNames.add(rootPath);
        imported.rootNames.push(rootPath);
      }
      await collectLegacyDroppedEntries(entry, rootPath, imported);
    }
  } else {
    for (const file of Array.from(dataTransfer.files ?? [])) {
      const relativePath = normalizeImportedRelativePath(file.webkitRelativePath || file.name);
      if (!relativePath) continue;
      const rootPath = relativePath.split('/')[0] ?? relativePath;
      if (!rootNames.has(rootPath)) {
        rootNames.add(rootPath);
        imported.rootNames.push(rootPath);
      }
      imported.files.push(await readImportedFile(file, relativePath));
    }
  }

  imported.folders = Array.from(new Set(imported.folders)).sort((left, right) => (
    left.localeCompare(right, undefined, { sensitivity: 'base' })
  ));
  imported.files.sort((left, right) => left.path.localeCompare(right.path, undefined, { sensitivity: 'base' }));
  return imported;
}

function buildImportedRootPath(
  rootName: string,
  destinationPath: string,
  rootIsFolder: boolean,
  attempt: number,
) {
  if (attempt <= 1) {
    return normalizeThesisWorkspacePath(destinationPath ? `${destinationPath}/${rootName}` : rootName);
  }

  if (rootIsFolder) {
    const candidateName = `${rootName} ${attempt}`;
    return normalizeThesisWorkspacePath(destinationPath ? `${destinationPath}/${candidateName}` : candidateName);
  }

  const { base, extension } = splitFileName(rootName);
  const candidateName = `${base} ${attempt}${extension}`;
  return normalizeThesisWorkspacePath(destinationPath ? `${destinationPath}/${candidateName}` : candidateName);
}

function mapImportedPath(rootPath: string, originalPath: string) {
  const [, ...rest] = originalPath.split('/');
  return rest.length > 0 ? `${rootPath}/${rest.join('/')}` : rootPath;
}

function getExplorerNodeId(node: ExplorerNode) {
  return node.kind === 'folder' ? getFolderNodeId(node.path) : node.id;
}

function areNodeSelectionsEqual(left: Set<string>, right: Set<string>) {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}

export default function ThesisFileExplorer({
  collapsed,
  workspace,
  activeFileId,
  selectedNodeId,
  savedFileIds,
  onOpenFile,
  onWorkspaceChange,
  onSelectedNodeIdChange,
  onToggleCollapsed,
  onDeleteSelectionSnapshot,
}: ThesisFileExplorerProps) {
  const [draftState, setDraftState] = useState<ExplorerDraftState | null>(null);
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>(() => {
    if (typeof window === 'undefined') return {};
    try {
      const rawValue = window.localStorage.getItem(THESIS_EXPLORER_OPEN_FOLDERS_STORAGE_KEY);
      if (!rawValue) return {};
      const parsed = JSON.parse(rawValue) as Record<string, boolean>;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  });
  const [error, setError] = useState<string | null>(null);
  const [dragState, setDragState] = useState<ExplorerMoveState | null>(null);
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);
  const [templateMenuOpen, setTemplateMenuOpen] = useState(false);
  const [toolbarTooltip, setToolbarTooltip] = useState<{
    label: string;
    tone: ExplorerToolbarTooltipTone;
    top: number;
    left: number;
  } | null>(null);
  const [, setIsExternalDropActive] = useState(false);
  const treeContainerRef = useRef<HTMLDivElement | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const toolbarTooltipAnchorRef = useRef<HTMLElement | null>(null);
  const nodeElementRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const draftInputRef = useRef<HTMLInputElement | null>(null);
  const autoExpandTimeoutRef = useRef<number | null>(null);
  const initializedDraftSelectionKeyRef = useRef<string | null>(null);
  const selectionAnchorNodeIdRef = useRef<string | null>(selectedNodeId);

  const tree = useMemo(() => buildExplorerTree(workspace), [workspace]);
  const activeFile = useMemo(() => getThesisWorkspaceActiveFile(workspace), [workspace]);
  const validNodeIds = useMemo(() => new Set([
    ...workspace.files.map((file) => file.id),
    ...workspace.folders.map((folder) => getFolderNodeId(folder.path)),
  ]), [workspace.files, workspace.folders]);
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(() => (
    selectedNodeId && validNodeIds.has(selectedNodeId) ? new Set([selectedNodeId]) : new Set()
  ));
  const selectedFile = useMemo(
    () => workspace.files.find((file) => file.id === selectedNodeId) ?? null,
    [selectedNodeId, workspace.files],
  );
  const selectedFolder = useMemo(
    () => workspace.folders.find((folder) => getFolderNodeId(folder.path) === selectedNodeId) ?? null,
    [selectedNodeId, workspace.folders],
  );
  const selectedFiles = useMemo(
    () => workspace.files.filter((file) => selectedNodeIds.has(file.id)),
    [selectedNodeIds, workspace.files],
  );
  const selectedFolders = useMemo(
    () => workspace.folders.filter((folder) => selectedNodeIds.has(getFolderNodeId(folder.path))),
    [selectedNodeIds, workspace.folders],
  );
  const isRootSelected = selectedNodeIds.size === 0 && selectedNodeId === null;
  const hasSingleSelection = selectedNodeIds.size === 1;

  const nodeMap = useMemo(() => {
    const map = new Map<string, ExplorerNode>();
    const visit = (nodes: ExplorerNode[]) => {
      for (const node of nodes) {
        map.set(getExplorerNodeId(node), node);
        if (node.children.length > 0) visit(node.children);
      }
    };
    visit(tree);
    return map;
  }, [tree]);

  const parentNodeIdMap = useMemo(() => {
    const map = new Map<string, string | null>();
    const visit = (nodes: ExplorerNode[], parentNodeId: string | null) => {
      for (const node of nodes) {
        const nodeId = node.kind === 'folder' ? getFolderNodeId(node.path) : node.id;
        map.set(nodeId, parentNodeId);
        if (node.children.length > 0) visit(node.children, nodeId);
      }
    };
    visit(tree, null);
    return map;
  }, [tree]);

  const visibleNodes = useMemo(() => {
    const flattened: ExplorerNode[] = [];
    const visit = (nodes: ExplorerNode[]) => {
      for (const node of nodes) {
        flattened.push(node);
        if (node.kind === 'folder' && (openFolders[node.path] ?? true)) {
          visit(node.children);
        }
      }
    };
    visit(tree);
    return flattened;
  }, [openFolders, tree]);
  const visibleNodeIds = useMemo(() => visibleNodes.map((node) => getExplorerNodeId(node)), [visibleNodes]);

  const revealPath = (path: string, includeSelf = false) => {
    const segments = path.split('/');
    setOpenFolders((current) => {
      const next = { ...current };
      let changed = false;
      const end = includeSelf ? segments.length : segments.length - 1;
      for (let index = 1; index <= end; index += 1) {
        const folderPath = segments.slice(0, index).join('/');
        if (next[folderPath] !== true) {
          next[folderPath] = true;
          changed = true;
        }
      }
      return changed ? next : current;
    });
  };

  const selectNode = (nodeId: string | null) => {
    onSelectedNodeIdChange(nodeId);
  };

  const updateSelection = (nextSelectedNodeIds: Set<string>, primaryNodeId: string | null, anchorNodeId: string | null) => {
    setSelectedNodeIds(nextSelectedNodeIds);
    selectionAnchorNodeIdRef.current = anchorNodeId;
    selectNode(primaryNodeId);
  };

  const resolvePrimarySelectedNodeId = (nextSelectedNodeIds: Set<string>, preferredNodeId: string | null = null) => {
    if (preferredNodeId && nextSelectedNodeIds.has(preferredNodeId)) return preferredNodeId;
    if (selectedNodeId && nextSelectedNodeIds.has(selectedNodeId)) return selectedNodeId;
    for (const nodeId of visibleNodeIds) {
      if (nextSelectedNodeIds.has(nodeId)) return nodeId;
    }
    return null;
  };

  const buildRangeSelection = (anchorNodeId: string, targetNodeId: string) => {
    const anchorIndex = visibleNodeIds.indexOf(anchorNodeId);
    const targetIndex = visibleNodeIds.indexOf(targetNodeId);
    if (anchorIndex < 0 || targetIndex < 0) return new Set<string>([targetNodeId]);
    const start = Math.min(anchorIndex, targetIndex);
    const end = Math.max(anchorIndex, targetIndex);
    return new Set(visibleNodeIds.slice(start, end + 1));
  };

  const selectSingleNode = (nodeId: string | null) => {
    updateSelection(nodeId ? new Set([nodeId]) : new Set(), nodeId, nodeId);
  };

  const openFileAndSelect = (fileId: string) => {
    selectSingleNode(fileId);
    onOpenFile(fileId);
  };

  const handleNodeSelection = (node: ExplorerNode, event: ReactMouseEvent<HTMLElement>) => {
    const nodeId = getExplorerNodeId(node);
    const isToggleSelection = event.ctrlKey || event.metaKey;
    const isRangeSelection = event.shiftKey;

    if (isRangeSelection) {
      const anchorNodeId = selectionAnchorNodeIdRef.current && validNodeIds.has(selectionAnchorNodeIdRef.current)
        ? selectionAnchorNodeIdRef.current
        : selectedNodeId ?? nodeId;
      const rangeSelection = buildRangeSelection(anchorNodeId, nodeId);
      const nextSelectedNodeIds = isToggleSelection ? new Set(selectedNodeIds) : new Set<string>();
      for (const rangeNodeId of rangeSelection) {
        nextSelectedNodeIds.add(rangeNodeId);
      }
      updateSelection(nextSelectedNodeIds, nodeId, anchorNodeId);
      focusTree();
      return;
    }

    if (isToggleSelection) {
      const nextSelectedNodeIds = new Set(selectedNodeIds);
      if (nextSelectedNodeIds.has(nodeId)) {
        nextSelectedNodeIds.delete(nodeId);
      } else {
        nextSelectedNodeIds.add(nodeId);
      }
      updateSelection(nextSelectedNodeIds, resolvePrimarySelectedNodeId(nextSelectedNodeIds, nodeId), nodeId);
      focusTree();
      return;
    }

    selectSingleNode(nodeId);
    focusTree();
    if (node.kind === 'file') {
      onOpenFile(node.id);
    }
  };

  const showToolbarTooltip = (target: HTMLElement, label: string, tone: ExplorerToolbarTooltipTone = 'default') => {
    toolbarTooltipAnchorRef.current = target;
    const bounds = target.getBoundingClientRect();
    setToolbarTooltip({
      label,
      tone,
      top: bounds.bottom + 8,
      left: Math.min(window.innerWidth - 16, Math.max(16, bounds.left + (bounds.width / 2))),
    });
  };

  const hideToolbarTooltip = () => {
    toolbarTooltipAnchorRef.current = null;
    setToolbarTooltip(null);
  };

  const getToolbarTooltipProps = (label: string, tone: ExplorerToolbarTooltipTone = 'default') => ({
    onMouseEnter: (event: React.MouseEvent<HTMLElement>) => {
      showToolbarTooltip(event.currentTarget, label, tone);
    },
    onMouseLeave: hideToolbarTooltip,
    onFocus: (event: React.FocusEvent<HTMLElement>) => {
      showToolbarTooltip(event.currentTarget, label, tone);
    },
    onBlur: hideToolbarTooltip,
  });

  const addFromTemplate = (template: ExplorerTemplateDefinition) => {
    setError(null);
    setTemplateMenuOpen(false);

    try {
      const reservedPaths = new Set([
        ...workspace.files.map((file) => file.path),
        ...workspace.folders.map((folder) => folder.path),
      ]);
      const templateFolderPath = uniquePath(template.folderName, reservedPaths);
      reservedPaths.add(templateFolderPath);

      const nextFolders = [...workspace.folders, { id: getFolderNodeId(templateFolderPath), path: templateFolderPath }];
      const nextFiles = [...workspace.files];
      let firstTemplateFileId: string | null = null;
      let firstTemplateFilePath: string | null = null;

      for (const templateFile of template.files) {
        const requestedPath = normalizeThesisWorkspacePath(`${templateFolderPath}/${templateFile.path}`);
        const nextPath = uniquePath(requestedPath, reservedPaths);
        reservedPaths.add(nextPath);
        const nextFile = createThesisWorkspaceFile(nextPath, templateFile.content, {
          encoding: templateFile.encoding,
          mimeType: templateFile.mimeType,
        });
        nextFiles.push(nextFile);

        if (!firstTemplateFileId) {
          firstTemplateFileId = nextFile.id;
          firstTemplateFilePath = nextFile.path;
        }
      }

      const nextWorkspace = rebuildWorkspace(nextFiles, nextFolders, firstTemplateFileId ?? workspace.activeFileId);
      onWorkspaceChange(nextWorkspace, {
        openFileId: firstTemplateFileId,
        selectedNodeId: firstTemplateFileId ?? getFolderNodeId(templateFolderPath),
      });
      revealPath(templateFolderPath, true);
      if (firstTemplateFilePath) revealPath(firstTemplateFilePath);
      selectNode(firstTemplateFileId ?? getFolderNodeId(templateFolderPath));
    } catch (templateError) {
      setError(templateError instanceof Error ? templateError.message : 'Failed to add explorer template.');
    }
  };

  useEffect(() => {
    if (activeFile?.id) {
      revealPath(activeFile.path);
    }
  }, [activeFile?.id, activeFile?.path]);

  useEffect(() => {
    setSelectedNodeIds((current) => {
      const sanitized = new Set(Array.from(current).filter((nodeId) => validNodeIds.has(nodeId)));
      const next = selectedNodeId && sanitized.has(selectedNodeId)
        ? sanitized
        : selectedNodeId && validNodeIds.has(selectedNodeId)
          ? new Set([selectedNodeId])
          : new Set<string>();
      return areNodeSelectionsEqual(current, next) ? current : next;
    });

    if (selectedNodeId && validNodeIds.has(selectedNodeId)) {
      if (!selectionAnchorNodeIdRef.current || !validNodeIds.has(selectionAnchorNodeIdRef.current)) {
        selectionAnchorNodeIdRef.current = selectedNodeId;
      }
      return;
    }
    selectionAnchorNodeIdRef.current = null;
  }, [selectedNodeId, validNodeIds]);

  useEffect(() => {
    if (!selectedNodeId) return;
    const selectedNode = nodeMap.get(selectedNodeId);
    if (!selectedNode) {
      if (activeFile?.id) {
        selectSingleNode(activeFile.id);
      } else if (visibleNodes[0]) {
        selectSingleNode(getExplorerNodeId(visibleNodes[0]));
      } else {
        selectSingleNode(null);
      }
      return;
    }

    // Reveal parent folders for the current selection, but do not force the
    // selected folder itself back open. That allows chevron collapse to stick.
    revealPath(selectedNode.path);
    const animationId = window.requestAnimationFrame(() => {
      nodeElementRefs.current[selectedNodeId]?.scrollIntoView({ block: 'nearest' });
    });
    return () => window.cancelAnimationFrame(animationId);
  }, [activeFile?.id, nodeMap, selectedNodeId, visibleNodes]);

  useEffect(() => {
    if (!draftState) {
      initializedDraftSelectionKeyRef.current = null;
      return;
    }
    const input = draftInputRef.current;
    if (!input) return;

    const selectionKey = [
      draftState.mode,
      draftState.targetKind ?? '',
      draftState.targetId ?? '',
      draftState.targetPath ?? '',
      draftState.parentPath,
    ].join('::');

    if (initializedDraftSelectionKeyRef.current === selectionKey) return;
    initializedDraftSelectionKeyRef.current = selectionKey;

    window.requestAnimationFrame(() => {
      input.focus();
      const selectionEnd = draftState.mode === 'new-folder' || draftState.targetKind === 'folder'
        ? draftState.value.length
        : splitFileName(draftState.value).base.length;
      input.setSelectionRange(0, selectionEnd);
    });
  }, [draftState]);

  useEffect(() => () => {
    if (autoExpandTimeoutRef.current !== null) {
      window.clearTimeout(autoExpandTimeoutRef.current);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const validFolderPaths = new Set(workspace.folders.map((folder) => folder.path));
    const sanitizedEntries = Object.entries(openFolders).filter(([folderPath, isOpen]) => validFolderPaths.has(folderPath) && typeof isOpen === 'boolean');
    window.localStorage.setItem(THESIS_EXPLORER_OPEN_FOLDERS_STORAGE_KEY, JSON.stringify(Object.fromEntries(sanitizedEntries)));
  }, [openFolders, workspace.folders]);

  useEffect(() => {
    if (!toolbarTooltip) return undefined;

    const updateTooltipPosition = () => {
      const anchor = toolbarTooltipAnchorRef.current;
      if (!anchor) {
        setToolbarTooltip(null);
        return;
      }
      const bounds = anchor.getBoundingClientRect();
      setToolbarTooltip((current) => (
        current
          ? {
              ...current,
              top: bounds.bottom + 8,
              left: Math.min(window.innerWidth - 16, Math.max(16, bounds.left + (bounds.width / 2))),
            }
          : current
      ));
    };

    window.addEventListener('resize', updateTooltipPosition);
    window.addEventListener('scroll', updateTooltipPosition, true);
    return () => {
      window.removeEventListener('resize', updateTooltipPosition);
      window.removeEventListener('scroll', updateTooltipPosition, true);
    };
  }, [toolbarTooltip]);

  useEffect(() => {
    if (!templateMenuOpen) return undefined;

    const handlePointerDown = (event: PointerEvent) => {
      if (toolbarRef.current?.contains(event.target as Node)) return;
      setTemplateMenuOpen(false);
    };

    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [templateMenuOpen]);

  useEffect(() => {
    hideToolbarTooltip();
  }, [collapsed]);

  const clearDragState = () => {
    if (autoExpandTimeoutRef.current !== null) {
      window.clearTimeout(autoExpandTimeoutRef.current);
      autoExpandTimeoutRef.current = null;
    }
    setDragState(null);
    setDropTargetPath(null);
    setIsExternalDropActive(false);
  };

  const importDroppedFiles = async (dataTransfer: DataTransfer, destinationPath: string) => {
    setError(null);

    const importedDrop = await readDroppedExplorerItems(dataTransfer);
    if (importedDrop.files.length === 0 && importedDrop.folders.length === 0) {
      throw new Error('Drop one or more files or folders into the thesis explorer to import them.');
    }

    const reservedPaths = new Set([
      ...workspace.files.map((file) => file.path),
      ...workspace.folders.map((folder) => folder.path),
    ]);

    const nextFolders = [...workspace.folders];
    const nextFiles = [...workspace.files];
    let firstImportedFileId: string | null = null;
    let firstImportedPath: string | null = null;
    let firstImportedFolderPath: string | null = null;
    const openedFolderPaths = new Set<string>();

    for (const rootName of importedDrop.rootNames) {
      const rootFolderPaths = importedDrop.folders.filter((folderPath) => (
        folderPath === rootName || folderPath.startsWith(`${rootName}/`)
      ));
      const rootFiles = importedDrop.files.filter((file) => (
        file.path === rootName || file.path.startsWith(`${rootName}/`)
      ));
      const rootIsFolder = rootFolderPaths.includes(rootName);

      let assignedRootPath = '';
      let attempt = 1;
      while (true) {
        const candidateRootPath = buildImportedRootPath(rootName, destinationPath, rootIsFolder, attempt);
        const hasConflict = (
          rootFolderPaths.some((folderPath) => reservedPaths.has(mapImportedPath(candidateRootPath, folderPath)))
          || rootFiles.some((file) => reservedPaths.has(mapImportedPath(candidateRootPath, file.path)))
        );
        if (!hasConflict) {
          assignedRootPath = candidateRootPath;
          break;
        }
        attempt += 1;
      }

      for (const folderPath of rootFolderPaths) {
        const nextPath = mapImportedPath(assignedRootPath, folderPath);
        reservedPaths.add(nextPath);
        nextFolders.push({ id: getFolderNodeId(nextPath), path: nextPath });
        openedFolderPaths.add(nextPath);
        if (!firstImportedFolderPath) {
          firstImportedFolderPath = nextPath;
          firstImportedPath = nextPath;
        }
      }

      for (const importedFile of rootFiles) {
        const nextPath = mapImportedPath(assignedRootPath, importedFile.path);
        reservedPaths.add(nextPath);
        const nextFile = createThesisWorkspaceFile(nextPath, importedFile.content, {
          encoding: importedFile.encoding,
          mimeType: importedFile.mimeType,
        });
        nextFiles.push(nextFile);
        const parentPath = getParentPath(nextPath);
        if (parentPath) openedFolderPaths.add(parentPath);
        if (!firstImportedFileId) {
          firstImportedFileId = nextFile.id;
        }
        if (!firstImportedPath) {
          firstImportedPath = nextPath;
        }
      }
    }

    const nextWorkspace = rebuildWorkspace(nextFiles, nextFolders, firstImportedFileId ?? workspace.activeFileId);
    onWorkspaceChange(nextWorkspace, {
      openFileId: firstImportedFileId,
      selectedNodeId: firstImportedFileId ?? (firstImportedFolderPath ? getFolderNodeId(firstImportedFolderPath) : null),
    });

    if (destinationPath) revealPath(destinationPath, true);
    if (firstImportedPath) {
      revealPath(firstImportedPath, firstImportedPath === firstImportedFolderPath);
    }
    setOpenFolders((current) => {
      const next = { ...current };
      if (destinationPath) next[destinationPath] = true;
      for (const folderPath of openedFolderPaths) {
        next[folderPath] = true;
      }
      return next;
    });
    if (firstImportedFileId) {
      selectNode(firstImportedFileId);
    } else if (firstImportedFolderPath) {
      selectNode(getFolderNodeId(firstImportedFolderPath));
    }
  };

  const beginDraft = (mode: ExplorerDraftMode) => {
    setError(null);

    if (mode === 'rename') {
      if (!hasSingleSelection) return;
      if (selectedFile) {
        setDraftState({
          mode,
          targetKind: 'file',
          targetId: selectedFile.id,
          targetPath: selectedFile.path,
          parentPath: getParentPath(selectedFile.path),
          value: selectedFile.path.split('/').pop() ?? selectedFile.path,
        });
        return;
      }

      if (selectedFolder) {
        setDraftState({
          mode,
          targetKind: 'folder',
          targetId: getFolderNodeId(selectedFolder.path),
          targetPath: selectedFolder.path,
          parentPath: getParentPath(selectedFolder.path),
          value: selectedFolder.path.split('/').pop() ?? selectedFolder.path,
        });
      }
      return;
    }

    const parentPath = selectedFolder?.path ?? (selectedFile ? getParentPath(selectedFile.path) : '');
    const defaultName = mode === 'new-file' ? 'untitled.tex' : 'untitled-folder';
    setDraftState({
      mode,
      targetKind: null,
      targetId: null,
      targetPath: null,
      parentPath,
      value: defaultName,
    });
    if (parentPath) {
      setOpenFolders((current) => ({ ...current, [parentPath]: true }));
    }
  };

  const cancelDraft = () => {
    setDraftState(null);
    setError(null);
  };

  const commitDraft = () => {
    if (!draftState) return;

    try {
      const nextName = draftState.value.trim();
      if (!nextName) throw new Error('Name is required.');

      const normalizedName = nextName.replace(/\\/g, '/').split('/').filter(Boolean).join('/');
      if (normalizedName.includes('/')) throw new Error('Use a file or folder name, not a nested path.');

      const nextPath = normalizeThesisWorkspacePath(
        draftState.parentPath ? `${draftState.parentPath}/${normalizedName}` : normalizedName,
      );
      const filePaths = new Set(workspace.files.map((file) => file.path));
      const folderPaths = new Set(workspace.folders.map((folder) => folder.path));

      if (draftState.mode === 'new-file') {
        if (filePaths.has(nextPath) || folderPaths.has(nextPath)) throw new Error('A file or folder with that name already exists.');
        const nextFile = createThesisWorkspaceFile(nextPath, '');
        const nextWorkspace = rebuildWorkspace(
          [...workspace.files, nextFile],
          workspace.folders,
          nextFile.id,
        );
        onWorkspaceChange(nextWorkspace, {
          openFileId: nextFile.id,
          selectedNodeId: nextFile.id,
        });
        revealPath(nextFile.path);
        selectNode(nextFile.id);
      } else if (draftState.mode === 'new-folder') {
        if (filePaths.has(nextPath) || folderPaths.has(nextPath)) throw new Error('A file or folder with that name already exists.');
        const nextWorkspace = rebuildWorkspace(
          workspace.files,
          [...workspace.folders, { id: getFolderNodeId(nextPath), path: nextPath }],
          workspace.activeFileId,
        );
        onWorkspaceChange(nextWorkspace, { selectedNodeId: getFolderNodeId(nextPath) });
        revealPath(nextPath, true);
        selectNode(getFolderNodeId(nextPath));
      } else if (draftState.targetKind === 'file' && draftState.targetPath && draftState.targetId) {
        if (nextPath !== draftState.targetPath && (filePaths.has(nextPath) || folderPaths.has(nextPath))) {
          throw new Error('A file or folder with that name already exists.');
        }
        const nextFiles = workspace.files.map((file) => (
          file.id === draftState.targetId ? { ...file, path: nextPath } : file
        ));
        const nextWorkspace = rebuildWorkspace(nextFiles, workspace.folders, workspace.activeFileId);
        onWorkspaceChange(nextWorkspace, {
          openFileId: workspace.activeFileId === draftState.targetId ? draftState.targetId : null,
          selectedNodeId: draftState.targetId,
        });
        revealPath(nextPath);
        selectNode(draftState.targetId);
      } else if (draftState.targetKind === 'folder' && draftState.targetPath) {
        if (nextPath !== draftState.targetPath && (filePaths.has(nextPath) || folderPaths.has(nextPath))) {
          throw new Error('A file or folder with that name already exists.');
        }
        const fromPrefix = `${draftState.targetPath}/`;
        const toPrefix = `${nextPath}/`;
        const nextFolders = workspace.folders.map((folder) => (
          folder.path === draftState.targetPath
            ? { ...folder, path: nextPath }
            : folder.path.startsWith(fromPrefix)
              ? { ...folder, path: `${toPrefix}${folder.path.slice(fromPrefix.length)}` }
              : folder
        ));
        const nextFiles = workspace.files.map((file) => (
          file.path.startsWith(fromPrefix)
            ? { ...file, path: `${toPrefix}${file.path.slice(fromPrefix.length)}` }
            : file
        ));
        const nextWorkspace = rebuildWorkspace(nextFiles, nextFolders, workspace.activeFileId);
        onWorkspaceChange(nextWorkspace, { selectedNodeId: getFolderNodeId(nextPath) });
        setOpenFolders((current) => remapFolderOpenState(current, draftState.targetPath!, nextPath));
        revealPath(nextPath, true);
        selectNode(getFolderNodeId(nextPath));
      }

      setDraftState(null);
      setError(null);
    } catch (draftError) {
      setError(draftError instanceof Error ? draftError.message : 'Failed to update explorer item.');
    }
  };

  const deleteSelection = () => {
    setError(null);
    if (selectedNodeIds.size === 0) return;

    const selectedFolderRoots = selectedFolders
      .map((folder) => folder.path)
      .filter((folderPath, index, folderPaths) => (
        !folderPaths.some((otherPath, otherIndex) => otherIndex !== index && folderPath.startsWith(`${otherPath}/`))
      ));
    const selectedFileIds = new Set(selectedFiles.map((file) => file.id));
    const nextFiles = workspace.files.filter((file) => (
      !selectedFileIds.has(file.id)
      && !selectedFolderRoots.some((folderPath) => file.path.startsWith(`${folderPath}/`))
    ));

    if (nextFiles.length === 0) {
      setError('Deleting that selection would remove every thesis file.');
      return;
    }

    const nextFolders = workspace.folders.filter((folder) => (
      !selectedFolderRoots.some((folderPath) => folder.path === folderPath || folder.path.startsWith(`${folderPath}/`))
    ));
    const nextActiveFileId = nextFiles.some((file) => file.id === workspace.activeFileId)
      ? workspace.activeFileId
      : nextFiles[0]?.id ?? null;
    onDeleteSelectionSnapshot?.(workspace, {
      selectedNodeId: selectedNodeIds.values().next().value ?? null,
    });
    onWorkspaceChange(rebuildWorkspace(nextFiles, nextFolders, nextActiveFileId), {
      openFileId: nextActiveFileId,
      selectedNodeId: nextActiveFileId,
    });
    if (nextActiveFileId) {
      const nextSelectedFile = nextFiles.find((file) => file.id === nextActiveFileId) ?? null;
      if (nextSelectedFile) revealPath(nextSelectedFile.path);
    }
    setOpenFolders((current) => {
      const next: Record<string, boolean> = {};
      for (const [folderPath, isOpen] of Object.entries(current)) {
        if (!selectedFolderRoots.some((selectedFolderPath) => (
          folderPath === selectedFolderPath || folderPath.startsWith(`${selectedFolderPath}/`)
        ))) {
          next[folderPath] = isOpen;
        }
      }
      return next;
    });
    selectSingleNode(nextActiveFileId);
  };

  const duplicateSelection = () => {
    if (!selectedFile || !hasSingleSelection) return;
    setError(null);
    const parentPath = getParentPath(selectedFile.path);
    const fileName = selectedFile.path.split('/').pop() ?? selectedFile.path;
    const { base, extension } = splitFileName(fileName);
    const reserved = new Set([
      ...workspace.files.map((file) => file.path),
      ...workspace.folders.map((folder) => folder.path),
    ]);
    const nextPath = uniquePath(parentPath ? `${parentPath}/${base} copy${extension}` : `${base} copy${extension}`, reserved);
    const nextWorkspace = rebuildWorkspace(
      [...workspace.files, createThesisWorkspaceFile(nextPath, selectedFile.content, {
        encoding: selectedFile.encoding,
        mimeType: selectedFile.mimeType ?? null,
      })],
      workspace.folders,
      workspace.activeFileId,
    );
    const duplicatedFile = nextWorkspace.files.find((file) => file.path === nextPath) ?? null;
    onWorkspaceChange(nextWorkspace, {
      openFileId: duplicatedFile?.id ?? null,
      selectedNodeId: duplicatedFile?.id ?? null,
    });
    if (duplicatedFile?.id) {
      revealPath(duplicatedFile.path);
      selectNode(duplicatedFile.id);
    }
  };

  const toggleFolder = (folderPath: string) => {
    setOpenFolders((current) => ({
      ...current,
      [folderPath]: !(current[folderPath] ?? true),
    }));
  };

  const moveNode = (moveSource: ExplorerMoveState, destinationPath: string) => {
    const validation = validateMove(workspace, moveSource, destinationPath);
    if (!validation.ok) {
      if (validation.error) setError(validation.error);
      return;
    }

    setError(null);

    if (moveSource.kind === 'file') {
      const nextFiles = workspace.files.map((file) => (
        file.id === moveSource.id ? { ...file, path: validation.nextPath! } : file
      ));
      const nextWorkspace = rebuildWorkspace(nextFiles, workspace.folders, workspace.activeFileId);
      onWorkspaceChange(nextWorkspace, {
        openFileId: workspace.activeFileId === moveSource.id ? moveSource.id : null,
        selectedNodeId: moveSource.id,
      });
      revealPath(validation.nextPath!);
      selectNode(moveSource.id);
      return;
    }

    const fromPrefix = `${moveSource.path}/`;
    const toPrefix = `${validation.nextPath!}/`;
    const nextFolders = workspace.folders.map((folder) => (
      folder.path === moveSource.path
        ? { ...folder, path: validation.nextPath! }
        : folder.path.startsWith(fromPrefix)
          ? { ...folder, path: `${toPrefix}${folder.path.slice(fromPrefix.length)}` }
          : folder
    ));
    const nextFiles = workspace.files.map((file) => (
      file.path.startsWith(fromPrefix)
        ? { ...file, path: `${toPrefix}${file.path.slice(fromPrefix.length)}` }
        : file
    ));
    const nextWorkspace = rebuildWorkspace(nextFiles, nextFolders, workspace.activeFileId);
    onWorkspaceChange(nextWorkspace, { selectedNodeId: getFolderNodeId(validation.nextPath!) });
    setOpenFolders((current) => {
      const next = remapFolderOpenState(current, moveSource.path, validation.nextPath!);
      if (destinationPath) next[destinationPath] = true;
      next[validation.nextPath!] = true;
      return next;
    });
    revealPath(validation.nextPath!, true);
    selectNode(getFolderNodeId(validation.nextPath!));
  };

  const handleDragStart = (node: ExplorerNode) => {
    setError(null);
    setDraftState(null);
    selectSingleNode(getExplorerNodeId(node));
    setDragState({
      kind: node.kind,
      id: node.id,
      name: node.name,
      path: node.path,
    });
  };

  const handleRootDragOver = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!dragState && isExternalFileDrag(event)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      setIsExternalDropActive(true);
      setDropTargetPath('');
      return;
    }

    if (!dragState) return;
    const validation = validateMove(workspace, dragState, '');
    if (!validation.ok && !validation.noOp) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = validation.noOp ? 'none' : 'move';
    setDropTargetPath('');
  };

  const handleFolderDragOver = (event: ReactDragEvent<HTMLDivElement>, folderPath: string, isOpen: boolean) => {
    if (!dragState && isExternalFileDrag(event)) {
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = 'copy';
      setIsExternalDropActive(true);
      setDropTargetPath(folderPath);

      if (!isOpen && autoExpandTimeoutRef.current === null) {
        autoExpandTimeoutRef.current = window.setTimeout(() => {
          setOpenFolders((current) => ({ ...current, [folderPath]: true }));
          autoExpandTimeoutRef.current = null;
        }, 500);
      }
      return;
    }

    if (!dragState) return;
    const validation = validateMove(workspace, dragState, folderPath);
    if (!validation.ok && !validation.noOp) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = validation.noOp ? 'none' : 'move';
    setDropTargetPath(folderPath);

    if (!isOpen && autoExpandTimeoutRef.current === null) {
      autoExpandTimeoutRef.current = window.setTimeout(() => {
        setOpenFolders((current) => ({ ...current, [folderPath]: true }));
        autoExpandTimeoutRef.current = null;
      }, 500);
    }
  };

  const handleFolderDragLeave = (event: ReactDragEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    if (autoExpandTimeoutRef.current !== null) {
      window.clearTimeout(autoExpandTimeoutRef.current);
      autoExpandTimeoutRef.current = null;
    }
    if (!dragState) {
      setDropTargetPath((current) => (current === null ? current : null));
    }
  };

  const handleDrop = async (event: ReactDragEvent<HTMLElement>, destinationPath: string) => {
    event.preventDefault();
    event.stopPropagation();

    try {
      if (dragState) {
        moveNode(dragState, destinationPath);
        return;
      }

      if (isExternalFileDrag(event)) {
        await importDroppedFiles(event.dataTransfer, destinationPath);
      }
    } catch (dropError) {
      setError(dropError instanceof Error ? dropError.message : 'Failed to import dropped file or folder.');
    } finally {
      clearDragState();
    }
  };

  const focusTree = () => {
    treeContainerRef.current?.focus();
  };

  const handleTreeBackgroundPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    setError(null);
    selectSingleNode(null);
    focusTree();
  };

  const selectVisibleNode = (node: ExplorerNode | undefined) => {
    if (!node) return;
    if (node.kind === 'file') {
      openFileAndSelect(node.id);
    } else {
      selectSingleNode(getExplorerNodeId(node));
    }
    focusTree();
  };

  const handleExplorerKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    if (target?.tagName === 'INPUT') return;

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      const nextSelectedNodeIds = new Set(visibleNodeIds);
      updateSelection(nextSelectedNodeIds, resolvePrimarySelectedNodeId(nextSelectedNodeIds, selectedNodeId), selectedNodeId ?? visibleNodeIds[0] ?? null);
      focusTree();
      return;
    }

    if (event.key === 'Escape') {
      if (templateMenuOpen) {
        event.preventDefault();
        setTemplateMenuOpen(false);
      } else if (draftState) {
        event.preventDefault();
        cancelDraft();
      } else if (error) {
        event.preventDefault();
        setError(null);
      }
      return;
    }

    if (!selectedNodeId) return;

    const selectedIndex = visibleNodes.findIndex((node) => (
      getExplorerNodeId(node) === selectedNodeId
    ));
    const selectedNode = selectedIndex >= 0 ? visibleNodes[selectedIndex] : nodeMap.get(selectedNodeId);
    if (!selectedNode) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      selectVisibleNode(visibleNodes[selectedIndex + 1]);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      selectVisibleNode(visibleNodes[selectedIndex - 1]);
      return;
    }

    if (event.key === 'ArrowRight') {
      if (selectedNode.kind !== 'folder') return;
      event.preventDefault();
      if (openFolders[selectedNode.path] === false) {
        toggleFolder(selectedNode.path);
        return;
      }
      selectVisibleNode(selectedNode.children[0]);
      return;
    }

    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      if (selectedNode.kind === 'folder' && (openFolders[selectedNode.path] ?? true) && selectedNode.children.length > 0) {
        toggleFolder(selectedNode.path);
        return;
      }
      const parentNodeId = parentNodeIdMap.get(selectedNodeId) ?? null;
      if (!parentNodeId) return;
      const parentNode = nodeMap.get(parentNodeId);
      if (parentNode) {
        selectSingleNode(parentNodeId);
        focusTree();
      }
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      if (draftState) {
        commitDraft();
        return;
      }
      if (selectedNode.kind === 'folder') {
        toggleFolder(selectedNode.path);
        return;
      }
      openFileAndSelect(selectedNode.id);
      return;
    }

    if (event.key === 'F2') {
      event.preventDefault();
      beginDraft('rename');
      return;
    }

    if (event.key === 'Delete') {
      event.preventDefault();
      deleteSelection();
    }
  };

  const renderDraftRow = (parentPath: string, depth: number) => {
    if (!draftState || draftState.mode === 'rename' || draftState.parentPath !== parentPath) return null;

    const isFolderDraft = draftState.mode === 'new-folder';
    const paddingLeft = 12 + depth * 14;

    return (
      <div key={`draft:${parentPath || 'root'}:${draftState.mode}`} className="flex items-center gap-2 py-1.5 pr-3" style={{ paddingLeft }}>
        {isFolderDraft ? (
          <>
            <ChevronDown size={13} className="shrink-0 text-muted opacity-0" />
            <FolderOpen size={14} className="shrink-0 text-accent/80" />
          </>
        ) : (
          <>
            <span className="w-[13px] shrink-0" />
            <FileText size={14} className="shrink-0 text-accent" />
          </>
        )}
        <input
          ref={draftInputRef}
          value={draftState.value}
          onChange={(event) => setDraftState((current) => (current ? { ...current, value: event.target.value } : current))}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commitDraft();
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              cancelDraft();
            }
          }}
          className="min-w-0 flex-1 border border-accent/30 bg-surface px-2 py-1 text-sm text-heading focus:border-accent/50 focus:outline-none"
        />
        <button type="button" onClick={commitDraft} className="inline-flex h-7 w-7 items-center justify-center rounded-sm border border-border bg-surface text-heading transition-colors hover:bg-surface2" aria-label="Confirm explorer change">
          <Check size={14} />
        </button>
        <button type="button" onClick={cancelDraft} className="inline-flex h-7 w-7 items-center justify-center rounded-sm border border-border bg-surface text-heading transition-colors hover:bg-surface2" aria-label="Cancel explorer change">
          <X size={14} />
        </button>
      </div>
    );
  };

  const renderNodeList = (nodes: ExplorerNode[], depth: number, parentPath: string) => {
    const rows: ReactElement[] = [];

    for (const node of nodes) {
      rows.push(renderNode(node, depth));
    }

    const draftRow = renderDraftRow(parentPath, depth);
    if (draftRow) rows.push(draftRow);

    return rows;
  };

  const renderNode = (node: ExplorerNode, depth = 0): ReactElement => {
    const isFolder = node.kind === 'folder';
    const isOpen = isFolder ? (openFolders[node.path] ?? true) : false;
    const nodeId = getExplorerNodeId(node);
    const isSelected = selectedNodeIds.has(nodeId);
    const isActiveFile = !isFolder && activeFileId === node.id;
    const isEditing = draftState?.mode === 'rename' && draftState.targetPath === node.path && draftState.targetKind === node.kind;
    const isDropTarget = isFolder && dropTargetPath === node.path;
    const paddingLeft = 12 + depth * 14;

    const rowClassName = `group flex w-full items-center gap-2 py-1.5 pr-3 text-left transition-colors ${
      isDropTarget
        ? 'bg-accent/10 text-heading ring-1 ring-inset ring-accent/30'
        : isSelected
          ? 'bg-surface2 text-heading'
          : isActiveFile && selectedNodeIds.size === 0 && !isRootSelected
            ? 'bg-accent/12 text-heading'
            : 'text-heading hover:bg-surface2/80'
    }`;

    return (
      <div key={nodeId}>
        {isEditing ? (
          <div className="flex items-center gap-2 py-1.5 pr-3" style={{ paddingLeft }}>
            {isFolder ? (
              <>
                {isOpen ? <ChevronDown size={13} className="shrink-0 text-muted" /> : <ChevronRight size={13} className="shrink-0 text-muted" />}
                {isOpen ? <FolderOpen size={14} className="shrink-0 text-accent/80" /> : <Folder size={14} className="shrink-0 text-accent/80" />}
              </>
            ) : (
              <>
                <span className="w-[13px] shrink-0" />
                <FileText size={14} className={`shrink-0 ${isActiveFile ? 'text-accent' : 'text-muted'}`} />
              </>
            )}
            <input
              ref={draftInputRef}
              value={draftState.value}
              onChange={(event) => setDraftState((current) => (current ? { ...current, value: event.target.value } : current))}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  commitDraft();
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  cancelDraft();
                }
              }}
              onMouseDown={(event) => event.stopPropagation()}
              className="min-w-0 flex-1 border border-accent/30 bg-surface px-2 py-1 text-sm text-heading focus:border-accent/50 focus:outline-none"
            />
            <button type="button" onClick={commitDraft} className="inline-flex h-7 w-7 items-center justify-center rounded-sm border border-border bg-surface text-heading transition-colors hover:bg-surface2" aria-label="Confirm explorer change">
              <Check size={14} />
            </button>
            <button type="button" onClick={cancelDraft} className="inline-flex h-7 w-7 items-center justify-center rounded-sm border border-border bg-surface text-heading transition-colors hover:bg-surface2" aria-label="Cancel explorer change">
              <X size={14} />
            </button>
          </div>
        ) : (
          <div
            ref={(element) => {
              nodeElementRefs.current[nodeId] = element;
            }}
            draggable={draftState === null}
            onDragStart={(event) => {
              handleDragStart(node);
              selectNode(nodeId);
              event.dataTransfer.effectAllowed = 'move';
              event.dataTransfer.setData('text/plain', node.path);
            }}
            onDragEnd={clearDragState}
            onDragOver={isFolder ? (event) => handleFolderDragOver(event, node.path, isOpen) : undefined}
            onDragLeave={isFolder ? handleFolderDragLeave : undefined}
            onDrop={isFolder ? (event) => {
              void handleDrop(event, node.path);
            } : undefined}
            className={rowClassName}
            style={{ paddingLeft }}
          >
            {isFolder ? (
              <>
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleFolder(node.path);
                    selectSingleNode(nodeId);
                    focusTree();
                  }}
                  className="inline-flex h-5 w-5 shrink-0 items-center justify-center text-muted transition-colors hover:text-heading"
                  aria-label={`${isOpen ? 'Collapse' : 'Expand'} folder ${node.name}`}
                >
                  {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                </button>
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={(event) => {
                    handleNodeSelection(node, event);
                  }}
                  onDoubleClick={(event) => {
                    if (event.shiftKey || event.ctrlKey || event.metaKey) return;
                    toggleFolder(node.path);
                    selectSingleNode(nodeId);
                    focusTree();
                  }}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  {isOpen ? <FolderOpen size={14} className="shrink-0 text-accent/80" /> : <Folder size={14} className="shrink-0 text-accent/80" />}
                  <span className="min-w-0 flex-1 truncate text-sm">{node.name}</span>
                </button>
              </>
            ) : (
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={(event) => handleNodeSelection(node, event)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                <span className="w-[13px] shrink-0" />
                <FileText size={14} className={`shrink-0 ${isActiveFile ? 'text-accent' : 'text-muted'}`} />
                <span className={`min-w-0 flex-1 truncate text-sm ${isActiveFile ? 'font-semibold' : ''}`}>{node.name}</span>
                {savedFileIds.has(node.id) && (
                  <span
                    className="inline-flex items-center gap-1 rounded-full border border-emerald-500/25 bg-emerald-500/8 px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-[0.12em] text-emerald-700"
                    title="Saved in Odyssey storage"
                  >
                    <Check size={10} />
                    Saved
                  </span>
                )}
              </button>
            )}
          </div>
        )}
        {isFolder && isOpen && renderNodeList(node.children, depth + 1, node.path)}
      </div>
    );
  };

  if (collapsed) {
    return (
      <aside className="flex h-full w-12 shrink-0 flex-col items-center border border-border bg-surface">
        {toolbarTooltip && (
          <div
            className="pointer-events-none fixed z-[60] -translate-x-1/2 whitespace-nowrap border border-border bg-surface2 px-2 py-1 text-[10px] font-mono uppercase tracking-[0.16em] text-heading shadow-lg"
            style={{ top: `${toolbarTooltip.top}px`, left: `${toolbarTooltip.left}px` }}
          >
            {toolbarTooltip.label}
          </div>
        )}
        <button
          type="button"
          onClick={() => {
            hideToolbarTooltip();
            onToggleCollapsed();
          }}
          className="mt-3 inline-flex h-9 w-9 items-center justify-center border border-border bg-surface2 text-heading transition-colors hover:bg-surface"
          aria-label="Expand thesis explorer"
          {...getToolbarTooltipProps('Expand Explorer')}
        >
          <PanelLeftOpen size={15} />
        </button>
      </aside>
    );
  }

  const isRootDropTarget = dropTargetPath === '';

  return (
    <aside className="flex h-full min-h-0 w-full shrink-0 flex-col border border-border bg-surface">
      {toolbarTooltip && (
        <div
          className="pointer-events-none fixed z-[60] -translate-x-1/2 whitespace-nowrap border border-border bg-surface2 px-2 py-1 text-[10px] font-mono uppercase tracking-[0.16em] text-heading shadow-lg"
          style={{ top: `${toolbarTooltip.top}px`, left: `${toolbarTooltip.left}px` }}
        >
          {toolbarTooltip.label}
        </div>
      )}
      <div className="flex items-center justify-between gap-2 border-b border-border bg-surface2 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-accent">Explorer</p>
          <p className="mt-1 truncate text-sm font-semibold text-heading" title={activeFile?.path ?? 'Thesis Workspace'}>
            {activeFile?.path ?? 'Thesis Workspace'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            hideToolbarTooltip();
            onToggleCollapsed();
          }}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center border border-border bg-surface text-heading transition-colors hover:bg-surface2"
          aria-label="Collapse thesis explorer"
          {...getToolbarTooltipProps('Collapse Explorer')}
        >
          <PanelLeftClose size={14} />
        </button>
      </div>

      <div ref={toolbarRef} className="relative flex items-center gap-1 border-b border-border px-3 py-2">
        <button type="button" onClick={() => beginDraft('new-file')} className="inline-flex h-8 w-8 items-center justify-center text-heading transition-colors hover:bg-surface2" aria-label="New file" {...getToolbarTooltipProps('New file')}>
          <FilePlus2 size={15} />
        </button>
        <button type="button" onClick={() => beginDraft('new-folder')} className="inline-flex h-8 w-8 items-center justify-center text-heading transition-colors hover:bg-surface2" aria-label="New folder" {...getToolbarTooltipProps('New folder')}>
          <FolderPlus size={15} />
        </button>
        <button
          type="button"
          onClick={() => setTemplateMenuOpen((current) => !current)}
          className={`inline-flex h-8 w-8 items-center justify-center text-heading transition-colors hover:bg-surface2 ${templateMenuOpen ? 'bg-surface2' : ''}`}
          aria-label="Add from template"
          aria-haspopup="menu"
          aria-expanded={templateMenuOpen}
          {...getToolbarTooltipProps('Add From Template')}
        >
          <FileText size={15} />
        </button>
        <button type="button" onClick={() => beginDraft('rename')} disabled={!hasSingleSelection || (!selectedFile && !selectedFolder)} className="inline-flex h-8 w-8 items-center justify-center text-heading transition-colors hover:bg-surface2 disabled:cursor-not-allowed disabled:opacity-35" aria-label="Rename selected item" {...getToolbarTooltipProps('Rename')}>
          <Pencil size={14} />
        </button>
        <button type="button" onClick={duplicateSelection} disabled={!hasSingleSelection || !selectedFile} className="inline-flex h-8 w-8 items-center justify-center text-heading transition-colors hover:bg-surface2 disabled:cursor-not-allowed disabled:opacity-35" aria-label="Duplicate selected file" {...getToolbarTooltipProps('Duplicate')}>
          <Copy size={14} />
        </button>
        <button type="button" onClick={deleteSelection} disabled={selectedNodeIds.size === 0} className="inline-flex h-8 w-8 items-center justify-center text-heading transition-colors hover:bg-surface2 disabled:cursor-not-allowed disabled:opacity-35" aria-label="Delete selected item" {...getToolbarTooltipProps('Delete')}>
          <Trash2 size={14} />
        </button>
        {templateMenuOpen && (
          <div className="absolute left-3 top-full z-20 mt-2 w-64 border border-border bg-surface shadow-xl">
            <div className="border-b border-border px-3 py-2">
              <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-accent">Add From Template</p>
            </div>
            <div className="p-1.5">
              {EXPLORER_TEMPLATE_DEFINITIONS.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => addFromTemplate(template)}
                  className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-sm text-heading transition-colors hover:bg-surface2"
                >
                  <FileText size={14} className="shrink-0 text-accent" />
                  <span>{template.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="border-b border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">
          {error}
        </div>
      )}

      <div
        ref={treeContainerRef}
        tabIndex={0}
        className={`min-h-0 flex-1 overflow-y-auto py-2 outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent/30 ${isRootDropTarget ? 'bg-accent/5' : isRootSelected ? 'bg-surface2/35' : ''}`}
        onPointerDown={handleTreeBackgroundPointerDown}
        onKeyDown={handleExplorerKeyDown}
        onDragOver={handleRootDragOver}
        onDragLeave={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
          if (!dragState) {
            setDropTargetPath(null);
            setIsExternalDropActive(false);
          }
        }}
        onDrop={(event) => {
          void handleDrop(event, '');
        }}
      >
        {tree.length === 0 && !draftState ? (
          <div className="px-4 py-6 text-sm text-muted">No files in this thesis workspace.</div>
        ) : (
          renderNodeList(tree, 0, '')
        )}
      </div>
    </aside>
  );
}
