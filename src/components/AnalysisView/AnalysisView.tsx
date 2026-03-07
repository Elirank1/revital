import { useAppStore } from '../../store/appStore';
import { analysisToText } from '../../utils/export';
import { copyToClipboard, downloadFile } from '../../utils/export';
import {
  Target,
  CheckCircle,
  AlertTriangle,
  HelpCircle,
  MessageSquare,
  Copy,
  Download,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  Edit3,
} from 'lucide-react';
import { useState, useEffect } from 'react';

/* ─── Score Ring ─── */
function ScoreRing({ score, size = 80 }: { score: number; size?: number }) {
  const radius = (size - 8) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const color =
    score >= 78 ? '#10b981' : score >= 55 ? '#f59e0b' : '#ef4444';

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#e2e8f0"
          strokeWidth={5}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={5}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-1000"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-xl font-bold" style={{ color }}>
          {score}%
        </span>
      </div>
    </div>
  );
}

/* ─── Verdict Badge ─── */
function VerdictBadge({ verdict }: { verdict: string }) {
  const styles: Record<string, string> = {
    'Strong Fit': 'bg-emerald-100 text-emerald-800 border-emerald-300',
    Potential: 'bg-amber-100 text-amber-800 border-amber-300',
    Reject: 'bg-red-100 text-red-800 border-red-300',
  };
  return (
    <span
      className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold border ${
        styles[verdict] || styles['Reject']
      }`}
    >
      {verdict}
    </span>
  );
}

/* ─── Pillar Mini Bar ─── */
function PillarMiniBar({
  name,
  score,
  riskLevel,
}: {
  name: string;
  score: number;
  riskLevel: string;
}) {
  const pct = (score / 10) * 100;
  const barColor =
    score >= 8
      ? 'bg-emerald-500'
      : score >= 6
      ? 'bg-amber-500'
      : 'bg-red-500';
  const textColor =
    score >= 8
      ? 'text-emerald-700'
      : score >= 6
      ? 'text-amber-700'
      : 'text-red-700';

  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-slate-600 w-40 truncate" title={name}>
        {name}
      </span>
      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={`text-xs font-bold w-8 text-right ${textColor}`}>
        {score}
      </span>
      <span
        className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${
          riskLevel === 'HIGH'
            ? 'bg-red-100 text-red-600'
            : riskLevel === 'MEDIUM'
            ? 'bg-amber-100 text-amber-600'
            : 'bg-emerald-100 text-emerald-600'
        }`}
      >
        {riskLevel}
      </span>
    </div>
  );
}

/* ─── Collapsible Section ─── */
function CollapsibleSection({
  icon,
  title,
  badge,
  children,
  defaultOpen = false,
}: {
  icon: React.ReactNode;
  title: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="card overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-brand-600">{icon}</span>
          <span className="font-semibold text-sm text-slate-900">{title}</span>
          {badge}
        </div>
        {open ? (
          <ChevronUp size={16} className="text-slate-400" />
        ) : (
          <ChevronDown size={16} className="text-slate-400" />
        )}
      </button>
      {open && (
        <div className="px-4 pb-4 border-t border-slate-100 pt-3">
          {children}
        </div>
      )}
    </div>
  );
}

/* ─── Recruiter Comment Field ─── */
function RecruiterCommentField({ analysisId, initialComment }: { analysisId: string; initialComment: string }) {
  const { updateAnalysisComment } = useAppStore();
  const [comment, setComment] = useState(initialComment);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setComment(initialComment);
  }, [initialComment, analysisId]);

  const handleSave = () => {
    updateAnalysisComment(analysisId, comment);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="flex items-center gap-2 font-semibold text-sm text-slate-900">
          <Edit3 size={14} className="text-brand-600" />
          Recruiter Notes
        </h3>
        {saved && (
          <span className="text-[10px] text-emerald-600 font-medium">Saved!</span>
        )}
      </div>
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        onBlur={handleSave}
        placeholder="Add your own notes about this candidate..."
        className="w-full text-sm border border-slate-200 rounded-lg p-3 min-h-[80px] resize-y focus:outline-none focus:ring-2 focus:ring-brand-300 focus:border-brand-300"
      />
    </div>
  );
}

