/** Network visibility + egress policy domain (spec §36–37 / P4.1–4.2). */
export type NetworkCategory = 'llm' | 'git' | 'registry' | 'localhost' | 'unknown'

export type NetworkProfileName = 'safe' | 'developer' | 'autonomous' | 'custom'

export type NetworkEvent = {
  id: string
  projectId?: string
  destination: string
  method: string
  bytes?: number
  allowed: boolean
  category: NetworkCategory
  createdAt: string
}

export type NetworkPolicySettings = {
  profile: NetworkProfileName
  /** Extra allowlist entries for the custom profile. */
  customAllowlist: string[]
}

export const DEFAULT_NETWORK_POLICY: NetworkPolicySettings = {
  profile: 'developer',
  customAllowlist: [],
}
