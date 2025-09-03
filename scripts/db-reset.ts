/**
 * Truncate TigerBeetle-Deno MySQL tables for clean test runs.
 * Uses env vars: TB_TEST_HOST, TB_TEST_PORT, TB_TEST_DB, TB_TEST_USER, TB_TEST_PASSWORD.
 */
import { Client as MySQLClient } from 'https://deno.land/x/mysql@v2.12.1/mod.ts';

function getEnv(name: string, fallback?: string): string | undefined {
  const v = Deno.env.get(name);
  return v !== undefined ? v : fallback;
}

async function main() {
  const hostname = getEnv('TB_TEST_HOST', '127.0.0.1')!;
  const port = parseInt(getEnv('TB_TEST_PORT', '3306')!, 10);
  const db = getEnv('TB_TEST_DB', 'tigerbeetle')!;
  const username = getEnv('TB_TEST_USER', 'root')!;
  const password = getEnv('TB_TEST_PASSWORD', '')!;

  const client = await new MySQLClient().connect({
    hostname,
    port,
    username,
    db,
    password,
  });

  try {
    // Only truncate base tables that exist, in safe order.
    const desired = [
      'pending_transfers',
      'account_balances',
      'transfers',
      'accounts',
    ];

    // Disable FK checks during truncation.
    await client.execute('SET FOREIGN_KEY_CHECKS=0');

    // Discover existing base tables.
    const rows = await client.query(
      "SHOW FULL TABLES WHERE Table_type='BASE TABLE'",
    ) as Array<Record<string, string>>;

    // SHOW FULL TABLES returns varying column names (e.g., `Tables_in_<db>` and `Table_type`).
    // Find the table name column dynamically.
    const tableNameKey = Object.keys(rows[0] || {}).find((k) =>
      k.toLowerCase().startsWith('tables_in_')
    );

    const existing = new Set(
      rows
        .map((r) => (tableNameKey ? r[tableNameKey] : undefined))
        .filter((t): t is string => typeof t === 'string'),
    );

    for (const table of desired) {
      if (existing.has(table)) {
        await client.execute(`TRUNCATE TABLE ${table}`);
        console.log(`Truncated ${table}`);
      }
    }

    await client.execute('SET FOREIGN_KEY_CHECKS=1');
    console.log('✅ Database reset complete');
  } finally {
    await client.close();
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error('❌ db:reset failed:', err);
    Deno.exit(1);
  });
}

