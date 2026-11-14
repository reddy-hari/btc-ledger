import { useCallback, useEffect, useRef, useState } from 'react'
import { api, BLOCK_TX_PAGE, toRow, WS_URL } from './api'
import type { ApiBlock, ApiTx, ConnectionStatus, TxRow } from './types'

/** Keep memory bounded: the oldest rows fall off past this count. */
const MAX_ROWS = 5000
/** Re-render at most this often, however fast transactions arrive. */
const FLUSH_MS = 500
/** If the mempool stream sends nothing for this long, fall back to polling. */
const STREAM_GRACE_MS = 15_000
const POLL_MS = 8_000

interface OlderCursor {
  hash: string
  start: number
  txCount: number
  prevHash?: string
}

export interface Tip {
  height: number
  time: number // ms epoch
  txCount: number
}

export function useLedger() {
  // The live data lives in refs so the WebSocket can update it many times a
  // second; React only re-renders on the FLUSH_MS tick.
  const rowsRef = useRef<TxRow[]>([])
  const byIdRef = useRef(new Map<string, TxRow>())
  const prependedRef = useRef(0) // total rows ever added at the top
  const dirtyRef = useRef(false)
  const cursorRef = useRef<OlderCursor | null>(null)

  const [snapshot, setSnapshot] = useState({ rows: [] as TxRow[], prepended: 0 })
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const [tip, setTip] = useState<Tip | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [hasOlder, setHasOlder] = useState(false)

  const markDirty = () => {
    dirtyRef.current = true
  }

  function trim() {
    if (rowsRef.current.length <= MAX_ROWS) return
    for (const row of rowsRef.current.slice(MAX_ROWS)) byIdRef.current.delete(row.txid)
    rowsRef.current = rowsRef.current.slice(0, MAX_ROWS)
  }

  const prepend = useCallback((txs: ApiTx[]) => {
    const fresh: TxRow[] = []
    for (const tx of txs) {
      if (byIdRef.current.has(tx.txid)) continue
      const row = toRow(tx)
      byIdRef.current.set(row.txid, row)
      fresh.push(row)
    }
    if (!fresh.length) return
    fresh.sort((a, b) => b.firstSeen - a.firstSeen)
    rowsRef.current = [...fresh, ...rowsRef.current]
    prependedRef.current += fresh.length
    trim()
    markDirty()
  }, [])

  const append = useCallback((txs: ApiTx[]) => {
    const older: TxRow[] = []
    for (const tx of txs) {
      if (byIdRef.current.has(tx.txid)) continue
      const row = toRow(tx)
      byIdRef.current.set(row.txid, row)
      older.push(row)
    }
    rowsRef.current = [...rowsRef.current, ...older]
    markDirty()
  }, [])

  /** A block was mined: flip any rows it contains to "confirmed". */
  const onBlock = useCallback(async (block: ApiBlock) => {
    setTip({ height: block.height, time: block.timestamp * 1000, txCount: block.tx_count })
    try {
      const txids = await api.blockTxids(block.id)
      for (const txid of txids) {
        const row = byIdRef.current.get(txid)
        if (row && !row.confirmed) {
          row.confirmed = true
          row.blockHeight = block.height
          row.blockTime = block.timestamp * 1000
        }
      }
      markDirty()
    } catch (e) {
      console.warn('Could not fetch txids for block', block.height, e)
    }
  }, [])

  // Flush ref data into React state on a fixed tick.
  useEffect(() => {
    const id = setInterval(() => {
      if (!dirtyRef.current) return
      dirtyRef.current = false
      setSnapshot({ rows: rowsRef.current, prepended: prependedRef.current })
    }, FLUSH_MS)
    return () => clearInterval(id)
  }, [])

  // Initial load: the latest block's first page of transactions.
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const hash = await api.tipHash()
        const block = await api.block(hash)
        const txs = await api.blockTxs(hash, 0)
        if (!alive) return
        setTip({ height: block.height, time: block.timestamp * 1000, txCount: block.tx_count })
        append(txs)
        cursorRef.current = {
          hash,
          start: BLOCK_TX_PAGE,
          txCount: block.tx_count,
          prevHash: block.previousblockhash,
        }
        setHasOlder(true)
      } catch (e) {
        if (alive) setError(`Couldn't load the latest block: ${(e as Error).message}`)
      }
    })()
    return () => {
      alive = false
    }
  }, [append])

  // Live stream: WebSocket, with automatic reconnect and a polling fallback.
  useEffect(() => {
    let alive = true
    let ws: WebSocket | null = null
    let retry = 0
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined
    let graceTimer: ReturnType<typeof setTimeout> | undefined
    let pollTimer: ReturnType<typeof setInterval> | undefined
    let streamWorking = false

    const startPolling = () => {
      if (pollTimer || !alive) return
      setStatus('polling')
      const poll = async () => {
        try {
          const recent = await api.recentMempool()
          const unseen = recent.filter((t) => !byIdRef.current.has(t.txid)).slice(0, 10)
          const txs: ApiTx[] = []
          for (const { txid } of unseen) {
            try {
              txs.push(await api.tx(txid))
            } catch {
              /* tx may have been evicted or confirmed; skip it */
            }
          }
          if (alive) prepend(txs)
        } catch (e) {
          console.warn('Mempool poll failed', e)
        }
      }
      poll()
      pollTimer = setInterval(poll, POLL_MS)
    }

    const stopPolling = () => {
      if (pollTimer) clearInterval(pollTimer)
      pollTimer = undefined
    }

    const connect = () => {
      if (!alive) return
      setStatus((s) => (s === 'polling' ? s : 'connecting'))
      ws = new WebSocket(WS_URL)

      ws.onopen = () => {
        retry = 0
        ws?.send(JSON.stringify({ action: 'want', data: ['blocks'] }))
        ws?.send(JSON.stringify({ 'track-mempool': true }))
        if (!streamWorking) {
          graceTimer = setTimeout(() => {
            if (!streamWorking) startPolling()
          }, STREAM_GRACE_MS)
        }
      }

      ws.onmessage = (event) => {
        let msg: Record<string, unknown>
        try {
          msg = JSON.parse(event.data)
        } catch {
          return
        }
        const mempool = msg['mempool-transactions'] as { added?: ApiTx[] } | undefined
        if (mempool?.added) {
          if (!streamWorking) {
            streamWorking = true
            stopPolling()
          }
          setStatus('live')
          // Guard against a huge initial dump: keep only the newest few hundred.
          prepend(mempool.added.slice(-300))
        }
        if (msg.block) onBlock(msg.block as ApiBlock)
      }

      ws.onclose = () => {
        clearTimeout(graceTimer)
        if (!alive) return
        if (!pollTimer) setStatus('offline')
        const delay = Math.min(30_000, 1000 * 2 ** retry++)
        reconnectTimer = setTimeout(connect, delay)
      }

      ws.onerror = () => ws?.close()
    }

    connect()
    return () => {
      alive = false
      clearTimeout(reconnectTimer)
      clearTimeout(graceTimer)
      stopPolling()
      ws?.close()
    }
  }, [prepend, onBlock])

  /** Fetch the next 25 older confirmed transactions, walking back block by block. */
  const loadOlder = useCallback(async () => {
    const cursor = cursorRef.current
    if (!cursor || loadingOlder) return
    setLoadingOlder(true)
    try {
      let c = cursor
      if (c.start >= c.txCount) {
        if (!c.prevHash) {
          setHasOlder(false)
          return
        }
        const prev = await api.block(c.prevHash)
        c = { hash: prev.id, start: 0, txCount: prev.tx_count, prevHash: prev.previousblockhash }
      }
      const txs = await api.blockTxs(c.hash, c.start)
      cursorRef.current = { ...c, start: c.start + BLOCK_TX_PAGE }
      append(txs)
      setSnapshot({ rows: rowsRef.current, prepended: prependedRef.current })
    } catch (e) {
      setError(`Couldn't load older transactions: ${(e as Error).message}`)
    } finally {
      setLoadingOlder(false)
    }
  }, [append, loadingOlder])

  return {
    rows: snapshot.rows,
    prepended: snapshot.prepended,
    status,
    tip,
    error,
    loadOlder,
    loadingOlder,
    hasOlder,
  }
}
