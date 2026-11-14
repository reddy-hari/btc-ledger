import type { ApiBlock, ApiTx, Party, TxRow } from './types'

export const API_BASE = 'https://mempool.space/api'
export const WS_URL = 'wss://mempool.space/api/v1/ws'
export const EXPLORER = 'https://mempool.space'

/** mempool.space returns block transactions in pages of 25. */
export const BLOCK_TX_PAGE = 25

async function get<T>(path: string, as: 'json' | 'text' = 'json'): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${path}`)
  return (as === 'json' ? res.json() : res.text()) as Promise<T>
}

export const api = {
  tipHash: () => get<string>('/blocks/tip/hash', 'text'),
  block: (hash: string) => get<ApiBlock>(`/block/${hash}`),
  blockTxs: (hash: string, start: number) => get<ApiTx[]>(`/block/${hash}/txs/${start}`),
  blockTxids: (hash: string) => get<string[]>(`/block/${hash}/txids`),
  recentMempool: () => get<{ txid: string }[]>('/mempool/recent'),
  tx: (txid: string) => get<ApiTx>(`/tx/${txid}`),
}

/**
 * Bitcoin transactions have many inputs and outputs rather than a single
 * sender and receiver. Flatten one into a table row.
 */
export function toRow(tx: ApiTx, seenAt = Date.now()): TxRow {
  const inputs: Party[] = tx.vin.map((vin) =>
    vin.is_coinbase
      ? { address: 'Coinbase (newly minted)', value: 0 }
      : {
          address: vin.prevout?.scriptpubkey_address ?? labelFor(vin.prevout?.scriptpubkey_type),
          value: vin.prevout?.value ?? 0,
        },
  )
  const outputs: Party[] = tx.vout.map((vout) => ({
    address: vout.scriptpubkey_address ?? labelFor(vout.scriptpubkey_type),
    value: vout.value,
  }))
  const confirmed = !!tx.status?.confirmed
  return {
    txid: tx.txid,
    inputs,
    outputs,
    totalOut: tx.vout.reduce((sum, v) => sum + v.value, 0),
    fee: tx.fee ?? 0,
    firstSeen: tx.firstSeen ? tx.firstSeen * 1000 : seenAt,
    confirmed,
    blockHeight: confirmed ? tx.status?.block_height : undefined,
    blockTime: confirmed && tx.status?.block_time ? tx.status.block_time * 1000 : undefined,
  }
}

function labelFor(type?: string): string {
  if (type === 'op_return') return 'OP_RETURN (data)'
  if (type === 'p2pk') return 'P2PK (raw pubkey)'
  if (type === 'multisig') return 'Bare multisig'
  return type ? `Non-standard (${type})` : 'Unknown'
}
