# btc-ledger

A live, paginated view of Bitcoin transactions as they hit the network.

**Live site:** https://reddy-hari.github.io/btc-ledger/

![status](https://img.shields.io/badge/data-mempool.space-f7931a)

btc-ledger is a static single-page app. There is no backend: your browser talks directly to the public
[mempool.space](https://mempool.space/docs/api) REST and WebSocket APIs, keeps recent transactions in memory,
and renders them as a table you can page through without rows shifting under you.

## Table of contents

- [Features](#features)
- [A note on the Bitcoin data model](#a-note-on-the-bitcoin-data-model)
- [Getting started](#getting-started)
- [Scripts](#scripts)
- [Project structure](#project-structure)
- [How it works](#how-it-works)
- [Configuration](#configuration)
- [Deployment](#deployment)
- [Limitations](#limitations)
- [Roadmap](#roadmap)

## Features

- **Live stream.** New **unconfirmed** transactions arrive over a WebSocket and are added to the top of the table.
- **Confirmation tracking.** When a block is mined, matching rows flip from *Unconfirmed* to *Block #N*.
- **Readable rows.** Each row shows time, transaction ID, **from** (first input address), **to** (first output
  address) and total amount. Click a row to expand every input and output, the fee, and first-seen/confirmed times.
- **Pagination that doesn't jump.** Page 1 is live. If you leave it or press *Pause*, your rows stay where they
  are and a banner counts the new arrivals, with a one-click "back to live".
- **Page sizes** of 25, 50 or 100 rows.
- **Load older.** Walks back through confirmed blocks, 25 transactions at a time.
- **Resilient connection.** Reconnects automatically with exponential backoff, and falls back to REST polling if
  the live stream is unavailable.
- **Stats strip.** Latest block (height, age, tx count), transactions seen in the last minute, rows waiting to
  confirm, and rows loaded.
- **Links out.** Transaction IDs and addresses link to mempool.space.

## A note on the Bitcoin data model

Bitcoin doesn't record transactions as "A sent X to B". Each transaction spends one or more earlier
outputs (**inputs**) and creates new **outputs**, one of which is usually *change* going back to the
sender. So this app shows the first input/output address with a `+N` count, and the amount is the
total of all outputs (which usually includes change).

Some inputs and outputs have no address. These are shown as labels instead:

| Label | Meaning |
| --- | --- |
| `Coinbase (newly minted)` | Block reward input of a miner's coinbase transaction |
| `OP_RETURN (data)` | Output that embeds data rather than paying an address |
| `P2PK (raw pubkey)` | Pay-to-public-key output |
| `Bare multisig` | Multisig output not wrapped in a script hash |
| `Non-standard (<type>)` / `Unknown` | Anything else |

## Getting started

### Prerequisites

- Node.js 22 or newer (CI uses 22)
- npm

### Run locally

```bash
npm install
npm run dev
# open http://localhost:5173/btc-ledger/
```

The dev server uses the same `/btc-ledger/` base path as production, so open that URL rather than the root.
An internet connection is required, since all data comes from mempool.space.

### Production build

```bash
npm run build     # type-checks, then writes static files to dist/
npm run preview   # serves dist/ locally
```

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the Vite dev server with hot reload |
| `npm run build` | Type-check with `tsc -b`, then build with Vite into `dist/` |
| `npm run lint` | Lint with [oxlint](https://oxc.rs/docs/guide/usage/linter) |
| `npm run preview` | Serve the production build locally |

There is no test suite yet.

## Project structure

```
.
├── .github/workflows/deploy.yml   Build and deploy to GitHub Pages
├── public/favicon.svg
├── src/
│   ├── main.tsx                   React entry point
│   ├── App.tsx                    Table, pagination/freeze logic, row detail view
│   ├── useLedger.ts               Data layer (see below)
│   ├── api.ts                     mempool.space calls and tx -> row flattening
│   ├── types.ts                   API response shapes and table row types
│   ├── format.ts                  BTC, hash, time and number formatting helpers
│   └── styles.css
├── index.html
├── vite.config.ts                 Sets base path to /btc-ledger/
└── tsconfig*.json, .oxlintrc.json
```

| File | Purpose |
| --- | --- |
| `src/useLedger.ts` | Initial load, WebSocket stream, reconnect, polling fallback, block confirmations, loading older transactions |
| `src/api.ts` | API calls and flattening raw transactions into table rows |
| `src/App.tsx` | Table, pagination/freeze logic, row detail view |
| `src/format.ts` | Satoshi to BTC conversion, hash shortening, "12s ago" labels |
| `.github/workflows/deploy.yml` | Build and deploy to Pages |

## How it works

### Tech

- React 19 + TypeScript + Vite
- [mempool.space](https://mempool.space/docs/api) public REST + WebSocket API (no key needed)
- Deployed to GitHub Pages by GitHub Actions on every push to `main`

### Data flow (`useLedger`)

1. **Initial load.** Fetches the tip block hash, the block, and its first page of transactions, so the table
   isn't empty while the stream connects. These are confirmed rows.
2. **Live stream.** Opens `wss://mempool.space/api/v1/ws`, subscribes to `blocks` and `track-mempool`, and
   prepends each batch of `mempool-transactions.added`. Only the newest 300 of any single batch are kept, to guard
   against a large initial dump.
3. **Block confirmations.** On each `block` message, the app fetches that block's txids and marks any matching
   table rows as confirmed. The "Latest block" stat is updated too.
4. **Reconnect.** On close, reconnects with exponential backoff (1s, 2s, 4s, ... capped at 30s).
5. **Polling fallback.** If the socket opens but sends no mempool data for 15 seconds, the app polls
   `/mempool/recent` every 8 seconds and fetches up to 10 unseen transactions per poll. Polling stops as soon as
   the stream starts delivering.
6. **Load older.** A cursor walks backwards through the tip block's remaining pages, then through
   `previousblockhash` to earlier blocks, 25 transactions per request.

### Performance

Live data is kept in refs, so the WebSocket can update it many times a second without re-rendering. React state
is refreshed on a fixed 500 ms tick, and only when something changed. The table keeps at most 5,000 rows;
the oldest fall off the end. Transactions are de-duplicated by txid.

### Freeze logic (`App.tsx`)

The hook exposes `prepended`, a running count of rows ever added at the top. When you leave page 1 or press
*Pause*, the app stores that count as an anchor. As new rows arrive, `prepended - anchor` becomes an offset that
shifts the visible window, so the rows you are looking at stay put. The banner reports that offset, and
*back to live* clears the anchor and returns to page 1.

## Configuration

There are no environment variables. Tunables are constants in the source:

| Constant | File | Default | Meaning |
| --- | --- | --- | --- |
| `MAX_ROWS` | `src/useLedger.ts` | `5000` | Maximum rows kept in memory |
| `FLUSH_MS` | `src/useLedger.ts` | `500` | Minimum interval between re-renders |
| `STREAM_GRACE_MS` | `src/useLedger.ts` | `15000` | Silence before falling back to polling |
| `POLL_MS` | `src/useLedger.ts` | `8000` | Polling interval in fallback mode |
| `BLOCK_TX_PAGE` | `src/api.ts` | `25` | Transactions per block page (set by the API) |
| `API_BASE`, `WS_URL`, `EXPLORER` | `src/api.ts` | mempool.space | Data source and explorer links |
| `PAGE_SIZES` | `src/App.tsx` | `25, 50, 100` | Rows-per-page options |
| `base` | `vite.config.ts` | `/btc-ledger/` | Public path the site is served from |

## Deployment

`.github/workflows/deploy.yml` runs on every push to `main` (and manually via *workflow_dispatch*). It runs
`npm ci` and `npm run build` on Node 22, uploads `dist/` and deploys it to GitHub Pages.

To deploy your own fork:

1. In the repository settings, set **Pages > Source** to **GitHub Actions**.
2. Change `base` in `vite.config.ts` to `/<your-repo-name>/`.
3. Update the live-site and source links in this README and in the footer of `src/App.tsx`.
4. Push to `main`.

## Limitations

- Data comes from a third-party public API, so availability and rate limits are mempool.space's, not this
  app's. If requests are blocked, the UI shows an error banner.
- History is not stored. Reloading the page starts again from the latest block.
- The table holds at most 5,000 rows.
- Amounts are BTC only, and "from"/"to" are the first input/output, not a true sender/receiver
  (see [the data model note](#a-note-on-the-bitcoin-data-model)).
