import type { AssembledManuscript } from '../services/manuscript.js';

export interface ExportOptions {
  includeTitles?: boolean;
}

/** The manuscript as Markdown, ready to paste into an editor. */
export function toMarkdown(manuscript: AssembledManuscript, options: ExportOptions = {}): string {
  const includeTitles = options.includeTitles !== false;
  const parts: string[] = [`# ${manuscript.title}`, ''];

  if (manuscript.chapters.length === 0 && manuscript.draft) {
    parts.push(manuscript.draft.trim());
    return parts.join('\n');
  }

  manuscript.chapters.forEach((chapter, index) => {
    if (includeTitles) parts.push(`## Chapter ${index + 1}: ${chapter.title}`, '');
    parts.push(chapter.text.trim(), '');
  });

  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/** Strip the light markdown we emit, for a plain reading copy. */
export function toPlainText(manuscript: AssembledManuscript, options: ExportOptions = {}): string {
  const markdown = toMarkdown(manuscript, options);
  return markdown
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/(^|\s)\*(\S[^*]*?)\*/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .trim() + '\n';
}
