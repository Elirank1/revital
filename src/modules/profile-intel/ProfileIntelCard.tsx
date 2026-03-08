import { useState } from 'react';
import { useAppStore } from '../../store/appStore';
import { generateProfileIntel } from './profileEngine';
import {
  Brain,
  Loader2,
  TrendingUp,
  Building2,
  MapPin,
  DollarSign,
  Target,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

const OPEN_TO_CHANGE_COLORS: Record<string, string> = {
  likely: 'bg-emerald-100 text-emerald-700',
  possible: 'bg-amber-100 text-amber-700',
  unlikely: 'bg-red-100 text-red-700',
  unknown: 'bg-slate-100 text-slate-500',
};

export default function ProfileIntelCard() {
  const { currentAnalysis, settings, savedJobs, candidates, profileIntelligence, addProfileIntel } = useAppStore();
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showIntent, setShowIntent] = useState(false);
  const [showPractical, setShowPractical] = useState(false);

  const a = currentAnalysis;
  if (!a) return null;

  // Check if this candidate came from LinkedIn
  const candidate = candidates.find((c) => c.id === a.candidateId);
  const isLinkedIn = candidate?.linkedinUrl || candidate?.fileName === 'LinkedIn Profile';

  // Find existing intel
  const existing = profileIntelligence.find((p) => p.analysisId === a.id);

  const job = savedJobs.find((j) => j.id === a.jobId);
  const pillars = job?.pillars || [];

  const handleGenerate = async () => {
    if (!settings.apiKey) {
      setError('API key / access code required');
      return;
    }
    if (!candidate?.rawText) {
      setError('No profile data available');
      return;
    }

    setGenerating(true);
    setError(null);

    try {
      const intel = await generateProfileIntel(
        candidate.rawText,
        a.jobTitle,
        pillars,
        a.id,
        a.candidateName,
        settings.apiKey,
        settings.model
      );
      addProfileIntel(intel);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  };

  // Only show for LinkedIn profiles or when intel already exists
  if (!isLinkedIn && !existing) return null;

  return (
    <div className="card overflow-hidden border-violet-200">
      <div className="px-4 py-3 bg-violet-50/50 border-b border-violet-100 flex items-center justify-between">
        <h3 className="flex items-center gap-2 font-semibold text-sm text-violet-800">
          <Brain size={15} />
          Profile Intelligence
        </h3>
        {!existing && (
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="btn-primary text-xs flex items-center gap-1.5 px-3 py-1.5"
          >
            {generating ? (
              <>
                <Loader2 size={12} className="animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <Brain size={12} />
                Generate Intel
              </>
            )}
          </button>
        )}
      </div>

      {error && <p className="text-xs text-red-600 px-4 pt-2">{error}</p>}

      {existing && (
        <div className="p-4 space-y-4">
          {/* Career Arc + Progression */}
          <div className="space-y-2">
            <div className="flex items-start gap-2">
              <TrendingUp size={14} className="text-violet-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-semibold text-slate-700">Career Arc</p>
                <p className="text-xs text-slate-600">{existing.careerArc}</p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Building2 size={14} className="text-violet-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-semibold text-slate-700">
                  {existing.seniorityProgression}
                </p>
                <p className="text-xs text-slate-500">{existing.companyPattern}</p>
              </div>
            </div>
          </div>

          {/* Domain expertise tags */}
          {existing.domainExpertise.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {existing.domainExpertise.map((d, i) => (
                <span
                  key={i}
                  className="text-[10px] px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 font-medium"
                >
                  {d}
                </span>
              ))}
            </div>
          )}

          {/* Intent Signals (collapsible) */}
          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <button
              onClick={() => setShowIntent(!showIntent)}
              className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              <span className="flex items-center gap-2">
                Intent Signals
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${OPEN_TO_CHANGE_COLORS[existing.openToChange]}`}>
                  {existing.openToChange}
                </span>
              </span>
              {showIntent ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            {showIntent && (
              <div className="px-3 pb-3 border-t border-slate-100 pt-2 space-y-2">
                <div>
                  <p className="text-[10px] font-semibold text-slate-500 mb-1">Likely Motivations</p>
                  <ul className="space-y-0.5">
                    {existing.likelyMotivations.map((m, i) => (
                      <li key={i} className="text-xs text-slate-600">- {m}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-slate-500 mb-0.5">Open to Change</p>
                  <p className="text-xs text-slate-600">{existing.openToChangeReasoning}</p>
                </div>
              </div>
            )}
          </div>

          {/* Practical Insights (collapsible) */}
          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <button
              onClick={() => setShowPractical(!showPractical)}
              className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              <span className="flex items-center gap-1">
                <DollarSign size={12} /> Practical Insights
              </span>
              {showPractical ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            {showPractical && (
              <div className="px-3 pb-3 border-t border-slate-100 pt-2 space-y-1.5">
                <div className="flex items-start gap-2">
                  <MapPin size={12} className="text-slate-400 mt-0.5 shrink-0" />
                  <p className="text-xs text-slate-600">{existing.locationConfidence}</p>
                </div>
                <div className="flex items-start gap-2">
                  <DollarSign size={12} className="text-slate-400 mt-0.5 shrink-0" />
                  <p className="text-xs text-slate-600">{existing.salaryBand}</p>
                </div>
                <p className="text-xs text-slate-500 italic">{existing.noticeRisk}</p>
              </div>
            )}
          </div>

          {/* Action Items (always visible) */}
          <div className="p-3 rounded-lg bg-brand-50/50 border border-brand-100">
            <div className="flex items-start gap-2 mb-2">
              <Target size={14} className="text-brand-600 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-semibold text-brand-700">Best Approach</p>
                <p className="text-xs text-slate-700">{existing.bestApproachAngle}</p>
              </div>
            </div>
            {existing.thingsToVerify.length > 0 && (
              <div className="mt-2 pt-2 border-t border-brand-100">
                <p className="text-[10px] font-semibold text-slate-500 mb-1">Verify on First Call</p>
                <ul className="space-y-0.5">
                  {existing.thingsToVerify.map((v, i) => (
                    <li key={i} className="text-xs text-slate-600">- {v}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
