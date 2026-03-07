import { useAppStore } from '../../store/appStore';
import { analysisToText } from '../../utils/export';
import { copyToClipboard, downloadFile } from '../../utils/export';
import {
  User,
  Target,
  CheckCircle,
  AlertTriangle,
  HelpCircle,
  MessageSquare,
  Copy,
  Download,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
} from 'lucide-react';
import type { CandidateAnalysis } from '../../types';
import { useState } from 'react';

function ScoreRing({ score, size = 72 }: { score: number; size?: number }) {
  const radius = (size - 8) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const color =
    score >= 80 ? '#10b981' : score >= 55 ? '#f59e0b' : '#ef4444';

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#e2e8f0"
          strokeWidth={4}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={4}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-1000"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-lg font-bold" style={{ color }}>
          {score}%
        </span>
      </div>
    </div>
  );
}

function VerdictBadge({ verdict }: { verdict: string }) {
  const styles: Record<string, string> = {
    'Strong Fit': 'bg-emerald-100 text-emerald-800 border-emerald-300',
    Potential: 'bg-amber-100 text-amber-800 border-amber-300',
    Reject: 'bg-red-100 text-red-800 border-red-300',
  };
  return (
    <span
      className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold border ${
        styles[verdict] || styles['Reject']
      }`}
    >
      {verdict}
    </span>
  );
}

function PillarBar({ score, max = 10 }: { score: number; max?: number }) {
  const pct = (score / max) * 100;
  const color =
    score >= 8 ? 'bg-emerald-500' : score >= 5 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2">
      <div className="w-24 h-2 bg-slate-200 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-sm font-semibold w-8">{score}/10</span>
    </div>
  );
}

export default function AnalysisView() {
  const { currentAnalysis, analyses, setCurrentAnalysis } = useAppStore();
  const [copied, setCopied] = useState(false);
  const a = currentAnalysis;

  if (!a) {
    return (
      <div className="text-center py-20 text-slate-400">
        <Target size={48} className="mx-auto mb-4 opacity-50" />
        <p className="text-lg font-medium">No analysis selected</p>
        <p className="text-sm mt-1">
          Upload a JD and CV, then run the analysis.
        </p>
      </div>
    );
  }

  const currentIndex = analyses.findIndex((x) => x.id === a.id);
  const hasPrev = currentIndex < analyses.length - 1;
  const hasNext = currentIndex > 0;

  const handleCopy = async () => {
    await copyToClipboard(analysisToText(a));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    downloadFile(
      analysisToText(a),
      `analysis-${a.candidateName.replace(/\s+/g, '-').toLowerCase()}.txt`
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <ScoreRing score={a.matchScore} />
          <div>
            <h2 className="text-xl font-bold text-slate-900">
              {a.candidateName}
            </h2>
            <p className="text-sm text-slate-500">
              {a.jobTitle} &middot;{' '}
              {new Date(a.timestamp).toLocaleDateString()}
            </p>
            <VerdictBadge verdict={a.verdict} />
          </div>
        </div>

        <div className="flex items-center gap-2">
          {hasPrev && (
            <button
              onClick={() => setCurrentAnalysis(analyses[currentIndex + 1])}
              className="btn-ghost"
            >
              <ChevronLeft size={18} />
            </button>
          )}
          {hasNext && (
            <button
              onClick={() => setCurrentAnalysis(analyses[currentIndex - 1])}
              className="btn-ghost"
            >
              <ChevronRight size={18} />
            </button>
          )}
          <button onClick={handleCopy} className="btn-secondary flex items-center gap-2 text-sm">
            <Copy size={14} />
            {copied ? 'Copied!' : 'Copy'}
          </button>
          <button onClick={handleDownload} className="btn-secondary flex items-center gap-2 text-sm">
            <Download size={14} />
            Export
          </button>
        </div>
      </div>

      {/* Profile Summary */}
      <Section icon={<User size={16} />} title="Profile Summary">
        <p className="text-sm text-slate-700 leading-relaxed">
          {a.profileSummary}
        </p>
      </Section>

      {/* Pillar Scores */}
      <Section icon={<Target size={16} />} title="Pillar Breakdown">
        <div className="space-y-3">
          {a.pillarScores.map((p, i) => (
            <div key={i} className="p-3 rounded-lg bg-slate-50 border border-slate-100">
              <div className="flex items-center justify-between mb-1">
                <span className="font-medium text-sm text-slate-900">
                  {p.pillarName}
                </span>
                <div className="flex items-center gap-3">
                  <span
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                      p.riskLevel === 'HIGH'
                        ? 'bg-red-100 text-red-700'
                        : p.riskLevel === 'MEDIUM'
                        ? 'bg-amber-100 text-amber-700'
                        : 'bg-emerald-100 text-emerald-700'
                    }`}
                  >
                    {p.riskLevel} RISK
                  </span>
                  <PillarBar score={p.score} />
                </div>
              </div>
              <p className="text-xs text-slate-600 mt-1">
                <strong>Evidence:</strong> {p.evidence}
              </p>
              {p.gap && (
                <p className="text-xs text-slate-500 mt-0.5">
                  <strong>Gap:</strong> {p.gap}
                </p>
              )}
            </div>
          ))}
        </div>
      </Section>

      {/* Green Flags */}
      <Section icon={<CheckCircle size={16} />} title="Green Flags">
        <ul className="space-y-1.5">
          {a.greenFlags.map((f, i) => (
            <li key={i} className="flex items-start gap-2 text-sm">
              <CheckCircle size={14} className="text-emerald-500 mt-0.5 shrink-0" />
              <span className="text-slate-700">{f}</span>
            </li>
          ))}
        </ul>
      </Section>

      {/* Red Flags */}
      <Section icon={<AlertTriangle size={16} />} title="Red Flags">
        <ul className="space-y-1.5">
          {a.redFlags.map((f, i) => (
            <li key={i} className="flex items-start gap-2 text-sm">
              <AlertTriangle size={14} className="text-red-500 mt-0.5 shrink-0" />
              <span className="text-slate-700">{f}</span>
            </li>
          ))}
        </ul>
        {a.autoRedFlags.length > 0 && (
          <div className="mt-3 pt-3 border-t border-slate-200">
            <p className="text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wider">
              Auto-Detected
            </p>
            {a.autoRedFlags.map((f, i) => (
              <div
                key={i}
                className={`flex items-start gap-2 text-sm p-2 rounded mb-1 ${
                  f.severity === 'critical'
                    ? 'bg-red-50 text-red-700'
                    : 'bg-amber-50 text-amber-700'
                }`}
              >
                <AlertCircle size={14} className="mt-0.5 shrink-0" />
                <span>
                  <strong className="uppercase text-xs">{f.type.replace(/_/g, ' ')}</strong>{' '}
                  — {f.description}
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Truth Test Questions */}
      <Section icon={<HelpCircle size={16} />} title="Truth Test Questions">
        <div className="space-y-3">
          {a.truthTestQuestions.map((q, i) => (
            <div key={i} className="p-3 rounded-lg bg-brand-50/50 border border-brand-100">
              <p className="text-sm font-medium text-slate-900">
                {i + 1}. {q.question}
              </p>
              <p className="text-xs text-slate-500 mt-1">
                Verifies: {q.intent}
              </p>
            </div>
          ))}
        </div>
      </Section>

      {/* Recruiter Notes */}
      <Section icon={<MessageSquare size={16} />} title="Recruiter Notes">
        <div className="space-y-2 text-sm">
          <p>
            <strong className="text-slate-700">Outreach Angle:</strong>{' '}
            <span className="text-slate-600">{a.recruiterNotes.outreachAngle}</span>
          </p>
          <p>
            <strong className="text-slate-700">Salary Estimate:</strong>{' '}
            <span className="text-slate-600">{a.recruiterNotes.salaryEstimate}</span>
          </p>
          {a.recruiterNotes.additionalNotes && (
            <p>
              <strong className="text-slate-700">Notes:</strong>{' '}
              <span className="text-slate-600">
                {a.recruiterNotes.additionalNotes}
              </span>
            </p>
          )}
        </div>
      </Section>
    </div>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card p-5">
      <h3 className="flex items-center gap-2 font-semibold text-slate-900 mb-3">
        <span className="text-brand-600">{icon}</span>
        {title}
      </h3>
      {children}
    </div>
  );
}
