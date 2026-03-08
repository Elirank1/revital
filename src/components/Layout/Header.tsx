import { useAppStore } from '../../store/appStore';
import type { AppView } from '../../types';
import {
  LayoutDashboard,
  Search,
  Clock,
  GitCompare,
  Settings,
  Briefcase,
  Moon,
  Sun,
} from 'lucide-react';

const navItems: { view: AppView; label: string; icon: React.ReactNode }[] = [
  { view: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={18} /> },
  { view: 'analyze', label: 'Analyze', icon: <Search size={18} /> },
  { view: 'jobs', label: 'Jobs', icon: <Briefcase size={18} /> },
  { view: 'comparison', label: 'Compare', icon: <GitCompare size={18} /> },
  { view: 'history', label: 'History', icon: <Clock size={18} /> },
  { view: 'settings', label: 'Settings', icon: <Settings size={18} /> },
];

export default function Header() {
  const { currentView, setView, settings, updateSettings, syncStatus } = useAppStore();

  const activeView = currentView === 'results' ? 'results' : currentView;

  return (
    <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 sticky top-0 z-50 transition-colors duration-200">
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
              <h1 className="text-lg font-bold text-slate-900 dark:text-white leading-none">
                Revital
              </h1>
              <p className="text-[10px] text-slate-400 dark:text-slate-500 font-medium tracking-wider uppercase">
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
                  activeView === view
                    ? 'bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-400'
                    : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50 dark:text-slate-400 dark:hover:text-white dark:hover:bg-slate-800'
                }`}
              >
                {icon}
                <span className="hidden sm:inline">{label}</span>
              </button>
            ))}
          </nav>

          {/* Status + Dark Mode */}
          <div className="flex items-center gap-2">
            {/* Dark mode toggle */}
            <button
              onClick={() => updateSettings({ darkMode: !settings.darkMode })}
              className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:text-slate-200 dark:hover:bg-slate-800 transition-all duration-200"
              title={settings.darkMode ? 'Light mode' : 'Dark mode'}
            >
              {settings.darkMode ? <Sun size={16} /> : <Moon size={16} />}
            </button>

            {syncStatus === 'syncing' && (
              <span className="text-[10px] text-slate-400 animate-pulse">Syncing...</span>
            )}
            {syncStatus === 'synced' && (
              <span className="text-[10px] text-emerald-500">Synced</span>
            )}
            {syncStatus === 'error' && (
              <span className="text-[10px] text-red-400">Sync error</span>
            )}
            {settings.apiKey ? (
              <span className="badge-green text-[10px]">Connected</span>
            ) : (
              <button
                onClick={() => setView('settings')}
                className="badge-red text-[10px] cursor-pointer hover:bg-red-100 dark:hover:bg-red-900"
              >
                Setup Required
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
