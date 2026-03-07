import { useAppStore } from '../../store/appStore';
import type { AppView } from '../../types';
import {
  LayoutDashboard,
  Search,
  Clock,
  GitCompare,
  Settings,
} from 'lucide-react';

const navItems: { view: AppView; label: string; icon: React.ReactNode }[] = [
  { view: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={18} /> },
  { view: 'analyze', label: 'Analyze', icon: <Search size={18} /> },
  { view: 'comparison', label: 'Compare', icon: <GitCompare size={18} /> },
  { view: 'history', label: 'History', icon: <Clock size={18} /> },
  { view: 'settings', label: 'Settings', icon: <Settings size={18} /> },
];

export default function Header() {
  const { currentView, setView, settings } = useAppStore();

  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <div
            className="flex items-center gap-3 cursor-pointer"
            onClick={() => setView('dashboard')}
          >
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center shadow-sm">
              <span className="text-white font-bold text-lg">R</span>
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900 leading-none">
                Revital
              </h1>
              <p className="text-[10px] text-slate-400 font-medium tracking-wider uppercase">
                CV Analyzer
              </p>
            </div>
          </div>

          {/* Nav */}
          <nav className="flex items-center gap-1">
            {navItems.map(({ view, label, icon }) => (
              <button
                key={view}
                onClick={() => setView(view)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                  currentView === view
                    ? 'bg-brand-50 text-brand-700'
                    : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                }`}
              >
                {icon}
                <span className="hidden sm:inline">{label}</span>
              </button>
            ))}
          </nav>

          {/* Status */}
          <div className="flex items-center gap-2">
            {settings.apiKey ? (
              <span className="badge-green text-[10px]">API Connected</span>
            ) : (
              <button
                onClick={() => setView('settings')}
                className="badge-red text-[10px] cursor-pointer hover:bg-red-100"
              >
                Set API Key
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
