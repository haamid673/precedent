import { listBeliefs } from "@/lib/memory";
import { scrubber } from "@/lib/results";

export async function GET(req: Request) {
  const bank = new URL(req.url).searchParams.get("bank");
  if (!bank) return Response.json({ error: "bank required" }, { status: 400 });
  try {
    const scrub = scrubber();
    const r = await listBeliefs(bank);
    return Response.json({ ...r, beliefs: r.beliefs.map((b) => ({ ...b, text: scrub(b.text) })) });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "list failed" }, { status: 502 });
  }
}
