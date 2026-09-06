import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'

const databaseUrl = process.env.DATABASE_URL || ''
if (!databaseUrl) throw new Error('DATABASE_URL is required')
const root = path.dirname(fileURLToPath(import.meta.url))
const pool = new Pool({ connectionString: databaseUrl, ssl: /sslmode=require/i.test(databaseUrl) ? { rejectUnauthorized: false } : undefined })

try {
  await pool.query(await fs.readFile(path.join(root, 'schema.sql'), 'utf8'))
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`)
  const files = (await fs.readdir(path.join(root, 'migrations'))).filter((name) => /^\d+.*\.sql$/.test(name)).sort()
  for (const name of files) {
    const sql = await fs.readFile(path.join(root, 'migrations', name), 'utf8')
    const { createHash } = await import('node:crypto')
    const sha256 = createHash('sha256').update(sql).digest('hex')
    const prior = await pool.query('SELECT sha256 FROM schema_migrations WHERE name=$1', [name])
    if (prior.rows[0]) {
      if (prior.rows[0].sha256 !== sha256) throw new Error(`Migration ${name} changed after it was applied`)
      console.log(`skip ${name}`)
      continue
    }
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(sql)
      await client.query('INSERT INTO schema_migrations(name,sha256) VALUES($1,$2)', [name, sha256])
      await client.query('COMMIT')
      console.log(`applied ${name}`)
    } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
  }
} finally { await pool.end() }
