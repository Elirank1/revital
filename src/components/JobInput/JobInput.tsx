import { useState, useRef } from 'react';
import { useAppStore } from '../../store/appStore';
import { extractText } from '../../engine/parser';
import { extractPillars } from '../../engine/analyzer';
import {
  FileText,
  Upload,
  Loader2,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Trash2,
  Sparkles,
  Link,
  Globe,
} from 'lucide-react';
import type { EvaluationPillar, JobDescription } from '../../types';

export default function JobInput() {
  const {
    currentJob,
    setCurrentJob,
    settings,
    setError,
    saveJob,
    savedJobs,
  } = useAppStore();
  const [jdText, setJdText] = useState('');
  const [jdUrl, setJdUrl] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);
  const [isFetchingUrl, setIsFetchingUrl] = useState(false);
  const [showPillars, setShowPillars] = useState(false);
  const [inputMode, setInputMode] = useState<'text' | 'url'>('text');
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await extractText(file);
      setJdText(text);
      setInputMode('text');
    } catch (err: any) {
      setError(`Failed to read file: ${err.message}`);
    }
  };

  const handleFetchUrl = async () => {
    if (!jdUrl.trim()) {
      setError('Please enter a URL.');
      return;
    }

    setIsFetchingUrl(true);
    setError(null);
    try {
      // Use a simple proxy/fetch approach
      // Try fetching the URL content through a CORS-friendly approach
      const response = await fetch(jdUrl.trim());
      const html = await response.text();

      // Extract readable text from HTML
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      // Remove scripts, styles, nav, footer, header
      const removeTags = ['script', 'style', 'nav', 'footer', 'header', 'iframe', 'noscript'];
      removeTags.forEach((tag) => {
        doc.querySelectorAll(tag).forEach((el) => el.remove());
      });

      // Get text content from main content areas, or fallback to body
      const mainContent =
        doc.querySelector('main') ||
        doc.querySelector('article') ||
        doc.querySelector('[role="main"]') ||
        doc.querySelector('.job-description') ||
        doc.querySelector('.posting-page') ||
        doc.body;

      const text = (mainContent?.textContent || '')
        .replace(/\s+/g, ' ')
        .replace(/\n\s*\n/g, '\n')
        .trim();

      if (text.length < 50) {
        setError('Could not extract meaningful text from this URL. Try pasting the job description directly.');
        return;
      }

      setJdText(text.slice(0, 10000)); // cap at 10k chars
      setInputMode('text');
      setJdUrl('');
    } catch (err: any) {
      setError(
        `Could not fetch URL: ${err.message}. The site may block direct access. Try pasting the job description text instead.`
      );
    } finally {
      setIsFetchingUrl(false);
    }
  };

  const handleExtractPillars = async () => {
    if (!jdText.trim()) {
      setError('Please enter or upload a job description first.');
      return;
    }
    if (!settings.apiKey) {
      setError('Please set your API key in Settings first.');
      return;
    }

    setIsExtracting(true);
    setError(null);
    try {
      const result = await extractPillars(jdText, settings.apiKey, settings.model);
      const job: JobDescription = {
        id: Date.now().toString(36),
        title: result.jobTitle,
        rawText: jdText,
        pillars: result.pillars,
        sourceUrl: jdUrl || undefined,
        createdAt: new Date().toISOString(),
      };
      setCurrentJob(job);
      saveJob(job); // Auto-save to savedJobs
      setShowPillars(true);
    } catch (err: any) {
      setError(`Pillar extraction failed: ${err.message}`);
    } finally {
      setIsExtracting(false);
    }
  };

  const handleLoadSavedJob = (job: JobDescription) => {
    setCurrentJob(job);
    setShowPillars(true);
  };

  const weightColor = (w: string) => {
    switch (w) {
      case 'CRITICAL': return 'badge-red';
      case 'HIGH': return 'badge-yellow';
      case 'MEDIUM': return 'badge-blue';
      default: return 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 text-xs px-2 py-0.5 rounded-full';
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
          <FileText size={18} className="text-brand-600" />
          Job Description
        </h3>
        {currentJob && (
          <button
            onClick={() => {
              setCurrentJob(null);
              setJdText('');
              setJdUrl('');
              setShowPillars(false);
            }}
            className="btn-ghost text-xs text-red-500 hover:text-red-700 flex items-center gap-1"
          >
            <Trash2 size={14} />
            Clear
          </button>
        )}
      </div>

      {/* If job is loaded, show summary */}
      {currentJob ? (
        <div className="card p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <CheckCircle size={18} className="text-emerald-500" />
              <span className="font-semibold text-slate-900 dark:text-white">{currentJob.title}</span>
            </div>
            <button
              onClick={() => setShowPillars(!showPillars)}
              className="btn-ghost text-xs flex items-center gap-1"
            >
              {showPillars ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              {currentJob.pillars.length} Pillars
            </button>
          </div>

          {showPillars && (
            <div className="mt-3 space-y-2">
              {currentJob.pillars.map((p: EvaluationPillar, i: number) => (
                <div
                  key={i}
                  className="flex items-start gap-3 p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800"
                >
                  <span className={weightColor(p.weight)}>{p.weight}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm text-slate-900 dark:text-white">{p.name}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{p.description}</p>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {p.keywords.map((k: string, j: number) => (
                        <span
                          key={j}
                          className="text-[10px] px-1.5 py-0.5 bg-brand-50 dark:bg-brand-950/30 text-brand-600 rounded font-mono"
                        >
                          {k}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* Input mode */
        <div className="space-y-3">
          {/* Saved jobs quick-load */}
          {savedJobs.length > 0 && (
            <div className="card p-3">
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">Load saved job:</p>
              <div className="flex flex-wrap gap-1.5">
                {savedJobs.slice(0, 5).map((job) => (
                  <button
                    key={job.id}
                    onClick={() => handleLoadSavedJob(job)}
                    className="text-xs px-2.5 py-1 rounded-full bg-brand-50 dark:bg-brand-950/30 text-brand-700 hover:bg-brand-100 dark:hover:bg-brand-900/40 transition-colors font-medium"
                  >
                    {job.title}
                  </button>
                ))}
                {savedJobs.length > 5 && (
                  <span className="text-[10px] text-slate-400 dark:text-slate-500 self-center ml-1">
                    +{savedJobs.length - 5} more in Jobs tab
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Input mode toggle */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setInputMode('text')}
              className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-1.5 ${
                inputMode === 'text'
                  ? 'bg-brand-100 dark:bg-brand-950/30 text-brand-700'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <FileText size={13} />
              Paste Text
            </button>
            <button
              onClick={() => setInputMode('url')}
              className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-1.5 ${
                inputMode === 'url'
                  ? 'bg-brand-100 dark:bg-brand-950/30 text-brand-700'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <Globe size={13} />
              From URL
            </button>
          </div>

          {inputMode === 'text' ? (
            <>
              <textarea
                value={jdText}
                onChange={(e) => setJdText(e.target.value)}
                placeholder="Paste the job description here, or upload a file..."
                className="input-field min-h-[160px] resize-y text-sm"
              />

              <div className="flex items-center gap-3">
                <button
                  onClick={handleExtractPillars}
                  disabled={!jdText.trim() || isExtracting}
                  className="btn-primary flex items-center gap-2"
                >
                  {isExtracting ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Sparkles size={16} />
                  )}
                  {isExtracting ? 'Extracting Pillars...' : 'Extract Pillars'}
                </button>

                <input
                  ref={fileRef}
                  type="file"
                  accept=".pdf,.docx,.doc,.txt,.md"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <button
                  onClick={() => fileRef.current?.click()}
                  className="btn-secondary flex items-center gap-2"
                >
                  <Upload size={16} />
                  Upload File
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <div className="flex-1 relative">
                  <Link size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
                  <input
                    type="url"
                    value={jdUrl}
                    onChange={(e) => setJdUrl(e.target.value)}
                    placeholder="https://jobs.example.com/job/12345"
                    className="input-field pl-9 text-sm"
                  />
                </div>
                <button
                  onClick={handleFetchUrl}
                  disabled={!jdUrl.trim() || isFetchingUrl}
                  className="btn-primary flex items-center gap-2"
                >
                  {isFetchingUrl ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Globe size={16} />
                  )}
                  {isFetchingUrl ? 'Fetching...' : 'Fetch JD'}
                </button>
              </div>
              <p className="text-[10px] text-slate-400 dark:text-slate-500">
                Paste a job posting URL. We'll extract the text automatically.
                If it doesn't work, paste the text directly.
              </p>
              {jdText && (
                <div className="mt-2">
                  <p className="text-xs text-emerald-600 font-medium mb-1">
                    Text extracted successfully. Review and extract pillars:
                  </p>
                  <textarea
                    value={jdText}
                    onChange={(e) => setJdText(e.target.value)}
                    className="input-field min-h-[120px] resize-y text-sm"
                  />
                  <button
                    onClick={handleExtractPillars}
                    disabled={!jdText.trim() || isExtracting}
                    className="btn-primary flex items-center gap-2 mt-2"
                  >
                    {isExtracting ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <Sparkles size={16} />
                    )}
                    {isExtracting ? 'Extracting Pillars...' : 'Extract Pillars'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
