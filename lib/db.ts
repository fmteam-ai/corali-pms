import fs from "node:fs";
import { Pool, type PoolClient, types } from "pg";
import { env } from "@/lib/env";

types.setTypeParser(20, Number);
types.setTypeParser(1700, Number);

const globalPool = globalThis as typeof globalThis & { coraliPool?: Pool };

export function db(): Pool {
  if (!globalPool.coraliPool) {
    const config = env();
    globalPool.coraliPool = new Pool({
      connectionString: config.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      ssl: config.DATABASE_SSL === "true" ? { rejectUnauthorized: true, ...(config.DATABASE_SSL_CA ? { ca: fs.readFileSync(config.DATABASE_SSL_CA, "utf8") } : {}) } : undefined,
    });
    globalPool.coraliPool.on("error", (error) => {
      console.error("Unexpected PostgreSQL pool error", error);
    });
  }
  return globalPool.coraliPool;
}

export async function withTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
