# Otto's Abode

An internal **mission-control** prototype for Otto — a master agent that supervises four worker agents across two memory timescales. Not a user-facing product; it's the glass wall into Otto's cognition.

## What it shows

- **Workplace (spatial canvas)** — four workboxes (Ingestion, Aging, Pattern, Escalation), each with a mini-agent that physically roams inside it. **Otto** roams between the boxes supervising: it checks priorities, draws a sight-line to the box it's reviewing, and auto-corrects an agent when it starts *drifting*. Click any workbox to open that agent's **node-graph workflow** and see how it's working right now.
- **Memory** — short-term rolling buffer (*holding*) vs. long-term crystallised model (*understanding*).
- **Logs** — the Shift Ledger: Otto's autonomous decisions, who flagged each one, and the memory it drew from.
- **Context panel** — Otto's live priorities and the **escalation queue** (the handoff boundary: decided & held, awaiting the right moment).
- **Command bar** — hand Otto a new commitment to parse and hold.

## Design

Built on the **Curricula design system**: near-monochrome cool slate neutrals + a single indigo accent, white cards, hairline borders, generous whitespace. Plus Jakarta Sans + JetBrains Mono. No gradients or glow.

## Run locally

It's a single self-contained file — just open `index.html` (which loads `ottos-abode.html`) in a browser, or serve the folder:

```bash
npx serve .
# then open http://localhost:3000
```

Best viewed on a wide screen (~1280px+). Below ~1040px the context panel becomes a toggle; below ~760px the sidebar collapses to icons.
