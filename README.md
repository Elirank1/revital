# Revital — CV Analyzer

AI-powered candidate screening tool. Upload a job description and CVs to get structured, scored analysis against dynamically extracted evaluation pillars.

## Features

- **Dynamic Pillar Extraction** — AI reads the JD and auto-generates evaluation criteria with weights
- **Structured Scoring** — Each candidate scored per pillar (1-10) with evidence and gaps
- **Red Flag Detection** — Auto-detects job hopping, title inflation, buzzword padding, employment gaps
- **Truth Test Questions** — AI-generated interview questions to verify claims
- **Batch Analysis** — Upload multiple CVs for the same role
- **Comparison View** — Side-by-side ranked candidate comparison
- **Export & Share** — Copy, download, or export CSV of all analyses
- **LinkedIn URL Support** — Attach LinkedIn profiles for reference

## Tech Stack

- React 18 + TypeScript
- Vite (build)
- Zustand (state management)
- Tailwind CSS (styling)
- PDF.js (client-side PDF parsing)
- Mammoth.js (client-side DOCX parsing)
- Claude API (Anthropic) for AI analysis

## Getting Started

```bash
# From monorepo root
npm install
npm run revital:dev

# Or directly
cd packages/revital
npm install
npm run dev
```

## Configuration

1. Open the app in your browser
2. Go to Settings
3. Enter your Anthropic API key
4. Select your preferred model (Claude Sonnet 4.6 recommended)

## Privacy

All data stays in your browser. CVs are only sent to the Anthropic API for analysis — no server, no database, no tracking.

## Deployment

Deployed to GitHub Pages at `/revital/` subpath.

---

Built by Revital Keren | Powered by Claude AI
