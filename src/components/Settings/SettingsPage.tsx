import { useState } from 'react';
import { useAppStore } from '../../store/appStore';
import { Key, Eye, EyeOff, Save } from 'lucide-react';

export default function SettingsPage() {
  const { settings, updateSettings } = useAppStore();
  const [showKey, setShowKey] = useState(false);
  const [localKey, setLocalKey] = useState(settings.apiKey);
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    updateSettings({ apiKey: localKey });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="max-w-2xl mx-auto">
      <h2 className="text-2xl font-bold text-slate-900 mb-1">Settings</h2>
      <p className="text-slate-500 mb-8">
        Configure your API connection and preferences.
      </p>

      <div className="card p-6 space-y-6">
        {/* API Key */}
        <div>
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 mb-2">
            <Key size={16} />
            Anthropic API Key
          </label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                type={showKey ? 'text' : 'password'}
                value={localKey}
                onChange={(e) => setLocalKey(e.target.value)}
                placeholder="sk-ant-..."
                className="input-field pr-10 font-mono text-sm"
              />
              <button
                onClick={() => setShowKey(!showKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
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
            Your API key is stored locally in your browser. It never leaves your device except to call the Anthropic API directly.
          </p>
        </div>

        {/* Model */}
        <div>
          <label className="text-sm font-semibold text-slate-700 mb-2 block">
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
          <label className="text-sm font-semibold text-slate-700 mb-2 block">
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
        <h3 className="font-semibold text-slate-900 mb-4">Data & Privacy</h3>
        <div className="space-y-3 text-sm text-slate-600">
          <p>
            All data is stored in your browser's localStorage. No server, no database, no tracking.
          </p>
          <p>
            CV text is sent to the Anthropic API for analysis. No data is stored on Anthropic's servers beyond the API call.
          </p>
          <button
            onClick={() => {
              if (confirm('Clear all saved analyses and history? This cannot be undone.')) {
                localStorage.removeItem('revital_analyses');
                localStorage.removeItem('revital_log');
                window.location.reload();
              }
            }}
            className="text-red-600 hover:text-red-700 font-medium"
          >
            Clear all stored data
          </button>
        </div>
      </div>
    </div>
  );
}
