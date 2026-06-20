import { FolderOpen, FileImage, FileCode, FileText, File } from 'lucide-react';

export const IMAGE_EXTS = new Set([
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'svg',
  'bmp',
  'ico',
  'tiff',
  'avif',
]);

export const TEXT_EXTS = new Set([
  'md',
  'markdown',
  'txt',
  'html',
  'htm',
  'css',
  'js',
  'ts',
  'jsx',
  'tsx',
  'json',
  'yaml',
  'yml',
  'toml',
  'csv',
  'xml',
  'sh',
  'bash',
  'py',
  'rs',
  'go',
  'java',
  'c',
  'cpp',
  'h',
  'hpp',
  'rb',
  'php',
  'swift',
  'kt',
  'sql',
  'graphql',
  'env',
  'log',
  'ini',
  'conf',
  'dockerfile',
  'makefile',
]);

export type FileKind = 'image' | 'text';

export function getFileKind(name: string): FileKind | null {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (TEXT_EXTS.has(ext) || ext === '') return 'text';
  return null;
}

export function getFileMimeType(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const mimeMap: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    bmp: 'image/bmp',
    tiff: 'image/tiff',
    ico: 'image/x-icon',
    avif: 'image/avif',
    md: 'text/markdown',
    markdown: 'text/markdown',
    txt: 'text/plain',
    html: 'text/html',
    htm: 'text/html',
    css: 'text/css',
    js: 'text/javascript',
    ts: 'text/typescript',
    json: 'application/json',
    xml: 'application/xml',
    csv: 'text/csv',
    yaml: 'text/yaml',
    yml: 'text/yaml',
    sh: 'text/x-sh',
    py: 'text/x-python',
  };
  return mimeMap[ext] ?? 'text/plain';
}

export function getExtColor(ext: string): string {
  const map: Record<string, string> = {
    pdf: '#E5534B',
    doc: '#2B579A',
    docx: '#2B579A',
    xls: '#217346',
    xlsx: '#217346',
    ppt: '#D24726',
    pptx: '#D24726',
    zip: '#C17D11',
    rar: '#C17D11',
    '7z': '#C17D11',
    tar: '#C17D11',
    gz: '#C17D11',
    js: '#F59E0B',
    jsx: '#F59E0B',
    ts: '#3B82F6',
    tsx: '#3B82F6',
    py: '#3776AB',
    rs: '#B7410E',
    go: '#00ACD7',
    java: '#E76F00',
    cs: '#9B4F96',
    html: '#E44D26',
    htm: '#E44D26',
    css: '#264DE4',
    svg: '#FFB13B',
  };
  return map[ext.toLowerCase()] ?? '#6B7280';
}

export function getFormatLabel(ext: string): string {
  const map: Record<string, string> = {
    jpg: 'JPEG 图片',
    jpeg: 'JPEG 图片',
    png: 'PNG 图片',
    gif: 'GIF 动图',
    webp: 'WebP 图片',
    bmp: 'BMP 图片',
    tiff: 'TIFF 图片',
    ico: '图标文件',
    avif: 'AVIF 图片',
    svg: 'SVG 矢量图',
    pdf: 'PDF',
    doc: 'Word',
    docx: 'Word',
    xls: 'Excel',
    xlsx: 'Excel',
    ppt: 'PowerPoint',
    pptx: 'PowerPoint',
    zip: 'ZIP 归档',
    rar: 'RAR 归档',
    '7z': '7Z 归档',
    tar: 'TAR 归档',
    gz: 'GZ 归档',
    md: 'Markdown',
    txt: '纯文本',
    json: 'JSON',
    yaml: 'YAML',
    yml: 'YAML',
    toml: 'TOML',
    html: 'HTML',
    htm: 'HTML',
    css: 'CSS',
    js: 'JavaScript',
    jsx: 'JavaScript',
    ts: 'TypeScript',
    tsx: 'TypeScript',
    py: 'Python',
    rs: 'Rust',
    go: 'Go',
    java: 'Java',
    cs: 'C#',
  };
  return map[ext.toLowerCase()] ?? ext.toUpperCase();
}

export function getFileIcon(fileName: string, className?: string) {
  const baseClass = className ?? 'text-black/40 dark:text-white/40 shrink-0';
  if (fileName.endsWith('/')) {
    return <FolderOpen size={14} className={baseClass} />;
  }
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  if (IMAGE_EXTS.has(ext)) {
    return <FileImage size={14} className={baseClass} />;
  }
  if (TEXT_EXTS.has(ext)) {
    const codeExts = new Set([
      'js', 'jsx', 'ts', 'tsx', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'h',
      'hpp', 'html', 'css', 'json', 'yaml', 'yml', 'toml', 'sh', 'bash',
      'sql', 'graphql', 'xml', 'dockerfile', 'makefile',
    ]);
    if (codeExts.has(ext)) {
      return <FileCode size={14} className={baseClass} />;
    }
    return <FileText size={14} className={baseClass} />;
  }
  return <File size={14} className={baseClass} />;
}

export function getFileIconSvg(fileName: string): string {
  if (fileName.endsWith('/')) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-sky-600 inline-block mr-1 shrink-0" style="vertical-align: -1.5px;"><path d="m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5c0-1.1.9-2 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2"/></svg>`;
  }
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  if (IMAGE_EXTS.has(ext)) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-sky-600 inline-block mr-1 shrink-0" style="vertical-align: -1.5px;"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><circle cx="9" cy="11" r="1"/><path d="m17 13-3-3-5 5"/></svg>`;
  }
  const codeExts = new Set([
    'js', 'jsx', 'ts', 'tsx', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'h',
    'hpp', 'html', 'css', 'json', 'yaml', 'yml', 'toml', 'sh', 'bash',
    'sql', 'graphql', 'xml', 'dockerfile', 'makefile',
  ]);
  if (codeExts.has(ext)) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-sky-600 inline-block mr-1 shrink-0" style="vertical-align: -1.5px;"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="m10 13-2 2 2 2"/><path d="m14 17 2-2-2-2"/></svg>`;
  }
  if (TEXT_EXTS.has(ext)) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-sky-600 inline-block mr-1 shrink-0" style="vertical-align: -1.5px;"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M9 9h1"/><path d="M9 13h6"/><path d="M9 17h6"/></svg>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-sky-600 inline-block mr-1 shrink-0" style="vertical-align: -1.5px;"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>`;
}

export function createFileBadgeDOM(displayPath: string, absolutePath: string): HTMLSpanElement {
  const badge = document.createElement('span');
  badge.className = 'text-sky-600 text-[14.5px] font-medium mx-1 select-all';
  badge.setAttribute('contenteditable', 'false');
  badge.setAttribute('data-file-path', absolutePath);

  const iconSvg = getFileIconSvg(displayPath);
  badge.innerHTML = `${iconSvg}<span>${displayPath}</span>`;
  return badge;
}

export function createSkillBadgeDOM(skillName: string, skillId: string): HTMLSpanElement {
  const badge = document.createElement('span');
  badge.className = 'text-sky-600 text-[14.5px] font-medium mx-1 select-all';
  badge.setAttribute('contenteditable', 'false');
  badge.setAttribute('data-skill-id', skillId);
  badge.setAttribute('data-skill-name', skillName);

  const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-sky-500 inline-block mr-1 shrink-0" style="vertical-align: -1.5px;"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>`;

  badge.innerHTML = `${iconSvg}<span style="position:absolute;width:0;height:0;opacity:0;overflow:hidden">/</span><span>${skillName}</span>`;
  return badge;
}
