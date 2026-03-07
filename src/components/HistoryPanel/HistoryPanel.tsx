import { useAppStore } from '../../store/appStore';
import { logToCSV, downloadFile, copyToClipboard } from '../../utils/export';
import { Clock, Download, Trash2, Copy, ExternalLink } from 'lucide-react';
import { useState } from 'react';

export default function HistoryPanel() {
  const { analysisLog, clearLog, analyses, setCurrentAnalysis, setView } =
    useAppStore();
  const [copied, setCopied] = useState<string | null>(null);

  const handleExportCSV = () => {
    const csv = logToCSV(analysisLog);
    downloadFile(csv, `revital-log-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv');
  };

  const handleCopySummary = async (id: string, summary: string) => {
    await copyToClipboard(summary);
    setCopied(id);
    setTimeout(() => setCopied(null), 1500);
  };

  const handleViewAnalysis = (logId: string) => {
    const analysis = analyses.find((a) => a.id === logId);
    if (analysis) {
      setCurrentAnalysis(analysis);
      setView('analyze');
    }
  };

  const verdictColor = (v: string) => {
    switch (v) {
      case 'Strong Fit':
        return 'text-emerald-700 bg-emerald-50';
      case 'Potential':
        return 'text-amber-700 bg-amber-50';
      default:
        return 'text-red-700 bg-red-50';
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Analysis History</h2>
          <p className="text-slate-500 text-sm">
            {analysisLog.length} analyses recorded
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleExportCSV} className="btn-secondary flex items-center gap-2 text-sm">
            <Download size={14} />
            Export CSV
          </button>
          {analysisLog.length > 0 && (
            <button
              onClick={() => {
                if (confirm('Clear entire history? This cannot be undone.'))
                  clearLog();
              }}
              className="btn-ghost text-red-500 hover:text-red-700 flex items-center gap-2 text-sm"
            >
              <Trash2 size={14} />
              Clear
            </button>
          )}
        </div>
      </div>

      {analysisLog.length === 0 ? (
        <div className="text-center py-20 text-slate-400">
          <Clock size={48} className="mx-auto mb-4 opacity-50" />
          <p>No analyses yet. Run your first analysis to see it here.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {analysisLog.map((entry) => (
            <div
              key={entry.id}
              className="card p-4 flex items-center justify-between hover:shadow-md transition-shadow"
            >
              <div className="flex items-center gap-4 min-w-0">
                {/* Score circle */}
                <div
                  className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-sm ${
                    entry.matchScore >= 80
                      ? 'bg-emerald-100 text-emerald-700'
                      : entry.matchScore >= 55
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-red-100 text-red-700'
                  }`}
                >
                  {entry.matchScore}%
                </div>

                <div className="min-w-0">
                  <p className="font-semibold text-slate-900 truncate">
                    {entry.candidateName}
                  </p>
                  <p className="text-xs text-slate-400">
                    {entry.jobTitle} &middot;{' '}
                    {new Date(entry.timestamp).toLocaleDateString()}
                  </p>
                </div>

                <span
                  className={`px-2.5 py-1 rounded-full text-xs font-semibold ${verdictColor(
                    entry.verdict
                  )}`}
                >
                  {entry.verdict}
                </span>
              </div>

              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleCopySummary(entry.id, entry.summary)}
                  className="btn-ghost text-xs"
                  title="Copy summary"
                >
                  <Copy size={14} />
                  {copied === entry.id ? (
                    <span className="ml-1">Copied</span>
                  ) : null}
                </button>
                <button
                  onClick={() => handleViewAnalysis(entry.id)}
                  className="btn-ghost text-xs"
                  title="View full analysis"
                >
                  <ExternalLink size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
