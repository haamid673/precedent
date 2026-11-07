/**
 * Hour 1-3 spike. Proves the loop we depend on:
 *   retain (human review + agent outcome) -> recall -> reflect, and one Groq JSON call.
 * Run: npm run spike
 */
import { config } from "dotenv";
import { z } from "zod";
config({ path: ".env.local" });

import { hindsight, ensureBank } from "../src/lib/hindsight";
import { completeJson } from "../src/lib/llm";

const BANK = "precedent-spike";

async function main() {
  const t0 = Date.now();
  await ensureBank(BANK);

  console.log("retain: human review comment");
  await hindsight().retain(
    BANK,
    "On PR #212, in src/db/session.py, reviewer-A said: 'Please do not catch a bare Exception here; narrow it to SQLAlchemyError.' The author changed the code as asked.",
    {
      context: "code review feedback from a human reviewer",
      timestamp: "2026-09-01T10:00:00Z",
      documentId: "spike-pr-212",
      tags: ["repo:acme/api", "reviewer:a", "type:human"],
      observationScopes: [["repo:acme/api"], ["reviewer:*"]],
    },
  );

  console.log("retain: agent outcome (experience)");
  await hindsight().retain(
    BANK,
    "On PR #230 I suggested adding a docstring to a private helper. Reviewer-A rejected it: 'We do not document private helpers.'",
    {
      context: "outcome of a suggestion I made during code review",
      timestamp: "2026-09-10T10:00:00Z",
      documentId: "spike-pr-230-outcome",
      tags: ["repo:acme/api", "reviewer:a", "type:agent", "outcome:rejected"],
      observationScopes: [["repo:acme/api"], ["reviewer:*"]],
    },
  );

  console.log("recall");
  const recalled = await hindsight().recall(BANK, "exception handling in a database session helper", {
    maxTokens: 1500,
    tags: ["repo:acme/api"],
  });
  console.log(JSON.stringify(recalled, null, 2).slice(0, 2500));

  console.log("reflect");
  const reflected = await hindsight().reflect(BANK, "What does reviewer-A care about, and what should I not suggest?", {
    includeFacts: true,
    tags: ["repo:acme/api"],
  });
  console.log(JSON.stringify(reflected, null, 2).slice(0, 2500));

  console.log("llm json call");
  const out = await completeJson({
    system: "You are a code reviewer.",
    user: "Return {\"comments\":[{\"line\":number,\"text\":string}]} for: `try:\n  run()\nexcept Exception:\n  pass`",
    schema: z.object({ comments: z.array(z.object({ line: z.number(), text: z.string() })) }),
  });
  console.log(out);

  console.log(`spike ok in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch((e) => {
  console.error("SPIKE FAILED:", e);
  process.exit(1);
});
