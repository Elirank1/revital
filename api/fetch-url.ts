// Vercel Serverless Function — fetches a URL server-side to bypass CORS
// Used by JobInput to fetch job descriptions from external sites

import type { VercelRequest, VercelResponse } from '@vercel/node';

const ACCESS_CODE = process.env.ACCESS_CODE || '';

// Block dangerous or internal URLs
const BLOCKED_PATTERNS = [
  /^https?:\/\/localhost/i,
  /^https?:\/\/127\./,
  /^https?:\/\/10\./,
  /^https?:\/\/192\.168\./,
  /^https?:\/\/172\.(1[6-9]|2\d|3[01])\./,
  /^https?:\/\/0\./,
  /^file:/i,
  /^ftp:/i,
  /^data:/i,
];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Access-Code');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Auth
  if (ACCESS_CODE) {
    const provided = req.headers['x-access-code'] as string;
    if (provided !== ACCESS_CODE) {
      return res.status(401).json({ error: 'Invalid access code' });
    }
  }

  const { url } = req.body;
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'URL is required' });
  }

  // Validate URL format
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return res.status(400).json({ error: 'Invalid URL format' });
  }

  // Only allow http/https
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    return res.status(400).json({ error: 'Only HTTP/HTTPS URLs are allowed' });
  }

  // Block internal/dangerous URLs
  if (BLOCKED_PATTERNS.some((p) => p.test(url))) {
    return res.status(400).json({ error: 'URL not allowed' });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000); // 15s timeout

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; RevitalBot/1.0)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,he;q=0.8',
      },
      redirect: 'follow',
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return res.status(502).json({
        error: `Failed to fetch URL: HTTP ${response.status}`,
      });
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('text/plain') && !contentType.includes('application/xhtml')) {
      return res.status(400).json({
        error: `Unexpected content type: ${contentType}. Expected HTML.`,
      });
    }

    const html = await response.text();

    // Cap response size to prevent abuse (500KB max)
    if (html.length > 500_000) {
      return res.status(200).json({ html: html.slice(0, 500_000) });
    }

    return res.status(200).json({ html });
  } catch (err: any) {
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: 'Request timed out (15s)' });
    }
    return res.status(500).json({ error: err.message || 'Failed to fetch URL' });
  }
}
