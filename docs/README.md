# Armada OS — Governing Documents

Armada OS is the operating system for behavioral healthcare: enterprise
management, facility operations, clinical workflows, and workforce management
in one platform. These documents govern how it evolves. Read them in this
order; when they conflict, the Constitution wins.

| # | Document | What it settles |
|---|---|---|
| 1 | [ARMADA-CONSTITUTION.md](ARMADA-CONSTITUTION.md) | **The law.** Twelve principles, five gates, the Armada OS product map, and the amendment rule. Every PR answers to it. |
| 2 | [ARMADA-AUDIT.md](ARMADA-AUDIT.md) | What exists — the honest inventory of every module, table, route, and workflow as found. |
| 3 | [ARMADA-MASTER-APP-MAP.md](ARMADA-MASTER-APP-MAP.md) | Audit × target: keep/adapt/rebuild dispositions, owner decisions, phases, and the high-risk register. |
| 4 | [ARMADA-DOMAIN-ARCHITECTURE.md](ARMADA-DOMAIN-ARCHITECTURE.md) | The business domains (31 + MDM), independent of how the code is organized. |
| 5 | [ARMADA-PLATFORM-ARCHITECTURE.md](ARMADA-PLATFORM-ARCHITECTURE.md) | The five platform layers, the capability & event model, and the build order. |
| 6 | [ARMADA-DESIGN-SYSTEM.md](ARMADA-DESIGN-SYSTEM.md) | How it looks and behaves: tokens, layout patterns, components, role homepages, UX law. |

Operational compliance material lives alongside: [HIPAA-GO-LIVE.md](HIPAA-GO-LIVE.md).

Standing rules that bear repeating outside any document: no PHI in this
repository, ever; vault data (cards, portal credentials, bank details) flows
upload → database only and never through git; migrations are additive and the
app must boot on both an empty database and yesterday's.
