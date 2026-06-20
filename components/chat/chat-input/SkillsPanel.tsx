import React from 'react';
import { Box } from 'lucide-react';

export interface Skill {
  id: string;
  name: string;
  description?: string | null;
}

export interface SkillWithLabel extends Skill {
  groupLabel?: string;
}

export interface SkillsPanelProps {
  skills: SkillWithLabel[];
  selectedIndex: number;
  skillsFilter: string;
  onSelectSkill: (skill: Skill) => void;
  onHoverIndex: (index: number) => void;
}

function highlightMatch(text: string, query: string) {
  if (!query) return <span>{text}</span>;
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  if (index === -1) return <span>{text}</span>;
  const before = text.slice(0, index);
  const match = text.slice(index, index + query.length);
  const after = text.slice(index + query.length);
  return (
    <span>
      {before}
      <span className="font-semibold text-black dark:text-white">{match}</span>
      {after}
    </span>
  );
}

const SkillsPanel = React.forwardRef<HTMLDivElement, SkillsPanelProps>(
  ({ skills, selectedIndex, skillsFilter, onSelectSkill, onHoverIndex }, ref) => {
    return (
      <div
        ref={ref}
        className="absolute bottom-full left-0 right-0 mb-2 z-50 dark:bg-[#242220] bg-white dark:border-white/[0.10] border-black/[0.10] border rounded-xl shadow-xl p-1 max-h-[280px] overflow-y-auto scrollbar-thin"
      >
        <div className="text-[11px] font-medium dark:text-white/30 text-black/35 px-2.5 py-1.5 uppercase tracking-wider">
          已安装技能
        </div>
        {skills.length === 0 ? (
          <div className="px-2.5 py-3 text-[12px] dark:text-white/30 text-black/35 text-center select-none">
            {skillsFilter ? '无匹配技能' : '暂无可用技能'}
          </div>
        ) : (
          <div className="space-y-0.5">
            {skills.map((skill, index) => {
              const isSelected = index === selectedIndex;
              return (
                <div
                  key={skill.id}
                  onClick={() => onSelectSkill(skill)}
                  onMouseEnter={() => onHoverIndex(index)}
                  className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg cursor-default transition-all ${
                    isSelected ? 'dark:bg-white/[0.06] bg-black/[0.05]' : ''
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <Box size={14} className="dark:text-white/40 text-black/45 shrink-0 mt-0.5" />
                    <span className="text-[13px] font-medium dark:text-[#e8e3d8] text-[#2d2b26] shrink-0">
                      {highlightMatch(skill.name, skillsFilter)}
                    </span>
                    {skill.description && (
                      <span className="text-[11px] dark:text-white/35 text-black/40 truncate flex-1 ml-1.5 pt-0.5">
                        {highlightMatch(skill.description, skillsFilter)}
                      </span>
                    )}
                  </div>
                  {skill.groupLabel && (
                    <span className="text-[10px] font-medium dark:bg-white/[0.04] bg-black/[0.04] dark:text-white/30 text-black/35 px-1.5 py-0.5 rounded shrink-0 ml-2">
                      {skill.groupLabel}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  },
);

SkillsPanel.displayName = 'SkillsPanel';

export default SkillsPanel;
