/**
 * DB·저장소 설정 도우미 단위 테스트 (Supabase 접속 주소, SSL, 자리표시자, 저장 경로)
 */
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const nodeRequire = createRequire(import.meta.url)
const { databaseUrlForPg, databaseSslOptions } = nodeRequire('../../server/config.js') as {
  databaseUrlForPg: (u: string) => string
  databaseSslOptions: (u: string, env?: Record<string, string>) => unknown
}
const { toPgPlaceholders, describeDb } = nodeRequire('../../server/db.js') as {
  toPgPlaceholders: (s: string) => string
  describeDb: (o: { driver: string; url?: string; path?: string }) => string
}
const { storageFolder } = nodeRequire('../../server/storage.js') as { storageFolder: (s: string) => string }

const SUPA = 'postgresql://postgres.abcd:pa%40ss@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres'

describe('toPgPlaceholders', () => {
  it('? 를 순서대로 $1, $2 … 로 바꾼다', () => {
    expect(toPgPlaceholders('SELECT * FROM t WHERE a = ? AND b = ?')).toBe('SELECT * FROM t WHERE a = $1 AND b = $2')
    expect(toPgPlaceholders('SELECT 1')).toBe('SELECT 1')
  })
})

describe('databaseUrlForPg', () => {
  it('sslmode 같은 SSL 값을 빼서 DATABASE_SSL 설정이 덮어써지지 않게 한다', () => {
    const out = databaseUrlForPg(`${SUPA}?sslmode=require&application_name=board`)
    expect(out).not.toMatch(/sslmode/)
    expect(out).toMatch(/application_name=board/)
    expect(out).toMatch(/pa%40ss/) // 비밀번호 인코딩 유지
  })
})

describe('databaseSslOptions', () => {
  it('원격 주소는 기본으로 암호화(인증서 검증 없이)', () => {
    expect(databaseSslOptions(SUPA, {})).toEqual({ rejectUnauthorized: false })
  })
  it('localhost 는 기본으로 SSL 끔', () => {
    expect(databaseSslOptions('postgres://u:p@localhost:5432/db', {})).toBe(false)
  })
  it('verify 는 CA 인증서가 있어야 하고, 있으면 검증한다', () => {
    expect(() => databaseSslOptions(SUPA, { DATABASE_SSL: 'verify' })).toThrow(/DATABASE_CA_CERT/)
    const pem = '-----BEGIN CERTIFICATE-----\\nAAAA\\n-----END CERTIFICATE-----'
    expect(databaseSslOptions(SUPA, { DATABASE_SSL: 'verify', DATABASE_CA_CERT: pem })).toEqual({
      ca: '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----',
      rejectUnauthorized: true,
    })
  })
  it('알 수 없는 값은 오류', () => {
    expect(() => databaseSslOptions(SUPA, { DATABASE_SSL: 'maybe' })).toThrow()
  })
})

describe('describeDb', () => {
  it('접속 주소의 비밀번호는 드러내지 않는다', () => {
    const text = describeDb({ driver: 'postgres', url: SUPA })
    expect(text).toContain('pooler.supabase.com')
    expect(text).not.toContain('pa%40ss')
    expect(text).not.toContain('pa@ss')
  })
})

describe('예전 board.db 자동 업그레이드', () => {
  it('notes_json 칸이 없는 예전 표에 칸을 붙이고, 기존 데이터는 그대로 둔다', async () => {
    const fs = nodeRequire('node:fs') as typeof import('node:fs')
    const os = nodeRequire('node:os') as typeof import('node:os')
    const path = nodeRequire('node:path') as typeof import('node:path')
    const { DatabaseSync } = nodeRequire('node:sqlite') as {
      DatabaseSync: new (f: string) => { exec: (s: string) => void; close: () => void }
    }
    const { createDb } = nodeRequire('../../server/db.js') as {
      createDb: (o: { driver: string; path: string }) => Promise<{
        get: (s: string, p?: unknown[]) => Promise<Record<string, unknown> | undefined>
        close: () => Promise<void>
      }>
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'old-db-'))
    const file = path.join(dir, 'old.db')
    const old = new DatabaseSync(file)
    old.exec(`CREATE TABLE personal_spaces (
      user_id INTEGER NOT NULL, room_slug TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
      files_json TEXT NOT NULL DEFAULT '[]', updated_at INTEGER NOT NULL, PRIMARY KEY (user_id, room_slug));
      INSERT INTO personal_spaces VALUES (1, 'b', '예전 메모', '[]', 1);`)
    old.close()

    const db = await createDb({ driver: 'sqlite', path: file })
    try {
      expect(await db.get('SELECT note, notes_json FROM personal_spaces')).toEqual({ note: '예전 메모', notes_json: '[]' })
    } finally {
      await db.close()
      try {
        fs.rmSync(dir, { recursive: true, force: true })
      } catch {
        // 윈도우 파일 잠금
      }
    }
  })
})

describe('storageFolder', () => {
  it('한글 slug 도 ASCII 폴더 이름으로, 같은 slug 는 늘 같은 폴더', () => {
    const a = storageFolder('한글-보드-ab12cd34')
    expect(a).toMatch(/^r_[0-9a-f]+$/)
    expect(storageFolder('한글-보드-ab12cd34')).toBe(a)
    expect(storageFolder('다른-보드')).not.toBe(a)
  })
})
