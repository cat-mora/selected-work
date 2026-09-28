# Schema, constraints and row level security

One migration from the Cultivating the Fruit app, which has sixteen. This one adds partner linking: two people in a relationship connect their accounts using a short-lived invitation code.

This is from an earlier iteration. The live app has since moved to a single `partner_links` table, so read this as an example of how I write schema rather than as the shipped design.

## Worth looking at

**Constraints carry the rules the application must not be trusted with.** `no_self_partnership CHECK (user_id != partner_id)` stops anyone partnering with themselves at the database level rather than in a validator that a later refactor could drop. `unique_partnership` stops the same pair being written twice.

**Row level security on both tables, scoped per operation.** Users can read only invitations they created. Users can read a partnership if they are on either side of it. Separate SELECT, INSERT and UPDATE policies rather than one blanket rule, so read access and write access are decided independently.

**Cascade behaviour chosen per relationship.** `created_by_user_id` cascades on delete, because an invitation without a creator is meaningless. `accepted_by_user_id` sets null, because the invitation record itself should survive the accepting account being removed.

**Indexes on the columns actually queried**, including `expires_at`, since expiry is swept rather than checked per row.

**A trigger for `updated_at`** rather than relying on every writer to remember.

## What this taught me later

The successor table shipped with an UPDATE policy whose `USING` clause could never be true for the person accepting an invitation, because at that moment `partner_id` is still null and `creator_id` is somebody else. Postgres returns no error for an update that matches zero rows, so the application reported success and linked nobody, silently, for weeks.

The lesson I took from it is in REVIEW-NOTES.md: a policy needs testing from the perspective of the role that will actually run the statement, and a write that reports success should be checked for how many rows it touched.
