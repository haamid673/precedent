import LearningCurve from "@/components/LearningCurve";
import BeliefTimeline from "@/components/BeliefTimeline";
import ReviewCompare from "@/components/ReviewCompare";
import { loadDataset, type ArmSummary } from "@/lib/results";

const pct = (v: number | null) => (v === null ? "n/a" : `${Math.round(v * 100)}%`);

function Stat({ label, a, b }: { label: string; a: string; b: string }) {
  return (
    <div className="rounded-xl border border-current/15 p-4">
      <div className="text-xs opacity-60 mb-1">{label}</div>
      <div className="flex items-baseline gap-3">
        <span className="text-2xl font-semibold text-(--viz-on)">{b}</span>
        <span className="text-sm opacity-60">vs {a} without memory</span>
      </div>
    </div>
  );
}

const sampleNote = (s: ArmSummary) => `${s.prs} PRs${s.failed ? `, ${s.failed} failed` : ""}`;

export default function Home() {
  const d = loadDataset();
  return (
    <main className="mx-auto w-full max-w-5xl px-4 sm:px-6 py-10 space-y-12">
      <header className="space-y-3">
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">Precedent</h1>
        <p className="text-lg opacity-80 max-w-2xl">
          A pull request reviewer that remembers every comment your maintainers ever wrote, and whether its own
          suggestions landed. Each new comment cites the precedent behind it.
        </p>
      </header>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Replay of real pytest PRs, oldest first</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Comments per PR" a={d.off.commentsPerPr?.toFixed(1) ?? "n/a"} b={d.on.commentsPerPr?.toFixed(1) ?? "n/a"} />
          <Stat label="Comments that match a maintainer" a={pct(d.off.precision)} b={pct(d.on.precision)} />
          <Stat label="Real maintainer comments recovered" a={pct(d.off.coverage)} b={pct(d.on.coverage)} />
        </div>
        <LearningCurve off={d.off} on={d.on} window={d.window} />
        <p className="text-xs opacity-60">
          Small sample: {sampleNote(d.on)} reviewed by both arms. Memory cuts the number of comments at about the same
          precision, and it recovers fewer of the real maintainer comments than a cold review, so read this as less
          noise, not more findings. Each PR is reviewed before its own outcome is stored, so nothing leaks forward.
          “Matches a maintainer” is a proxy for acceptance: a comment nobody raised is not necessarily wrong.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Same PR, with and without memory</h2>
        <ReviewCompare prs={d.prs} bank={d.bank} repo={d.repo} feedback={process.env.ENABLE_FEEDBACK === "1"} />
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold">What the memory believes</h2>
        <p className="text-sm opacity-70 max-w-2xl">
          Hindsight consolidates the stored comments and outcomes into beliefs. These are the ones it has formed for
          this repository so far. Accept or reject a comment above and the evidence here changes.
        </p>
        <BeliefTimeline bank={d.bank} />
      </section>
    </main>
  );
}
