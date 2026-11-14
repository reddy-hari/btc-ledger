// Shapes returned by the mempool.space (Esplora-compatible) API.

export interface ApiPrevout {
  scriptpubkey_address?: string
  scriptpubkey_type: string
  value: number // satoshis
}

export interface ApiVin {
  txid: string
  vout: number
  prevout: ApiPrevout | null
  is_coinbase: boolean
}

export interface ApiVout {
  scriptpubkey_address?: string
  scriptpubkey_type: string
  value: number // satoshis
}

export interface ApiTxStatus {
  confirmed: boolean
  block_height?: number
  block_hash?: string
  block_time?: number // unix seconds
}

export interface ApiTx {
  txid: string
  vin: ApiVin[]
  vout: ApiVout[]
  fee: number
  status?: ApiTxStatus
  firstSeen?: number // unix seconds, sent by mempool.space for mempool txs
}

export interface ApiBlock {
  id: string
  height: number
  timestamp: number // unix seconds
  tx_count: number
  previousblockhash?: string
}

// What the table works with: one flattened row per transaction.

export interface Party {
  address: string // address, or a label like "Coinbase (new coins)"
  value: number // satoshis
}

export interface TxRow {
  txid: string
  inputs: Party[]
  outputs: Party[]
  totalOut: number // satoshis
  fee: number // satoshis
  firstSeen: number // ms epoch: when this app (or mempool.space) first saw it
  confirmed: boolean
  blockHeight?: number
  blockTime?: number // ms epoch
}

export type ConnectionStatus = 'connecting' | 'live' | 'polling' | 'offline'
