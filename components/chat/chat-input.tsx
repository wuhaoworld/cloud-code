"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Plus, Square, ArrowUp } from "lucide-react";
import { useAppStore } from "@/store/app-store";

// ── Editor Helper ──────────────────────────────────────────────────

function getEditorText(editor: HTMLDivElement): string {
  let text = "";

  const traverse = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent;
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
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
  };

  for (let i = 0; i < editor.childNodes.length; i++) {
    traverse(editor.childNodes[i]);
  }

  return text.trim();
}

// ── Props ──────────────────────────────────────────────────────────

interface ChatInputProps {
  onSend: (prompt: string) => void;
  onStop?: () => void;
  disabled?: boolean;
  placeholder?: string;
}

// ── Component ──────────────────────────────────────────────────────

export function ChatInput({
  onSend,
  onStop,
  disabled = false,
  placeholder = "向 AI 询问任何问题...",
}: ChatInputProps) {
  const isStreaming = useAppStore((s) => s.isStreaming);
  const [hasText, setHasText] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);

  const canSend = hasText && !isStreaming && !disabled;
  const isActive = isStreaming;

  // 挂载时自动聚焦
  useEffect(() => {
    if (!disabled) {
      editorRef.current?.focus();
    }
  }, [disabled]);

  const syncEditorState = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const textContent = editor.textContent || "";
    setHasText(textContent.length > 0);
  }, []);

  const handleSend = useCallback(() => {
    const editor = editorRef.current;
    if (!editor || !canSend) return;

    const text = getEditorText(editor);
    if (!text) return;

    onSend(text);

    // 清空编辑器
    editor.innerHTML = "";
    setHasText(false);

    // 保持焦点
    setTimeout(() => {
      editor.focus();
    }, 0);
  }, [canSend, onSend]);

  const handleEditorInput = () => {
    if (disabled) return;
    syncEditorState();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) {
      e.preventDefault();
      return;
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!isActive && canSend) {
        handleSend();
      }
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    if (disabled) {
      e.preventDefault();
      return;
    }

    // 仅粘贴纯文本，避免富文本污染
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

  return (
    <div className="relative w-full">
      {/* Main Input Box */}
      <div className="w-full overflow-hidden transition-colors border dark:border-white/[0.12] border-black/[0.10] dark:bg-white/[0.04] bg-white focus-within:border-black/[0.18] dark:focus-within:border-white/[0.20] rounded-[18px]">
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
            style={{
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          />
        </div>

        {/* Bottom toolbar */}
        <div className="flex items-center justify-between px-1.5 pb-1.5">
          {/* Left: add attachment button (placeholder, non-functional) */}
          <div className="flex items-center gap-0.5">
            <button
              title="添加附件"
              disabled={disabled}
              className="flex items-center justify-center w-7 h-7 rounded-lg dark:text-white/45 text-black/40 dark:hover:bg-white/[0.06] hover:bg-black/[0.05] dark:hover:text-white/70 hover:text-black/65 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Plus size={14} />
            </button>
          </div>

          {/* Right: send / stop button */}
          <div className="flex items-center gap-1.5">
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
    </div>
  );
}