/* ─── Main Component ─── */
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

  const avgScore =
    a.pillarScores.length > 0
      ? Math.round(
          a.pillarScores.reduce((s, p) => s + p.score, 0) /
            a.pillarScores.length
        )
      : 0;

  return (
    <div className="space-y-3 max-w-3xl mx-auto">
      {/* ═══ HERO CARD: Score + Verdict + Profile ═══ */}
      <div className="card p-5">
        <div className="flex items-start gap-5">
          <ScoreRing score={a.matchScore} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="text-lg font-bold text-slate-900 truncate">
                {a.candidateName}
              </h2>
              <VerdictBadge verdict={a.verdict} />
            </div>
            <p className="text-xs text-brand-600 font-medium mt-0.5">
              {a.jobTitle}
            </p>
            <p className="text-[10px] text-slate-400 mt-0.5">
              {new Date(a.timestamp).toLocaleDateString()}
            </p>
            <p className="text-sm text-slate-700 mt-2 leading-relaxed">
              {a.profileSummary}
            </p>
          </div>

          {/* Actions */}
          <div className="flex flex-col items-end gap-1 shrink-0">
            <div className="flex items-center gap-1">
              {hasPrev && (
                <button
                  onClick={() =>
                    setCurrentAnalysis(analyses[currentIndex + 1])
                  }
                  className="btn-ghost p-1"
                >
                  <ChevronLeft size={16} />
                </button>
              )}
              {hasNext && (
                <button
                  onClick={() =>
                    setCurrentAnalysis(analyses[currentIndex - 1])
                  }
                  className="btn-ghost p-1"
                >
                  <ChevronRight size={16} />
                </button>
              )}
            </div>
            <div className="flex items-center gap-1 mt-1">
              <button
                onClick={handleCopy}
                className="btn-ghost p-1.5"
                title="Copy summary"
              >
                <Copy size={14} />
              </button>
              <button
                onClick={handleDownload}
                className="btn-ghost p-1.5"
                title="Download report"
              >
                <Download size={14} />
              </button>
            </div>
            {copied && (
              <span className="text-[10px] text-emerald-600 font-medium">
                Copied!
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ═══ PILLAR SCORES (always visible) ═══ */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="flex items-center gap-2 font-semibold text-sm text-slate-900">
            <Target size={14} className="text-brand-600" />
            Pillar Scores
          </h3>
          <span className="text-xs text-slate-400">avg {avgScore}/10</span>
        </div>
        <div className="space-y-2">
          {a.pillarScores.map((p, i) => (
            <PillarMiniBar
              key={i}
              name={p.pillarName}
              score={p.score}
              riskLevel={p.riskLevel}
            />
          ))}
        </div>
      </div>

      {/* ═══ RECRUITER COMMENT (free text, always visible) ═══ */}
      <RecruiterCommentField
        analysisId={a.id}
        initialComment={a.recruiterComment || ''}
      />

      {/* ═══ COLLAPSIBLE SECTIONS ═══ */}

      {/* Green Flags */}
      <CollapsibleSection
        icon={<CheckCircle size={15} />}
        title="Green Flags"
        badge={
          <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full font-medium">
            {a.greenFlags.length}
          </span>
        }
      >
        <ul className="space-y-1.5">
          {a.greenFlags.map((f, i) => (
            <li key={i} className="flex items-start gap-2 text-sm">
              <CheckCircle size={13} className="text-emerald-500 mt-0.5 shrink-0" />
              <span className="text-slate-700">{f}</span>
            </li>
          ))}
        </ul>
      </CollapsibleSection>

      {/* Red Flags */}
      <CollapsibleSection
        icon={<AlertTriangle size={15} />}
        title="Red Flags"
        badge={
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
              a.redFlags.length + a.autoRedFlags.length > 0
                ? 'bg-red-100 text-red-700'
                : 'bg-slate-100 text-slate-500'
            }`}
          >
            {a.redFlags.length + a.autoRedFlags.length}
          </span>
        }
      >
        {a.redFlags.length === 0 && a.autoRedFlags.length === 0 ? (
          <p className="text-sm text-slate-400 italic">No red flags detected.</p>
        ) : (
          <>
            <ul className="space-y-1.5">
              {a.redFlags.map((f, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <AlertTriangle size={13} className="text-red-500 mt-0.5 shrink-0" />
                  <span className="text-slate-700">{f}</span>
                </li>
              ))}
            </ul>
            {a.autoRedFlags.length > 0 && (
              <div className="mt-3 pt-3 border-t border-slate-200">
                <p className="text-[10px] font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">
                  Auto-Detected
                </p>
                {a.autoRedFlags.map((f, i) => (
                  <div
                    key={i}
                    className={`flex items-start gap-2 text-xs p-2 rounded mb-1 ${
                      f.severity === 'critical'
                        ? 'bg-red-50 text-red-700'
                        : 'bg-amber-50 text-amber-700'
                    }`}
                  >
                    <AlertCircle size={12} className="mt-0.5 shrink-0" />
                    <span>
                      <strong className="uppercase">{f.type.replace(/_/g, ' ')}</strong>{' '}
                      — {f.description}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </CollapsibleSection>

      {/* Pillar Details */}
      <CollapsibleSection
        icon={<Target size={15} />}
        title="Pillar Details"
        badge={
          <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full font-medium">
            Evidence & Gaps
          </span>
        }
      >
        <div className="space-y-2.5">
          {a.pillarScores.map((p, i) => (
            <div key={i} className="p-3 rounded-lg bg-slate-50 border border-slate-100">
              <div className="flex items-center justify-between mb-1">
                <span className="font-medium text-xs text-slate-900">{p.pillarName}</span>
                <span className="text-xs font-bold text-slate-600">{p.score}/10</span>
              </div>
              <p className="text-xs text-slate-600">{p.evidence}</p>
              {p.gap && p.gap !== 'None' && (
                <p className="text-xs text-amber-600 mt-1">Gap: {p.gap}</p>
              )}
            </div>
          ))}
        </div>
      </CollapsibleSection>

      {/* Truth Test Questions */}
      <CollapsibleSection
        icon={<HelpCircle size={15} />}
        title="Interview Questions"
        badge={
          <span className="text-[10px] bg-brand-100 text-brand-700 px-1.5 py-0.5 rounded-full font-medium">
            {a.truthTestQuestions.length}
          </span>
        }
      >
        <div className="space-y-2">
          {a.truthTestQuestions.map((q, i) => (
            <div key={i} className="p-3 rounded-lg bg-brand-50/50 border border-brand-100">
              <p className="text-sm font-medium text-slate-900">
                {i + 1}. {q.question}
              </p>
              <p className="text-[11px] text-slate-500 mt-1">Verifies: {q.intent}</p>
            </div>
          ))}
        </div>
      </CollapsibleSection>

      {/* AI Recruiter Notes */}
      <CollapsibleSection
        icon={<MessageSquare size={15} />}
        title="AI Suggestions"
        badge={
          <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full font-medium">
            Outreach & Salary
          </span>
        }
      >
        <div className="space-y-2 text-sm">
          <p>
            <strong className="text-slate-700 text-xs">Outreach:</strong>{' '}
            <span className="text-slate-600 text-xs">{a.recruiterNotes.outreachAngle}</span>
          </p>
          <p>
            <strong className="text-slate-700 text-xs">Salary Est:</strong>{' '}
            <span className="text-slate-600 text-xs">{a.recruiterNotes.salaryEstimate}</span>
          </p>
          {a.recruiterNotes.additionalNotes && (
            <p>
              <strong className="text-slate-700 text-xs">Notes:</strong>{' '}
              <span className="text-slate-600 text-xs">{a.recruiterNotes.additionalNotes}</span>
            </p>
          )}
        </div>
      </CollapsibleSection>
    </div>
  );
}
