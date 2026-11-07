import { hindsight } from "./hindsight";
import type { AgentComment, Outcome, Pr, Precedent } from "./types";

/** Hindsight calls occasionally fail on a network blip; retry a few times. */
async function retry<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  let err: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      err = e;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw err;
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "..." : s);
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

export const repoTag = (repo: string) => `repo:${repo}`;
const SCOPES: string[][] = [["repo:*"], ["reviewer:*"]];

/** What the human reviewers said on a PR. One document per comment so attribution stays clean. */
export async function retainHumanReview(bank: string, repo: string, pr: Pr): Promise<void> {
  if (pr.reviewComments.length === 0) return;
  await retry(() => hindsight().retainBatch(
    bank,
    pr.reviewComments.map((c) => ({
      content:
        `On PR #${pr.number} ("${clip(pr.title, 120)}"), reviewer ${c.reviewer} commented on ${c.path}` +
        `${c.line ? `:${c.line}` : ""}: "${clip(oneLine(c.body), 700)}"`,
      context: "code review feedback from a human maintainer",
      timestamp: c.createdAt,
      document_id: `${repo}#${pr.number}-human-${c.id}`,
      tags: [repoTag(repo), `reviewer:${c.reviewer}`, "type:human"],
      observation_scopes: SCOPES,
    })),
  ));
}

/** How my own suggestions fared: raised by a reviewer (accepted) or ignored. */
export async function retainOutcomes(bank: string, repo: string, pr: Pr, outcomes: Outcome[]): Promise<void> {
  if (outcomes.length === 0) return;
  await retry(() => hindsight().retainBatch(
    bank,
    outcomes.map((o, i) => {
      const where = `${o.comment.path}${o.comment.line ? `:${o.comment.line}` : ""}`;
      const mine = clip(oneLine(o.comment.text), 400);
      const accepted = !!o.matched;
      return {
        content: accepted
          ? `Precedent, the automated review bot, suggested on PR #${pr.number} at ${where}: "${mine}". Reviewer ${o.matched!.reviewer} raised the same concern ("${clip(oneLine(o.matched!.body), 300)}"). Lesson: the maintainers want this kind of review comment.`
          : `Precedent, the automated review bot, suggested on PR #${pr.number} at ${where}: "${mine}". None of the maintainers raised this concern on that PR. Lesson: weak signal only, since maintainers comment on just a few things per PR; this kind of comment is lower priority than concerns maintainers actually voiced.`,
        context: "outcome of a suggestion made by the review bot Precedent",
        timestamp: pr.mergedAt,
        document_id: `${repo}#${pr.number}-outcome-${i}`,
        tags: [repoTag(repo), "type:agent", accepted ? "outcome:accepted" : "outcome:ignored", ...(accepted ? [`reviewer:${o.matched!.reviewer}`] : [])],
        observation_scopes: SCOPES,
      };
    }),
  ));
}

/** Recall what the bank knows that is relevant to this PR, in three groups so each stays small and legible. */
export async function recallPrecedents(bank: string, repo: string, pr: Pr, includeAgentOutcomes = true): Promise<Precedent[]> {
  const files = [...new Set(pr.diff.match(/^\+\+\+ b\/(.+)$/gm)?.map((l) => l.slice(6)) ?? [])].slice(0, 8);
  const query = clip(`Review of PR "${pr.title}". Files: ${files.join(", ")}. ${oneLine(pr.body).slice(0, 400)}`, 1100);
  const rt = repoTag(repo);
  const [obs, human, agent] = await Promise.all([
    retry(() => hindsight().recall(bank, query, { types: ["observation"], maxTokens: 1500, tags: [rt], tagsMatch: "any_strict" })),
    retry(() => hindsight().recall(bank, query, { types: ["world"], maxTokens: 1500, tags: [rt, "type:human"], tagsMatch: "all_strict" })),
    includeAgentOutcomes
      ? retry(() => hindsight().recall(bank, query, { types: ["world", "experience"], maxTokens: 900, tags: [rt, "type:agent"], tagsMatch: "all_strict" }))
      : Promise.resolve({ results: [] as { id: string; text: string; type?: string | null }[] }),
  ]);
  const out: Precedent[] = [];
  const seen = new Set<string>();
  const add = (kind: Precedent["kind"], results: { id: string; text: string; type?: string | null }[] | undefined) => {
    for (const r of results ?? []) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      out.push({ id: r.id, label: `P${out.length + 1}`, kind, text: r.text, type: r.type ?? null });
    }
  };
  add("observation", obs.results);
  add("human", human.results);
  add("agent", agent.results);
  return out;
}

export type { AgentComment };

/** A human accepting or rejecting one of Precedent's comments in the UI, with an optional reason. */
export async function retainFeedback(
  bank: string,
  repo: string,
  f: { pr: number; path: string; line: number | null; comment: string; verdict: "accept" | "reject"; reason?: string },
): Promise<string> {
  const where = `${f.path}${f.line ? `:${f.line}` : ""}`;
  const mine = clip(oneLine(f.comment), 400);
  const reason = f.reason ? clip(oneLine(f.reason), 300) : "";
  const accepted = f.verdict === "accept";
  const id = `${repo}#${f.pr}-feedback-${Date.now().toString(36)}`;
  await retry(() => hindsight().retainBatch(bank, [{
    content: accepted
      ? `Precedent, the automated review bot, suggested on PR #${f.pr} at ${where}: "${mine}". A maintainer accepted it${reason ? ` ("${reason}")` : ""}. Lesson: the maintainers want this kind of review comment.`
      : `Precedent, the automated review bot, suggested on PR #${f.pr} at ${where}: "${mine}". A maintainer rejected it${reason ? `: "${reason}"` : ""}. Lesson: the maintainers do not want this kind of review comment, so do not repeat it.`,
    context: "outcome of a suggestion made by the review bot Precedent",
    timestamp: new Date().toISOString(),
    document_id: id,
    tags: [repoTag(repo), "type:agent", accepted ? "outcome:accepted" : "outcome:rejected", "source:ui"],
    observation_scopes: SCOPES,
  }]));
  return id;
}

export interface Belief { id: string; text: string; date: string | null }

/** Consolidated beliefs (observations) Hindsight has formed in a bank, newest first. */
export async function listBeliefs(bank: string, limit = 40): Promise<{ beliefs: Belief[]; total: number }> {
  const r = await retry(() => hindsight().listMemories(bank, { type: "observation", limit }));
  const beliefs = r.items
    .map((m) => ({ id: m.id, text: m.text ?? "", date: m.date ?? null }))
    .filter((b) => b.text)
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  return { beliefs, total: r.total };
}
