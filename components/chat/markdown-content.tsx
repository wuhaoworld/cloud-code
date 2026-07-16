"use client";

import { code } from "@streamdown/code";
import { cjk } from "@streamdown/cjk";
import { Streamdown } from "streamdown";
import "streamdown/styles.css";
import "katex/dist/katex.min.css";

interface MarkdownContentProps {
  text: string;
  isStreaming: boolean;
}

export function MarkdownContent({ text, isStreaming }: MarkdownContentProps) {
  return (
    <Streamdown
      mode={isStreaming ? "streaming" : "static"}
      className="text-sm leading-relaxed text-foreground"
      plugins={{ code, cjk }}
      animated
      linkSafety={{ enabled: false }}
      controls={{ table: false }}
    >
      {text}
    </Streamdown>
  );
}
