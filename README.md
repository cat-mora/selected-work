# Selected Work — Cathryn Mora

Code from projects I've designed, directed and deployed. The working repositories are private, so this holds the files worth reading, with a short note on each explaining what it is and what it shows.

I build with LLMs and structured agent workflows. I define the problem and what the solution has to do, direct the build, test as it develops and work through it when something misbehaves. That is the method, and it is what produced everything here.

| | What it is | What it shows |
|---|---|---|
| [01](01-stripe-webhook-fulfilment) | Stripe → Supabase → Loops fulfilment webhook | Webhooks, signature verification, idempotency, multi-system integration |
| [02](02-publer-mcp-server) | An MCP server exposing five tools to Claude | MCP, tool design for models, third-party API integration |
| [03](03-self-healing-ci) | A CI pipeline that fixes itself and escalates to an agent | Automation, agentic workflow design, build versus buy |
| [04](04-knowledge-grounded-adviser) | An LLM adviser over a private knowledge base | LLM API integration, prompt caching, model-tier cost control |
| [05](05-database-and-rls) | Schema, constraints and row level security | Relational design, access control, data integrity |

## Live

- **cultivatingthefruit.com** — the funnel behind 01
- **app.cultivatingthefruit.com** — the app behind 05
- **kindredsystems.com.au** — the site behind 03

## Read this too

**[REVIEW-NOTES.md](REVIEW-NOTES.md)** — I reviewed this code myself before putting it here, found four faults that mattered, fixed them, and wrote down what I consciously left alone and why. If you were going to run a review tool over these files, that document is what it would tell you, plus the reasoning.

## A note on redaction

Project identifiers, third-party record IDs and one system prompt are replaced with placeholders in these copies. No credentials appear in this repository or in the private originals: every one reads from environment variables.

## Contact

cathrynmora@gmail.com · [linkedin.com/in/cathryn-mora](https://www.linkedin.com/in/cathryn-mora)
