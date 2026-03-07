// ============================================================
// File parsing utilities — extract text from PDF and DOCX
// All processing happens client-side
// ============================================================

import * as pdfjsLib from 'pdfjs-dist';

// Set up PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

/**
 * Extract text from a PDF file
 */
export async function extractTextFromPDF(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pages: string[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .map((item: any) => item.str)
      .join(' ');
    pages.push(text);
  }

  return pages.join('\n\n');
}

/**
 * Extract text from a DOCX file using mammoth
 */
export async function extractTextFromDOCX(file: File): Promise<string> {
  const mammoth = await import('mammoth');
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value;
}

/**
 * Read a plain text file
 */
export async function extractTextFromTXT(file: File): Promise<string> {
  return await file.text();
}

/**
 * Auto-detect file type and extract text
 */
export async function extractText(file: File): Promise<string> {
  const name = file.name.toLowerCase();

  if (name.endsWith('.pdf')) {
    return extractTextFromPDF(file);
  } else if (name.endsWith('.docx') || name.endsWith('.doc')) {
    return extractTextFromDOCX(file);
  } else if (name.endsWith('.txt') || name.endsWith('.md')) {
    return extractTextFromTXT(file);
  }

  throw new Error(`Unsupported file type: ${name}. Use PDF, DOCX, or TXT.`);
}

/**
 * Extract candidate name from CV text (best effort)
 */
export function guessNameFromText(text: string): string {
  // Try first non-empty line that looks like a name
  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length === 0) return 'Unknown';

  // First line is usually the name
  const firstLine = lines[0].trim();
  if (firstLine.length < 60 && firstLine.length > 2) {
    return firstLine;
  }

  return 'Unknown';
}
