/**
 * 업로드 파일(사진·첨부) 본문 저장소.
 *
 *  - disk     : UPLOAD_DIR/<보드 slug>/<파일 id>        (기본, 로컬 개발)
 *  - supabase : Supabase Storage 비공개 버킷           (배포용)
 *
 * 파일의 이름·형식·크기 같은 정보는 DB 의 files 테이블에 있고, 여기서는 본문만 다룬다.
 * 내려받기 권한 검사는 API(files.js)가 먼저 하고, 버킷은 비공개라 바깥에서 직접 열 수 없다.
 */
import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import {
  STORAGE_DRIVER,
  SUPABASE_BUCKET,
  SUPABASE_SECRET_KEY,
  SUPABASE_URL,
  UPLOAD_DIR,
} from './config.js'

/**
 * Supabase Storage 의 객체 이름은 ASCII 만 안전하게 쓸 수 있는데, 보드 slug 에는 한글이 들어간다.
 * 그래서 slug 를 16진수로 바꿔 폴더 이름으로 쓴다. (같은 slug → 항상 같은 폴더)
 */
export function storageFolder(slug) {
  return 'r_' + Buffer.from(String(slug), 'utf8').toString('hex')
}

// ---------------------------------------------------------------------------
// 디스크
// ---------------------------------------------------------------------------

function createDiskStorage(root) {
  const fileOf = (slug, id) => path.join(root, slug, id)
  return {
    driver: 'disk',
    async put(slug, id, body) {
      const dir = path.join(root, slug)
      await fs.promises.mkdir(dir, { recursive: true })
      await fs.promises.writeFile(path.join(dir, id), body)
    },
    /** 본문 스트림. 없으면 null */
    async open(slug, id) {
      const abs = fileOf(slug, id)
      if (!fs.existsSync(abs)) return null
      return fs.createReadStream(abs)
    },
    async removeRoom(slug) {
      const dir = path.join(root, slug)
      // slug 가 저장 폴더 밖을 가리키지 않는지 방어적으로 확인
      if (path.dirname(dir) !== root) return
      await fs.promises.rm(dir, { recursive: true, force: true })
    },
  }
}

// ---------------------------------------------------------------------------
// Supabase Storage (REST)
// ---------------------------------------------------------------------------

/**
 * @param {{ url: string, key: string, bucket: string, fetchImpl?: typeof fetch }} options
 *   url: 프로젝트 주소 (https://<ref>.supabase.co)
 */
export function createSupabaseStorage({ url, key, bucket, fetchImpl = fetch }) {
  const base = `${url.replace(/\/+$/, '')}/storage/v1`
  // 새 비밀 키(sb_secret_...)는 apikey 헤더로만 보낸다. 예전 JWT 키(eyJ...)는 Authorization 에도 넣는다.
  const auth = { apikey: key }
  if (key.startsWith('eyJ')) auth.Authorization = `Bearer ${key}`
  const objectPath = (slug, id) =>
    `${encodeURIComponent(bucket)}/${storageFolder(slug)}/${encodeURIComponent(id)}`

  async function fail(res, what) {
    let detail = ''
    try {
      detail = (await res.text()).slice(0, 200)
    } catch {
      // 본문 없음
    }
    // 키 값은 절대 남기지 않는다
    return new Error(`[storage] Supabase ${what} 실패 (${res.status}) ${detail}`)
  }

  return {
    driver: 'supabase',
    async put(slug, id, body, mime) {
      const res = await fetchImpl(`${base}/object/${objectPath(slug, id)}`, {
        method: 'POST',
        headers: {
          ...auth,
          'content-type': mime || 'application/octet-stream',
          'cache-control': 'max-age=3600',
          'x-upsert': 'false',
        },
        body,
      })
      if (!res.ok) throw await fail(res, '업로드')
    },
    async open(slug, id) {
      const res = await fetchImpl(`${base}/object/${objectPath(slug, id)}`, { headers: auth })
      // 없는 객체는 400 또는 404 로 온다
      if (res.status === 404 || res.status === 400) {
        await res.body?.cancel().catch(() => {})
        return null
      }
      if (!res.ok || !res.body) throw await fail(res, '내려받기')
      return Readable.fromWeb(res.body)
    },
    /** 보드의 파일들을 지운다. ids 는 DB 의 files 테이블에서 읽은 그 보드의 파일 id 목록 */
    async removeRoom(slug, ids = []) {
      const folder = storageFolder(slug)
      for (let i = 0; i < ids.length; i += 100) {
        const prefixes = ids.slice(i, i + 100).map((id) => `${folder}/${id}`)
        const res = await fetchImpl(`${base}/object/${encodeURIComponent(bucket)}`, {
          method: 'DELETE',
          headers: { ...auth, 'content-type': 'application/json' },
          body: JSON.stringify({ prefixes }),
        })
        if (!res.ok) throw await fail(res, '삭제')
      }
    },
    /** 버킷이 없으면 비공개로 만든다 (서버 시작 시 한 번) */
    async ensureBucket() {
      const res = await fetchImpl(`${base}/bucket/${encodeURIComponent(bucket)}`, { headers: auth })
      if (res.ok) {
        const info = await res.json().catch(() => ({}))
        if (info && info.public === true) {
          console.warn(`[storage] 버킷 '${bucket}' 이 공개(public) 상태예요. 누구나 파일을 열 수 있으니 비공개로 바꾸세요.`)
        }
        return 'exists'
      }
      await res.body?.cancel().catch(() => {})
      const created = await fetchImpl(`${base}/bucket`, {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({ id: bucket, name: bucket, public: false }),
      })
      if (!created.ok) throw await fail(created, '버킷 만들기')
      return 'created'
    },
  }
}

// ---------------------------------------------------------------------------
// 기본 저장소
// ---------------------------------------------------------------------------

export function createStorageFromEnv() {
  if (STORAGE_DRIVER === 'supabase') {
    return createSupabaseStorage({ url: SUPABASE_URL, key: SUPABASE_SECRET_KEY, bucket: SUPABASE_BUCKET })
  }
  return createDiskStorage(UPLOAD_DIR)
}

export const storage = createStorageFromEnv()

export function describeStorage() {
  return STORAGE_DRIVER === 'supabase'
    ? `Supabase Storage (버킷 ${SUPABASE_BUCKET})`
    : `서버 디스크 (${UPLOAD_DIR})`
}
