import { X } from 'lucide-react';
import { getExtColor, getFormatLabel } from './fileUtils';

export interface AttachmentFile {
  name: string;
  /** 文件的 data URL（web 环境用 FileReader 生成） */
  dataUrl?: string;
  mimeType: string;
  kind: 'image' | 'text';
  size: number;
}

export interface AttachmentCardProps {
  file: AttachmentFile;
  previewUrl?: string;
  onRemove: () => void;
}

export default function AttachmentCard({ file, previewUrl, onRemove }: AttachmentCardProps) {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const baseName = file.name.replace(/\.[^/.]+$/, '');

  return (
    <div className="relative group flex-shrink-0 w-[160px] h-[60px] rounded-xl border dark:border-white/[0.10] border-black/[0.09] bg-white dark:bg-white/[0.06] overflow-hidden transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.10]">
      {/* 删除按键 */}
      <button
        onClick={onRemove}
        className="absolute top-1 right-1 z-10 w-4 h-4 rounded-full bg-white dark:bg-[#2a2826] border dark:border-white/[0.15] border-black/[0.15] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
      >
        <X size={9} strokeWidth={2.5} className="dark:text-white/70 text-black/60" />
      </button>

      <div className="flex items-center gap-2 h-full px-2.5">
        {/* 左侧：图片缩略图 或 彩色图标 */}
        {file.kind === 'image' && previewUrl ? (
          // Preview URLs are local data/blob URLs, which Next.js cannot optimize.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previewUrl}
            alt={file.name}
            className="w-9 h-9 rounded-lg object-cover shrink-0"
          />
        ) : (
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
            style={{ backgroundColor: getExtColor(ext) }}
          >
            <span className="text-[9px] font-bold text-white uppercase leading-none">
              {ext.slice(0, 4) || 'FILE'}
            </span>
          </div>
        )}
        {/* 右侧：文件名 + 格式 */}
        <div className="flex flex-col min-w-0">
          <span className="text-[11.5px] font-medium dark:text-[#e8e3d8] text-[#2d2b26] truncate leading-snug block">
            {baseName}
          </span>
          <span className="text-[10px] dark:text-white/40 text-black/40 leading-snug">
            {getFormatLabel(ext)}
          </span>
        </div>
      </div>
    </div>
  );
}
