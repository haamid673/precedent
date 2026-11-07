import OpenAI from "openai";
import { z } from "zod";
import { requireEnv } from "./env";

let groq: OpenAI | null = null;
function client(): OpenAI {
  if (!groq) {
    groq = new OpenAI({ apiKey: requireEnv("GROQ_API_KEY"), baseURL: "https://api.groq.com/openai/v1", timeout: 120_000, maxRetries: 2 });
  }
  return groq;
}

function models(): string[] {
  return [process.env.LLM_MODEL ?? "openai/gpt-oss-120b", process.env.LLM_FALLBACK_MODEL ?? "openai/gpt-oss-20b"];
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced ? fenced[1] : text).trim();
  const start = body.search(/[\[{]/);
  if (start < 0) throw new Error("no JSON found in model output");
  return JSON.parse(body.slice(start));
}

/**
 * Ask the model for JSON matching a zod schema. Retries, repairs fenced output,
 * and falls back to the second model, because tool-call/JSON errors are expected.
 */
export async function completeJson<T>(opts: {
  system: string;
  user: string;
  schema: z.ZodType<T>;
  attemptsPerModel?: number;
}): Promise<T> {
  const attempts = opts.attemptsPerModel ?? 2;
  let lastErr: unknown;
  for (const model of models()) {
    for (let i = 0; i < attempts; i++) {
      // A 429 does not use up an attempt: wait as long as Groq says, then retry (bounded).
      for (let rl = 0; rl < 8; rl++) {
        try {
          const res = await client().chat.completions.create({
            model,
            temperature: 0.2,
            max_completion_tokens: 3000,
            // gpt-oss models spend tokens on reasoning; keep it short so the JSON always fits.
            ...(model.includes("gpt-oss") ? { reasoning_effort: "low" } : {}),
            messages: [
              { role: "system", content: `${opts.system}\n\nRespond with JSON only. No prose, no markdown.` },
              { role: "user", content: opts.user },
            ],
          } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming);
          const text = res.choices[0]?.message?.content ?? "";
          return opts.schema.parse(extractJson(text));
        } catch (e) {
          lastErr = e;
          const msg = (e as Error).message ?? "";
          if ((e as { status?: number }).status === 429) {
            const m = msg.match(/try again in ([\d.]+)s/i);
            await new Promise((r) => setTimeout(r, (m ? parseFloat(m[1]) : 20) * 1000 + 1500));
            continue;
          }
          break;
        }
      }
    }
  }
  throw new Error(`LLM JSON completion failed on all models: ${(lastErr as Error)?.message}`);
}
