# Review notes

Before putting this code somewhere people would read it, I reviewed it properly. Four things were wrong enough to fix, and I fixed them. The rest is what I looked at, decided to leave, and why.

This is working code from small projects I build and run alone. It is not a hardened platform. I would rather tell you where the edges are than have you find them.

---

## Fixed

### The Stripe webhook was not idempotent

Stripe retries webhooks, and `checkout.session.completed` can arrive more than once for the same session. The database write was safe, because the unique constraint on the invite code returns `23505` and the handler treats that as success. **The emails were not.** A retry re-sent the purchase confirmation and every guide email. A failed Loops call made it worse: the handler threw, Stripe retried, and everything that had already succeeded ran again.

Fixed with a `processed_stripe_events` ledger. The handler claims `event.id` before doing any work, so the insert is the lock: a duplicate delivery hits the primary key and returns having sent nothing. On a genuine failure the claim is released so the retry can still get through. See `claimEvent` and `releaseEvent` in 01.

### A failed database write still sent the customer their code

`saveInviteCodeToSupabase` returned `false` when the service-role key was missing, and the caller ignored it. A misconfigured environment would send a paying customer a welcome email containing an access code that had never been stored. It now fails, which with the guard above means Stripe retries it.

### Invite codes could be spent more than once

Not in this file, in the app it feeds. There was no row level security policy permitting a signing-up user to mark a code used, so the update matched zero rows. Supabase returns no error for a zero-row update, so the code reported success and every code stayed redeemable forever. Replaced with a `SECURITY DEFINER` function that updates atomically on `status = 'pending'` and returns whether it actually spent the code.

The same class of bug, a zero-row update read as success, had also silently broken partner linking in that app. Both are fixed.

### A timing leak on the adviser passcode

Compared with `!==`, which returns as soon as two bytes differ and so leaks length and prefix. Now `timingSafeEqual` over a SHA-256 of both sides, which is constant time and handles unequal lengths. Added a rate limit at the same time, because anyone holding the passcode could previously empty the Anthropic budget in a loop.

---

## Left alone, deliberately

### 01 — Stripe fulfilment webhook

**Fulfilment runs inline rather than on a queue.** Four sequential third-party calls happen before the 200 is returned, and Stripe times out around ten seconds. The correct shape is acknowledge first, fulfil asynchronously. At this volume the idempotency guard is the part that mattered; the queue is the next thing I would do, not the first.

### 02 — Publer MCP server

**One code path is unverified, and the comment says so.** `buildPost` returns a structured payload for Pinterest and a flat shape for everything else. Pinterest is verified against Publer's documentation. The flat shape preserves earlier behaviour and I have not confirmed it against every network.

**No retry or backoff.** A transient Publer failure surfaces to the agent as an error. For a single-user server that is honest rather than harmful, and the error message tells the agent what to do about it.

**`any` with an eslint-disable** in `publerFetch`, because the response shape genuinely varies by endpoint.

### 03 — Self-healing CI

**The retry block is copy-pasted four times where it should be a loop.** The only thing that varies between them is the commit message. I have rewritten it as a single loop with the attempt count as one variable, but that version is not deployed yet, so what is in this repository is what is actually running rather than the tidier version. A reviewer is right to flag the duplication.

**`|| true` on nearly every step means the workflow cannot fail.** Deliberate: its job is to fix and escalate, not to block a static site deploy. It does mean a green "Code Check" tells you nothing by itself. The Issue it raises is the real signal.

**`permissions: contents: write` with an auto-commit on every branch.** Fine for a personal repository. In a shared one, a workflow that pushes on any push needs more thought than I have given it.

**The `console.log` grep has no ignore list**, so it would match vendored or minified files if the site had any.

### 04 — Knowledge-grounded adviser

**Conversation history is client-supplied and trusted.** Roles and length are validated, content is taken on faith. The passcode bounds who can send it.

**The knowledge cache is per warm instance.** On serverless a cold start re-reads all six files. Prompt caching handles the cost that matters; this is just disk reads.

**The whole corpus goes into every request.** Fine at six files. It does not scale, and past some size retrieval stops being optional. There is a note in that folder about why I am not calling this RAG.

### 05 — Schema and RLS

This migration is from an earlier iteration of partner linking. The live app has since moved to a single `partner_links` table, so read this one as an example of how I write schema rather than as the shipped design.

**`UNIQUE (user_id, partner_id)` does not prevent the mirror.** Rows `(A, B)` and `(B, A)` can both exist. A unique index on `least()`/`greatest()` would close it.

**No DELETE policy**, so unlinking cannot be done by the user through RLS.

**Expiry is stored and indexed but enforced in application code**, not by a constraint.

**Code collision is caught rather than prevented.** Six characters is a small space when codes are generated client side, so the retry-on-`23505` is doing real work.
