import { useState, useEffect, useRef } from 'react';
import { useAppStore } from '../../store/appStore';
import { generateInterviewSummary } from './interviewEngine';
import {
  FileText,
  Loader2,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  Mic,
  Upload,
  CheckCircle,
  AlertTriangle,
  HelpCircle,
  MessageSquare,
} from 'lucide-react';

export default function InterviewSummary() {
  const { currentAnalysis, settings, savedJobs, interviewSummaries, addInterviewSummary } = useAppStore();
  const [transcript, setTranscript] = useState('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedManager, setCopiedManager] = useState(false);
  const [copiedFull, setCopiedFull] = useState(false);
  const [showQuestions, setShowQuestions] = useState(false);
  const [showCulture, setShowCulture] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [language, setLanguage] = useState<'auto' | 'he' | 'en'>('auto');
  const audioRef = useRef<HTMLInputElement>(null);

  const a = currentAnalysis;

  // Load existing summary for this analysis
  const existing = a ? interviewSummaries.find((s) => s.analysisId === a.id) : null;

  useEffect(() => {
    if (existing) setTranscript(existing.rawTranscript);
  }, [existing?.id]);

  if (!a) return null;

  const job = savedJobs.find((j) => j.id === a.jobId);
  const pillars = job?.pillars || [];

  const handleGenerate = async () => {
    if (!transcript.trim()) {
      setError('Please paste the interview transcript first.');
      return;
    }
    if (!settings.apiKey) {
      setError('API key / access code required');
      return;
    }

    setGenerating(true);
    setError(null);

    try {
      const analysisContext = `Profile: ${a.profileSummary}\nVerdict: ${a.verdict} (${a.matchScore}%)`;
      const summary = await generateInterviewSummary(
        transcript.trim(),
        a.candidateName,
        a.jobTitle,
        pillars,
        analysisContext,
        a.id,
        settings.apiKey,
        settings.model
      );
      addInterviewSummary(summary);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  };

  const handleAudioUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!settings.apiKey) {
      setError('API key / access code required');
      return;
    }

    // Validate file size (25MB limit for Whisper)
    if (file.size > 25 * 1024 * 1024) {
      setError('Audio file must be under 25MB');
      return;
    }

    setTranscribing(true);
    setError(null);

    try {
      // Convert file to base64
      const buffer = await file.arrayBuffer();
      const base64 = btoa(
        new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
      );

      const response = await fetch(`${window.location.origin}/api/transcribe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Access-Code': settings.apiKey,
        },
        body: JSON.stringify({
          audio: base64,
          fileName: file.name,
          language: language === 'auto' ? undefined : language,
        }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || `Transcription failed (${response.status})`);
      }

      const data = await response.json();
      setTranscript(data.transcript);
    } catch (err: any) {
      setError(`Transcription failed: ${err.message}`);
    } finally {
      setTranscribing(false);
      if (audioRef.current) audioRef.current.value = '';
    }
  };

  const handleCopy = async (text: string, setCopied: (v: boolean) => void) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const buildFullSummary = () => {
    if (!existing) return '';
    return [
      `Interview Summary: ${existing.candidateName} — ${existing.jobTitle}`,
      `Date: ${new Date(existing.timestamp).toLocaleDateString()}`,
      '',
      `OVERVIEW: ${existing.overview}`,
      '',
      'STRENGTHS:',
      ...existing.strengths.map((s) => `  - ${s}`),
      '',
      'CONCERNS:',
      ...existing.concerns.map((c) => `  - ${c}`),
      '',
      'OPEN QUESTIONS:',
      ...existing.openQuestions.map((q) => `  - ${q}`),
      '',
      `RECOMMENDATION: ${existing.recommendation}`,
      '',
      `CULTURE FIT: ${existing.cultureFit}`,
    ].join('\n');
  };

  return (
    <div className="space-y-4">
      {/* Transcript input */}
      {!existing && (
        <>
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">
              Interview Transcript
            </label>
            <textarea
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              placeholder="Paste the interview transcript or notes here..."
              className="w-full text-sm border border-slate-200 rounded-lg p-3 min-h-[200px] resize-y focus:outline-none focus:ring-2 focus:ring-brand-300 focus:border-brand-300"
            />
          </div>

          {/* Audio upload */}
          <div className="flex items-center gap-3 flex-wrap">
            <input
              ref={audioRef}
              type="file"
              accept="audio/*,.mp3,.mp4,.m4a,.wav,.webm,.ogg,.flac"
              onChange={handleAudioUpload}
              className="hidden"
            />
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-slate-500">Language:</label>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value as 'auto' | 'he' | 'en')}
                className="text-xs border border-slate-200 rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-brand-300"
              >
                <option value="auto">Auto-detect</option>
                <option value="he">Hebrew</option>
                <option value="en">English</option>
              </select>
            </div>
            <button
              onClick={() => audioRef.current?.click()}
              disabled={transcribing}
              className="btn-secondary text-xs flex items-center gap-1.5"
            >
              {transcribing ? (
                <>
                  <Loader2 size={12} className="animate-spin" />
                  Transcribing...
                </>
              ) : (
                <>
                  <Upload size={12} />
                  Upload Audio
                </>
              )}
            </button>
            <span className="text-[10px] text-slate-400">MP3, M4A, WAV, WebM — max 25MB</span>
          </div>

          <button
            onClick={handleGenerate}
            disabled={generating || !transcript.trim()}
            className="btn-primary text-sm flex items-center gap-2"
          >
            {generating ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Generating Summary...
              </>
            ) : (
              <>
                <FileText size={14} />
                Generate Summary
              </>
            )}
          </button>
        </>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}

      {/* Results */}
      {existing && (
        <div className="space-y-3">
          {/* Overview */}
          <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
            <p className="text-xs font-semibold text-slate-500 mb-1">Overview</p>
            <p className="text-sm text-slate-800">{existing.overview}</p>
          </div>

          {/* Strengths */}
          <div className="p-3 rounded-lg bg-emerald-50/50 border border-emerald-100">
            <p className="text-xs font-semibold text-emerald-700 mb-2 flex items-center gap-1">
              <CheckCircle size={12} /> Strengths
            </p>
            <ul className="space-y-1">
              {existing.strengths.map((s, i) => (
                <li key={i} className="text-xs text-slate-700 flex items-start gap-2">
                  <span className="text-emerald-500 mt-0.5">+</span>
                  {s}
                </li>
              ))}
            </ul>
          </div>

          {/* Concerns */}
          <div className="p-3 rounded-lg bg-red-50/50 border border-red-100">
            <p className="text-xs font-semibold text-red-700 mb-2 flex items-center gap-1">
              <AlertTriangle size={12} /> Concerns
            </p>
            <ul className="space-y-1">
              {existing.concerns.map((c, i) => (
                <li key={i} className="text-xs text-slate-700 flex items-start gap-2">
                  <span className="text-red-500 mt-0.5">-</span>
                  {c}
                </li>
              ))}
            </ul>
          </div>

          {/* Recommendation */}
          <div className="p-3 rounded-lg bg-brand-50 border border-brand-200">
            <p className="text-xs font-semibold text-brand-700 mb-1">Recommendation</p>
            <p className="text-sm font-medium text-slate-900">{existing.recommendation}</p>
          </div>

          {/* Open Questions (collapsible) */}
          {existing.openQuestions.length > 0 && (
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <button
                onClick={() => setShowQuestions(!showQuestions)}
                className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                <span className="flex items-center gap-1">
                  <HelpCircle size={12} /> Open Questions ({existing.openQuestions.length})
                </span>
                {showQuestions ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
              {showQuestions && (
                <div className="px-3 pb-3 border-t border-slate-100 pt-2">
                  <ul className="space-y-1">
                    {existing.openQuestions.map((q, i) => (
                      <li key={i} className="text-xs text-slate-600">? {q}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Culture Fit (collapsible) */}
          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <button
              onClick={() => setShowCulture(!showCulture)}
              className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              <span className="flex items-center gap-1">
                <MessageSquare size={12} /> Culture Fit
              </span>
              {showCulture ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            {showCulture && (
              <div className="px-3 pb-3 border-t border-slate-100 pt-2">
                <p className="text-xs text-slate-700">{existing.cultureFit}</p>
              </div>
            )}
          </div>

          {/* Manager Summary */}
          <div className="card p-4 border-violet-200 bg-violet-50/30">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-violet-700">Manager Version</p>
              <div className="flex gap-1">
                <button
                  onClick={() => handleCopy(existing.managerSummary, setCopiedManager)}
                  className="btn-ghost text-[10px] flex items-center gap-1"
                >
                  {copiedManager ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                  {copiedManager ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
            <p className="text-sm text-slate-800 leading-relaxed">{existing.managerSummary}</p>
          </div>

          {/* Copy full summary */}
          <button
            onClick={() => handleCopy(buildFullSummary(), setCopiedFull)}
            className="btn-secondary text-xs flex items-center gap-2"
          >
            {copiedFull ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
            {copiedFull ? 'Copied Full Summary' : 'Copy Full Summary'}
          </button>
        </div>
      )}
    </div>
  );
}
