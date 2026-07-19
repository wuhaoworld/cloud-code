"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Plus, Square, ArrowUp, ChevronDown, Check } from "lucide-react";
import { useAppStore } from "@/store/app-store";
import { cn } from "@/lib/utils";
import type { PermissionMode } from "@/lib/permission-mode";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import AttachmentCard, {
  type AttachmentFile,
} from "./chat-input/AttachmentCard";
import SkillsPanel, {
  type Skill,
  type SkillWithLabel,
} from "./chat-input/SkillsPanel";
import FilesPanel from "./chat-input/FilesPanel";
import {
  getFileKind,
  getFileMimeType,
  createFileBadgeDOM,
  createSkillBadgeDOM,
} from "./chat-input/fileUtils";

// ── Editor Helper ──────────────────────────────────────────────────

function parseEditorContents(editor: HTMLDivElement) {
  let text = "";
  const skillIds: string[] = [];

  const traverse = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent;
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      if (el.getAttribute("data-skill-id")) {
        const skillId = el.getAttribute("data-skill-id")!;
        const skillName = el.getAttribute("data-skill-name")!;
        text += `@[skill:${skillName}]`;
        if (!skillIds.includes(skillId)) {
          skillIds.push(skillId);
        }
      } else if (el.getAttribute("data-file-path")) {
        const filePath = el.getAttribute("data-file-path")!;
        text += `@[${filePath}]`;
      } else {
        if (el.tagName === "BR") {
          text += "\n";
        } else {
          for (let i = 0; i < el.childNodes.length; i++) {
            traverse(el.childNodes[i]);
          }
          if (el.tagName === "DIV" || el.tagName === "P") {
            text += "\n";
          }
        }
      }
    }
  };

  for (let i = 0; i < editor.childNodes.length; i++) {
    traverse(editor.childNodes[i]);
  }

  return { text: text.trim(), skillIds };
}

// ── Props ──────────────────────────────────────────────────────────

interface ChatInputProps {
  onSend: (
    prompt: string,
    attachments?: AttachmentFile[],
    skillIds?: string[] | null,
    permissionMode?: PermissionMode,
    model?: string,
  ) => void;
  onStop?: () => void;
  disabled?: boolean;
  placeholder?: string;
  /** 当前项目 ID（用于加载文件列表和技能列表） */
  projectId?: string | null;
  /** 可选的项目选择器，渲染在输入框底部 */
  projectSelector?: React.ReactNode;
}

const MAX_ATTACHMENTS = 5;
const EMPTY_PROJECT_FILES: string[] = [];

interface ModelOption {
  name: string;
  id: string;
}
const MODEL_FALLBACK: ModelOption = { name: "默认模型", id: "" };

// ── Component ──────────────────────────────────────────────────────

