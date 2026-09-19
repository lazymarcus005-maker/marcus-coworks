/** Budget domain (spec §25 / P4.4). */
export type BudgetLimits = {
  dailyTokensPerProject: number
  maxSubagents: number
  dailyModelCallsPerProject: number
}

export type BudgetUsage = {
  date: string
  tokensByProject: Record<string, number>
  modelCallsByProject: Record<string, number>
}
