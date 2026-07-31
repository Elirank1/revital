// ============================================================
// Legacy smoke suite — engine/parser (quality-gate, Wave 0)
// Pure-function pinning on synthetic CV text. pdfjs-dist and
// mammoth are mocked — no workers, no real documents.
// ============================================================

import { describe, it, expect, vi } from 'vitest';

// parser.ts imports pdfjs-dist at module load (and sets a CDN workerSrc);
// mock it so tests stay offline and deterministic.
vi.mock('pdfjs-dist', () => {
  const getDocument = vi.fn((_: unknown) => ({
    promise: Promise.resolve({
      numPages: 2,
      getPage: async (i: number) => ({
        getTextContent: async () => ({
          items: [{ str: `page${i}-a` }, { str: `page${i}-b` }],
        }),
      }),
    }),
  }));
  return { GlobalWorkerOptions: { workerSrc: '' }, version: '0.0.0-test', getDocument };
});

vi.mock('mammoth', () => ({
  extractRawText: vi.fn(async (_: unknown) => ({ value: 'DOCX synthetic body' })),
}));

const parser = await import('./parser');

describe('guessNameFromText', () => {
  it('returns the first line when it looks like a name (3–59 chars)', () => {
    expect(parser.guessNameFromText('Dana Synthetic\nSenior QA Engineer\nTel Aviv')).toBe('Dana Synthetic');
  });

  it('prefers a "NAME: ..." line within the first 5 lines (LinkedIn fetch format)', () => {
    const text = 'LinkedIn Profile\nNAME: Synthetic Person\nHeadline: Engineer';
    expect(parser.guessNameFromText(text)).toBe('Synthetic Person');
  });

  it('matches NAME: case-insensitively and trims the value', () => {
    expect(parser.guessNameFromText('name:   Spaced Out  \nrest')).toBe('Spaced Out');
  });

  it('ignores a NAME: line past the first 5 non-empty lines', () => {
    const text = ['First Line Person', 'l2', 'l3', 'l4', 'l5', 'NAME: Too Late'].join('\n');
    expect(parser.guessNameFromText(text)).toBe('First Line Person');
  });

  it('skips leading blank lines when picking the first line', () => {
    expect(parser.guessNameFromText('\n\n  \nReal First Line\nmore')).toBe('Real First Line');
  });

  it('returns Unknown for empty/whitespace-only text', () => {
    expect(parser.guessNameFromText('')).toBe('Unknown');
    expect(parser.guessNameFromText('   \n  \n')).toBe('Unknown');
  });

  it('returns Unknown when the first line is 60+ chars (headline, not a name)', () => {
    const long = 'X'.repeat(60);
    expect(parser.guessNameFromText(`${long}\nsecond`)).toBe('Unknown');
    // 59 chars is still accepted — pin the boundary
    const fiftyNine = 'Y'.repeat(59);
    expect(parser.guessNameFromText(`${fiftyNine}\nsecond`)).toBe(fiftyNine);
  });

  it('returns Unknown when the first line is 2 chars or fewer', () => {
    expect(parser.guessNameFromText('AB\nsecond line')).toBe('Unknown');
    expect(parser.guessNameFromText('ABC\nsecond line')).toBe('ABC');
  });
});

describe('extractText dispatch', () => {
  it('routes .txt and .md to plain text reading', async () => {
    const txt = new File(['synthetic cv body'], 'cv.txt', { type: 'text/plain' });
    await expect(parser.extractText(txt)).resolves.toBe('synthetic cv body');
    const md = new File(['# markdown cv'], 'CV.MD');
    await expect(parser.extractText(md)).resolves.toBe('# markdown cv');
  });

  it('routes .pdf to the PDF extractor and joins pages with blank lines', async () => {
    const pdf = new File([new Uint8Array([1, 2, 3])], 'resume.PDF');
    await expect(parser.extractText(pdf)).resolves.toBe('page1-a page1-b\n\npage2-a page2-b');
  });

  it('routes .docx/.doc to mammoth raw-text extraction', async () => {
    const docx = new File([new Uint8Array([4, 5])], 'resume.docx');
    await expect(parser.extractText(docx)).resolves.toBe('DOCX synthetic body');
    const doc = new File([new Uint8Array([6])], 'old-resume.doc');
    await expect(parser.extractText(doc)).resolves.toBe('DOCX synthetic body');
  });

  it('rejects unsupported extensions with a clear error', async () => {
    const img = new File([new Uint8Array([7])], 'photo.png');
    await expect(parser.extractText(img)).rejects.toThrow(/Unsupported file type: photo\.png/);
  });

  it('is extension-driven, case-insensitive on the file name', async () => {
    const upper = new File(['upper case ext'], 'NOTES.TXT');
    await expect(parser.extractText(upper)).resolves.toBe('upper case ext');
  });
});
