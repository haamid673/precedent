# Precedent

A pull request reviewer that learns what your team's maintainers actually care about.
It stores every human review comment in [Hindsight](https://github.com/vectorize-io/hindsight) agent memory,
recalls the relevant ones before it reviews a new PR, and cites the precedent behind each comment.

Most review bots flood a PR with generic comments until the team mutes them. Precedent is built around the opposite
idea: a new teammate who has read the whole review history says less, and says it in the team's own terms.

**Live demo:** https://precedent-theta-pink.vercel.app

## How Hindsight is used

One memory bank per repository.

| Step | Hindsight call | What we store or ask |
|---|---|---|
| Learn | `retainBatch` | One document per maintainer review comment: PR, file, line, reviewer, the comment text. Tagged `repo:<repo>`, `reviewer:<login>`, `type:human`. Real comment timestamps. `document_id` makes retries idempotent. `observation_scopes` are per repo and per reviewer. |
| Recall | `recall` (two queries) | Built from the PR title, files and description. (1) consolidated **observations** (the team's beliefs), (2) raw **maintainer comments** on similar code. Each group has its own token budget. |
| Review | LLM (Groq `gpt-oss-120b`) | The recalled items are labelled P1, P2, ... and handed to the model as a checklist. Each comment lists the labels it follows, which the UI shows as "Cites N precedents". |
| Feedback | `retainBatch` | A maintainer accepts or rejects a comment in the UI, with an optional reason. It is stored as an outcome memory and recalled on the next review. |
| Inspect | `listMemories` | The "What the memory believes" section shows the observations Hindsight consolidated from the stored comments. |

## Does it work? A backtest on real pytest PRs

We replayed real, merged `pytest-dev/pytest` pull requests oldest first. For each PR the agent reviews with the memory
built from *earlier* PRs only, a judge compares its comments with what the human maintainers actually wrote on that PR,
and only then are the maintainers' comments stored. Nothing leaks forward. Memory off reviews every PR cold.

Result on the 12 PRs that both arms completed:

| | Memory off | Memory on (maintainer comments) |
|---|---|---|
| Comments per PR | 4.3 | 2.7 |
| Comments that match a real maintainer comment | 10 of 52 (19%) | 7 of 32 (22%) |
| Real maintainer comments recovered | 10 of 56 (18%) | 7 of 56 (13%) |

**Read this honestly.** Memory cuts the volume of comments by about 37% at about the same precision. It also recovers
somewhat fewer of the real maintainer comments than a cold review. It does not show a learning curve that rises with
more PRs, and 12 PRs is a small sample where one matched comment moves the percentages a lot. "Matches a maintainer"
is a proxy for "accepted": a comment nobody raised is not necessarily wrong. The judge is an LLM and is not
deterministic. We report this as less noise, not more findings.

### What we tried and learned
- **Storing the bot's own suggestion outcomes hurt.** Our first design also stored "my suggestion was accepted / ignored".
  On the same 12 PRs that arm said even less (1.5 to 1.7 comments per PR) and recovered only 5 to 7% of the real
  maintainer comments, because "no maintainer raised this" is a weak signal when maintainers leave only one or two
  comments per PR. Dropping the outcomes (this repo's default) brought coverage back to 13%. The code to store them
  is still there (`--mem full`) and the live accept/reject feedback in the UI uses the same idea, but it is not part
  of the replay claim.
- **Memory stays chronological** even if a review fails: the maintainers' comments are always stored after the PR.
- **Free-tier limits shaped the run.** Groq's free tier allows 8,000 tokens per minute, so a 13-PR arm takes 1 to 2
  hours. The replay retries transient network failures and one arm lost its last PR to a network error, which is why
  the comparison uses the 12 PRs both arms finished.

## Run it

```bash
npm install
cp .env.example .env.local        # HINDSIGHT_BASE_URL, HINDSIGHT_API_KEY, GROQ_API_KEY, GITHUB_TOKEN
npm run spike                     # proves retain -> recall -> reflect and the LLM call
npm run fetch-prs                 # caches merged PRs and maintainer comments to data/
npm run replay -- --arm off --n 13 --tag demo
npm run replay -- --arm on  --n 13 --tag demo   # add --mem full to also store the bot's own outcomes
npm run dev                       # the demo UI, reads results/
```

The demo reads cached results from `results/`, so it never depends on a live run. Maintainer names are replaced with
"Maintainer A", "Maintainer B" in the UI.

## Layout
- `src/lib/memory.ts` retain, recall, feedback and belief listing
- `src/lib/reviewer.ts` and `src/lib/judge.ts` the review agent and the backtest judge
- `scripts/replay.ts` the chronological backtest, `scripts/fetch-prs.ts` the data pull
- `src/app` and `src/components` the UI
