/**
 * 로컬 SQLite(board.db) + uploads 폴더의 데이터를 Postgres(Supabase) + Supabase Storage 로 옮긴다.
 *
 * 실행 (배포 전 한 번, 내 컴퓨터에서):
 *   DATABASE_URL=...  STORAGE_DRIVER=supabase  SUPABASE_URL=...  SUPABASE_SECRET_KEY=...  npm run migrate:supabase
 *   (윈도우 cmd 는 .env 파일 대신 set 으로 넣거나, --env-file 을 쓴다: node --env-file=.env.migrate server/tools/migrate-to-postgres.js)
 *
 * 안전장치
 *  - 대상 DB 에 사용자가 이미 있으면 멈춘다 (덮어쓰지 않음). 비어 있는 새 DB 로만 옮긴다.
 *  - 표 옮기기는 하나의 트랜잭션: 중간에 실패하면 대상 DB 는 그대로 비어 있다.
 *  - 원본(board.db, uploads)은 읽기만 하고 바꾸지 않는다.
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

/** 옮길 표와 열 (순서 = 외래 키 순서) */
const TABLES = [
  ['users', ['id', 'username', 'name', 'password_hash', 'created_at']],
  ['rooms', ['id', 'slug', 'name', 'owner_id', 'created_at']],
  ['room_members', ['room_id', 'user_id', 'role', 'joined_at']],
  ['personal_spaces', ['user_id', 'room_slug', 'note', 'files_json', 'notes_json', 'updated_at']],
  ['files', ['id', 'room_slug', 'name', 'mime', 'size', 'uploader_id', 'created_at']],
  ['docs', ['name', 'state', 'updated_at']],
]
/** 자동 번호 열: 옮긴 뒤 다음 번호를 맞춘다 */
const IDENTITY = [
  ['users', 'id'],
  ['rooms', 'id'],
]

/** Postgres TEXT 에는 NUL 문자를 넣을 수 없다 */
const clean = (v) => (typeof v === 'string' ? v.replace(/\u0000/g, '') : v)

/**
 * @param {{
 *   source: { all: Function },                  // SQLite (server/db.js createDb)
 *   target: { get: Function, run: Function, tx: Function, dialect: string },
 *   uploadDir?: string,                         // 원본 업로드 폴더
 *   storage?: { driver: string, put: Function }, // 대상 파일 저장소
 *   log?: (msg: string) => void,
 * }} options
 */
export async function migrate({ source, target, uploadDir, storage, log = console.log }) {
  if (target.dialect !== 'postgres') throw new Error('대상 DB 가 Postgres 가 아닙니다. DATABASE_URL 을 확인하세요.')
  const existing = await target.get('SELECT CAST(COUNT(*) AS INTEGER) AS c FROM users')
  if (existing && existing.c > 0) {
    throw new Error(`대상 DB 에 이미 사용자 ${existing.c}명이 있어 멈춥니다. 비어 있는 새 DB 로만 옮길 수 있어요.`)
  }

  const counts = {}
  await target.tx(async (t) => {
    for (const [table, cols] of TABLES) {
      const rows = await source.all(`SELECT ${cols.join(', ')} FROM ${table}`)
      const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
      for (const row of rows) await t.run(sql, cols.map((c) => clean(row[c])))
      counts[table] = rows.length
      log(`  ${table}: ${rows.length}행`)
    }
    for (const [table, col] of IDENTITY) {
      await t.get(
        `SELECT setval(pg_get_serial_sequence('${table}', '${col}'), COALESCE((SELECT MAX(${col}) FROM ${table}), 0) + 1, false)`,
      )
    }
  })

  // 업로드 파일 본문 옮기기 (표가 다 옮겨진 뒤)
  const fileResult = { copied: 0, missing: 0, skipped: 0 }
  const files = await source.all('SELECT id, room_slug, mime FROM files')
  if (files.length && (!storage || storage.driver !== 'supabase')) {
    fileResult.skipped = files.length
    log(`  파일 ${files.length}개는 옮기지 않았어요 (STORAGE_DRIVER=supabase 가 아님). 서버 디스크에 uploads 폴더를 직접 옮기세요.`)
  } else {
    for (const f of files) {
      const abs = uploadDir ? path.join(uploadDir, f.room_slug, f.id) : ''
      if (!abs || !fs.existsSync(abs)) {
        fileResult.missing++
        log(`  ! 원본 파일이 없어 건너뜀: ${f.room_slug}/${f.id}`)
        continue
      }
      await storage.put(f.room_slug, f.id, fs.readFileSync(abs), f.mime)
      fileResult.copied++
    }
    if (files.length) log(`  파일: ${fileResult.copied}개 옮김, ${fileResult.missing}개 원본 없음`)
  }
  return { counts, files: fileResult }
}

// ---------------------------------------------------------------------------
// 명령줄 실행
// ---------------------------------------------------------------------------
async function main() {
  const { createDb } = await import('../db.js')
  const { DATABASE_URL, DB_PATH, UPLOAD_DIR } = await import('../config.js')
  const { storage } = await import('../storage.js')

  const sourcePath = process.argv[2] || DB_PATH
  if (!DATABASE_URL) throw new Error('DATABASE_URL(옮겨 갈 Supabase 주소)을 넣어 주세요.')
  if (!fs.existsSync(sourcePath)) throw new Error(`원본 SQLite 파일이 없습니다: ${sourcePath}`)

  console.log(`[migrate] 원본: ${path.resolve(sourcePath)} (+ ${UPLOAD_DIR})`)
  const source = await createDb({ driver: 'sqlite', path: sourcePath })
  const target = await createDb({ driver: 'postgres', url: DATABASE_URL })
  try {
    if (storage.ensureBucket) await storage.ensureBucket()
    const result = await migrate({ source, target, uploadDir: UPLOAD_DIR, storage })
    console.log('[migrate] 완료:', JSON.stringify(result))
  } finally {
    await source.close()
    await target.close()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error('[migrate] 실패:', err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
