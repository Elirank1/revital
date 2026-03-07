import { useAppStore } from './store/appStore';
import Header from './components/Layout/Header';
import JobInput from './components/JobInput/JobInput';
import CandidateUpload from './components/CandidateUpload/CandidateUpload';
import AnalysisView from './components/AnalysisView/AnalysisView';
import ComparisonView from './components/ComparisonView/ComparisonView';
import HistoryPanel from './components/HistoryPanel/HistoryPanel';
import SettingsPage from './components/Settings/SettingsPage';
import {
  BarChart3,
  FileText,
  Users,
  TrendingUp,
  ArrowRight,
} from 'lucide-react';

function Dashboard() {
  const { analysisLog, setView, settings } = useAppStore();

  const total = analysisLog.length;
  const strongFits = analysisLog.filter((a) => a.verdict === 'Strong Fit').length;
  const potentials = analysisLog.filter((a) => a.verdict === 'Potential').length;
  const avgScore =
    total > 0
      ? Math.round(analysisLog.reduce((s, a) => s + a.matchScore, 0) / total)
      : 0;

  return (
    <div className="space-y-8">
      {/* Hero */}
      <div className="text-center py-8">
        <div className="inline-flex items-center gap-3 mb-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center shadow-lg shadow-brand-500/20">
            <span className="text-white font-bold text-2xl">R</span>
          </div>
        </div>
        <h1 className="text-3xl font-bold text-slate-900 mb-2">
          Revital <span className="text-brand-600">CV Analyzer</span>
        </h1>
        <p className="text-slate-500 max-w-md mx-auto">
          AI-powered candidate screening. Upload a job description and CVs to get
          structured, scored analysis in seconds.
        </p>
        {!settings.apiKey && (
          <button
            onClick={() => setView('settings')}
            className="btn-primary mt-4 inline-flex items-center gap-2"
          >
            Get Started — Set API Key
            <ArrowRight size={16} />
          </button>
        )}
      </div>

      {/* Stats */}
      {total > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            icon={<FileText size={20} />}
            label="Total Analyses"
            value={total.toString()}
          />
          <StatCard
            icon={<TrendingUp size={20} />}
            label="Avg. Score"
            value={`${avgScore}%`}
            color="brand"
          />
          <StatCard
            icon={<Users size={20} />}
            label="Strong Fits"
            value={strongFits.toString()}
            color="green"
          />
          <StatCard
            icon={<BarChart3 size={20} />}
            label="Potentials"
            value={potentials.toString()}
            color="amber"
          />
        </div>
      )}

      {/* Quick action */}
      {settings.apiKey && (
        <div className="card p-6 border-brand-200 bg-gradient-to-r from-brand-50/50 to-white">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-slate-900">
                Ready to analyze candidates
              </h3>
              <p className="text-sm text-slate-500 mt-1">
                Start by loading a job description, then upload CVs.
              </p>
            </div>
            <button
              onClick={() => setView('analyze')}
              className="btn-primary flex items-center gap-2"
            >
              Start Analysis
              <ArrowRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Recent */}
      {analysisLog.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-slate-900">Recent Analyses</h3>
            <button
              onClick={() => setView('history')}
              className="text-sm text-brand-600 hover:text-brand-700 font-medium"
            >
              View all
            </button>
          </div>
          <div className="space-y-2">
            {analysisLog.slice(0, 5).map((entry) => (
              <div
                key={entry.id}
                className="card p-3 flex items-center justify-between hover:shadow-md transition-shadow cursor-pointer"
                onClick={() => {
                  const analysis = useAppStore
                    .getState()
                    .analyses.find((a) => a.id === entry.id);
                  if (analysis) {
                    useAppStore.getState().setCurrentAnalysis(analysis);
                    setView('analyze');
                  }
                }}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-xs ${
                      entry.matchScore >= 80
                        ? 'bg-emerald-100 text-emerald-700'
                        : entry.matchScore >= 55
                        ? 'bg-amber-100 text-amber-700'
                        : 'bg-red-100 text-red-700'
                    }`}
                  >
                    {entry.matchScore}%
                  </div>
                  <div>
                    <p className="font-medium text-sm">{entry.candidateName}</p>
                    <p className="text-xs text-slate-400">{entry.jobTitle}</p>
                  </div>
                </div>
                <span
                  className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                    entry.verdict === 'Strong Fit'
                      ? 'bg-emerald-50 text-emerald-700'
                      : entry.verdict === 'Potential'
                      ? 'bg-amber-50 text-amber-700'
                      : 'bg-red-50 text-red-700'
                  }`}
                >
                  {entry.verdict}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  color = 'slate',
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color?: string;
}) {
  const colorMap: Record<string, string> = {
    slate: 'text-slate-600',
    brand: 'text-brand-600',
    green: 'text-emerald-600',
    amber: 'text-amber-600',
  };
  return (
    <div className="card p-4">
      <div className={`${colorMap[color] || colorMap.slate} mb-2`}>{icon}</div>
      <p className="text-2xl font-bold text-slate-900">{value}</p>
      <p className="text-xs text-slate-500">{label}</p>
    </div>
  );
}

function AnalyzePage() {
  const { currentAnalysis } = useAppStore();

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Left panel — inputs */}
      <div className="lg:col-span-1 space-y-6">
        <JobInput />
        <CandidateUpload />
      </div>

      {/* Right panel — results */}
      <div className="lg:col-span-2">
        <AnalysisView />
      </div>
    </div>
  );
}

export default function App() {
  const { currentView } = useAppStore();

  return (
    <div className="min-h-screen bg-slate-50">
      <Header />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {currentView === 'dashboard' && <Dashboard />}
        {currentView === 'analyze' && <AnalyzePage />}
        {currentView === 'comparison' && <ComparisonView />}
        {currentView === 'history' && <HistoryPanel />}
        {currentView === 'settings' && <SettingsPage />}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 py-4 mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center justify-between">
          <p className="text-xs text-slate-400">
            Revital CV Analyzer &middot; Built by Revital Keren
          </p>
          <p className="text-xs text-slate-400">
            Powered by Claude AI
          </p>
        </div>
      </footer>
    </div>
  );
}
