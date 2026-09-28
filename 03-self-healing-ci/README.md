# A self-healing CI pipeline

From the Kindred Systems site. This started as a commercial decision rather than a technical one: I looked at paying for an AI code review tool, decided it was not worth the subscription for a site this size, and built the part I actually wanted instead.

## What it does

On every push, `check.yml` formats the codebase, commits and pushes its own fix, then checks whether anything remains. If it does, it tries again, up to five times. If it still cannot resolve it, it opens a GitHub Issue addressed to my coding agent with the commit, branch and run ID, instructing it to diagnose, fix, push and close, and to escalate to me only if it cannot.

So the escalation ladder is: the pipeline fixes what it can, hands what it cannot to an agent, and reaches a human last. That last part is what I actually wanted from the paid tool.

`ping-indexnow.mjs` runs on the same push and tells search engines which pages changed.

## Worth looking at

**`ping-indexnow.mjs` submits only what changed.** It diffs the push range to find which `index.html` files moved, converts those to URLs and submits only those. On a shallow clone, first commit or force push, where the diff is unreliable, it submits nothing rather than submitting the whole site, because a wasted quota is worse than a delayed crawl.

**It does not fail the build on a bad IndexNow response.** The sitemap still carries every page, so the worst case is that Bing finds the change on its own later. That is a judgement about what is worth blocking a deploy for.

**The key rotation design.** The IndexNow key is found by scanning the repo root for the single hex-named `.txt` file, and the script asserts the file contains exactly its own key. Rotating the key is a rename and nothing else. The comment explains at length why that key is not a secret, so nobody later mistakes it for one and hides it in an environment variable where the protocol cannot reach it.

## Honest notes

This is small. It is a static site, not a build system. What it demonstrates is the instinct to automate a recurring manual task, put an agent in the loop, and reserve my own attention for what needs it.

The retry block in `check.yml` is copy-pasted four times where it should be a loop. I have rewritten it as one, but that version is not deployed yet, so what is here is what is actually running. See REVIEW-NOTES.md.
