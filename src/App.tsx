import { Fragment, useEffect, useState } from 'react'
import { EXPLORER } from './api'
import { btc, clock, int, isAddress, shortHash, timeAgo } from './format'
import type { ConnectionStatus, Party, TxRow } from './types'
import { useLedger } from './useLedger'

const PAGE_SIZES = [25, 50, 100]

export default function App() {
  const { rows, prepended, status, tip, error, loadOlder, loadingOlder, hasOlder } = useLedger()
  const now = useNow()

  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [paused, setPaused] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

  // Freezing: when you leave page 1 (or pause), remember how many rows had
  // been added at that moment. New rows still arrive, but we shift the window
  // by the same amount so the rows you're looking at stay put.
  const [anchor, setAnchor] = useState<number | null>(null)
  const offset = anchor === null ? 0 : prepended - anchor
  const visibleCount = Math.max(0, rows.length - offset)
  const totalPages = Math.max(1, Math.ceil(visibleCount / pageSize))
  const start = (page - 1) * pageSize + offset
  const pageRows = rows.slice(start, start + pageSize)

  const freeze = () => setAnchor((a) => (a === null ? prepended : a))

  const goTo = (p: number) => {
    const next = Math.min(Math.max(1, p), totalPages)
    if (next > 1) freeze()
    else if (!paused) setAnchor(null)
    setPage(next)
    setExpanded(null)
  }

  const togglePause = () => {
    if (paused) {
      setPaused(false)
      if (page === 1) setAnchor(null)
    } else {
      setPaused(true)
      freeze()
    }
  }

  const backToLive = () => {
    setPaused(false)
    setAnchor(null)
    setPage(1)
    setExpanded(null)
  }

  const lastMinute = rows.reduce((n, r) => (!r.confirmed && now - r.firstSeen < 60_000 ? n + 1 : n), 0)
  const unconfirmed = rows.reduce((n, r) => (r.confirmed ? n : n + 1), 0)

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <span className="logo">₿</span>
          <div>
            <h1>btc-ledger</h1>
            <p className="tagline">Bitcoin transactions, live as they hit the network</p>
          </div>
        </div>
        <StatusPill status={status} paused={paused} />
      </header>

      <section className="stats">
        <Stat label="Latest block" value={tip ? `#${int(tip.height)}` : '—'} hint={tip ? `${timeAgo(tip.time, now)} · ${int(tip.txCount)} txs` : 'loading…'} />
        <Stat label="Seen in last minute" value={int(lastMinute)} hint="new unconfirmed txs" />
        <Stat label="Waiting to confirm" value={int(unconfirmed)} hint="in this table" />
        <Stat label="Rows loaded" value={int(rows.length)} hint={`capped at ${int(5000)}`} />
      </section>

      {error && <div className="error">{error}</div>}

      <div className="toolbar">
        <button className="btn" onClick={togglePause}>
          {paused ? '▶ Resume live' : '❚❚ Pause'}
        </button>
        <label className="page-size">
          Rows per page
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value))
              goTo(1)
            }}
          >
            {PAGE_SIZES.map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
      </div>

      {offset > 0 && (
        <button className="banner" onClick={backToLive}>
          ↑ {int(offset)} new transaction{offset === 1 ? '' : 's'} · back to live
        </button>
      )}

      <div className="table-wrap">
        <table className="ledger">
          <thead>
            <tr>
              <th>Time</th>
              <th>Transaction</th>
              <th>From</th>
              <th>To</th>
              <th className="num">Amount (BTC)</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 && (
              <tr>
                <td colSpan={6} className="empty">
                  {error ? 'Nothing to show yet.' : 'Connecting to the Bitcoin network…'}
                </td>
              </tr>
            )}
            {pageRows.map((row) => (
              <Fragment key={row.txid}>
                <Row
                  row={row}
                  now={now}
                  open={expanded === row.txid}
                  onToggle={() => setExpanded((id) => (id === row.txid ? null : row.txid))}
                />
                {expanded === row.txid && <Detail row={row} />}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <nav className="pager">
        <button className="btn" disabled={page === 1} onClick={() => goTo(1)}>
          « Latest
        </button>
        <button className="btn" disabled={page === 1} onClick={() => goTo(page - 1)}>
          ‹ Newer
        </button>
        <span className="page-num">
          Page {page} of {totalPages}
        </span>
        <button className="btn" disabled={page >= totalPages} onClick={() => goTo(page + 1)}>
          Older ›
        </button>
        {page >= totalPages && hasOlder && (
          <button className="btn btn-accent" disabled={loadingOlder} onClick={loadOlder}>
            {loadingOlder ? 'Loading…' : '+ Load older transactions'}
          </button>
        )}
      </nav>

      <footer className="footer">
        Data from the public{' '}
        <a href={EXPLORER} target="_blank" rel="noreferrer">
          mempool.space
        </a>{' '}
        API. Amount is the total of all outputs, which usually includes change sent back to the sender.{' '}
        <a href="https://github.com/reddy-hari/btc-ledger" target="_blank" rel="noreferrer">
          Source on GitHub
        </a>
      </footer>
    </div>
  )
}

function Row({ row, now, open, onToggle }: { row: TxRow; now: number; open: boolean; onToggle: () => void }) {
  return (
    <tr className={`row ${open ? 'open' : ''}`} onClick={onToggle}>
      <td className="time">
        {row.confirmed && row.blockTime ? clock(row.blockTime) : timeAgo(row.firstSeen, now)}
      </td>
      <td className="mono">
        <a href={`${EXPLORER}/tx/${row.txid}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
          {shortHash(row.txid)}
        </a>
      </td>
      <td>
        <PartyCell parties={row.inputs} />
      </td>
      <td>
        <PartyCell parties={row.outputs} />
      </td>
      <td className="num mono">{btc(row.totalOut)}</td>
      <td>
        {row.confirmed ? (
          <span className="badge confirmed">Block #{row.blockHeight ? int(row.blockHeight) : '?'}</span>
        ) : (
          <span className="badge pending">Unconfirmed</span>
        )}
      </td>
    </tr>
  )
}

function PartyCell({ parties }: { parties: Party[] }) {
  const first = parties[0]
  if (!first) return <span className="muted">—</span>
  return (
    <span className="party">
      <Addr value={first.address} />
      {parties.length > 1 && <span className="more">+{parties.length - 1}</span>}
    </span>
  )
}

function Addr({ value }: { value: string }) {
  if (!isAddress(value)) return <span className="label">{value}</span>
  return (
    <a
      className="mono"
      href={`${EXPLORER}/address/${value}`}
      target="_blank"
      rel="noreferrer"
      title={value}
      onClick={(e) => e.stopPropagation()}
    >
      {shortHash(value, 7, 5)}
    </a>
  )
}

function Detail({ row }: { row: TxRow }) {
  return (
    <tr className="detail">
      <td colSpan={6}>
        <div className="detail-grid">
          <PartyList title={`Inputs (${row.inputs.length})`} parties={row.inputs} />
          <div className="arrow">→</div>
          <PartyList title={`Outputs (${row.outputs.length})`} parties={row.outputs} />
        </div>
        <div className="detail-meta">
          <span>
            Fee <b className="mono">{btc(row.fee)} BTC</b>
          </span>
          <span>
            First seen <b>{new Date(row.firstSeen).toLocaleString()}</b>
          </span>
          {row.blockTime && (
            <span>
              Confirmed <b>{new Date(row.blockTime).toLocaleString()}</b>
            </span>
          )}
          <span className="mono txid">{row.txid}</span>
        </div>
      </td>
    </tr>
  )
}

function PartyList({ title, parties }: { title: string; parties: Party[] }) {
  const shown = parties.slice(0, 50)
  return (
    <div className="party-list">
      <h4>{title}</h4>
      <ul>
        {shown.map((p, i) => (
          <li key={i}>
            <Addr value={p.address} />
            {p.value > 0 && <span className="mono amount">{btc(p.value)}</span>}
          </li>
        ))}
        {parties.length > shown.length && <li className="muted">…and {parties.length - shown.length} more</li>}
      </ul>
    </div>
  )
}

function StatusPill({ status, paused }: { status: ConnectionStatus; paused: boolean }) {
  const label = paused
    ? 'Paused'
    : { live: 'Live', polling: 'Live (polling)', connecting: 'Connecting…', offline: 'Reconnecting…' }[status]
  return (
    <span className={`status ${paused ? 'paused' : status}`}>
      <span className="dot" />
      {label}
    </span>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      <div className="stat-hint">{hint}</div>
    </div>
  )
}

/** Current time, ticking every second, so "12s ago" labels stay fresh. */
function useNow() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  return now
}
