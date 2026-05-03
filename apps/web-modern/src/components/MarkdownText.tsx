import React from "react";

/**
 * Renderer compacto de Markdown para texto generado por IA.
 *
 * Soporta:
 *   - **bold** dentro de una línea
 *   - # H1, ## H2, ### H3
 *   - 1. 2. 3. listas numeradas
 *   - - item de lista (bullet)
 *   - líneas en blanco como separadores
 *
 * NO usa dangerouslySetInnerHTML — todo es React puro, sin riesgo XSS.
 * Para casos más complejos (tablas, links, code blocks) usar react-markdown.
 */

function renderInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  // Match **algo** (no greedy, sin capturar otros asteriscos dentro).
  const re = /\*\*([^*]+?)\*\*/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIdx) parts.push(text.slice(lastIdx, match.index));
    parts.push(<strong key={`b${key++}`} className="text-white font-semibold">{match[1]}</strong>);
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < text.length) parts.push(text.slice(lastIdx));
  return parts.length > 0 ? parts : [text];
}

export interface MarkdownTextProps {
  text: string;
  className?: string;
}

export const MarkdownText: React.FC<MarkdownTextProps> = ({ text, className = "" }) => {
  const lines = text.split(/\r?\n/);
  return (
    <div className={className}>
      {lines.map((line, i) => {
        if (line.startsWith("### ")) {
          return <h4 key={i} className="text-xs font-bold text-white mt-3 mb-1">{renderInline(line.slice(4))}</h4>;
        }
        if (line.startsWith("## ")) {
          return <h3 key={i} className="text-sm font-bold text-accent mt-3 mb-1.5">{renderInline(line.slice(3))}</h3>;
        }
        if (line.startsWith("# ")) {
          return <h2 key={i} className="text-base font-bold text-accent mt-2 mb-2">{renderInline(line.slice(2))}</h2>;
        }
        const numMatch = /^(\d+)\.\s+(.*)$/.exec(line);
        if (numMatch) {
          return (
            <p key={i} className="ml-2 mb-1 leading-relaxed">
              <span className="text-accent font-semibold mr-1">{numMatch[1]}.</span>
              {renderInline(numMatch[2])}
            </p>
          );
        }
        if (line.startsWith("- ") || line.startsWith("* ")) {
          return (
            <p key={i} className="ml-2 mb-1 leading-relaxed">
              <span className="text-accent mr-1">•</span>
              {renderInline(line.slice(2))}
            </p>
          );
        }
        if (line.trim() === "") {
          return <div key={i} className="h-2" />;
        }
        return <p key={i} className="mb-1 leading-relaxed">{renderInline(line)}</p>;
      })}
    </div>
  );
};
