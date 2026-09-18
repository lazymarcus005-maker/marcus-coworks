import type { LlmProvider, ProviderType } from '@studio/shared'
import type { SqliteDb, SqlRow } from '../database.js'

function toProvider(row: SqlRow): LlmProvider {
  return {
    id: String(row.id),
    name: String(row.name),
    type: String(row.type) as ProviderType,
    baseUrl: String(row.base_url),
    apiKeySecretId:
      row.api_key_secret_id === null || row.api_key_secret_id === undefined
        ? undefined
        : String(row.api_key_secret_id),
    defaultModel:
      row.default_model === null || row.default_model === undefined
        ? undefined
        : String(row.default_model),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

export class ProviderRepository {
  constructor(private readonly db: SqliteDb) {}

  insert(provider: LlmProvider): void {
    this.db.run(
      `INSERT INTO providers (id, name, type, base_url, api_key_secret_id, default_model, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      provider.id,
      provider.name,
      provider.type,
      provider.baseUrl,
      provider.apiKeySecretId ?? null,
      provider.defaultModel ?? null,
      provider.createdAt,
      provider.updatedAt,
    )
  }

  update(provider: LlmProvider): void {
    this.db.run(
      `UPDATE providers SET name = ?, type = ?, base_url = ?, api_key_secret_id = ?, default_model = ?, updated_at = ?
       WHERE id = ?`,
      provider.name,
      provider.type,
      provider.baseUrl,
      provider.apiKeySecretId ?? null,
      provider.defaultModel ?? null,
      provider.updatedAt,
      provider.id,
    )
  }

  list(): LlmProvider[] {
    return this.db.all('SELECT * FROM providers ORDER BY created_at ASC').map(toProvider)
  }

  get(id: string): LlmProvider | undefined {
    const row = this.db.get('SELECT * FROM providers WHERE id = ?', id)
    return row ? toProvider(row) : undefined
  }

  delete(id: string): void {
    this.db.run('DELETE FROM providers WHERE id = ?', id)
  }
}
