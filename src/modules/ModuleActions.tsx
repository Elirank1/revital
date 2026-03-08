import { useState } from 'react';
import { useAppStore } from '../store/appStore';
import OutreachComposer from './outreach/OutreachComposer';
import InterviewSummary from './interview/InterviewSummary';
import ProfileIntelCard from './profile-intel/ProfileIntelCard';
import {
  Send,
  FileText,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

export default function ModuleActions() {
  const { currentAnalysis } = useAppStore();
  const [showOutreach, setShowOutreach] = useState(false);
  const [showInterview, setShowInterview] = useState(false);

  if (!currentAnalysis) return null;

  return (
    <div className="max-w-3xl mx-auto space-y-3 mt-3">
      {/* Profile Intelligence — auto-shown for LinkedIn candidates */}
      <ProfileIntelCard />

      {/* Outreach Composer */}
      <div className="card overflow-hidden">
        <button
          onClick={() => setShowOutreach(!showOutreach)}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
        >
          <div className="flex items-center gap-2">
            <span className="text-brand-600"><Send size={15} /></span>
            <span className="font-semibold text-sm text-slate-900 dark:text-white">Outreach Composer</span>
            <span className="text-[10px] bg-brand-100 text-brand-700 px-1.5 py-0.5 rounded-full font-medium">
              Generate
            </span>
          </div>
          {showOutreach ? (
            <ChevronUp size={16} className="text-slate-400" />
          ) : (
            <ChevronDown size={16} className="text-slate-400" />
          )}
        </button>
        {showOutreach && (
          <div className="px-4 pb-4 border-t border-slate-100 dark:border-slate-700 pt-3">
            <OutreachComposer />
          </div>
        )}
      </div>

      {/* Interview Summary */}
      <div className="card overflow-hidden">
        <button
          onClick={() => setShowInterview(!showInterview)}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
        >
          <div className="flex items-center gap-2">
            <span className="text-brand-600"><FileText size={15} /></span>
            <span className="font-semibold text-sm text-slate-900 dark:text-white">Interview Summary</span>
            <span className="text-[10px] bg-brand-100 text-brand-700 px-1.5 py-0.5 rounded-full font-medium">
              Generate
            </span>
          </div>
          {showInterview ? (
            <ChevronUp size={16} className="text-slate-400" />
          ) : (
            <ChevronDown size={16} className="text-slate-400" />
          )}
        </button>
        {showInterview && (
          <div className="px-4 pb-4 border-t border-slate-100 dark:border-slate-700 pt-3">
            <InterviewSummary />
          </div>
        )}
      </div>
    </div>
  );
}
