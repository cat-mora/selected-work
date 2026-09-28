# A knowledge-grounded LLM adviser

An installable web app that answers advisory questions from my own methodology, built so I could get a usable answer on site or between meetings. An experiment rather than a finished product, and I would present it that way.

## What I did

Built the concept with Claude: defined what it needed to do, what the answer format should be, and what knowledge it should reason from. I have not put it through the testing the other projects have had.

## It is not RAG, and I want to be exact about that

`loadKnowledge()` reads every markdown file in `api/knowledge/`, concatenates all six, and injects the whole corpus as a single system block on every request. There is no query embedding, no similarity search, no chunk selection and no reranking. Every question receives the entire knowledge base.

That is knowledge-grounded long-context prompting with caching. It is not retrieval-augmented generation, and calling it RAG because the two get conflated would be wrong.

## Worth looking at

**Prompt caching on the expensive block.** The knowledge base carries `cache_control: { type: 'ephemeral' }`, so the large constant block is not re-billed on every turn while the cache is warm. The short volatile instructions sit in a separate uncached block above it, which is the order that makes caching work.

**Model routing as cost control.** Short mode runs Haiku with 500 max tokens, detail mode runs Sonnet with 1200. Most questions asked in a car park do not need the larger model.

**Knowledge files under `/api/`.** Vercel does not serve that directory as static content, so the knowledge base is readable by the function and not by the public. The alternative, `/public/`, would have published my methodology.

**Constant-time passcode comparison.** `timingSafeEqual` over a hash of both sides. This was `!==`, which returns as soon as two bytes differ and so leaks the passcode's length and how much of a guess was right. Hashing first gives both sides a fixed 32 bytes, so the compare cannot throw on a length mismatch either.

**A rate limit.** Per instance rather than global, which on serverless means a ceiling per instance. Not a substitute for a shared store, but it stops one caller emptying the Anthropic budget in a loop, which the endpoint previously allowed.

**History trimmed to six turns, inputs capped at 4,000 characters.** Both bound the context and the bill.

The system prompt is redacted here, since it contains my own advisory methodology.
