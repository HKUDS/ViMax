"use client";

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownProps {
  content: string;
}

// Map standard markdown elements to our design tokens
const markdownComponents = {
  code({ className, children, ...props }: React.ComponentPropsWithoutRef<"code"> & { node?: unknown }) {
    const isInline = !className;
    if (isInline) {
      return (
        <code
          className="px-1 py-0.5 rounded text-[11px] font-mono bg-[var(--color-surface-elevated)] text-[var(--color-accent)]"
          {...props}
        >
          {children}
        </code>
      );
    }
    return (
      <code
        className="block px-3 py-2 rounded-lg text-[11px] font-mono bg-[var(--color-surface-elevated)] text-[var(--color-text)] overflow-x-auto"
        {...props}
      >
        {children}
      </code>
    );
  },
  pre({ children }: React.ComponentPropsWithoutRef<"pre">) {
    return <pre className="my-2 rounded-lg overflow-hidden">{children}</pre>;
  },
  a({ href, children }: React.ComponentPropsWithoutRef<"a">) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[var(--color-accent)] hover:underline"
      >
        {children}
      </a>
    );
  },
  ul({ children }: React.ComponentPropsWithoutRef<"ul">) {
    return <ul className="pl-4 my-1 space-y-0.5 list-disc">{children}</ul>;
  },
  ol({ children }: React.ComponentPropsWithoutRef<"ol">) {
    return <ol className="pl-4 my-1 space-y-0.5 list-decimal">{children}</ol>;
  },
  table({ children }: React.ComponentPropsWithoutRef<"table">) {
    return (
      <div className="overflow-x-auto my-2">
        <table className="w-full text-[11px] border-collapse">{children}</table>
      </div>
    );
  },
  th({ children }: React.ComponentPropsWithoutRef<"th">) {
    return (
      <th className="px-2 py-1 text-left border border-[var(--color-border)] bg-[var(--color-surface-elevated)] font-semibold">
        {children}
      </th>
    );
  },
  td({ children }: React.ComponentPropsWithoutRef<"td">) {
    return <td className="px-2 py-1 border border-[var(--color-border)]">{children}</td>;
  },
};

export const Markdown = memo(function Markdown({ content }: MarkdownProps) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
      {content}
    </ReactMarkdown>
  );
});
