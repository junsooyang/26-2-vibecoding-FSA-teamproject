/**
 * 파일 저장소를 Supabase Storage 로 쓸 때(STORAGE_DRIVER=supabase) 테스트.
 * 진짜 Supabase 대신, 같은 REST 규칙을 흉내 내는 가짜 저장소 서버를 띄운다.
 *  - 비밀 키는 apikey 헤더로만 보낸다 (sb_secret_ 키는 Authorization 에 넣으면 안 됨)
 *  - 업로드 → 내려받기 → 보드 삭제 시 객체 삭제
 *  - 한글 보드 이름도 안전한 객체 경로(ASCII)로 저장
 *  - 버킷이 없으면 비공개로 만든다
 */
import http from 'node:http'
import { createRequire } from 'node:module'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { makeApi, register, startServers, type TestServers } from '../helpers/server'

const nodeRequire = createRequire(import.meta.url)
const KEY = 'sb_secret_test_key_123'
const BUCKET = 'board-files'

interface Seen {
  method: string
  path: string
  apikey?: string
  authorization?: string
}

/** Supabase Storage REST 를 흉내 내는 가짜 서버 */
function fakeStorage() {
  const objects = new Map<string, { body: Buffer; type: string }>()
  const buckets = new Map<string, { public: boolean }>()
  const seen: Seen[] = []
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c as Buffer)
    const body = Buffer.concat(chunks)
    const url = new URL(req.url || '/', 'http://x')
    const p = decodeURIComponent(url.pathname)
    seen.push({
      method: req.method || '',
      path: p,
      apikey: req.headers.apikey as string | undefined,
      authorization: req.headers.authorization,
    })
    const json = (status: number, data: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(data))
    }
    if (req.headers.apikey !== KEY) return json(401, { message: 'bad key' })
    // 객체 경로는 ASCII 만 허용 (진짜 Supabase 처럼 이상한 키는 거절)
    if (/[^\x20-\x7e]/.test(p)) return json(400, { message: 'Invalid key' })

    const bucketMatch = p.match(/^\/storage\/v1\/bucket\/?(.*)$/)
    if (bucketMatch) {
      const id = bucketMatch[1]
      if (req.method === 'GET') {
        const b = buckets.get(id)
        return b ? json(200, { id, public: b.public }) : json(400, { message: 'Bucket not found' })
      }
      if (req.method === 'POST') {
        const info = JSON.parse(body.toString())
        buckets.set(info.id, { public: !!info.public })
        return json(200, { name: info.id })
      }
    }
    const objMatch = p.match(/^\/storage\/v1\/object\/([^/]+)(?:\/(.*))?$/)
    if (objMatch) {
      const [, bucket, key] = objMatch
      if (!buckets.has(bucket)) return json(400, { message: 'Bucket not found' })
      if (req.method === 'POST' && key) {
        objects.set(`${bucket}/${key}`, { body, type: String(req.headers['content-type']) })
        return json(200, { Key: `${bucket}/${key}` })
      }
      if (req.method === 'GET' && key) {
        const o = objects.get(`${bucket}/${key}`)
        if (!o) return json(400, { statusCode: '404', message: 'Object not found' })
        res.writeHead(200, { 'content-type': o.type })
        return res.end(o.body)
      }
      if (req.method === 'DELETE' && !key) {
        const { prefixes } = JSON.parse(body.toString()) as { prefixes: string[] }
        for (const k of prefixes) objects.delete(`${bucket}/${k}`)
        return json(200, [])
      }
    }
    json(404, { message: 'no route' })
  })
  return { server, objects, buckets, seen }
}

const fake = fakeStorage()
let servers: TestServers
let call: ReturnType<typeof makeApi>

beforeAll(async () => {
  await new Promise<void>((r) => fake.server.listen(0, '127.0.0.1', () => r()))
  const port = (fake.server.address() as AddressInfo).port
  process.env.STORAGE_DRIVER = 'supabase'
  process.env.SUPABASE_URL = `http://127.0.0.1:${port}/`
  process.env.SUPABASE_SECRET_KEY = KEY
  process.env.SUPABASE_BUCKET = BUCKET
  servers = await startServers()
  call = makeApi(servers.api)
})

afterAll(async () => {
  await servers.close()
  await new Promise((r) => fake.server.close(r))
})

describe('Supabase Storage 저장소', () => {
  it('버킷이 없으면 비공개로 만든다', async () => {
    const { storage } = nodeRequire('../../server/storage.js') as {
      storage: { ensureBucket: () => Promise<string> }
    }
    expect(await storage.ensureBucket()).toBe('created')
    expect(fake.buckets.get(BUCKET)).toEqual({ public: false })
    expect(await storage.ensureBucket()).toBe('exists')
  })

  it('한글 보드에서 올리고 내려받고, 보드를 지우면 객체도 지워진다', async () => {
    const owner = await register(call, 'sb_owner')
    const slug = (await call('POST', '/rooms', owner, { name: '한글 보드' })).json.room.slug as string
    const png = Buffer.from('89504e470d0a1a0a0000', 'hex')
    const up = await fetch(`${servers.api}/files/${encodeURIComponent(slug)}?kind=image`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${owner}`,
        'Content-Type': 'application/octet-stream',
        'X-File-Name': encodeURIComponent('사진.png'),
        'X-File-Type': 'image/png',
      },
      body: png,
    })
    expect(up.status).toBe(201)
    const id = ((await up.json()) as { file: { id: string } }).file.id
    expect(fake.objects.size).toBe(1)
    // 객체 경로는 ASCII (한글 slug 를 16진수로 바꾼 폴더)
    const key = [...fake.objects.keys()][0]
    expect(key).toMatch(/^board-files\/r_[0-9a-f]+\/[0-9a-f-]{36}$/)
    expect(key.endsWith(id)).toBe(true)

    const dl = await fetch(`${servers.api}/files/${encodeURIComponent(slug)}/${id}`, {
      headers: { Authorization: `Bearer ${owner}` },
    })
    expect(dl.status).toBe(200)
    expect(dl.headers.get('content-type')).toBe('image/png')
    expect(Buffer.from(await dl.arrayBuffer()).equals(png)).toBe(true)

    expect((await call('DELETE', `/rooms/${encodeURIComponent(slug)}`, owner)).status).toBe(200)
    expect(fake.objects.size).toBe(0)
    expect(await servers.scalar('SELECT COUNT(*) FROM files WHERE room_slug = ?', slug)).toBe(0)
  })

  it('저장소에 없는 파일은 404', async () => {
    const owner = await register(call, 'sb_owner2')
    const slug = (await call('POST', '/rooms', owner, { name: 'missing' })).json.room.slug as string
    const id = '00000000-0000-4000-8000-000000000000'
    await servers.exec(
      'INSERT INTO files (id, room_slug, name, mime, size, uploader_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id,
      slug,
      'x.txt',
      'text/plain',
      1,
      1,
      Date.now(),
    )
    const dl = await fetch(`${servers.api}/files/${slug}/${id}`, { headers: { Authorization: `Bearer ${owner}` } })
    expect(dl.status).toBe(404)
  })

  it('비밀 키는 apikey 헤더로만 보내고 Authorization 에는 넣지 않는다', () => {
    expect(fake.seen.length).toBeGreaterThan(0)
    for (const s of fake.seen) {
      expect(s.apikey).toBe(KEY)
      expect(s.authorization).toBeUndefined()
    }
  })
})
