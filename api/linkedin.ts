// Vercel Serverless Function — fetches LinkedIn profile via Enrich Layer API
// Returns structured profile text ready for CV analysis

import type { VercelRequest, VercelResponse } from '@vercel/node';

const ACCESS_CODE = process.env.ACCESS_CODE || '';
const ENRICH_API_KEY = process.env.ENRICH_LAYER_API_KEY || '';

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

  if (!ENRICH_API_KEY) {
    return res.status(500).json({ error: 'Enrich Layer API key not configured on server' });
  }

  const { linkedinUrl } = req.body;
  if (!linkedinUrl || !linkedinUrl.includes('linkedin.com/in/')) {
    return res.status(400).json({ error: 'Valid LinkedIn profile URL required' });
  }

  try {
    const response = await fetch(
      `https://enrichlayer.com/api/v2/profile?profile_url=${encodeURIComponent(linkedinUrl)}&use_cache=if-recent`,
      {
        headers: { 'Authorization': `Bearer ${ENRICH_API_KEY}` },
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({
        error: `Enrich Layer API error: ${response.status}`,
        details: errText,
      });
    }

    const profile = await response.json();

    // Format profile into readable text for analysis
    const profileText = formatProfile(profile);
    const name = profile.full_name || `${profile.first_name || ''} ${profile.last_name || ''}`.trim() || 'Unknown';

    return res.status(200).json({
      name,
      profileText,
      headline: profile.headline || '',
      location: [profile.city, profile.state, profile.country].filter(Boolean).join(', '),
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to fetch LinkedIn profile' });
  }
}

function formatProfile(p: any): string {
  const sections: string[] = [];

  // Header
  const name = p.full_name || `${p.first_name || ''} ${p.last_name || ''}`.trim();
  if (name) sections.push(`NAME: ${name}`);
  if (p.headline) sections.push(`HEADLINE: ${p.headline}`);
  if (p.occupation) sections.push(`CURRENT ROLE: ${p.occupation}`);
  const location = [p.city, p.state, p.country].filter(Boolean).join(', ');
  if (location) sections.push(`LOCATION: ${location}`);
  if (p.connections) sections.push(`CONNECTIONS: ${p.connections}`);

  // Summary
  if (p.summary) {
    sections.push(`\nSUMMARY:\n${p.summary}`);
  }

  // Experience
  if (p.experiences?.length) {
    sections.push('\nEXPERIENCE:');
    for (const exp of p.experiences) {
      const title = exp.title || 'Unknown Role';
      const company = exp.company || exp.company_name || 'Unknown Company';
      const start = formatDate(exp.starts_at);
      const end = exp.ends_at ? formatDate(exp.ends_at) : 'Present';
      const duration = start ? `${start} - ${end}` : '';
      const location = exp.location || '';

      let line = `  - ${title} at ${company}`;
      if (duration) line += ` (${duration})`;
      if (location) line += ` | ${location}`;
      sections.push(line);

      if (exp.description) {
        sections.push(`    ${exp.description}`);
      }
    }
  }

  // Education
  if (p.education?.length) {
    sections.push('\nEDUCATION:');
    for (const edu of p.education) {
      const school = edu.school || edu.school_name || 'Unknown School';
      const degree = edu.degree_name || '';
      const field = edu.field_of_study || '';
      const start = formatDate(edu.starts_at);
      const end = edu.ends_at ? formatDate(edu.ends_at) : '';
      const duration = start ? `${start} - ${end || 'Present'}` : '';

      let line = `  - ${school}`;
      if (degree || field) line += `: ${[degree, field].filter(Boolean).join(' in ')}`;
      if (duration) line += ` (${duration})`;
      sections.push(line);
    }
  }

  // Certifications
  if (p.certifications?.length) {
    sections.push('\nCERTIFICATIONS:');
    for (const cert of p.certifications) {
      const name = cert.name || 'Unknown';
      const authority = cert.authority || '';
      let line = `  - ${name}`;
      if (authority) line += ` — ${authority}`;
      sections.push(line);
    }
  }

  // Skills (if available)
  if (p.skills?.length) {
    sections.push(`\nSKILLS: ${p.skills.join(', ')}`);
  }

  // Recommendations
  if (p.recommendations?.length) {
    sections.push('\nRECOMMENDATIONS:');
    for (const rec of p.recommendations.slice(0, 3)) {
      sections.push(`  - "${rec}"`);
    }
  }

  return sections.join('\n');
}

function formatDate(d: any): string {
  if (!d) return '';
  const month = d.month ? String(d.month).padStart(2, '0') : '';
  const year = d.year || '';
  return month ? `${month}/${year}` : `${year}`;
}
