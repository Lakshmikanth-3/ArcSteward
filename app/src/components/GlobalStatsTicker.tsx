"use client";
import { useEffect, useState } from 'react';

export default function GlobalStatsTicker() {
  const [stats, setStats] = useState<any>(null);

  useEffect(() => {
    function fetchStats() {
      fetch('/api/stats/global')
        .then(r => r.json())
        .then(d => { if (!d.error) setStats(d); })
        .catch(() => {});
    }
    fetchStats();
    const id = setInterval(fetchStats, 15000);
    return () => clearInterval(id);
  }, []);

  if (!stats) return null;

  return (
    <div style={{
      fontSize: '0.75rem',
      fontFamily: 'monospace',
      display: 'flex',
      justifyContent: 'center',
      gap: '2rem',
      color: 'var(--on-surface-variant)',
      alignItems: 'center'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span className="pulse-dot live" style={{ width: '6px', height: '6px' }} />
        <span>NETWORK LIVE</span>
      </div>
      <div>TOTAL AGENTS: <span style={{ color: 'var(--primary)' }}>{stats.unique_agents}</span></div>
      <div>TOTAL TX: <span style={{ color: 'var(--primary)' }}>{stats.total_transactions}</span></div>
      <div>VOL: <span style={{ color: 'var(--primary)' }}>{stats.total_sui_paid} SUI</span></div>
      <div>LAST ACTION: <span style={{ color: 'var(--primary)' }}>{stats.last_action_seconds_ago}s ago</span></div>
    </div>
  );
}
