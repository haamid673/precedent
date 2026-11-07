import { HindsightClient } from "@vectorize-io/hindsight-client";
import { requireEnv } from "./env";

let client: HindsightClient | null = null;

export function hindsight(): HindsightClient {
  if (!client) {
    client = new HindsightClient({
      baseUrl: requireEnv("HINDSIGHT_BASE_URL"),
      apiKey: process.env.HINDSIGHT_API_KEY,
    });
  }
  return client;
}

export const REVIEWER_MISSION =
  "I review pull requests for one repository. I learn what this team's human reviewers care about " +
  "from their past comments and from whether they accept or reject my own suggestions. " +
  "I do not raise things the team has rejected, and I cite the precedent behind every comment.";

/** Create the bank for a repo if it does not exist yet. Safe to call repeatedly. */
export async function ensureBank(bankId: string): Promise<void> {
  let last: unknown;
  for (let i = 1; i <= 6; i++) {
    try {
      await hindsight().createBank(bankId, { reflectMission: REVIEWER_MISSION });
      return;
    } catch (e) {
      // "Already exists" counts as success; any other failure is retried, then thrown.
      if (/already exists|conflict|409/i.test((e as Error).message)) return;
      last = e;
      await new Promise((r) => setTimeout(r, 5000 * i));
    }
  }
  throw new Error(`could not create bank ${bankId}: ${(last as Error)?.message}`);
}
