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
 *   - tablas markdown (| col | col | con separador |---|---|)
 *
 * NO usa dangerouslySetInnerHTML — todo es React puro, sin riesgo XSS.
 * Para casos más complejos (links, code blocks) usar react-markdown.
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
    parts.push(<strong key={`b${key++}`} className="text-fg font-semibold">{match[1]}</strong>);
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < text.length) parts.push(text.slice(lastIdx));
  return parts.length > 0 ? parts : [text];
}

// Detecta una fila de tabla markdown: empieza y termina con |
function isTableRow(line: string): boolean {
  const t = line.trim();
  return t.startsWith("|") && t.endsWith("|") && t.length > 1;
}

// Detecta la línea separadora de tabla: |---|---|...
function isTableSeparator(line: string): boolean {
  const t = line.trim();
  if (!isTableRow(t)) return false;
  return t
    .slice(1, -1)
    .split("|")
    .every(cell => /^\s*:?-+:?\s*$/.test(cell));
}

function parseTableRow(line: string): string[] {
  return line.trim().slice(1, -1).split("|").map(c => c.trim());
}

export interface MarkdownTextProps {
  text: string;
  className?: string;
}

export const MarkdownText: React.FC<MarkdownTextProps> = ({ text, className = "" }) => {
  const lines = text.split(/\r?\n/);
  const nodes: React.ReactNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // ─── Tabla markdown ───────────────────────────────────────────────────
    // Detecta: fila de header + separador + N filas
    if (isTableRow(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const headerCells = parseTableRow(line);
      const bodyRows: string[][] = [];
      let j = i + 2;
      while (j < lines.length && isTableRow(lines[j]) && !isTableSeparator(lines[j])) {
        bodyRows.push(parseTableRow(lines[j]));
        j++;
      }
      nodes.push(
        <div key={`tbl-${i}`} className="overflow-x-auto my-2 -mx-1">
          <table className="w-full text-[11px] border-collapse">
            <thead>
              <tr className="bg-accent/15 border-b border-accent/30">
                {headerCells.map((h, ci) => (
                  <th key={ci} className="px-2 py-1.5 text-left font-bold text-accent uppercase tracking-wider whitespace-nowrap">
                    {renderInline(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bodyRows.map((row, ri) => (
                <tr key={ri} className="border-b border-fg/5">
                  {row.map((cell, ci) => (
                    <td key={ci} className="px-2 py-1.5 align-top text-fg/85 leading-snug">
                      {renderInline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      i = j - 1; // saltar al final de la tabla
      continue;
    }

    // ─── Headings ─────────────────────────────────────────────────────────
    if (line.startsWith("### ")) {
      nodes.push(<h4 key={i} className="text-xs font-bold text-fg mt-3 mb-1">{renderInline(line.slice(4))}</h4>);
      continue;
    }
    if (line.startsWith("## ")) {
      nodes.push(<h3 key={i} className="text-sm font-bold text-accent mt-3 mb-1.5">{renderInline(line.slice(3))}</h3>);
      continue;
    }
    if (line.startsWith("# ")) {
      nodes.push(<h2 key={i} className="text-base font-bold text-accent mt-2 mb-2">{renderInline(line.slice(2))}</h2>);
      continue;
    }

    // ─── Listas ───────────────────────────────────────────────────────────
    const numMatch = /^(\d+)\.\s+(.*)$/.exec(line);
    if (numMatch) {
      nodes.push(
        <p key={i} className="ml-2 mb-1 leading-relaxed">
          <span className="text-accent font-semibold mr-1">{numMatch[1]}.</span>
          {renderInline(numMatch[2])}
        </p>
      );
      continue;
    }
    if (line.startsWith("- ") || line.startsWith("* ")) {
      nodes.push(
        <p key={i} className="ml-2 mb-1 leading-relaxed">
          <span className="text-accent mr-1">•</span>
          {renderInline(line.slice(2))}
        </p>
      );
      continue;
    }
    if (line.trim() === "") {
      nodes.push(<div key={i} className="h-2" />);
      continue;
    }
    nodes.push(<p key={i} className="mb-1 leading-relaxed">{renderInline(line)}</p>);
  }

  return <div className={className}>{nodes}</div>;
};
