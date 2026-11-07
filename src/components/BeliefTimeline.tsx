"use client";
import { useEffect, useState } from "react";

interface Belief { id: string; text: string; date: string | null }
type State = { bank: string; nonce: number; beliefs: Belief[]; total: number } | { bank: string; nonce: number; error: string };

export default function BeliefTimeline({ bank }: { bank: string | null }) {
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<State | null>(null);

  useEffect(() => {
    if (!bank) return;
    let live = true;
    fetch(`/api/beliefs?bank=${encodeURIComponent(bank)}`)
      .then(async (res) => {
        const j = await res.json();
        if (!res.ok) throw new Error(j.error ?? "failed");
        if (live) setState({ bank, nonce, beliefs: j.beliefs, total: j.total });
      })
      .catch((e) => live && setState({ bank, nonce, error: e instanceof Error ? e.message : "failed" }));
    return () => { live = false; };
  }, [bank, nonce]);

  if (!bank) return <p className="text-sm opacity-60">No memory-on run yet.</p>;
  const current = state && state.bank === bank && state.nonce === nonce ? state : null;
  return (
    <div>
      <div className="mb-3 flex items-center gap-3 text-xs opacity-70">
        <span>{current && "beliefs" in current ? `${current.total} beliefs, newest first` : current ? "" : "Loading…"}</span>
        <button onClick={() => setNonce((n) => n + 1)} className="underline">refresh</button>
      </div>
      {current && "error" in current && <p className="text-sm text-red-500">Could not load beliefs: {current.error}</p>}
      {current && "beliefs" in current && current.beliefs.length === 0 && (
        <p className="text-sm opacity-60">No beliefs yet. Hindsight consolidates in the background, so check back shortly.</p>
      )}
      <ol className="space-y-3 border-l border-(--viz-on)/40 pl-4">
        {current && "beliefs" in current && current.beliefs.map((b) => (
          <li key={b.id} className="text-sm">
            {b.date && <div className="text-xs opacity-50 mb-0.5">{b.date.slice(0, 10)}</div>}
            <p>{b.text}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
