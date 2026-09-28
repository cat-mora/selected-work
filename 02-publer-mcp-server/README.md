# Publer MCP server

An MCP (Model Context Protocol) server that gives Claude five tools for scheduling social content through Publer. I built it because no connector existed for what I needed, and I use it.

## What it does

Exposes `list_accounts`, `list_posts`, `schedule_post`, `create_draft` and `delete_post`. Claude drafts content, calls these, and it publishes on schedule across connected accounts.

## Worth looking at

**The tool descriptions are the interface.** A model decides whether to call a tool by reading its description, so these are written as instructions to the model, not documentation for a human. `list_accounts` says *"Always call this first before scheduling a post so you know the correct account IDs"* because otherwise the model guesses. Every parameter carries a `.describe()` for the same reason, including the exact ISO 8601 format and the AEST and AEDT offsets.

**Errors are written for the agent, not the log.** `publerFetch` checks the content type before parsing. When Publer returns HTML, which it does for an expired key or a wrong path, the thrown error says which of those is likely and includes the first 300 characters of the body. The default behaviour is `res.json()` throwing `Unexpected token '<'`, which tells an agent nothing it can act on.

**A documented API quirk.** `delete_post` originally 404'd on every call. Publer's delete is not `DELETE /posts/{id}` but a bulk `DELETE /posts?post_ids[]=`, which is not what the REST pattern suggests. The comment records that so the next person does not spend the same afternoon on it.

**Platform-specific shaping.** `buildPost` returns a structured `networks.pinterest` payload when an image is supplied and a flat shape otherwise, with the comment marking honestly which branch is verified against Publer's real format and which is not.

No credentials here. The key and workspace ID read from environment variables.
