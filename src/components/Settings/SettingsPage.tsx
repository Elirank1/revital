import { useState, useEffect } from 'react';
import { useAppStore } from '../../store/appStore';
import { checkProxyAvailable } from '../../engine/analyzer';
import { Key, Eye, EyeOff, Save, Shield, Cloud, Monitor } from 'lucide-react';

export default function SettingsPage() {
  const { settings, updateSettings } = useAppStore();
  const [showKey, setShowKey] = useState(false);
  const [localKey, setLocalKey] = useState(settings.apiKey);
  const [saved, setSaved] = useState(false);
  const [proxyAvailable, setProxyAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    checkProxyAvailable().then(setProxyAvailable);
  }, []);

  const handleSave = () => {
    updateSettings({ apiKey: localKey });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const isProxyMode = proxyAvailable === true;

  return (
    <div className="max-w-2xl mx-auto">
      <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-1">Settings</h2>
      <p className="text-slate-500 dark:text-slate-400 mb-8">
        Configure your connection and preferences.
      </p>

      {/* Connection Mode */}
      <div className="card p-6 mb-6">
        <h3 className="font-semibold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
          <Shield size={18} className="text-brand-600 dark:text-brand-400" />
          Connection Mode
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Proxy mode */}
          <div
            className={`p-4 rounded-lg border-2 transition-all ${
              isProxyMode
                ? 'border-brand-500 bg-brand-50/50 dark:bg-brand-950/30'
                : 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800 opacity-60'
            }`}
          >
            <div className="flex items-center gap-2 mb-2">
              <Cloud size={18} className={isProxyMode ? 'text-brand-600 dark:text-brand-400' : 'text-slate-400'} />
              <span className="font-semibold text-sm dark:text-slate-200">
                Team Mode (Proxy)
              </span>
              {isProxyMode && (
                <span className="badge-green text-[10px] ml-auto">Active</span>
              )}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              API key is on the server. Team members only need an access code.
              No one sees the API key.
            </p>
          </div>

          {/* Direct mode */}
          <div
            className={`p-4 rounded-lg border-2 transition-all ${
              !isProxyMode
                ? 'border-brand-500 bg-brand-50/50 dark:bg-brand-950/30'
                : 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800 opacity-60'
            }`}
          >
            <div className="flex items-center gap-2 mb-2">
              <Monitor size={18} className={!isProxyMode ? 'text-brand-600 dark:text-brand-400' : 'text-slate-400'} />
              <span className="font-semibold text-sm dark:text-slate-200">
                Personal Mode (Direct)
              </span>
              {!isProxyMode && (
                <span className="badge-blue text-[10px] ml-auto">Active</span>
              )}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              You provide your own Anthropic API key. It stays in your browser only.
            </p>
          </div>
        </div>

        {proxyAvailable === null && (
          <p className="text-xs text-slate-400 mt-3">Detecting connection mode...</p>
        )}
      </div>

      {/* Auth Input */}
      <div className="card p-6 space-y-6">
        <div>
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">
            <Key size={16} />
            {isProxyMode ? 'Access Code' : 'Anthropic API Key'}
          </label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                type={showKey ? 'text' : 'password'}
                value={localKey}
                onChange={(e) => setLocalKey(e.target.value)}
                placeholder={isProxyMode ? 'Enter access code...' : 'sk-ant-...'}
                className="input-field pr-10 font-mono text-sm"
              />
              <button
                onClick={() => setShowKey(!showKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
              >
                {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <button onClick={handleSave} className="btn-primary flex items-center gap-2">
              <Save size={16} />
              {saved ? 'Saved!' : 'Save'}
            </button>
          </div>
          <p className="text-xs text-slate-400 mt-2">
            {isProxyMode
              ? 'The access code is checked by the server. Your API key is never exposed.'
              : 'Your API key is stored locally in your browser. It never leaves your device except to call the Anthropic API directly.'}
          </p>
        </div>

        {/* Model */}
        <div>
          <label className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2 block">
            Model
          </label>
          <select
            value={settings.model}
            onChange={(e) => updateSettings({ model: e.target.value })}
            className="input-field"
          >
            <option value="claude-sonnet-4-6">Claude Sonnet 4.6 (Recommended)</option>
            <option value="claude-opus-4-6">Claude Opus 4.6</option>
            <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5 (Fast/Cheap)</option>
          </select>
        </div>

        {/* Max Tokens */}
        <div>
          <label className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2 block">
            Max Output Tokens
          </label>
          <input
            type="number"
            value={settings.maxTokens}
            onChange={(e) =>
              updateSettings({ maxTokens: parseInt(e.target.value) || 4096 })
            }
            min={1024}
            max={8192}
            className="input-field w-32"
          />
          <p className="text-xs text-slate-400 mt-1">
            Higher = more detailed analysis but slower. 4096 is a good default.
          </p>
        </div>
      </div>

      {/* Data */}
      <div className="card p-6 mt-6">
        <h3 className="font-semibold text-slate-900 dark:text-white mb-4">Data & Privacy</h3>
        <div className="space-y-3 text-sm text-slate-600 dark:text-slate-400">
          <p>
            All analysis results are stored in your browser's localStorage.
            {isProxyMode
              ? ' CV text is sent through our secure proxy to the Anthropic API.'
              : ' CV text is sent directly to the Anthropic API from your browser.'}
          </p>
          <p>
            No data is stored permanently on any server. Analysis results exist only in your browser.
          </p>
          <button
            onClick={() => {
              if (confirm('Clear all saved analyses and history? This cannot be undone.')) {
                localStorage.removeItem('revital_analyses');
                localStorage.removeItem('revital_log');
                window.location.reload();
              }
            }}
            className="text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 font-medium"
          >
            Clear all stored data
          </button>
        </div>
      </div>
    </div>
  );
}
