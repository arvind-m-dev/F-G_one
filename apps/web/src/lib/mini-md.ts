/**
 * Tiny, safe-by-default Markdown renderer for our own docs (CHANGELOG, help pages).
 * Only the subset the docs actually use: headings, paragraphs, bulleted lists (with
 * one level of nesting), horizontal rules, inline **bold**, `code` and [links](url).
 * All text is escaped before any replacement, so there's no HTML injection path.
 */

const ESCAPE: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESCAPE[c]!);

/** Only http(s), mailto and in-app paths are linkable. */
function safeHref(raw: string): string | null {
  const s = raw.trim();
  if (/^https?:\/\//i.test(s)) return s;
  if (/^mailto:/i.test(s)) return s;
  if (s.startsWith('/') || s.startsWith('#')) return s;
  return null;
}

function inline(src: string): string {
  // Escape first, then re-introduce only our known markup.
  let s = esc(src);
  // Inline code: `...` (no backticks inside).
  s = s.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
  // Bold: **...**
  s = s.replace(/\*\*([^*]+)\*\*/g, (_, c) => `<strong>${c}</strong>`);
  // Links: [text](url). text is already escaped; url is validated.
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, rawUrl) => {
    const href = safeHref(rawUrl);
    return href ? `<a href="${esc(href)}">${text}</a>` : m;
  });
  return s;
}

/**
 * Converts a small-subset Markdown document to a safe HTML string.
 * Supports `#`, `##`, `###` headings; paragraphs; `---` rules; and bulleted lists
 * where a leading two-space indent nests one level deeper.
 */
export function miniMarkdown(src: string): string {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;
  const flushList = (indent: number): string => {
    const items: string[] = [];
    while (i < lines.length) {
      const m = /^(\s*)- (.*)$/.exec(lines[i]!);
      if (!m) break;
      const thisIndent = Math.floor(m[1]!.length / 2);
      if (thisIndent < indent) break;
      if (thisIndent > indent) {
        // Attach nested list to the previous item.
        const nested = flushList(indent + 1);
        if (items.length > 0) items[items.length - 1] = items[items.length - 1]!.replace(/<\/li>$/, nested + '</li>');
        else items.push(`<li>${nested}</li>`);
        continue;
      }
      i++;
      items.push(`<li>${inline(m[2]!)}</li>`);
    }
    return `<ul>${items.join('')}</ul>`;
  };
  while (i < lines.length) {
    const line = lines[i]!;
    if (/^\s*$/.test(line)) { i++; continue; }
    if (/^---+\s*$/.test(line)) { out.push('<hr />'); i++; continue; }
    let m: RegExpExecArray | null;
    if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) {
      const level = Math.min(6, m[1]!.length);
      out.push(`<h${level}>${inline(m[2]!)}</h${level}>`);
      i++; continue;
    }
    if (/^\s*- /.test(line)) { out.push(flushList(0)); continue; }
    // Paragraph: consume until blank line or block boundary.
    const buf: string[] = [];
    while (i < lines.length && !/^\s*$/.test(lines[i]!) && !/^(#{1,6})\s+/.test(lines[i]!) && !/^\s*- /.test(lines[i]!) && !/^---+\s*$/.test(lines[i]!)) {
      buf.push(lines[i]!);
      i++;
    }
    out.push(`<p>${inline(buf.join(' '))}</p>`);
  }
  return out.join('\n');
}
