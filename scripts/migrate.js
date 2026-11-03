import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { neon } from '@neondatabase/serverless'
import { EXPECTED_DATABASE_NAME } from '../api/_lib/db.js'

const MIGRATIONS_DIR = fileURLToPath(new URL('../db/migrations/', import.meta.url))
const MIGRATIONS_TABLE = 'leanwebsite_schema_migrations'
const BREAKPOINT = '-- statement-breakpoint'

// DO blocks cannot take bind parameters; the value is a fixed constant, not user input.
const DATABASE_GUARD_SQL = `DO $guard$
BEGIN
  IF current_database() <> '${EXPECTED_DATABASE_NAME}' THEN
    RAISE EXCEPTION 'unexpected database';
  END IF;
END
$guard$`

// A chunk consisting only of SQL comments would be an empty query.
function hasExecutableSql(statement) {
  return statement.replace(/^\s*--.*$/gm, '').trim().length > 0
}

function fail(message) {
  console.error(message)
  process.exit(1)
}

if (!process.env.DATABASE_URL) {
  fail('DATABASE_URL is not set. Run via "pnpm db:migrate" so .env.local is loaded.')
}

const sql = neon(process.env.DATABASE_URL)

try {
  const [{ database_name: databaseName }] = await sql`SELECT current_database() AS database_name`

  if (databaseName !== EXPECTED_DATABASE_NAME) {
    fail(`Abort: connected database is "${databaseName}", expected "${EXPECTED_DATABASE_NAME}". Nothing was changed.`)
  }

  await sql.query(
    `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
       version text PRIMARY KEY,
       applied_at timestamptz NOT NULL DEFAULT now()
     )`,
  )

  const applied = new Set((await sql.query(`SELECT version FROM ${MIGRATIONS_TABLE}`)).map((row) => row.version))
  const files = (await readdir(MIGRATIONS_DIR)).filter((file) => file.endsWith('.sql')).sort()

  let appliedCount = 0

  for (const file of files) {
    const version = file.replace(/\.sql$/, '')

    if (applied.has(version)) continue

    const statements = (await readFile(join(MIGRATIONS_DIR, file), 'utf8'))
      .split(BREAKPOINT)
      .map((statement) => statement.trim())
      .filter(hasExecutableSql)

    // Documented Neon API (non-interactive HTTP transaction): all statements and the
    // version entry are sent as one transaction and roll back together on any error.
    // The first statement re-checks the database name inside the transaction.
    await sql.transaction((txn) => [
      txn.query(DATABASE_GUARD_SQL),
      ...statements.map((statement) => txn.query(statement)),
      txn.query(`INSERT INTO ${MIGRATIONS_TABLE} (version) VALUES ($1)`, [version]),
    ])

    appliedCount += 1
    console.log(`Applied ${version}`)
  }

  console.log(appliedCount === 0 ? `Database "${databaseName}" is up to date.` : `Done: ${appliedCount} migration(s) applied.`)
} catch (error) {
  // Only the message is printed; connection strings are never logged.
  fail(`Migration failed: ${error.message}`)
}
