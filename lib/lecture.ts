import path from 'node:path';
import { readFile } from 'node:fs/promises';
import mammoth from 'mammoth';

export type LectureContent = {
  title: string;
  paragraphs: string[];
  text: string;
  html: string;
  source: string;
};

const DEFAULT_DOCX_FILENAME = 'Лекция №4-5 Внутренние и внешние метки ИАД.docx';
const lectureDocPath = process.env.LECTURE_DOC_PATH || DEFAULT_DOCX_FILENAME;

const fallbackParagraphs: string[] = [
  'Не удалось прочитать текст лекции из Word-документа.',
  'Проверьте путь к файлу в LECTURE_DOC_PATH и убедитесь, что файл доступен.',
];

let cachedLecturePromise: Promise<LectureContent> | null = null;

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function normalizeTextFromHtml(html: string): string[] {
  const withBlockBreaks = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(td|th)>/gi, '\t')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/(table|thead|tbody)>/gi, '\n\n')
    .replace(/<\/(p|li|h1|h2|h3|h4|h5|h6|div)>/gi, '\n\n');

  const plain = decodeHtmlEntities(withBlockBreaks.replace(/<[^>]+>/g, ' '))
    .replace(/\t+/g, ' | ')
    .replace(/\r/g, '\n');

  return plain
    .split(/\n{2,}/)
    .map((item) => item.replace(/[ \t]+\n/g, '\n').replace(/[ \t]{2,}/g, ' ').trim())
    .filter((item) => item.length > 0);
}

function fallbackHtmlFromParagraphs(paragraphs: string[]): string {
  return paragraphs.map((item) => `<p>${item}</p>`).join('');
}

function normalizeTableMarkup(html: string): string {
  return html.replace(/<table>([\s\S]*?)<\/table>/gi, (tableHtml) => {
    const rows = tableHtml.match(/<tr>[\s\S]*?<\/tr>/gi);
    if (!rows || rows.length <= 1) {
      return tableHtml;
    }

    const headerRow = rows[0];
    const bodyRows = rows
      .slice(1)
      .map((row) =>
        row
          .replace(/<th(\s[^>]*)?>/gi, (_match, attrs) => `<td${attrs ?? ''}>`)
          .replace(/<\/th>/gi, '</td>'),
      )
      .join('');

    return `<table><thead>${headerRow}</thead><tbody>${bodyRows}</tbody></table>`;
  });
}

function cleanupWordHtml(html: string): string {
  return normalizeTableMarkup(
    html
    .replace(/<a[^>]*id="[^"]+"[^>]*>\s*<\/a>/gi, '')
    .replace(/<p>\s*(<br\s*\/?>\s*)+<\/p>/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim(),
  );
}

export async function getLectureContent(): Promise<LectureContent> {
  if (cachedLecturePromise) {
    return cachedLecturePromise;
  }

  cachedLecturePromise = (async () => {
    const absolutePath = path.resolve(process.cwd(), lectureDocPath);

    try {
      await readFile(absolutePath);
      const htmlResult = await mammoth.convertToHtml({ path: absolutePath });
      const html = cleanupWordHtml(
        htmlResult.value || fallbackHtmlFromParagraphs(fallbackParagraphs),
      );
      const paragraphs = normalizeTextFromHtml(html);

      if (!paragraphs.length) {
        return {
          title: path.basename(absolutePath, path.extname(absolutePath)),
          paragraphs: fallbackParagraphs,
          text: fallbackParagraphs.join('\n\n'),
          html: fallbackHtmlFromParagraphs(fallbackParagraphs),
          source: absolutePath,
        };
      }

      return {
        title: path.basename(absolutePath, path.extname(absolutePath)),
        paragraphs,
        text: paragraphs.join('\n\n'),
        html,
        source: absolutePath,
      };
    } catch (error) {
      console.error('Lecture loading error:', error);
      return {
        title: 'Лекция',
        paragraphs: fallbackParagraphs,
        text: fallbackParagraphs.join('\n\n'),
        html: fallbackHtmlFromParagraphs(fallbackParagraphs),
        source: absolutePath,
      };
    }
  })();

  return cachedLecturePromise;
}
