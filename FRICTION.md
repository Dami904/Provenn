# TxLINE API Friction Log

Running log of feedback and friction encountered while building against the TxLINE odds API (by TxODDS) during the hackathon: unclear docs, surprising responses, auth quirks, latency, schema drift, anything that slowed us down. Kept honest and specific so it's useful as hackathon feedback.

| Date | What happened | Severity |
|---|---|---|
| 2026-07-11 | Scores endpoints return **PascalCase** field names on the wire (`FixtureId`, `GameState`, `Action`, `Seq`, ...) while the OpenAPI spec v1.5.2 documents them as camelCase (`fixtureId`, `gameState`, ...). Fixtures/odds are PascalCase in both. Cost us a types rewrite after first live call. | Medium |
| 2026-07-11 | `GameState` is inconsistently typed across endpoints: numeric on fixtures (`1`), lowercase string on scores (`"scheduled"`), and `null` on odds records. Docs only say "1 = Scheduled" with no per-endpoint typing. | Low |
| 2026-07-11 | Integer `Prices` encoding in odds payloads is undocumented in the spec. Empirically it is decimal odds × 1000 (e.g. `4010` ↔ `Pct` "24.938" = 1/4.010), verified against the `Pct` field. Should be one sentence in the docs. | Low |
| 2026-07-11 | `/api/odds/snapshot/{fixtureId}` (no `asOf`) intermittently returned `[]` for a World Cup fixture that had live StablePrice odds — the same call minutes later returned 14–20 records, and `?asOf=now` returned data. Looks like the "current 5-minute interval" cache can be empty right after an interval rollover; not mentioned in docs/troubleshooting. | Medium |
| 2026-07-11 | Free tier (0 TxL charged) still requires creating a Token-2022 ATA for the TxL mint before `subscribe` — an extra tx + rent that isn't obvious from the quickstart; only discoverable from the reference repo's `users.ts`. | Low |
| 2026-07-11 | Happy path otherwise worked first try on devnet: subscribe(1, 4 weeks) → guest JWT → sign `txSig::jwt` → `/api/token/activate` returned a token with zero retries. Reference repo (`tx-on-chain`) was essential for the exact `subscribe` account list. | Praise |
