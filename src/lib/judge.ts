import { z } from "zod";
import { completeJson } from "./llm";
import type { AgentComment, Outcome, Pr } from "./types";

const schema = z.object({
  matches: z.array(z.object({ agent: z.coerce.number(), human: z.union([z.number(), z.string().regex(/^\d+$/).transform(Number)]).nullable() })),
});

/**
 * Decide which agent comments raise substantively the same concern as a real reviewer comment on the
 * same PR. This is a proxy for "accepted": a comment nobody raised is not necessarily wrong.
 */
export async function judge(pr: Pr, comments: AgentComment[]): Promise<Outcome[]> {
  if (comments.length === 0) return [];
  if (pr.reviewComments.length === 0) return comments.map((comment) => ({ comment, matched: null }));

  const out = await completeJson({
    system:
      `You compare automated review comments with the real comments human maintainers left on the same pull request. ` +
      `An automated comment MATCHES a human comment only if it raises substantively the same concern about the same code area ` +
      `(same file or clearly the same piece of logic). Generic or merely related remarks do not match. ` +
      `A human comment can be matched by at most one automated comment.`,
    user:
      `AUTOMATED COMMENTS:\n` +
      comments.map((c, i) => `[${i}] ${c.path}${c.line ? `:${c.line}` : ""} ${c.text.slice(0, 500)}`).join("\n") +
      `\n\nHUMAN COMMENTS:\n` +
      pr.reviewComments.map((c) => `[${c.id}] ${c.path}${c.line ? `:${c.line}` : ""} (${c.reviewer}) ${c.body.slice(0, 500)}`).join("\n") +
      `\n\nReturn {"matches":[{"agent":<index>,"human":<human comment id or null>}]} with exactly one entry per automated comment.`,
    schema,
  });

  const byId = new Map(pr.reviewComments.map((c) => [c.id, c]));
  const used = new Set<number>();
  return comments.map((comment, i) => {
    const m = out.matches.find((x) => x.agent === i);
    const human = m?.human != null && !used.has(m.human) ? byId.get(m.human) ?? null : null;
    if (human) used.add(human.id);
    return { comment, matched: human };
  });
}
