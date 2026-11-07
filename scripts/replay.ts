/**
 * Chronological replay of real PRs. For each PR: review with the current memory, score against what the
 * human maintainers actually said, THEN retain the human comments and the outcomes. Nothing about PR k is
 * visible when reviewing PR k.
 *
 * npm run replay -- --arm on|off [--n 10] [--start 0] [--tag name] [--repo pytest-dev/pytest]
 */
import { config } from "dotenv";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
config({ path: ".env.local" });

import { ensureBank } from "../src/lib/hindsight";
import { recallPrecedents, retainHumanReview, retainOutcomes } from "../src/lib/memory";
import { reviewPr } from "../src/lib/reviewer";
import { judge } from "../src/lib/judge";
import type { Pr } from "../src/lib/types";

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : def;
}

async function main() {
  const arm = arg("arm", "on") as "on" | "off";
  const n = Number(arg("n", "10"));
  const start = Number(arg("start", "0"));
  const repo = arg("repo", "pytest-dev/pytest");
  const tag = arg("tag", "run");
  // "human" (default) stores maintainers' comments only. "full" also stores the bot's own suggestion outcomes,
  // which over-suppressed the reviewer in our backtests (see README).
  const mem = arg("mem", "human") as "full" | "human";
  const prs: Pr[] = JSON.parse(readFileSync(`data/${repo.split("/")[1]}/prs.json`, "utf8")).slice(start, start + n);
  const bank = `replay-${tag}-${arm}-${Date.now().toString(36)}`;
  if (arm === "on") await ensureBank(bank);
  console.log(`arm=${arm} prs=${prs.length} bank=${arm === "on" ? bank : "-"}`);

  const rows: unknown[] = [];
  mkdirSync("results", { recursive: true });
  const file = `results/replay-${tag}-${arm}.json`;
  let cumAgent = 0, cumMatched = 0;

  for (const [k, pr] of prs.entries()) {
    const t = Date.now();
    try {
      // Transient network/LLM failures must not leave holes in the curve: retry the whole PR step.
      let precedents: Awaited<ReturnType<typeof recallPrecedents>> | null = null;
      let comments: Awaited<ReturnType<typeof reviewPr>> = [];
      let outcomes: Awaited<ReturnType<typeof judge>> = [];
      for (let attempt = 1; ; attempt++) {
        try {
          precedents = arm === "on" ? await recallPrecedents(bank, repo, pr, mem === "full") : null;
          comments = await reviewPr(pr, precedents);
          outcomes = await judge(pr, comments);
          break;
        } catch (e) {
          if (attempt >= 4) throw e;
          console.error(`PR ${pr.number} attempt ${attempt} failed (${(e as Error).message.slice(0, 80)}), retrying in 30s`);
          await new Promise((r) => setTimeout(r, 30_000));
        }
      }
      const matched = outcomes.filter((o) => o.matched).length;
      const covered = new Set(outcomes.filter((o) => o.matched).map((o) => o.matched!.id)).size;
      cumAgent += comments.length; cumMatched += matched;

      rows.push({
        k, pr: pr.number, title: pr.title, arm, recalled: precedents?.length ?? 0,
        agentComments: comments.length, matched, humanComments: pr.reviewComments.length, humanCovered: covered,
        outcomes: outcomes.map((o) => ({ ...o.comment, matchedHuman: o.matched?.id ?? null, matchedReviewer: o.matched?.reviewer ?? null })),
        precedents,
      });
      console.log(
        `#${String(k).padStart(2)} PR ${pr.number}  recalled=${precedents?.length ?? "-"}  comments=${comments.length}  matched=${matched}  ` +
          `human=${pr.reviewComments.length} covered=${covered}  running precision=${cumAgent ? ((100 * cumMatched) / cumAgent).toFixed(0) : "-"}%  (${((Date.now() - t) / 1000).toFixed(0)}s)`,
      );

      if (arm === "on") {
        await retainHumanReview(bank, repo, pr);
        if (mem === "full") await retainOutcomes(bank, repo, pr, outcomes);
      }
    } catch (e) {
      console.error(`PR ${pr.number} failed:`, (e as Error).message);
      rows.push({ k, pr: pr.number, arm, error: (e as Error).message });
      // Memory must stay chronological even if this review failed.
      if (arm === "on") await retainHumanReview(bank, repo, pr).catch(() => undefined);
    }
    writeFileSync(file, JSON.stringify({ arm, repo, bank, rows }, null, 1));
  }
  console.log(`wrote ${file}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
