import React from 'react';
import { getFileIcon } from './fileUtils';

export interface FilesPanelProps {
  files: string[];
  selectedIndex: number;
  onSelectFile: (filePath: string) => void;
  onHoverIndex: (index: number) => void;
}

const FilesPanel = React.forwardRef<HTMLDivElement, FilesPanelProps>(
  ({ files, selectedIndex, onSelectFile, onHoverIndex }, ref) => {
    return (
      <div
        ref={ref}
        className="absolute bottom-full left-0 right-0 mb-2 z-50 dark:bg-[#242220] bg-white dark:border-white/[0.10] border-black/[0.10] border rounded-xl shadow-xl p-1 max-h-[280px] overflow-y-auto scrollbar-thin"
      >
        <div className="text-[11px] font-medium dark:text-white/30 text-black/35 px-2.5 py-1.5 uppercase tracking-wider">
          项目文件
        </div>
        {files.length === 0 ? (
          <div className="px-2.5 py-3 text-[12px] dark:text-white/30 text-black/35 text-center select-none">
            暂无文件
          </div>
        ) : (
          <div className="space-y-0.5">
            {files.map((filePath, index) => {
              const isSelected = index === selectedIndex;
              const isDir = filePath.endsWith('/');
              const cleanPath = isDir ? filePath.slice(0, -1) : filePath;
              const fileName = cleanPath.split('/').pop() || cleanPath;
              const displayName = isDir ? `${fileName}/` : fileName;
              return (
                <div
                  key={filePath}
                  onClick={() => onSelectFile(filePath)}
                  onMouseEnter={() => onHoverIndex(index)}
                  className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg cursor-default transition-all ${
                    isSelected ? 'dark:bg-white/[0.06] bg-black/[0.05]' : ''
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="shrink-0 flex items-center">{getFileIcon(filePath)}</span>
                    <span className="text-[13px] font-medium dark:text-[#e8e3d8] text-[#2d2b26] shrink-0">
                      {displayName}
                    </span>
                    <span className="text-[11px] dark:text-white/35 text-black/40 truncate flex-1 pt-0.5">
                      {filePath}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  },
);

FilesPanel.displayName = 'FilesPanel';

export default FilesPanel;
