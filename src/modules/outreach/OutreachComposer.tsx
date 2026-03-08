import { useState, useEffect } from 'react';
import { useAppStore } from '../../store/appStore';
import { generateOutreach } from './outreachEngine';
import type { OutreachTone } from './outreachTypes';
import {
  Send,
  Loader2,
  Copy,
  RefreshCw,
  Check,
} from 'lucide-react';

const TONES: { value: OutreachTone; label: string }[] = [
  { value: 'professional', label: 'Professional' },
  { value: 'warm', label: 'Warm' },
  { value: 'direct', label: 'Direct' },
  { value: 'consultative', label: 'Consultative' },
];

export default function OutreachComposer() {
  const { currentAnalysis, settings, outreachDrafts, addOutreachDraft } = useAppStore();
  const [tone, setTone] = useState<OutreachTone>('professional');
  const [companyContext, setCompanyContext] = useState('');
  const [firstMessage, setFirstMessage] = useState('');
  const [followUpMessage, setFollowUpMessage] = useState('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedFirst, setCopiedFirst] = useState(false);
  const [copiedFollowUp, setCopiedFollowUp] = useState(false);

  const a = currentAnalysis;

  // Load existing draft for this analysis if available
  useEffect(() => {
    if (!a) return;
    const existing = outreachDrafts.find((d) => d.analysisId === a.id);
    if (existing) {
      setFirstMessage(existing.firstMessage);
      setFollowUpMessage(existing.followUpMessage);
      setTone(existing.tone);
      setCompanyContext(existing.companyContext);
    } else {
      setFirstMessage('');
      setFollowUpMessage('');
    }
  }, [a?.id, outreachDrafts]);

  if (!a) return null;

  const handleGenerate = async () => {
    if (!settings.apiKey) {
      setError('API key / access code required');
      return;
    }

    setGenerating(true);
    setError(null);

    try {
      const draft = await generateOutreach(a, tone, companyContext, settings.apiKey, settings.model);
      setFirstMessage(draft.firstMessage);
      setFollowUpMessage(draft.followUpMessage);
      addOutreachDraft(draft);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  };

  const handleCopy = async (text: string, setCopied: (v: boolean) => void) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="space-y-4">
      {/* Tone selector */}
      <div>
        <label className="text-xs font-medium text-slate-500 mb-2 block">Tone</label>
        <div className="flex gap-2 flex-wrap">
          {TONES.map((t) => (
            <button
              key={t.value}
              onClick={() => setTone(t.value)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                tone === t.value
                  ? 'bg-brand-100 text-brand-700 border border-brand-300'
                  : 'bg-slate-50 text-slate-500 border border-slate-200 hover:bg-slate-100'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Company context */}
      <div>
        <label className="text-xs font-medium text-slate-500 mb-1 block">
          Company / Role Context
        </label>
        <textarea
          value={companyContext}
          onChange={(e) => setCompanyContext(e.target.value)}
          placeholder="What makes this role/company attractive? e.g., 'Series B AI startup, building core ML platform, small team with high impact...'"
          className="w-full text-sm border border-slate-200 rounded-lg p-3 min-h-[60px] resize-y focus:outline-none focus:ring-2 focus:ring-brand-300 focus:border-brand-300"
        />
      </div>

      {/* Generate button */}
      <button
        onClick={handleGenerate}
        disabled={generating}
        className="btn-primary text-sm flex items-center gap-2"
      >
        {generating ? (
          <>
            <Loader2 size={14} className="animate-spin" />
            Generating...
          </>
        ) : firstMessage ? (
          <>
            <RefreshCw size={14} />
            Regenerate
          </>
        ) : (
          <>
            <Send size={14} />
            Generate Outreach
          </>
        )}
      </button>

      {error && (
        <p className="text-xs text-red-600">{error}</p>
      )}

      {/* First message */}
      {firstMessage && (
        <div className="space-y-3">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-semibold text-slate-700">First Message</label>
              <button
                onClick={() => handleCopy(firstMessage, setCopiedFirst)}
                className="btn-ghost text-[10px] flex items-center gap-1"
              >
                {copiedFirst ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                {copiedFirst ? 'Copied' : 'Copy'}
              </button>
            </div>
            <textarea
              value={firstMessage}
              onChange={(e) => setFirstMessage(e.target.value)}
              className="w-full text-sm border border-slate-200 rounded-lg p-3 min-h-[120px] resize-y focus:outline-none focus:ring-2 focus:ring-brand-300 focus:border-brand-300"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-semibold text-slate-700">Follow-up</label>
              <button
                onClick={() => handleCopy(followUpMessage, setCopiedFollowUp)}
                className="btn-ghost text-[10px] flex items-center gap-1"
              >
                {copiedFollowUp ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                {copiedFollowUp ? 'Copied' : 'Copy'}
              </button>
            </div>
            <textarea
              value={followUpMessage}
              onChange={(e) => setFollowUpMessage(e.target.value)}
              className="w-full text-sm border border-slate-200 rounded-lg p-3 min-h-[80px] resize-y focus:outline-none focus:ring-2 focus:ring-brand-300 focus:border-brand-300"
            />
          </div>
        </div>
      )}
    </div>
  );
}
