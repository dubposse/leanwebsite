import { neon } from '@neondatabase/serverless'

export const EXPECTED_DATABASE_NAME = 'leanwebsite'

let client

// Lazily created tagged-template client; values are always sent as bound parameters.
export function getSql() {
  if (!client) {
    const connectionString = process.env.DATABASE_URL

    if (!connectionString) {
      throw new Error('DATABASE_URL is not configured')
    }

    client = neon(connectionString)
  }

  return client
}

export async function checkDatabaseHealth() {
  try {
    const [row] = await getSql()`SELECT current_database() AS database_name`

    return {
      ok: row.database_name === EXPECTED_DATABASE_NAME,
      database: row.database_name,
    }
  } catch {
    // Driver errors can contain connection details, so none are forwarded.
    return { ok: false, database: null }
  }
}
