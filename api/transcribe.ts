// Vercel Serverless Function — transcribes audio via OpenAI Whisper API
// Supports Hebrew and English

import type { VercelRequest, VercelResponse } from '@vercel/node';

const ACCESS_CODE = process.env.ACCESS_CODE || '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

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

  if (!OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OpenAI API key not configured on server' });
  }

  try {
    const { audio, fileName, language } = req.body;

    if (!audio) {
      return res.status(400).json({ error: 'No audio data provided' });
    }

    // audio is base64 encoded
    const audioBuffer = Buffer.from(audio, 'base64');

    // Build multipart form data for Whisper API
    const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);
    const ext = (fileName || 'audio.webm').split('.').pop() || 'webm';
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

    const parts: Buffer[] = [];

    // File part
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName || 'audio.' + ext}"\r\nContent-Type: ${mimeType}\r\n\r\n`
    ));
    parts.push(audioBuffer);
    parts.push(Buffer.from('\r\n'));

    // Model part
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n`
    ));

    // Language part (optional — if not set, Whisper auto-detects)
    if (language && language !== 'auto') {
      parts.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\n${language}\r\n`
      ));
    }

    // Response format
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="response_format"\r\n\r\ntext\r\n`
    ));

    parts.push(Buffer.from(`--${boundary}--\r\n`));

    const body = Buffer.concat(parts);

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({
        error: `Whisper API error: ${response.status}`,
        details: errText,
      });
    }

    const transcript = await response.text();
    return res.status(200).json({ transcript: transcript.trim() });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Transcription failed' });
  }
}
