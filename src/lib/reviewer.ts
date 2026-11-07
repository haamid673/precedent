import { z } from "zod";
import { completeJson } from "./llm";
import type { AgentComment, Pr, Precedent } from "./types";

const MAX_COMMENTS = 6;
const MAX_DIFF = 8_000;

const schema = z.object({
  comments: z
    .array(
      z.object({
        path: z.string(),
        line: z.number().nullable().optional(),
        text: z.string(),
        precedents: z.array(z.string()).optional(),
      }),
    )
    .max(MAX_COMMENTS + 4),
});

/**
 * Review a PR diff. With `precedents` the model sees what this team's reviewers have said and
 * how its own past suggestions fared; with null it reviews cold.
 */
export async function reviewPr(pr: Pr, precedents: Precedent[] | null): Promise<AgentComment[]> {
  const group = (kind: Precedent["kind"]) =>
    (precedents ?? []).filter((p) => p.kind === kind).map((p) => `[${p.label}] ${p.text}`).join("\n") || "(none)";
  const memoryBlock = precedents
    ? `\n\nMEMORY from earlier reviews in this repository.\n` +
      `Beliefs consolidated from many reviews:\n${group("observation")}\n\n` +
      `What maintainers actually said on earlier PRs:\n${group("human")}\n\n` +
      `How your own earlier suggestions fared:\n${group("agent")}\n\n` +
      `Use MEMORY as a checklist built from this team's own reviewers. First, for each thing maintainers said on earlier PRs, check whether THIS diff has the same kind of problem, and if so raise it in their style. ` +
      `Second, add your own findings only if they are concrete defects. Suggestions that earlier outcomes show nobody raised are only a weak hint to deprioritise, not a ban. ` +
      `Always return at least one comment unless the diff is trivial. When a comment follows a MEMORY item, cite its label in "precedents".`
    : "";

  const out = await completeJson({
    system:
      `You are a code reviewer for the open source repository pytest. Review the pull request diff and write the inline review comments ` +
      `that this project's maintainers would plausibly write. Quality over quantity: at most ${MAX_COMMENTS} comments, fewer if nothing is wrong. ` +
      `Each comment must point at a file path in the diff and a line number in the new file if you can tell. ` +
      `Skip generic praise and generic style nitpicks. If a comment relies on a MEMORY item, list its label (e.g. "P3") in "precedents".` +
      memoryBlock,
    user:
      `PR #${pr.number}: ${pr.title}\n\n${pr.body.slice(0, 1500)}\n\nDIFF:\n${pr.diff.slice(0, MAX_DIFF)}\n\n` +
      `Return {"comments":[{"path":string,"line":number|null,"text":string,"precedents":string[]}]}`,
    schema,
  });

  return out.comments.slice(0, MAX_COMMENTS).map((c) => ({
    path: c.path,
    line: c.line ?? null,
    text: c.text,
    // Models write "P3", "[P3]" or "P3, P5"; normalise to labels that exist.
    precedents: [...new Set((c.precedents ?? []).flatMap((l) => l.match(/P\d+/g) ?? []))].filter((l) => precedents?.some((p) => p.label === l)),
  }));
}