export function ChatInput({
  onSend,
  onStop,
  disabled = false,
  placeholder = "向 AI 询问任何问题... 输入 / 使用技能，@ 提及文件",
  projectId,
  projectSelector,
}: ChatInputProps) {
  const isStreaming = useAppStore((s) => s.isStreaming);
  const projectFilesCacheEntry = useAppStore((s) =>
    projectId ? s.projectFilesById[projectId] : undefined,
  );
  const projectFiles = projectFilesCacheEntry?.files ?? EMPTY_PROJECT_FILES;
  const ensureProjectFiles = useAppStore((s) => s.ensureProjectFiles);
  const isActive = isStreaming;

  const [model, setModel] = useState<ModelOption>({ name: "Loading…", id: "" });
  const [models, setModels] = useState<ModelOption[]>([]);

  // Fetch models from settings
  useEffect(() => {
    fetch("/api/settings/models")
      .then((r) => r.json())
      .then((data: { models?: ModelOption[] }) => {
        const seen = new Set<string>();
        const list = (data.models ?? []).filter((m) => {
          if (!m.id || seen.has(m.id)) return false;
          seen.add(m.id);
          return true;
        });
        setModels(list);

        const stored = localStorage.getItem("selected-model-id");
        const found = stored ? list.find((m) => m.id === stored) : undefined;
        if (found) {
          setModel(found);
        } else if (list.length > 0) {
          setModel(list[0]);
        } else {
          setModel(MODEL_FALLBACK);
        }
      })
      .catch(() => {
        setModels([]);
        setModel(MODEL_FALLBACK);
      });
  }, []);

  const permissionMode: PermissionMode = "bypassPermissions";

  const handleModelChange = (m: ModelOption) => {
    setModel(m);
    localStorage.setItem("selected-model-id", m.id);
  };

  // ── Editor state ──
  const editorRef = useRef<HTMLDivElement>(null);
  const editorSelectionRef = useRef<{
    node: Text;
    offset: number;
    length: number;
  } | null>(null);
  const skillsPanelRef = useRef<HTMLDivElement>(null);
  const filesPanelRef = useRef<HTMLDivElement>(null);
  const [hasText, setHasText] = useState(false);

  // ── Attachments ──
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [attachments, setAttachments] = useState<AttachmentFile[]>([]);
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});

  // ── Skills ──
  const [skills, setSkills] = useState<SkillWithLabel[]>([]);
  const [showSkillsPanel, setShowSkillsPanel] = useState(false);
  const [skillsFilter, setSkillsFilter] = useState("");
  const [selectedSkills, setSelectedSkills] = useState<Skill[]>([]);

  // ── Files ──
  const [showFilesPanel, setShowFilesPanel] = useState(false);
  const [filesFilter, setFilesFilter] = useState("");

  // ── Shared dropdown index ──
  const [selectedIndex, setSelectedIndex] = useState(0);

  const canSend =
    (hasText || attachments.length > 0) && !isActive && !disabled;

  // ── Sync editor text state ──
  const syncEditorState = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;

    const badges = Array.from(editor.querySelectorAll("span[data-skill-id]"));
    const badgeIds = badges.map((b) => b.getAttribute("data-skill-id"));
    const matchedSkills = skills.filter((s) => badgeIds.includes(s.id));
    setSelectedSkills(matchedSkills);

    const textContent = editor.textContent || "";
    const containsBadge =
      editor.querySelector("span[data-skill-id]") !== null ||
      editor.querySelector("span[data-file-path]") !== null;
    setHasText(textContent.length > 0 || containsBadge);
  }, [skills]);

  // ── Load skills ──
  useEffect(() => {
    if (!projectId) return;
    fetch(`/api/projects/${projectId}/skills`)
      .then((r) => r.json())
      .then((data: { groups?: Array<{ label: string; skills: Skill[] }> }) => {
        const allSkills: SkillWithLabel[] = (data.groups ?? []).flatMap((g) =>
          g.skills.map((s) => ({ ...s, groupLabel: g.label })),
        );
        setSkills(allSkills);
      })
      .catch((err) => console.error("Failed to load skills:", err));
  }, [projectId]);

  // ── Load shared project files ──
  useEffect(() => {
    if (projectId) void ensureProjectFiles(projectId);
  }, [ensureProjectFiles, projectFilesCacheEntry, projectId]);

  // ── Click outside to close panels ──
  useEffect(() => {
    if (!showSkillsPanel && !showFilesPanel) return;

    const handleDocumentClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const insideEditor =
        editorRef.current && editorRef.current.contains(target);
      const insideSkillsPanel =
        skillsPanelRef.current && skillsPanelRef.current.contains(target);
      const insideFilesPanel =
        filesPanelRef.current && filesPanelRef.current.contains(target);

      if (!insideEditor && !insideSkillsPanel && !insideFilesPanel) {
        setShowSkillsPanel(false);
        setShowFilesPanel(false);
        setSkillsFilter("");
        setFilesFilter("");
        setSelectedIndex(0);
        editorSelectionRef.current = null;
      }
    };

    document.addEventListener("mousedown", handleDocumentClick);
    return () => document.removeEventListener("mousedown", handleDocumentClick);
  }, [showSkillsPanel, showFilesPanel]);

  // ── Filtered lists ──
  const filteredSkills = useMemo(() => {
    const unselected = skills.filter(
      (s) => !selectedSkills.some((sel) => sel.id === s.id),
    );
    if (!skillsFilter) return unselected;
    const q = skillsFilter.toLowerCase();
    return unselected.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.description && s.description.toLowerCase().includes(q)),
    );
  }, [skills, skillsFilter, selectedSkills]);

  const filteredFiles = useMemo(() => {
    const q = filesFilter.toLowerCase();
    const results = q
      ? projectFiles.filter((f) => f.toLowerCase().includes(q))
      : projectFiles;
    return results.slice(0, 20);
  }, [projectFiles, filesFilter]);

  // ── Auto focus ──
  useEffect(() => {
    if (!disabled) editorRef.current?.focus();
  }, [disabled]);

  // ── Cleanup preview URLs ──
  useEffect(() => {
    return () => {
      Object.values(previewUrls).forEach((url) => URL.revokeObjectURL(url));
    };
  }, [previewUrls]);

  // ── Select skill ──
  const handleSelectSkill = (skill: Skill) => {
    const editor = editorRef.current;
    if (!editor) return;

    editor.focus();
    const selection = window.getSelection();
    if (!selection) return;

    let range: Range;
    if (editorSelectionRef.current) {
      const { node, offset, length } = editorSelectionRef.current;
      range = document.createRange();
      try {
        range.setStart(node, offset);
        range.setEnd(node, offset + length);
      } catch {
        range = selection.getRangeAt(0);
      }
    } else {
      range = selection.getRangeAt(0);
    }

    range.deleteContents();
    const badge = createSkillBadgeDOM(skill.name, skill.id);
    range.insertNode(badge);
    const spaceNode = document.createTextNode(" ");
    badge.after(spaceNode);
    const newRange = document.createRange();
    newRange.setStartAfter(spaceNode);
    newRange.setEndAfter(spaceNode);
    selection.removeAllRanges();
    selection.addRange(newRange);

    setShowSkillsPanel(false);
    setSkillsFilter("");
    setSelectedIndex(0);
    editorSelectionRef.current = null;
    syncEditorState();
  };

  // ── Select file ──
  const handleSelectFile = (filePath: string) => {
    const editor = editorRef.current;
    if (!editor) return;

    editor.focus();
    const selection = window.getSelection();
    if (!selection) return;

    let range: Range;
    if (editorSelectionRef.current) {
      const { node, offset, length } = editorSelectionRef.current;
      range = document.createRange();
      try {
        range.setStart(node, offset);
        range.setEnd(node, offset + length);
      } catch {
        range = selection.getRangeAt(0);
      }
    } else {
      range = selection.getRangeAt(0);
    }

    range.deleteContents();
    const badge = createFileBadgeDOM(filePath, filePath);
    range.insertNode(badge);
    const spaceNode = document.createTextNode(" ");
    badge.after(spaceNode);
    const newRange = document.createRange();
    newRange.setStartAfter(spaceNode);
    newRange.setEndAfter(spaceNode);
    selection.removeAllRanges();
    selection.addRange(newRange);

    setShowFilesPanel(false);
    setFilesFilter("");
    setSelectedIndex(0);
    editorSelectionRef.current = null;
    syncEditorState();
  };

  // ── Editor input — detect / and @ triggers ──
  const handleEditorInput = () => {
    if (disabled) return;
    syncEditorState();

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    const container = range.startContainer;

    if (container.nodeType === Node.TEXT_NODE) {
      const text = container.textContent || "";
      const offset = range.startOffset;
      const textBeforeCursor = text.slice(0, offset);
      const lastSlashIdx = textBeforeCursor.lastIndexOf("/");
      const lastAtIdx = projectId
        ? textBeforeCursor.lastIndexOf("@")
        : -1;

      const triggerIdx = Math.max(lastSlashIdx, lastAtIdx);
      if (triggerIdx !== -1) {
        const triggerChar = textBeforeCursor[triggerIdx];
        const textBetween = textBeforeCursor.slice(triggerIdx + 1);
        if (!textBetween.includes(" ") && !textBetween.includes("\n")) {
          const charBeforeTrigger =
            triggerIdx > 0 ? textBeforeCursor[triggerIdx - 1] : "";
          if (
            triggerIdx === 0 ||
            charBeforeTrigger === " " ||
            charBeforeTrigger === "\xA0" ||
            charBeforeTrigger === "\n"
          ) {
            if (triggerChar === "/") {
              setShowSkillsPanel(true);
              setShowFilesPanel(false);
              setSkillsFilter(textBetween);
              setSelectedIndex(0);
              editorSelectionRef.current = {
                node: container as Text,
                offset: triggerIdx,
                length: textBetween.length + 1,
              };
              return;
            } else if (triggerChar === "@") {
              setShowFilesPanel(true);
              setShowSkillsPanel(false);
              setFilesFilter(textBetween);
              setSelectedIndex(0);
              editorSelectionRef.current = {
                node: container as Text,
                offset: triggerIdx,
                length: textBetween.length + 1,
              };
              return;
            }
          }
        }
      }
    }

    setShowSkillsPanel(false);
    setShowFilesPanel(false);
    setSkillsFilter("");
    setFilesFilter("");
    setSelectedIndex(0);
    editorSelectionRef.current = null;
  };

  // ── Keyboard navigation ──
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) {
      e.preventDefault();
      return;
    }

    if (showSkillsPanel && filteredSkills.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % filteredSkills.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex(
          (prev) => (prev - 1 + filteredSkills.length) % filteredSkills.length,
        );
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        handleSelectSkill(filteredSkills[selectedIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setShowSkillsPanel(false);
        return;
      }
    }

    if (showFilesPanel && filteredFiles.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % filteredFiles.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex(
          (prev) => (prev - 1 + filteredFiles.length) % filteredFiles.length,
        );
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        handleSelectFile(filteredFiles[selectedIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setShowFilesPanel(false);
        return;
      }
    }

    // Backspace：删除 badge
    if (e.key === "Backspace") {
      const sel = window.getSelection();
      if (sel && sel.isCollapsed && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        const container = range.startContainer;
        const offset = range.startOffset;

        if (container.nodeType === Node.TEXT_NODE && offset === 0) {
          const prevSibling = container.previousSibling;
          if (
            prevSibling &&
            prevSibling.nodeType === Node.ELEMENT_NODE &&
            ((prevSibling as HTMLElement).getAttribute("data-skill-id") ||
              (prevSibling as HTMLElement).getAttribute("data-file-path"))
          ) {
            e.preventDefault();
            prevSibling.remove();
            syncEditorState();
            return;
          }
        }
        if (container.nodeType === Node.ELEMENT_NODE) {
          const prevSibling = container.childNodes[offset - 1];
          if (
            prevSibling &&
            prevSibling.nodeType === Node.ELEMENT_NODE &&
            ((prevSibling as HTMLElement).getAttribute("data-skill-id") ||
              (prevSibling as HTMLElement).getAttribute("data-file-path"))
          ) {
            e.preventDefault();
            prevSibling.remove();
            syncEditorState();
            return;
          }
        }
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!isActive && canSend) handleSend();
    }
  };

  // ── Paste: plain text only ──
  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    if (disabled) {
      e.preventDefault();
      return;
    }
    const pastedText = e.clipboardData.getData("text/plain");
    if (!pastedText) return;

    e.preventDefault();
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    range.deleteContents();
    const textNode = document.createTextNode(pastedText);
    range.insertNode(textNode);
    const newRange = document.createRange();
    newRange.setStartAfter(textNode);
    newRange.setEndAfter(textNode);
    selection.removeAllRanges();
    selection.addRange(newRange);
    syncEditorState();
  };

  // ── Send ──
  const handleSend = useCallback(() => {
    const editor = editorRef.current;
    if (!editor || !canSend) return;

    const { text, skillIds } = parseEditorContents(editor);
    onSend(
      text,
      attachments.length > 0 ? attachments : undefined,
      skillIds,
      permissionMode,
      model.id || undefined,
    );

    editor.innerHTML = "";
    setHasText(false);
    setSelectedSkills([]);
    setPreviewUrls((prev) => {
      Object.values(prev).forEach((url) => URL.revokeObjectURL(url));
      return {};
    });
    setAttachments([]);

    setTimeout(() => editor.focus(), 0);
  }, [canSend, onSend, attachments, permissionMode, model]);

  // ── Attachment: add ──
  const handleAddAttachment = () => {
    if (disabled || attachments.length >= MAX_ATTACHMENTS) return;
    fileInputRef.current?.click();
  };

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      if (!files.length) return;

      const remaining = MAX_ATTACHMENTS - attachments.length;
      const toAdd = files.slice(0, remaining);

      const newAttachments: AttachmentFile[] = [];
      const newPreviews: Record<string, string> = {};

      for (const file of toAdd) {
        const kind = getFileKind(file.name);
        if (!kind) continue;

        const attachment: AttachmentFile = {
          name: file.name,
          mimeType: getFileMimeType(file.name),
          kind,
          size: file.size,
        };
        newAttachments.push(attachment);

        if (kind === "image") {
          newPreviews[file.name + file.size] = URL.createObjectURL(file);
        }
      }

      setAttachments((prev) => [...prev, ...newAttachments]);
      setPreviewUrls((prev) => ({ ...prev, ...newPreviews }));
      e.target.value = "";
    },
    [attachments.length],
  );

  const removeAttachment = (index: number) => {
    const file = attachments[index];
    const key = file.name + file.size;
    if (previewUrls[key]) {
      URL.revokeObjectURL(previewUrls[key]);
      setPreviewUrls((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  // ── Render ──────────────────────────────────────────────────────

  return (
    <div className="relative w-full">
      {/* Skills Panel */}
      {!disabled && showSkillsPanel && (
        <SkillsPanel
          ref={skillsPanelRef}
          skills={filteredSkills}
          selectedIndex={selectedIndex}
          skillsFilter={skillsFilter}
          onSelectSkill={handleSelectSkill}
          onHoverIndex={setSelectedIndex}
        />
      )}

      {/* Files Panel */}
      {!disabled && showFilesPanel && (
        <FilesPanel
          ref={filesPanelRef}
          files={filteredFiles}
          selectedIndex={selectedIndex}
          onSelectFile={handleSelectFile}
          onHoverIndex={setSelectedIndex}
        />
      )}

      {/* Outer gray wrapper — only when projectSelector is visible */}
      <div
        className={
          projectSelector
            ? "w-full rounded-[18px] dark:bg-white/[0.03] bg-black/[0.035]"
            : "w-full"
        }
      >
        {/* Main Input Box — with its own border */}
        <div className="w-full overflow-hidden transition-colors border dark:border-white/[0.12] border-black/[0.10] dark:bg-white/[0.04] bg-white focus-within:border-black/[0.18] dark:focus-within:border-white/[0.20] rounded-[18px]">
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={[
              "image/*",
              ".md", ".markdown", ".txt", ".html", ".htm", ".css",
              ".js", ".ts", ".jsx", ".tsx", ".json", ".yaml", ".yml",
              ".toml", ".csv", ".xml", ".sh", ".bash", ".py", ".rs",
              ".go", ".java", ".c", ".cpp", ".h", ".hpp", ".rb", ".php",
              ".swift", ".kt", ".sql", ".graphql", ".env", ".log",
              ".ini", ".conf",
            ].join(",")}
            className="hidden"
            onChange={handleFileChange}
          />

          {/* Attachments preview row */}
          {attachments.length > 0 && (
            <div className="px-3 pt-3 pb-0">
              <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-none">
                {attachments.map((file, i) => (
                  <AttachmentCard
                    key={`${file.name}-${file.size}-${i}`}
                    file={file}
                    previewUrl={previewUrls[file.name + file.size]}
                    onRemove={() => removeAttachment(i)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* ContentEditable Editor */}
          <div
            className={`px-3 pt-3 relative flex items-start min-h-[60px] ${
              disabled ? "cursor-not-allowed" : "cursor-text"
            }`}
            onClick={() => {
              if (!disabled) editorRef.current?.focus();
            }}
          >
            {/* Placeholder */}
            {!hasText && (
              <div className="absolute left-3 top-[14px] pointer-events-none text-[14.5px] dark:text-white/25 text-black/28 leading-relaxed select-none">
                {placeholder}
              </div>
            )}

            <div
              ref={editorRef}
              contentEditable={!disabled}
              suppressContentEditableWarning
              onInput={handleEditorInput}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              aria-disabled={disabled}
              id="chat-input"
              className={`w-full bg-transparent border-none outline-none resize-none text-[14.5px] dark:text-[#e8e3d8] text-[#2d2b26] leading-relaxed max-h-[200px] overflow-y-auto min-h-[48px] break-all whitespace-pre-wrap outline-0 ${
                disabled ? "pointer-events-none opacity-60" : ""
              }`}
              style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
            />
          </div>

          {/* Bottom toolbar */}
          <div className="flex items-center justify-between px-1.5 pb-1.5">
            {/* Left: add attachment */}
            <div className="flex items-center gap-0.5">
              <button
                title={
                  attachments.length >= MAX_ATTACHMENTS
                    ? `最多添加 ${MAX_ATTACHMENTS} 个附件`
                    : "添加附件"
                }
                onClick={handleAddAttachment}
                disabled={disabled || attachments.length >= MAX_ATTACHMENTS}
                className="flex items-center justify-center w-7 h-7 rounded-lg dark:text-white/45 text-black/40 dark:hover:bg-white/[0.06] hover:bg-black/[0.05] dark:hover:text-white/70 hover:text-black/65 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Plus size={14} />
              </button>
            </div>

            {/* Right: model selector slot + send/stop */}
            <div className="flex items-center gap-1.5">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    disabled={disabled}
                    className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-[12.5px] dark:text-white/55 text-black/45 dark:hover:bg-white/[0.06] hover:bg-black/[0.05] dark:hover:text-white/75 hover:text-black/65 transition-all outline-none"
                  >
                    <span>{model.name}</span>
                    <ChevronDown className="size-3 opacity-60" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[120px] w-fit max-w-[320px] p-1 space-y-0.5">
                  {models.length === 0 ? (
                    <DropdownMenuItem
                      disabled
                      className="px-3 py-1.5 rounded-lg text-[13px] text-muted-foreground"
                    >
                      未检测到可选模型
                    </DropdownMenuItem>
                  ) : (
                    models.map((m) => (
                      <DropdownMenuItem
                        key={m.id}
                        onClick={() => handleModelChange(m)}
                        className={cn(
                          "flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg text-[13px] cursor-default whitespace-nowrap",
                          m.id === model.id && "bg-accent"
                        )}
                      >
                        <span className="truncate">{m.name}</span>
                        {m.id === model.id && <Check className="size-3.5 shrink-0" />}
                      </DropdownMenuItem>
                    ))
                  )}
                </DropdownMenuContent>
              </DropdownMenu>

              <button
                onClick={isActive ? onStop : handleSend}
                title={isActive ? "停止生成" : "发送"}
                disabled={!isActive && !canSend}
                id="chat-send-btn"
                className={`flex items-center justify-center w-[26px] h-[26px] rounded-full transition-all shrink-0 ${
                  isActive
                    ? "cursor-pointer bg-[#3a3835] dark:bg-[#e8e3d8] text-white dark:text-[#2d2b26] hover:bg-[#2d2b26] dark:hover:bg-white"
                    : canSend
                      ? "cursor-pointer bg-[#3a3835] dark:bg-[#e8e3d8] text-white dark:text-[#2d2b26] hover:bg-[#2d2b26] dark:hover:bg-white"
                      : "cursor-not-allowed bg-black/[0.08] dark:bg-white/[0.08] text-black/25 dark:text-white/25"
                }`}
              >
                {isActive ? (
                  <Square size={12} strokeWidth={2} />
                ) : (
                  <ArrowUp size={13} strokeWidth={2.5} />
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Project Selector — inside the outer gray wrapper, below the main input box */}
        {projectSelector && (
          <div className="flex items-center px-1.5 py-1.5">
            {projectSelector}
          </div>
        )}
      </div>
    </div>
  );
}
