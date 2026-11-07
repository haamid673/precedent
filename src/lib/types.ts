export interface ReviewComment {
  id: number;
  reviewer: string;
  path: string;
  line: number | null;
  body: string;
  createdAt: string;
  diffHunk: string;
}

export interface Pr {
  number: number;
  title: string;
  body: string;
  author: string;
  mergedAt: string;
  url: string;
  diff: string;
  diffTruncated: boolean;
  reviewComments: ReviewComment[];
}

export interface Precedent {
  /** Hindsight memory id */
  id: string;
  /** Short label used in the prompt, e.g. P3 */
  label: string;
  /** observation = consolidated belief; human = what a maintainer said; agent = outcome of my own suggestion */
  kind: "observation" | "human" | "agent";
  text: string;
  type: string | null;
}

export interface AgentComment {
  path: string;
  line: number | null;
  text: string;
  /** Precedent labels (P1, P2...) the comment relies on */
  precedents: string[];
}

export interface Outcome {
  comment: AgentComment;
  matched: ReviewComment | null;
}
