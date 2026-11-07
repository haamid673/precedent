import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { Pr } from "./types";

/* ---------- view model (plain JSON, safe to pass to client components) ---------- */

export interface CommentView {
  path: string;
  line: number | null;
  text: string;
  /** pseudonymised reviewer whose real comment raised the same concern, or null */
  matchedReviewer: string | null;
  /** text of the memories this comment cited */
  cited: string[];
}

export interface ArmPr {
  comments: CommentView[];
  recalled: number;
  matched: number;
  humanCovered: number;
}

export interface PrView {
  k: number;
  number: number;
  title: string;
  url: string;
  human: { reviewer: string; path: string; line: number | null; body: string }[];
  off: ArmPr | null;
  on: ArmPr | null;
}

export interface PerPr {
  comments: number;
  matched: number;
  humanComments: number;
  humanCovered: number;
}

export interface ArmSummary {
  prs: number;
  failed: number;
  comments: number;
  matched: number;
  precision: number | null;
  firstHalfPrecision: number | null;
  lastHalfPrecision: number | null;
  commentsPerPr: number | null;
  /** share of real maintainer comments this arm's comments matched */
  coverage: number | null;
  /** raw per-PR counts in replay order, null where the PR has no completed run; the chart derives its metrics from these */
  series: (PerPr | null)[];
  source: string;
}

export interface Dataset {
  /** Hindsight bank the memory-on replay wrote to (used by live feedback and the belief timeline) */
  bank: string | null;
  repo: string;
  prs: PrView[];
  off: ArmSummary;
  on: ArmSummary;
  window: number;
}

/* ---------- loading ---------- */

interface RawRow {
  k: number;
  pr: number;
  error?: string;
  recalled?: number;
  agentComments?: number;
  matched?: number;
  humanCovered?: number;
  humanComments?: number;
  outcomes?: { path: string; line: number | null; text: string; precedents: string[]; matchedReviewer: string | null }[];
  precedents?: { label: string; text: string }[] | null;
}

const WINDOW = 6;
/** The runs the demo reports: memory off baseline and the human-comments-only memory arm. */
const RUNS = { off: "replay-t6-off.json", on: "replay-t8h-on.json" } as const;

function listArmFiles(arm: "on" | "off"): { file: string; rows: RawRow[]; ok: number; mtime: number }[] {
  const dir = path.join(process.cwd(), "results");
  let names: string[] = [];
  try {
    names = readdirSync(dir).filter((n) => n.startsWith("replay-") && n.endsWith(`-${arm}.json`));
  } catch {
    return [];
  }
  return names.map((n) => {
    const full = path.join(dir, n);
    let rows: RawRow[] = [];
    try {
      rows = JSON.parse(readFileSync(full, "utf8")).rows ?? [];
    } catch {
      /* file may be mid-write; treat as empty */
    }
    return { file: n, rows, ok: rows.filter((r) => !r.error).length, mtime: statSync(full).mtimeMs };
  });
}

function bankOf(file: string): string | null {
  try {
    return JSON.parse(readFileSync(path.join(process.cwd(), "results", file), "utf8")).bank ?? null;
  } catch {
    return null;
  }
}

function pickArm(arm: "on" | "off") {
  const files = listArmFiles(arm);
  return files.find((f) => f.file === RUNS[arm]) ?? { file: "(none)", rows: [] as RawRow[], ok: 0, mtime: 0 };
}

/** Replace every known GitHub handle in free text with its pseudonym, so memory text never leaks real names. */
export function scrubber(repo = "pytest-dev/pytest"): (text: string) => string {
  const prs: Pr[] = JSON.parse(readFileSync(path.join(process.cwd(), "data", repo.split("/")[1], "prs.json"), "utf8"));
  const alias = pseudonymiser(prs);
  const handles = new Set<string>();
  for (const p of prs) {
    handles.add(p.author);
    for (const c of p.reviewComments) handles.add(c.reviewer);
  }
  const list = [...handles].sort((a, b) => b.length - a.length).map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`(?<![\\w-])@?(${list.join("|")})(?![\\w-])`, "gi");
  const lookup = new Map([...handles].map((h) => [h.toLowerCase(), h]));
  return (text) => text.replace(re, (_m, h: string) => alias(lookup.get(h.toLowerCase()) ?? h));
}

