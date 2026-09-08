import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

/**
 * 런타임 커넥션. Neon pooled 엔드포인트(DATABASE_URL)를 쓴다.
 * 마이그레이션·DDL은 여기 말고 scripts/db/migrate.ts 의 직결(unpooled) 연결을 쓴다 —
 * PgBouncer transaction mode 는 SET · 세션 어드바이저리 락을 지원하지 않는다 (08 §5.5).
 */
const globalForDb = globalThis as unknown as { pool?: Pool };

export const pool =
  globalForDb.pool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000, // Neon 콜드스타트 대비
  });
if (process.env.NODE_ENV !== "production") globalForDb.pool = pool;

export const db = drizzle(pool, { schema });
export type Db = typeof db;
/** 트랜잭션 콜백이 받는 핸들 */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** "db 또는 트랜잭션" — 서비스 함수가 어느 쪽에서도 돌 수 있게 하는 매개변수 타입 */
export type DbLike = Db | Tx;
