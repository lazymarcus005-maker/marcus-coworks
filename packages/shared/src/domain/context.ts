/** Context management domain (spec §27). */
export type ContextUsage = {
  profile: {
    provider?: string
    model: string
    contextWindow: number
    maxOutputTokens?: number
    autoCompact: boolean
    source: 'explicit' | 'provider-metadata' | 'catalog' | 'fallback'
  }
  estimatedActiveTokens: number
  safetyReserve: number
  lastCompactedAt?: string
}
