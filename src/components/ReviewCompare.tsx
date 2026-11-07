"use client";
import { useState } from "react";
import type { ArmPr, CommentView, PrView } from "@/lib/results";

type Ctx = { bank: string | null; repo: string; pr: number };

function Feedback({ c, ctx }: { c: CommentView; ctx: Ctx }) {
  const [state, setState] = useState<"idle" | "reason" | "sending" | "done" | "error">("idle");
  const [verdict, setVerdict] = useState<"accept" | "reject">("reject");
  const [reason, setReason] = useState("");
  if (!ctx.bank) return null;
  async function send(v: "accept" | "reject") {
    setState("sending");
    const res = await fetch("/api/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bank: ctx.bank, repo: ctx.repo, pr: ctx.pr, path: c.path, line: c.line, comment: c.text, verdict: v, reason: reason || undefined }),
    }).catch(() => null);
    setState(res?.ok ? "done" : "error");
  }
  if (state === "done") return <p className="mt-2 text-xs text-emerald-600 dark:text-emerald-400">Stored in memory as {verdict === "accept" ? "accepted" : "rejected"}. The next review will use it.</p>;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
      {state === "reason" ? (
        <>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why? (optional)" maxLength={400}
            className="min-w-48 flex-1 rounded-md border border-current/20 bg-transparent px-2 py-1" />
          <button onClick={() => send(verdict)} className="rounded-md bg-(--viz-on) px-2.5 py-1 text-white">Save {verdict}</button>
          <button onClick={() => setState("idle")} className="opacity-60 underline">cancel</button>
        </>
      ) : (
        <>
          <button disabled={state === "sending"} onClick={() => { setVerdict("accept"); setState("reason"); }} className="rounded-md border border-current/20 px-2.5 py-1 hover:bg-emerald-500/15">Accept</button>
          <button disabled={state === "sending"} onClick={() => { setVerdict("reject"); setState("reason"); }} className="rounded-md border border-current/20 px-2.5 py-1 hover:bg-red-500/15">Reject</button>
          {state === "error" && <span className="text-red-500">Could not save. Try again.</span>}
        </>
      )}
    </div>
  );
}

function Column({ title, arm, accent, ctx }: { title: string; arm: ArmPr | null; accent: boolean; ctx?: Ctx }) {
  return (
    <div className={`min-w-0 rounded-xl border p-4 ${accent ? "border-(--viz-on)/60" : "border-current/15"}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 mb-3">
        <h3 className="font-semibold">{title}</h3>
        {arm && <span className="text-xs opacity-70">{arm.matched}/{arm.comments.length} match a maintainer</span>}
      </div>
      {!arm && <p className="text-sm opacity-60">No run for this PR yet.</p>}
      <ul className="space-y-3">
        {arm?.comments.map((c, i) => (
          <li key={i} className="text-sm break-words">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <code className="text-xs opacity-70 break-all">{c.path}{c.line ? `:${c.line}` : ""}</code>
              {c.matchedReviewer ? (
                <span className="text-[11px] rounded-full px-2 py-0.5 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                  {c.matchedReviewer} raised this
                </span>
              ) : (
                <span className="text-[11px] rounded-full px-2 py-0.5 bg-current/10 opacity-70">nobody raised this</span>
              )}
            </div>
            <p>{c.text}</p>
            {c.cited.length > 0 && (
              <details className="mt-1.5 text-xs">
                <summary className="cursor-pointer text-(--viz-on)">Cites {c.cited.length} precedent{c.cited.length > 1 ? "s" : ""}</summary>
                <ul className="mt-1 space-y-1 pl-3 border-l border-(--viz-on)/40 opacity-80">
                  {c.cited.map((t, j) => <li key={j}>{t}</li>)}
                </ul>
              </details>
            )}
            {ctx && <Feedback c={c} ctx={ctx} />}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function ReviewCompare({ prs, bank, repo, feedback }: { prs: PrView[]; bank: string | null; repo: string; feedback: boolean }) {
  const [idx, setIdx] = useState(Math.max(0, prs.length - 1));
  const pr = prs[idx];
  if (!pr) return null;
  return (
    <div>
      <label className="block text-sm mb-3">
        <span className="opacity-70 mr-2">Replayed PR</span>
        <select value={idx} onChange={(e) => setIdx(Number(e.target.value))}
          className="rounded-md border border-current/20 bg-transparent px-2 py-1 max-w-full">
          {prs.map((p, i) => <option key={p.number} value={i} className="text-black">#{p.number} · {p.title.slice(0, 70)}</option>)}
        </select>
        <a href={pr.url} className="ml-3 text-xs underline opacity-70" target="_blank" rel="noreferrer">open on GitHub</a>
      </label>
      <div className="grid gap-4 md:grid-cols-2">
        <Column title="Memory off" arm={pr.off} accent={false} />
        <Column title="Memory on" arm={pr.on} accent ctx={feedback ? { bank, repo, pr: pr.number } : undefined} />
      </div>
      <details className="mt-4 text-sm">
        <summary className="cursor-pointer opacity-80">What the maintainers actually said ({pr.human.length})</summary>
        <ul className="mt-2 space-y-2">
          {pr.human.map((h, i) => (
            <li key={i} className="rounded-lg bg-current/5 p-3">
              <div className="text-xs opacity-60 mb-1">{h.reviewer} · <code className="break-all">{h.path}{h.line ? `:${h.line}` : ""}</code></div>
              <p className="whitespace-pre-wrap">{h.body}</p>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
