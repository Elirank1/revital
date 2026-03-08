import { useAppStore } from '../../store/appStore';
import { GitCompare } from 'lucide-react';
import type { CandidateAnalysis } from '../../types';
import { useState, useMemo } from 'react';

export default function ComparisonView() {
  const { analyses, setCurrentAnalysis, setView } = useAppStore();
  const [sortBy, setSortBy] = useState<'score' | 'name' | 'date'>('score');
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  // Group by jobId (not jobTitle — different JDs could have the same title)
  const jobGroups = useMemo(() => {
    const groups: Record<string, { jobId: string; jobTitle: string; analyses: CandidateAnalysis[] }> = {};
    analyses.forEach((a) => {
      if (!groups[a.jobId]) {
        groups[a.jobId] = { jobId: a.jobId, jobTitle: a.jobTitle, analyses: [] };
      }
      groups[a.jobId].analyses.push(a);
    });
    return Object.values(groups);
  }, [analyses]);

  // Auto-select first job if none selected
  const activeJobId = selectedJobId || (jobGroups.length > 0 ? jobGroups[0].jobId : null);
  const activeGroup = jobGroups.find((g) => g.jobId === activeJobId);

  const sortAnalyses = (list: CandidateAnalysis[]) => {
    return [...list].sort((a, b) => {
      if (sortBy === 'score') return b.matchScore - a.matchScore;
      if (sortBy === 'name') return a.candidateName.localeCompare(b.candidateName);
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    });
  };

  const verdictColor = (v: string) => {
    switch (v) {
      case 'Strong Fit': return 'bg-emerald-500';
      case 'Potential': return 'bg-amber-500';
      default: return 'bg-red-500';
    }
  };

  if (analyses.length === 0) {
    return (
      <div className="text-center py-20 text-slate-400">
        <GitCompare size={48} className="mx-auto mb-4 opacity-50" />
        <p className="text-lg font-medium">No analyses to compare</p>
        <p className="text-sm mt-1">Run analyses on multiple candidates for the same role.</p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Candidate Comparison</h2>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 dark:text-slate-400">Sort by:</span>
          {(['score', 'name', 'date'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSortBy(s)}
              className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${
                sortBy === s
                  ? 'bg-brand-100 text-brand-700'
                  : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Job selector */}
      {jobGroups.length > 1 && (
        <div className="flex items-center gap-2 mb-6 flex-wrap">
          <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">Select job:</span>
          {jobGroups.map((g) => (
            <button
              key={g.jobId}
              onClick={() => setSelectedJobId(g.jobId)}
              className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
                g.jobId === activeJobId
                  ? 'bg-brand-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700'
              }`}
            >
              {g.jobTitle} ({g.analyses.length})
            </button>
          ))}
        </div>
      )}

      {/* Comparison table for active job */}
      {activeGroup ? (
        <div>
          <h3 className="text-sm font-semibold text-brand-700 mb-3">
            {activeGroup.jobTitle} — {activeGroup.analyses.length} candidate
            {activeGroup.analyses.length !== 1 ? 's' : ''}
          </h3>

          {activeGroup.analyses.length < 2 ? (
            <div className="card p-6 text-center text-slate-400">
              <p className="text-sm">
                Need at least 2 candidates for comparison. Analyze more CVs for this job.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="text-left text-xs text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                    <th className="pb-2 pr-4">Rank</th>
                    <th className="pb-2 pr-4">Candidate</th>
                    <th className="pb-2 pr-4">Score</th>
                    <th className="pb-2 pr-4">Verdict</th>
                    <th className="pb-2 pr-4">Top Strength</th>
                    <th className="pb-2 pr-4">Top Gap</th>
                    <th className="pb-2">Red Flags</th>
                  </tr>
                </thead>
                <tbody>
                  {sortAnalyses(activeGroup.analyses).map((a, rank) => (
                    <tr
                      key={a.id}
                      className="border-b border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer transition-colors"
                      onClick={() => {
                        setCurrentAnalysis(a);
                        setView('results');
                      }}
                    >
                      <td className="py-3 pr-4 text-sm font-semibold text-slate-400">
                        #{rank + 1}
                      </td>
                      <td className="py-3 pr-4">
                        <p className="font-medium text-sm text-slate-900 dark:text-white">
                          {a.candidateName}
                        </p>
                      </td>
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${
                                a.matchScore >= 80
                                  ? 'bg-emerald-500'
                                  : a.matchScore >= 55
                                  ? 'bg-amber-500'
                                  : 'bg-red-500'
                              }`}
                              style={{ width: `${a.matchScore}%` }}
                            />
                          </div>
                          <span className="text-sm font-semibold">{a.matchScore}%</span>
                        </div>
                      </td>
                      <td className="py-3 pr-4">
                        <span className={`w-2 h-2 rounded-full inline-block mr-1.5 ${verdictColor(a.verdict)}`} />
                        <span className="text-sm">{a.verdict}</span>
                      </td>
                      <td className="py-3 pr-4 text-xs text-slate-600 dark:text-slate-400 max-w-[200px] truncate">
                        {a.greenFlags[0] || '—'}
                      </td>
                      <td className="py-3 pr-4 text-xs text-slate-600 dark:text-slate-400 max-w-[200px] truncate">
                        {a.redFlags[0] || '—'}
                      </td>
                      <td className="py-3 text-xs">
                        {a.autoRedFlags.length > 0 ? (
                          <span className="bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-400 px-2 py-0.5 rounded-full text-[10px] font-semibold">
                            {a.autoRedFlags.length}
                          </span>
                        ) : (
                          <span className="text-slate-400">None</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
