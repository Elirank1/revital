import { useAppStore } from '../../store/appStore';
import {
  Briefcase,
  Users,
  TrendingUp,
  ChevronRight,
  Trash2,
  ExternalLink,
} from 'lucide-react';

export default function JobsPanel() {
  const { savedJobs, removeJob, analyses, setCurrentJob, setView } =
    useAppStore();

  const handleLoadJob = (jobId: string) => {
    const job = savedJobs.find((j) => j.id === jobId);
    if (job) {
      setCurrentJob(job);
      setView('analyze');
    }
  };

  const getCandidateCount = (jobId: string) =>
    analyses.filter((a) => a.jobId === jobId).length;

  const getAvgScore = (jobId: string) => {
    const jobAnalyses = analyses.filter((a) => a.jobId === jobId);
    if (jobAnalyses.length === 0) return 0;
    return Math.round(
      jobAnalyses.reduce((s, a) => s + a.matchScore, 0) / jobAnalyses.length
    );
  };

  const getTopCandidate = (jobId: string) => {
    const jobAnalyses = analyses.filter((a) => a.jobId === jobId);
    if (jobAnalyses.length === 0) return null;
    return jobAnalyses.reduce((best, a) =>
      a.matchScore > best.matchScore ? a : best
    );
  };

  if (savedJobs.length === 0) {
    return (
      <div className="text-center py-20 text-slate-400 max-w-4xl mx-auto">
        <Briefcase size={48} className="mx-auto mb-4 opacity-50" />
        <p className="text-lg font-medium">No jobs yet</p>
        <p className="text-sm mt-1">
          Go to Analyze, enter a job description and extract pillars.
          Jobs are saved automatically.
        </p>
        <button
          onClick={() => setView('analyze')}
          className="btn-primary mt-4 inline-flex items-center gap-2"
        >
          Add First Job
          <ChevronRight size={16} />
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Jobs</h2>
          <p className="text-slate-500 dark:text-slate-400 text-sm">
            {savedJobs.length} job descriptions analyzed
          </p>
        </div>
        <button
          onClick={() => setView('analyze')}
          className="btn-primary flex items-center gap-2 text-sm"
        >
          Add New Job
          <ChevronRight size={14} />
        </button>
      </div>

      <div className="space-y-3">
        {savedJobs.map((job) => {
          const candidateCount = getCandidateCount(job.id);
          const avgScore = getAvgScore(job.id);
          const top = getTopCandidate(job.id);

          return (
            <div
              key={job.id}
              className="card p-5 hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-slate-900 dark:text-white text-lg truncate">
                    {job.title}
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Added {new Date(job.createdAt).toLocaleDateString()}
                    {job.sourceUrl && (
                      <span>
                        {' '}&middot;{' '}
                        <a
                          href={job.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-brand-600 hover:underline"
                        >
                          Source <ExternalLink size={10} className="inline" />
                        </a>
                      </span>
                    )}
                  </p>

                  {/* Stats row */}
                  <div className="flex items-center gap-4 mt-3">
                    <div className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
                      <Users size={13} className="text-slate-400 dark:text-slate-500" />
                      <span className="font-semibold">{candidateCount}</span>
                      <span>candidates</span>
                    </div>
                    {candidateCount > 0 && (
                      <div className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
                        <TrendingUp size={13} className="text-slate-400 dark:text-slate-500" />
                        <span>Avg score:</span>
                        <span className="font-semibold">{avgScore}%</span>
                      </div>
                    )}
                    {top && (
                      <div className="text-xs text-slate-600 dark:text-slate-400">
                        Top:{' '}
                        <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                          {top.candidateName} ({top.matchScore}%)
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Pillars */}
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {job.pillars.map((p, i) => (
                      <span
                        key={i}
                        className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                          p.weight === 'CRITICAL'
                            ? 'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400'
                            : p.weight === 'HIGH'
                            ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400'
                            : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                        }`}
                      >
                        {p.name}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex flex-col items-end gap-2 ml-4 shrink-0">
                  <button
                    onClick={() => handleLoadJob(job.id)}
                    className="btn-primary text-xs flex items-center gap-1"
                  >
                    Analyze CVs
                    <ChevronRight size={12} />
                  </button>
                  {candidateCount > 0 && (
                    <button
                      onClick={() => setView('comparison')}
                      className="btn-secondary text-xs"
                    >
                      Compare
                    </button>
                  )}
                  <button
                    onClick={() => {
                      if (
                        confirm(
                          `Remove "${job.title}" from saved jobs? Analysis history will remain.`
                        )
                      )
                        removeJob(job.id);
                    }}
                    className="btn-ghost text-xs text-red-400 hover:text-red-600"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
