/**
 * 테스트에서 SQLite DB 를 직접 들여다볼 때 쓰는 도우미.
 * 'node:sqlite' 를 import 문으로 쓰면 Vite 5 가 변환하다 실패하므로, 실행 시점에 require 로 불러온다.
 */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

interface Statement {
  get: (...params: unknown[]) => Record<string, unknown> | undefined
  run: (...params: unknown[]) => unknown
}
export interface TestDb {
  prepare: (sql: string) => Statement
  exec: (sql: string) => void
  close: () => void
}

export function openDb(file: string): TestDb {
  const { DatabaseSync } = require('node:sqlite') as {
    DatabaseSync: new (file: string) => TestDb
  }
  return new DatabaseSync(file)
}

/** COUNT(*) 같은 단일 값 조회 */
export function scalar(db: TestDb, sql: string, ...params: unknown[]): unknown {
  const row = db.prepare(sql).get(...params)
  return row ? Object.values(row)[0] : undefined
}