function pseudonymiser(prs: Pr[]): (login: string) => string {
  const counts = new Map<string, number>();
  for (const p of prs) for (const c of p.reviewComments) counts.set(c.reviewer, (counts.get(c.reviewer) ?? 0) + 1);
  const order = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([l]) => l);
  return (login) => {
    const i = order.indexOf(login);
    return i >= 0 ? `Maintainer ${String.fromCharCode(65 + (i % 26))}` : "a contributor";
  };
}

function summarise(rows: RawRow[], n: number, source: string): ArmSummary {
  const byK = new Map(rows.filter((r) => !r.error).map((r) => [r.k, r]));
  const failed = rows.filter((r) => r.error).length;
  const seq: (RawRow | undefined)[] = Array.from({ length: n }, (_, k) => byK.get(k));
  const sum = (xs: (RawRow | undefined)[], f: (r: RawRow) => number) => xs.reduce((a, r) => a + (r ? f(r) : 0), 0);
  const prec = (xs: (RawRow | undefined)[]) => {
    const c = sum(xs, (r) => r.agentComments ?? 0);
    return c ? sum(xs, (r) => r.matched ?? 0) / c : null;
  };
  const done = [...byK.keys()];
  const half = Math.floor(n / 2);
  return {
    prs: done.length,
    failed,
    comments: sum(seq, (r) => r.agentComments ?? 0),
    matched: sum(seq, (r) => r.matched ?? 0),
    precision: prec(seq),
    firstHalfPrecision: prec(seq.slice(0, half)),
    lastHalfPrecision: prec(seq.slice(half)),
    coverage: sum(seq, (r) => r.humanComments ?? 0) ? sum(seq, (r) => r.humanCovered ?? 0) / sum(seq, (r) => r.humanComments ?? 0) : null,
    commentsPerPr: done.length ? sum(seq, (r) => r.agentComments ?? 0) / done.length : null,
    series: seq.map((r) => r ? { comments: r.agentComments ?? 0, matched: r.matched ?? 0, humanComments: r.humanComments ?? 0, humanCovered: r.humanCovered ?? 0 } : null),
    source,
  };
}

export function loadDataset(repo = "pytest-dev/pytest"): Dataset {
  const prs: Pr[] = JSON.parse(readFileSync(path.join(process.cwd(), "data", repo.split("/")[1], "prs.json"), "utf8"));
  const alias = pseudonymiser(prs);
  const scrub = scrubber(repo);
  const off = pickArm("off");
  const on = pickArm("on");
  // Compare like with like: only PRs where both arms completed.
  const okK = (rows: RawRow[]) => new Set(rows.filter((r) => !r.error).map((r) => r.k));
  const onOk = okK(on.rows);
  const common = new Set([...okK(off.rows)].filter((k) => onOk.has(k)));
  off.rows = off.rows.filter((r) => common.has(r.k));
  on.rows = on.rows.filter((r) => common.has(r.k));
  const n = Math.max(1, ...[...common].map((k) => k + 1));

  const toArm = (r: RawRow | undefined): ArmPr | null => {
    if (!r || r.error) return null;
    const labelText = new Map((r.precedents ?? []).map((p) => [p.label, p.text]));
    return {
      recalled: r.recalled ?? 0,
      matched: r.matched ?? 0,
      humanCovered: r.humanCovered ?? 0,
      comments: (r.outcomes ?? []).map((o) => ({
        path: o.path,
        line: o.line,
        text: o.text,
        matchedReviewer: o.matchedReviewer ? alias(o.matchedReviewer) : null,
        cited: o.precedents.map((l) => labelText.get(l)).filter((t): t is string => !!t).map(scrub),
      })),
    };
  };

  const offByK = new Map(off.rows.map((r) => [r.k, r]));
  const onByK = new Map(on.rows.map((r) => [r.k, r]));
  const views: PrView[] = [];
  for (let k = 0; k < n; k++) {
    const pr = prs[k];
    if (!pr) break;
    views.push({
      k,
      number: pr.number,
      title: pr.title,
      url: pr.url,
      human: pr.reviewComments.map((c) => ({ reviewer: alias(c.reviewer), path: c.path, line: c.line, body: scrub(c.body) })),
      off: toArm(offByK.get(k)),
      on: toArm(onByK.get(k)),
    });
  }
  return { bank: bankOf(on.file), repo, prs: views, off: summarise(off.rows, n, off.file), on: summarise(on.rows, n, on.file), window: WINDOW };
}
