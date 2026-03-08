import { useRef, useState } from 'react';
import { useAppStore } from '../../store/appStore';
import { extractText, guessNameFromText } from '../../engine/parser';
import { analyzeCandidate, createLogEntry } from '../../engine/analyzer';
import {
  UserPlus,
  Upload,
  X,
  Linkedin,
  Play,
  Loader2,
  FileText,
  AlertCircle,
} from 'lucide-react';

export default function CandidateUpload() {
  const {
    currentJob,
    candidates,
    addCandidate,
    removeCandidate,
    addAnalysis,
    addToLog,
    setCurrentAnalysis,
    settings,
    isAnalyzing,
    setIsAnalyzing,
    analysisProgress,
    setAnalysisProgress,
    error,
    setError,
    setView,
  } = useAppStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [showPaste, setShowPaste] = useState(false);
  const [fetchingLinkedin, setFetchingLinkedin] = useState(false);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    for (const file of Array.from(files)) {
      try {
        const text = await extractText(file);
        const name = guessNameFromText(text);
        addCandidate({
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          name,
          fileName: file.name,
          rawText: text,
          linkedinUrl: linkedinUrl || undefined,
          uploadedAt: new Date().toISOString(),
        });
      } catch (err: any) {
        setError(`Failed to read ${file.name}: ${err.message}`);
      }
    }
    // Reset
    if (fileRef.current) fileRef.current.value = '';
    setLinkedinUrl('');
  };

  const handleAnalyzeAll = async () => {
    if (!currentJob) {
      setError('Please load a job description first.');
      return;
    }
    if (candidates.length === 0) {
      setError('Please upload at least one CV.');
      return;
    }
    if (!settings.apiKey) {
      setError('Please set your API key in Settings.');
      return;
    }

    setIsAnalyzing(true);
    setError(null);

    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      setAnalysisProgress(
        `Analyzing ${candidate.name} (${i + 1}/${candidates.length})...`
      );

      try {
        const analysis = await analyzeCandidate(
          currentJob,
          candidate,
          settings.apiKey,
          settings.model
        );
        addAnalysis(analysis);
        addToLog(createLogEntry(analysis));

        // Show the first result immediately
        if (i === 0) {
          setCurrentAnalysis(analysis);
        }
      } catch (err: any) {
        setError(`Analysis failed for ${candidate.name}: ${err.message}`);
      }
    }

    setIsAnalyzing(false);
    setAnalysisProgress('');
    setView('results'); // Navigate to results view after analysis completes
  };

  const handleFetchLinkedin = async () => {
    if (!linkedinUrl || !linkedinUrl.includes('linkedin.com/in/')) {
      setError('Please enter a valid LinkedIn profile URL (e.g., https://linkedin.com/in/name)');
      return;
    }

    setFetchingLinkedin(true);
    setError(null);

    try {
      const response = await fetch(`${window.location.origin}/api/linkedin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Access-Code': settings.apiKey,
        },
        body: JSON.stringify({ linkedinUrl }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || `Failed to fetch profile (${response.status})`);
      }

      const data = await response.json();
      addCandidate({
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        name: data.name || 'Unknown',
        fileName: 'LinkedIn Profile',
        rawText: data.profileText,
        linkedinUrl,
        uploadedAt: new Date().toISOString(),
      });
      setLinkedinUrl('');
    } catch (err: any) {
      setError(`LinkedIn fetch failed: ${err.message}`);
    } finally {
      setFetchingLinkedin(false);
    }
  };

  const handlePasteAdd = () => {
    if (!pasteText.trim()) return;
    const text = pasteText.trim();
    const name = guessNameFromText(text);
    addCandidate({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name,
      fileName: linkedinUrl ? 'LinkedIn Profile' : 'Pasted Text',
      rawText: text,
      linkedinUrl: linkedinUrl || undefined,
      uploadedAt: new Date().toISOString(),
    });
    setPasteText('');
    setLinkedinUrl('');
    setShowPaste(false);
  };

  const noJob = !currentJob;

  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-slate-900 flex items-center gap-2">
        <UserPlus size={18} className="text-brand-600" />
        Candidates
      </h3>

      {noJob && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-700">
          <AlertCircle size={16} />
          Load a job description first before uploading CVs.
        </div>
      )}

      {/* LinkedIn URL */}
      <div>
        <label className="text-xs font-medium text-slate-500 mb-1 block">
          LinkedIn Profile URL — fetch profile or attach as reference
        </label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Linkedin
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              type="url"
              value={linkedinUrl}
              onChange={(e) => setLinkedinUrl(e.target.value)}
              placeholder="https://linkedin.com/in/..."
              className="input-field pl-9 text-sm"
              disabled={noJob}
            />
          </div>
          <button
            onClick={handleFetchLinkedin}
            disabled={noJob || !linkedinUrl || fetchingLinkedin}
            className="btn-primary text-sm flex items-center gap-2 px-4 whitespace-nowrap"
          >
            {fetchingLinkedin ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Fetching...
              </>
            ) : (
              <>
                <Linkedin size={14} />
                Fetch Profile
              </>
            )}
          </button>
        </div>
        <p className="text-[10px] text-slate-400 mt-1">
          Paste a URL and click Fetch to pull the full profile automatically, or just attach as reference with a CV upload.
        </p>
      </div>

      {/* Upload */}
      <input
        ref={fileRef}
        type="file"
        accept=".pdf,.docx,.doc,.txt"
        multiple
        onChange={handleFileUpload}
        className="hidden"
      />
      <div className="flex gap-2">
        <button
          onClick={() => fileRef.current?.click()}
          disabled={noJob}
          className="btn-secondary flex-1 flex items-center justify-center gap-2 py-6 border-dashed border-2 hover:border-brand-300 hover:bg-brand-50/30"
        >
          <Upload size={20} />
          <span>Upload CVs (PDF, DOCX, TXT)</span>
        </button>
        <button
          onClick={() => setShowPaste(!showPaste)}
          disabled={noJob}
          className={`btn-secondary flex items-center justify-center gap-2 px-4 py-6 border-dashed border-2 ${
            showPaste
              ? 'border-brand-400 bg-brand-50/50 text-brand-700'
              : 'hover:border-brand-300 hover:bg-brand-50/30'
          }`}
        >
          <FileText size={20} />
          <span className="text-sm">Paste Text</span>
        </button>
      </div>

      {/* Paste text area */}
      {showPaste && (
        <div className="space-y-2">
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder="Paste LinkedIn profile text, resume content, or any candidate info here..."
            className="w-full text-sm border border-slate-200 rounded-lg p-3 min-h-[150px] resize-y focus:outline-none focus:ring-2 focus:ring-brand-300 focus:border-brand-300"
          />
          <button
            onClick={handlePasteAdd}
            disabled={!pasteText.trim()}
            className="btn-primary text-sm flex items-center gap-2"
          >
            <UserPlus size={14} />
            Add Candidate from Text
          </button>
        </div>
      )}

      {/* Candidate list */}
      {candidates.length > 0 && (
        <div className="space-y-2">
          {candidates.map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between p-3 rounded-lg bg-slate-50 border border-slate-100"
            >
              <div className="flex items-center gap-3 min-w-0">
                <FileText size={16} className="text-brand-500 shrink-0" />
                <div className="min-w-0">
                  <p className="font-medium text-sm text-slate-900 truncate">
                    {c.name}
                  </p>
                  <p className="text-xs text-slate-400 truncate">{c.fileName}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {c.linkedinUrl && (
                  <a
                    href={c.linkedinUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-500 hover:text-blue-700"
                  >
                    <Linkedin size={14} />
                  </a>
                )}
                <button
                  onClick={() => removeCandidate(c.id)}
                  className="text-slate-400 hover:text-red-500 transition-colors"
                >
                  <X size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Analyze button */}
      {candidates.length > 0 && currentJob && (
        <button
          onClick={handleAnalyzeAll}
          disabled={isAnalyzing}
          className="btn-primary w-full flex items-center justify-center gap-2 py-3 text-base"
        >
          {isAnalyzing ? (
            <>
              <Loader2 size={20} className="animate-spin" />
              {analysisProgress}
            </>
          ) : (
            <>
              <Play size={20} />
              Analyze {candidates.length} Candidate{candidates.length > 1 ? 's' : ''}
            </>
          )}
        </button>
      )}

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          {error}
        </div>
      )}
    </div>
  );
}
