// Vercel Serverless Function — transcribes audio via Google Gemini API
// Supports Hebrew and English

import type { VercelRequest, VercelResponse } from '@vercel/node';

const ACCESS_CODE = process.env.ACCESS_CODE || '';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '25mb',
    },
  },
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Access-Code');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (ACCESS_CODE) {
    const provided = req.headers['x-access-code'] as string;
    if (provided !== ACCESS_CODE) {
      return res.status(401).json({ error: 'Invalid access code' });
    }
  }

  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: 'Gemini API key not configured on server' });
  }

  try {
    const { audio, fileName, language } = req.body;

    if (!audio) {
      return res.status(400).json({ error: 'No audio data provided' });
    }

    // Determine MIME type from file extension
    const ext = (fileName || 'audio.webm').split('.').pop()?.toLowerCase() || 'webm';
    const mimeTypes: Record<string, string> = {
      mp3: 'audio/mpeg',
      mp4: 'audio/mp4',
      m4a: 'audio/mp4',
      wav: 'audio/wav',
      webm: 'audio/webm',
      ogg: 'audio/ogg',
      flac: 'audio/flac',
    };
    const mimeType = mimeTypes[ext] || 'audio/webm';

    // Build language instruction
    const langHint = language === 'he'
      ? 'The audio is in Hebrew. Transcribe in Hebrew.'
      : language === 'en'
      ? 'The audio is in English. Transcribe in English.'
      : 'Auto-detect the language (likely Hebrew or English) and transcribe accordingly.';

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-001:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  inlineData: {
                    mimeType,
                    data: audio,
                  },
                },
                {
                  text: `Transcribe this audio recording accurately and completely. ${langHint}\n\nRules:\n- Output ONLY the transcription text, nothing else.\n- Preserve the original language — do not translate.\n- Include speaker turns if distinguishable (use "Speaker 1:", "Speaker 2:", etc.).\n- Do not add summaries, commentary, or formatting beyond the transcript.`,
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 8192,
          },
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({
        error: `Gemini API error: ${response.status}`,
        details: errText,
      });
    }

    const data = await response.json();
    const transcript =
      data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';

    if (!transcript) {
      return res.status(500).json({ error: 'No transcription returned from Gemini' });
    }

    return res.status(200).json({ transcript });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Transcription failed' });
  }
}
