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
} from 'lucide-react';
import type { EvaluationPillar } from '../../types';

export default function JobInput() {
  const {
    currentJob,
    setCurrentJob,
    settings,
    setError,
  } = useAppStore();
  const [jdText, setJdText] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);
  const [showPillars, setShowPillars] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await extractText(file);
      setJdText(text);
    } catch (err: any) {
      setError(`Failed to read file: ${err.message}`);
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
      setCurrentJob({
        id: Date.now().toString(36),
        title: result.jobTitle,
        rawText: jdText,
        pillars: result.pillars,
        createdAt: new Date().toISOString(),
      });
      setShowPillars(true);
    } catch (err: any) {
      setError(`Pillar extraction failed: ${err.message}`);
    } finally {
      setIsExtracting(false);
    }
  };

  const weightColor = (w: string) => {
    switch (w) {
      case 'CRITICAL': return 'badge-red';
      case 'HIGH': return 'badge-yellow';
      case 'MEDIUM': return 'badge-blue';
      default: return 'bg-slate-100 text-slate-600 text-xs px-2 py-0.5 rounded-full';
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-slate-900 flex items-center gap-2">
          <FileText size={18} className="text-brand-600" />
          Job Description
        </h3>
        {currentJob && (
          <button
            onClick={() => {
              setCurrentJob(null);
              setJdText('');
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
              <span className="font-semibold text-slate-900">{currentJob.title}</span>
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
                  className="flex items-start gap-3 p-2.5 rounded-lg bg-slate-50"
                >
                  <span className={weightColor(p.weight)}>{p.weight}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm text-slate-900">{p.name}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{p.description}</p>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {p.keywords.map((k: string, j: number) => (
                        <span
                          key={j}
                          className="text-[10px] px-1.5 py-0.5 bg-brand-50 text-brand-600 rounded font-mono"
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
        </div>
      )}
    </div>
  );
}
