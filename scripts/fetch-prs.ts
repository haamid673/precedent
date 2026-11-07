/**
 * Pull merged PRs from a public repo with their diffs and maintainer review comments,
 * and cache them as JSON. Run: npm run fetch-prs -- [owner/repo] [maxPrs]
 */
import { config } from "dotenv";
import { mkdirSync, writeFileSync } from "node:fs";
config({ path: ".env.local" });

const REPO = process.argv[2] ?? "pytest-dev/pytest";
const MAX_PRS = Number(process.argv[3] ?? 80);
const SINCE = process.argv[4] ?? "2025-05-01";
const MAX_DIFF_CHARS = 30_000;
const MAINTAINER = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
const token = process.env.GITHUB_TOKEN;
if (!token) throw new Error("GITHUB_TOKEN missing in .env.local");

async function gh<T>(path: string, accept = "application/vnd.github+json"): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`https://api.github.com${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: accept, "User-Agent": "precedent-data-fetch" },
    });
    if (res.ok) return (accept.includes("diff") ? await res.text() : await res.json()) as T;
    if (res.status === 403 || res.status === 429) await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    else throw new Error(`${res.status} ${path}`);
  }
  throw new Error(`gave up on ${path}`);
}

type RawPr = { number: number; title: string; body: string | null; merged_at: string | null; html_url: string; user: { login: string } };
type RawComment = {
  id: number; user: { login: string; type: string }; author_association: string; path: string;
  line: number | null; original_line: number | null; body: string; created_at: string;
  in_reply_to_id?: number; diff_hunk: string;
};

async function pool<T, R>(items: T[], size: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

async function main() {
  // 1. Recent closed PRs, keep merged ones.
  const merged: RawPr[] = [];
  for (let page = 1; page <= 20 && merged.length < MAX_PRS * 4; page++) {
    const batch = await gh<RawPr[]>(`/repos/${REPO}/pulls?state=closed&sort=updated&direction=desc&per_page=100&page=${page}`);
    merged.push(...batch.filter((p) => p.merged_at && p.merged_at >= SINCE));
  }
  console.log(`found ${merged.length} merged PRs, fetching review comments`);

  // 2. Review comments per PR; keep PRs that have at least one substantive maintainer comment.
  const withComments = await pool(merged, 8, async (pr) => {
    const comments = await gh<RawComment[]>(`/repos/${REPO}/pulls/${pr.number}/comments?per_page=100`);
    const review = comments
      .filter(
        (c) =>
          c.user.type !== "Bot" &&
          c.user.login !== pr.user.login &&
          MAINTAINER.has(c.author_association) &&
          !c.in_reply_to_id &&
          c.body.trim().length >= 20,
      )
      .map((c) => ({
        id: c.id, reviewer: c.user.login, path: c.path, line: c.line ?? c.original_line, body: c.body,
        createdAt: c.created_at, diffHunk: c.diff_hunk,
      }));
    return { pr, review };
  });

  const kept = withComments
    .filter((x) => x.review.length >= 1)
    .sort((a, b) => a.pr.merged_at!.localeCompare(b.pr.merged_at!))
    .slice(-MAX_PRS);
  console.log(`${kept.length} PRs have maintainer review comments; fetching diffs`);

  // 3. Diffs for kept PRs.
  const out = await pool(kept, 6, async ({ pr, review }) => {
    let diff = await gh<string>(`/repos/${REPO}/pulls/${pr.number}`, "application/vnd.github.diff");
    const truncated = diff.length > MAX_DIFF_CHARS;
    if (truncated) diff = diff.slice(0, MAX_DIFF_CHARS);
    return {
      number: pr.number, title: pr.title, body: (pr.body ?? "").slice(0, 3000), author: pr.user.login,
      mergedAt: pr.merged_at, url: pr.html_url, diff, diffTruncated: truncated, reviewComments: review,
    };
  });

  const dir = `data/${REPO.split("/")[1]}`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/prs.json`, JSON.stringify(out, null, 1));

  const reviewers = new Map<string, number>();
  for (const p of out) for (const c of p.reviewComments) reviewers.set(c.reviewer, (reviewers.get(c.reviewer) ?? 0) + 1);
  console.log(`wrote ${dir}/prs.json: ${out.length} PRs, ${out.reduce((n, p) => n + p.reviewComments.length, 0)} comments`);
  console.log("window:", out[0]?.mergedAt, "->", out.at(-1)?.mergedAt);
  console.log("reviewers:", [...reviewers.entries()].sort((a, b) => b[1] - a[1]).map(([u, n]) => `${u}:${n}`).join(", "));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
