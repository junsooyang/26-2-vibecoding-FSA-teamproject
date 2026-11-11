/**
 * SQLite → Postgres(Supabase) 데이터 이전 스크립트 테스트.
 * 원본은 임시 SQLite 파일, 대상은 메모리 Postgres(PGlite), 파일 저장소는 기록만 하는 가짜.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const nodeRequire = createRequire(import.meta.url)

type Db = {
  get: (s: string, p?: unknown[]) => Promise<Record<string, unknown> | undefined>
  all: (s: string, p?: unknown[]) => Promise<Record<string, unknown>[]>
  run: (s: string, p?: unknown[]) => Promise<unknown>
  tx: (fn: (t: Db) => Promise<unknown>) => Promise<unknown>
  close: () => Promise<void>
  dialect: string
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-test-'))
const uploadDir = path.join(dir, 'uploads')
let createDb: (o: { driver: string; path?: string }) => Promise<Db>
let migrate: (o: Record<string, unknown>) => Promise<{
  counts: Record<string, number>
  files: { copied: number; missing: number; skipped: number }
}>
let source: Db
let target: Db
const put: { slug: string; id: string; size: number; mime: string }[] = []
const fakeStorage = {
  driver: 'supabase',
  put: async (slug: string, id: string, body: Buffer, mime: string) => {
    put.push({ slug, id, size: body.length, mime })
  },
}

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-secret'
  ;({ createDb } = nodeRequire('../../server/db.js'))
  ;({ migrate } = nodeRequire('../../server/tools/migrate-to-postgres.js'))
  source = await createDb({ driver: 'sqlite', path: path.join(dir, 'board.db') })
  // 원본 데이터: 사용자 2명(번호 5, 9), 보드 1개, 멤버, 개인 공간, 파일 2개(1개는 원본 없음), 보드 문서
  await source.run("INSERT INTO users (id, username, name, password_hash, created_at) VALUES (5, 'kim', '김', 'h1', 1)")
  await source.run("INSERT INTO users (id, username, name, password_hash, created_at) VALUES (9, 'lee', '이', 'h2', 2)")
  await source.run("INSERT INTO rooms (id, slug, name, owner_id, created_at) VALUES (3, '보드-abc', '보드', 5, 3)")
  await source.run("INSERT INTO room_members VALUES (3, 5, 'owner', 3)")
  await source.run("INSERT INTO room_members VALUES (3, 9, 'member', 4)")
  await source.run('INSERT INTO personal_spaces VALUES (9, ?, ?, ?, 5)', ['보드-abc', '메모\u0000', '[]'])
  const fileId = '11111111-1111-4111-8111-111111111111'
  await source.run('INSERT INTO files VALUES (?, ?, ?, ?, ?, ?, ?)', [fileId, '보드-abc', 'a.png', 'image/png', 3, 5, 6])
  await source.run('INSERT INTO files VALUES (?, ?, ?, ?, ?, ?, ?)', [
    '22222222-2222-4222-8222-222222222222',
    '보드-abc',
    'gone.txt',
    'text/plain',
    1,
    5,
    7,
  ])
  await source.run('INSERT INTO docs VALUES (?, ?, ?)', ['보드-abc', new Uint8Array([1, 2, 3, 250]), 8])
  fs.mkdirSync(path.join(uploadDir, '보드-abc'), { recursive: true })
  fs.writeFileSync(path.join(uploadDir, '보드-abc', fileId), Buffer.from([1, 2, 3]))

  target = await createDb({ driver: 'pglite' })
})

afterAll(async () => {
  await source?.close()
  await target?.close()
  try {
    fs.rmSync(dir, { recursive: true, force: true })
  } catch {
    // 윈도우 파일 잠금
  }
})

describe('migrate (SQLite → Postgres)', () => {
  it('모든 표와 파일을 옮긴다', async () => {
    const result = await migrate({ source, target, uploadDir, storage: fakeStorage, log: () => {} })
    expect(result.counts).toEqual({ users: 2, rooms: 1, room_members: 2, personal_spaces: 1, files: 2, docs: 1 })
    expect(result.files).toEqual({ copied: 1, missing: 1, skipped: 0 })
    expect(put).toEqual([{ slug: '보드-abc', id: '11111111-1111-4111-8111-111111111111', size: 3, mime: 'image/png' }])
  })

  it('번호·한글·바이너리가 그대로이고, NUL 문자는 지워진다', async () => {
    expect(await target.get("SELECT id, name FROM users WHERE username = 'lee'")).toEqual({ id: 9, name: '이' })
    expect(await target.get('SELECT owner_id FROM rooms WHERE slug = ?', ['보드-abc'])).toEqual({ owner_id: 5 })
    const doc = await target.get('SELECT state FROM docs WHERE name = ?', ['보드-abc'])
    expect([...(doc!.state as Uint8Array)]).toEqual([1, 2, 3, 250])
    expect((await target.get('SELECT note FROM personal_spaces'))!.note).toBe('메모')
  })

  it('옮긴 뒤 새로 가입한 사용자는 기존 번호와 겹치지 않는다', async () => {
    const row = await target.get(
      "INSERT INTO users (username, name, password_hash, created_at) VALUES ('new', '새', 'h', 9) RETURNING id",
    )
    expect(row!.id).toBe(10)
  })

  it('이미 데이터가 있는 DB 로는 옮기지 않는다', async () => {
    await expect(migrate({ source, target, uploadDir, storage: fakeStorage, log: () => {} })).rejects.toThrow(
      /이미 사용자/,
    )
  })

  it('중간에 실패하면 대상 DB 는 비어 있는 그대로다', async () => {
    const empty = await createDb({ driver: 'pglite' })
    // 원본에 대상 규칙을 어기는 행(같은 아이디가 두 번)을 흉내 내기 위해 가짜 원본을 쓴다
    const broken = {
      all: async (sql: string) =>
        sql.includes('FROM users')
          ? [
              { id: 1, username: 'dup', name: 'a', password_hash: 'h', created_at: 1 },
              { id: 2, username: 'dup', name: 'b', password_hash: 'h', created_at: 1 },
            ]
          : [],
    }
    await expect(migrate({ source: broken, target: empty, storage: fakeStorage, log: () => {} })).rejects.toThrow()
    expect(await empty.get('SELECT CAST(COUNT(*) AS INTEGER) AS c FROM users')).toEqual({ c: 0 })
    await empty.close()
  })
})
