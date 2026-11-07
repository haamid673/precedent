import { z } from "zod";
import { retainFeedback } from "@/lib/memory";

const Body = z.object({
  bank: z.string().min(1),
  repo: z.string().min(1),
  pr: z.number().int(),
  path: z.string(),
  line: z.number().int().nullable(),
  comment: z.string().min(1),
  verdict: z.enum(["accept", "reject"]),
  reason: z.string().max(400).optional(),
});

export async function POST(req: Request) {
  // Public deployments leave this off so strangers cannot write to the memory bank.
  if (process.env.ENABLE_FEEDBACK !== "1") return Response.json({ error: "feedback is disabled on this deployment" }, { status: 403 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad request" }, { status: 400 });
  const { bank, repo, ...f } = parsed.data;
  try {
    const id = await retainFeedback(bank, repo, f);
    return Response.json({ ok: true, id });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "retain failed" }, { status: 502 });
  }
}
