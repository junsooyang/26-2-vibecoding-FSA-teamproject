/**
 * 서버 공용 설정 (API 서버와 실시간 서버가 같은 값을 쓰도록 한 곳에서 관리).
 */
import fs from 'node:fs'
import path from 'node:path'

const DEV_SECRET = 'dev-insecure-secret-change-me'

// 운영에서는 반드시 환경변수로 주입할 것. (개발 편의용 기본값)
export const JWT_SECRET = process.env.JWT_SECRET || DEV_SECRET

// 운영 환경에서 개발용 기본 비밀키(또는 .env.example 의 예시 값, 너무 짧은 값)를 쓰면
// 누구나 토큰을 위조할 수 있으므로 시작 자체를 막는다.
const WEAK_SECRETS = new Set([DEV_SECRET, 'change-me-in-production'])
if (process.env.NODE_ENV === 'production' && (WEAK_SECRETS.has(JWT_SECRET) || JWT_SECRET.length < 32)) {
  throw new Error('운영 환경에서는 JWT_SECRET 환경변수를 32자 이상의 임의 값으로 설정해야 합니다.')
}
if (process.env.NODE_ENV !== 'production' && JWT_SECRET === DEV_SECRET && !process.env.VITEST) {
  console.warn('[config] 개발용 JWT_SECRET 을 쓰고 있어요. 배포할 때는 반드시 바꾸세요.')
}

const IS_PROD = process.env.NODE_ENV === 'production'

// ---------------------------------------------------------------------------
// 데이터베이스
//  - DATABASE_URL 이 있으면 Postgres(예: Supabase), 없으면 SQLite 파일(DB_PATH)
//  - DB_DRIVER=pglite 는 자동 테스트 전용 (메모리 Postgres)
// ---------------------------------------------------------------------------
export const DB_PATH = process.env.DB_PATH || 'board.db'
export const DATABASE_URL = (process.env.DATABASE_URL || '').trim()
export const DB_DRIVER = (process.env.DB_DRIVER || '').trim()

const LOCAL_DB_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

/**
 * pg 는 접속 주소의 sslmode 같은 값이 ssl 옵션을 덮어쓴다.
 * SSL 은 DATABASE_SSL 로만 정하도록 주소에서 SSL 관련 값을 뺀다.
 */
export function databaseUrlForPg(url) {
  try {
    const u = new URL(url)
    for (const k of ['sslmode', 'ssl', 'sslrootcert', 'sslcert', 'sslkey', 'uselibpqcompat']) {
      u.searchParams.delete(k)
    }
    return u.toString()
  } catch {
    return url
  }
}

/**
 * Postgres SSL 설정 (DATABASE_SSL)
 *  - verify    : 인증서까지 검증. DATABASE_CA_CERT(PEM 내용 또는 파일 경로) 필요. Supabase 대시보드에서 받은 CA 사용
 *  - no-verify : 암호화하되 인증서는 검증하지 않음 (원격 주소의 기본값)
 *  - disable   : SSL 끔 (로컬 Postgres 의 기본값)
 */
export function databaseSslOptions(url, env = process.env) {
  let host = ''
  try {
    host = new URL(url).hostname
  } catch {
    // 주소 형식이 아니면 원격으로 본다
  }
  const mode = (env.DATABASE_SSL || (LOCAL_DB_HOSTS.has(host) ? 'disable' : 'no-verify')).trim()
  if (mode === 'disable') return false
  if (mode === 'verify') {
    const raw = (env.DATABASE_CA_CERT || '').trim()
    if (!raw) throw new Error('DATABASE_SSL=verify 이면 DATABASE_CA_CERT(인증서 내용 또는 파일 경로)가 필요합니다.')
    const ca = raw.includes('BEGIN CERTIFICATE') ? raw.replace(/\\n/g, '\n') : fs.readFileSync(raw, 'utf8')
    return { ca, rejectUnauthorized: true }
  }
  if (mode !== 'no-verify') throw new Error(`DATABASE_SSL 값이 올바르지 않습니다: ${mode} (verify / no-verify / disable)`)
  return { rejectUnauthorized: false }
}

// ---------------------------------------------------------------------------
// 업로드 파일 저장소
//  - disk     : UPLOAD_DIR 폴더 (기본, 로컬 개발)
//  - supabase : Supabase Storage 의 비공개 버킷 (배포용. Render 무료 플랜은 디스크가 재시작 때 지워짐)
// ---------------------------------------------------------------------------
export const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || 'uploads')
export const STORAGE_DRIVER = (process.env.STORAGE_DRIVER || 'disk').trim()
export const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '')
// 새 비밀 키(sb_secret_...) 또는 예전 service_role 키. 서버에서만 쓴다. 절대 프론트에 넣지 말 것.
export const SUPABASE_SECRET_KEY = (process.env.SUPABASE_SECRET_KEY || '').trim()
export const SUPABASE_BUCKET = (process.env.SUPABASE_BUCKET || 'board-files').trim()

if (!['disk', 'supabase'].includes(STORAGE_DRIVER)) {
  throw new Error(`STORAGE_DRIVER 값이 올바르지 않습니다: ${STORAGE_DRIVER} (disk / supabase)`)
}
if (STORAGE_DRIVER === 'supabase' && (!SUPABASE_URL || !SUPABASE_SECRET_KEY)) {
  throw new Error('STORAGE_DRIVER=supabase 이면 SUPABASE_URL 과 SUPABASE_SECRET_KEY 가 필요합니다.')
}

// 운영에서 서버 디스크에 데이터를 두면 Render 무료 플랜 등에서는 재시작할 때 사라진다.
if (IS_PROD && !DATABASE_URL && DB_DRIVER !== 'pglite') {
  console.warn('[config] 운영 모드인데 DATABASE_URL 이 없어 SQLite 파일을 씁니다. 서버 디스크가 지워지면 데이터가 사라져요.')
}
if (IS_PROD && STORAGE_DRIVER === 'disk') {
  console.warn('[config] 운영 모드인데 업로드 파일을 서버 디스크에 저장합니다. 디스크가 지워지면 파일이 사라져요. (STORAGE_DRIVER=supabase 권장)')
}

// 실시간 서버 메시지 하나의 최대 크기 (MB). 예전 방식으로 문서에 들어간 사진을 고려해 넉넉히 둔다.
export const WS_MAX_PAYLOAD = (Number(process.env.WS_MAX_PAYLOAD_MB) || 16) * 1024 * 1024
