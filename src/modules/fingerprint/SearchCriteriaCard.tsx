// ============================================================
// SearchCriteriaCard — Shows generated search criteria
// + "Find Similar" button on analyzed candidates
// ============================================================

import { useState } from 'react';
import { useAppStore } from '../../store/appStore';
import type { SearchCriteria, CandidateFingerprint } from './fingerprintTypes';
import type { CandidateAnalysis, JobDescription } from '../../types';
import {
  extractFingerprint,
  generateSearchFromFingerprint,
  generateSearchFromJD,
  generateSearchFromCV,
} from './fingerprintEngine';

// ── "Find Similar" Button ──────────────────────────────────
export function FindSimilarButton({ analysis }: { analysis: CandidateAnalysis }) {
  const { settings, addFingerprint, addSearchCriteria, fingerprints, analyses } = useAppStore();
  const [loading, setLoading] = useState(false);
  const [criteria, setCriteria] = useState<SearchCriteria | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFindSimilar = async () => {
    setLoading(true);
    setError(null);
    try {
      // Find the candidate's raw text from a matching analysis
      const candidate = analyses.find(a => a.id === analysis.id);
      if (!candidate) throw new Error('Analysis not found');

      // Check if we already have a fingerprint
      let fp = fingerprints.find(f => f.candidateId === analysis.candidateId);

      if (!fp) {
        // We need the raw CV text — get it from rawResponse or create from analysis data
        // For now, generate search criteria directly from the analysis profile
        const cvProxy = `
Name: ${analysis.candidateName}
Role analyzed for: ${analysis.jobTitle}
Profile: ${analysis.profileSummary}
Match Score: ${analysis.matchScore}%
Green Flags: ${analysis.greenFlags.join(', ')}
Pillar Scores: ${analysis.pillarScores.map(p => `${p.pillarName}: ${p.score}/10 - ${p.evidence}`).join('\n')}
Recruiter Notes: ${analysis.recruiterNotes.outreachAngle}
Salary Estimate: ${analysis.recruiterNotes.salaryEstimate}
        `.trim();

        const sc = await generateSearchFromCV(
          cvProxy,
          analysis.candidateName,
          analysis.candidateId,
          settings.apiKey,
          settings.model
        );
        addSearchCriteria(sc);
        setCriteria(sc);
      } else {
        // Use existing fingerprint for look-alike
        const sc = await generateSearchFromFingerprint(fp, settings.apiKey, settings.model);
        addSearchCriteria(sc);
        setCriteria(sc);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to generate search criteria');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ marginTop: '0.5rem' }}>
      {!criteria && (
        <button
          onClick={handleFindSimilar}
          disabled={loading || !settings.apiKey}
          style={{
            padding: '0.5rem 1rem',
            background: loading ? '#94A3B8' : '#3B82F6',
            color: '#fff',
            border: 'none',
            borderRadius: '0.375rem',
            cursor: loading ? 'wait' : 'pointer',
            fontSize: '0.875rem',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem',
          }}
        >
          {loading ? (
            <>⏳ Generating search criteria...</>
          ) : (
            <>🔍 Find Similar Candidates</>
          )}
        </button>
      )}

      {error && (
        <div style={{ color: '#EF4444', fontSize: '0.8rem', marginTop: '0.3rem' }}>
          {error}
        </div>
      )}

      {criteria && <SearchCriteriaDisplay criteria={criteria} />}
    </div>
  );
}

// ── "Search by JD" Button ──────────────────────────────────
export function SearchByJDButton({ job }: { job: JobDescription }) {
  const { settings, addSearchCriteria } = useAppStore();
  const [loading, setLoading] = useState(false);
  const [criteria, setCriteria] = useState<SearchCriteria | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async () => {
    setLoading(true);
    setError(null);
    try {
      const sc = await generateSearchFromJD(job, settings.apiKey, settings.model);
      addSearchCriteria(sc);
      setCriteria(sc);
    } catch (err: any) {
      setError(err.message || 'Failed to generate search criteria');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ marginTop: '0.5rem' }}>
      {!criteria && (
        <button
          onClick={handleSearch}
          disabled={loading || !settings.apiKey || !job.pillars?.length}
          style={{
            padding: '0.5rem 1rem',
            background: loading ? '#94A3B8' : '#0EA5E9',
            color: '#fff',
            border: 'none',
            borderRadius: '0.375rem',
            cursor: loading ? 'wait' : 'pointer',
            fontSize: '0.875rem',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem',
          }}
        >
          {loading ? (
            <>⏳ Generating search criteria...</>
          ) : (
            <>🎯 Generate Candidate Search</>
          )}
        </button>
      )}

      {error && (
        <div style={{ color: '#EF4444', fontSize: '0.8rem', marginTop: '0.3rem' }}>
          {error}
        </div>
      )}

      {criteria && <SearchCriteriaDisplay criteria={criteria} />}
    </div>
  );
}

// ── Search Criteria Display Card ───────────────────────────
function SearchCriteriaDisplay({ criteria }: { criteria: SearchCriteria }) {
  const [copied, setCopied] = useState(false);

  const copyBoolean = () => {
    navigator.clipboard.writeText(criteria.booleanQuery);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      style={{
        marginTop: '0.75rem',
        padding: '1rem',
        background: '#F0F9FF',
        borderRadius: '0.5rem',
        border: '1px solid #BAE6FD',
      }}
    >
      <div style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.5rem', color: '#0369A1' }}>
        🎯 Search Criteria Generated
      </div>

      <div style={{ fontSize: '0.85rem', color: '#475569', marginBottom: '0.75rem' }}>
        {criteria.searchSummary}
      </div>

      {/* Target Titles */}
      <div style={{ marginBottom: '0.5rem' }}>
        <span style={{ fontWeight: 600, fontSize: '0.8rem', color: '#334155' }}>Target Titles: </span>
        <span style={{ fontSize: '0.8rem', color: '#475569' }}>
          {criteria.targetTitles.join(' · ')}
        </span>
      </div>

      {/* Required Skills */}
      <div style={{ marginBottom: '0.5rem' }}>
        <span style={{ fontWeight: 600, fontSize: '0.8rem', color: '#334155' }}>Must-Have Skills: </span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', marginTop: '0.2rem' }}>
          {criteria.requiredSkills.map((s, i) => (
            <span
              key={i}
              style={{
                padding: '0.15rem 0.5rem',
                background: '#DBEAFE',
                borderRadius: '0.25rem',
                fontSize: '0.75rem',
                color: '#1E40AF',
              }}
            >
              {s}
            </span>
          ))}
        </div>
      </div>

      {/* Preferred Skills */}
      {criteria.preferredSkills.length > 0 && (
        <div style={{ marginBottom: '0.5rem' }}>
          <span style={{ fontWeight: 600, fontSize: '0.8rem', color: '#334155' }}>Nice-to-Have: </span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', marginTop: '0.2rem' }}>
            {criteria.preferredSkills.map((s, i) => (
              <span
                key={i}
                style={{
                  padding: '0.15rem 0.5rem',
                  background: '#F0FDF4',
                  borderRadius: '0.25rem',
                  fontSize: '0.75rem',
                  color: '#166534',
                }}
              >
                {s}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Seniority + Experience */}
      <div style={{ marginBottom: '0.5rem', fontSize: '0.8rem', color: '#475569' }}>
        <span style={{ fontWeight: 600, color: '#334155' }}>Seniority: </span>
        {criteria.seniorityRange.join(', ')}
        {' · '}
        <span style={{ fontWeight: 600, color: '#334155' }}>Experience: </span>
        {criteria.experienceRange.min}-{criteria.experienceRange.max} years
      </div>

      {/* Boolean Query — the key output */}
      <div
        style={{
          marginTop: '0.75rem',
          padding: '0.75rem',
          background: '#1E293B',
          borderRadius: '0.375rem',
          position: 'relative',
        }}
      >
        <div style={{ fontSize: '0.7rem', color: '#94A3B8', marginBottom: '0.3rem', fontWeight: 600 }}>
          LINKEDIN RECRUITER BOOLEAN QUERY
        </div>
        <pre
          style={{
            color: '#E2E8F0',
            fontSize: '0.8rem',
            fontFamily: 'Consolas, monospace',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            margin: 0,
          }}
        >
          {criteria.booleanQuery}
        </pre>
        <button
          onClick={copyBoolean}
          style={{
            position: 'absolute',
            top: '0.5rem',
            right: '0.5rem',
            padding: '0.25rem 0.5rem',
            background: copied ? '#10B981' : '#475569',
            color: '#fff',
            border: 'none',
            borderRadius: '0.25rem',
            fontSize: '0.7rem',
            cursor: 'pointer',
          }}
        >
          {copied ? '✓ Copied' : '📋 Copy'}
        </button>
      </div>
    </div>
  );
}

export default SearchCriteriaDisplay;
