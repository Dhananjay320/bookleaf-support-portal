# Write-up: BookLeaf Author Support Portal

**What I prioritised.** The core loop first: an author raises a ticket → it is triaged → an agent replies with an AI-assisted draft → the author sees the reply live. I treated AI as one component of a support workflow rather than the centrepiece, so the questions I kept asking were "what happens when the model is wrong, slow or down?" and "what stops a bad draft from reaching an author?"

**How the AI is used.**
- *Triage* is one cheap, structured-output call per ticket (category, priority, confidence, one-line reasoning). It runs in the background, so ticket creation never waits on or fails because of the model.
- *Drafts* are generated only when an agent opens a ticket, then cached until the conversation changes.
- The drafting prompt is grounded in three things: the KB sections for that category only, BookLeaf's own sample responses for that category, and the author's real account data.
- Anything the model is bad at, such as royalty payout dates, is computed in code and passed in as a fact.
- When information is missing, the model leaves an `[Agent: …]` marker instead of guessing, and the UI won't send a reply until every marker is resolved.

**Trade-offs I made.**
- *SQLite over Postgres:* reviewers can run it with zero setup. The relational schema (FKs, CHECK constraints) ports directly.
- *SSE over WebSockets:* updates only flow one way, SSE reconnects automatically, and events carry only IDs, so all access control stays in the REST layer.
- *In-process background triage and an in-memory event bus:* fine for one instance; I documented the swap to a durable queue and Redis pub/sub.
- *Gemini 2.5 Flash on the free tier for the demo:* it costs nothing, it is fast, and it handled BookLeaf's sample queries correctly. The cost is a low rate limit, which I handled with retries, a circuit breaker and delayed re-triage. The LLM sits behind a small provider interface, so Claude is a config switch away. For production I'd compare providers on real tickets rather than pick one up front.
- *Attachments are UI-only,* as the brief allowed.

**Graceful degradation was a first-class feature, not an afterthought.**
- Every model call has a timeout, retries, typed error handling, and a `stop_reason` check.
- A circuit breaker stops calling a failing provider for a minute.
- Every AI feature has a non-AI fallback: keyword triage that is clearly labelled in the UI, and policy-based reply templates. The test suite runs entirely on this fallback path.
- Every call's tokens and latency are logged, so cost is measured rather than estimated.

**How I'd evolve this into production.**
1. **Measure before optimising:** label ~300 historical tickets, measure triage accuracy per model, and track draft acceptance (edit distance between draft and sent reply, plus the `ai_assisted` flag already stored).
2. **Infrastructure:** Postgres, a durable job queue for triage and re-drafts, Redis for pub/sub and rate limits, and object storage for attachments.
3. **Richer grounding:** connect the real royalty ledger, bank-link status and production timeline so drafts can say "your Q3 payout of ₹3,570 was sent on 14 Nov" instead of using placeholders. Pass photos of print defects to the model's vision input.
4. **Ops workflow:** SLA alerts for Critical tickets, macros, email notifications to authors, and an audit log.
5. **Selective automation:** once acceptance rates are high for a category (e.g. "how do I update my bio"), auto-send the reply with a short undo window, keeping humans on money and ISBN issues.
