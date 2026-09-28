# Stripe → Supabase → Loops fulfilment

From the Cultivating the Fruit funnel, live at cultivatingthefruit.com. This is the file that runs when someone buys.

## What it does

One webhook coordinates four systems. Stripe fires the event, this verifies it came from Stripe, claims the event so it can only be fulfilled once, writes an access code into Supabase, creates or updates the contact in Loops, then works out which of several emails to send based on what was actually in the cart.

## Worth looking at

**Idempotency via a claim, not a check.** `claimEvent` inserts the Stripe event id into a ledger table and treats a `23505` primary key violation as "already handled". The insert *is* the lock, so two concurrent deliveries cannot both pass a read-then-write check. On a genuine failure `releaseEvent` gives the claim back so Stripe's retry can still get through. This was added after I found the handler would re-send every fulfilment email on a retry.

**Signature verification on a raw body.** `bodyParser` is disabled and the request is buffered manually, because Stripe signs the raw bytes. Parsing first breaks verification, and a webhook that cannot verify its sender is an open endpoint.

**The 409 upsert.** The Loops API returns 409 when a contact already exists rather than upserting. `loopsUpsertContact` creates, catches the 409, and falls back to update. Without it, every repeat customer fails fulfilment.

**A failed write now stops the email.** `saveInviteCodeToSupabase` returning false used to be ignored, so a missing service-role key would send a paying customer a code that had never been stored. It now throws, and the idempotency guard makes the retry safe.

**Branching fulfilment.** Tier, order bumps and one-time offers combine into different email sequences. An order bump-only purchase must not trigger the main onboarding sequence, which is what `isOTOOnly` guards.

## Redacted

Nothing in this file is a credential; everything sensitive reads from environment variables.
