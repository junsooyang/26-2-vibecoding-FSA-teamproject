/**
 * 보드 파일(사진/첨부) API 테스트: 멤버만 올리고 내려받을 수 있는지, 형식·크기 제한이 지켜지는지.
 */
import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { makeApi, register, startServers, type TestServers } from '../helpers/server'

let servers: TestServers
let call: ReturnType<typeof makeApi>
let slug: string
let owner: string
let member: string
let outsider: string
let invited: string

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')

async function upload(token: string | null, kind: 'image' | 'file', body: Buffer, name: string, type: string) {
  const res = await fetch(`${servers.api}/files/${slug}?kind=${kind}`, {
    method: 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': 'application/octet-stream',
      'X-File-Name': encodeURIComponent(name),
      'X-File-Type': type,
    },
    body,
  })
  let json: any = null
  try {
    json = await res.json()
  } catch {
    // 본문 없음
  }
  return { status: res.status, json }
}

beforeAll(async () => {
  servers = await startServers()
  call = makeApi(servers.api)
  owner = await register(call, 'fown')
  member = await register(call, 'fmem')
  outsider = await register(call, 'fout')
  invited = await register(call, 'finv')
  slug = (await call('POST', '/rooms', owner, { name: '파일테스트' })).json.room.slug
  await call('POST', `/rooms/${slug}/members`, owner, { username: 'fmem' })
  await call('POST', `/rooms/${slug}/accept`, member)
  await call('POST', `/rooms/${slug}/members`, owner, { username: 'finv' })
})

afterAll(async () => {
  await servers.close()
})

describe('업로드 권한', () => {
  it('토큰 없으면 401, 멤버 아니면 403, 초대 대기자도 403', async () => {
    expect((await upload(null, 'file', PNG, 'a.bin', 'application/octet-stream')).status).toBe(401)
    expect((await upload(outsider, 'file', PNG, 'a.bin', 'application/octet-stream')).status).toBe(403)
    expect((await upload(invited, 'file', PNG, 'a.bin', 'application/octet-stream')).status).toBe(403)
  })

  it('멤버는 사진을 올릴 수 있고, 한글 파일명이 유지되며 보드 문서용 참조를 받는다', async () => {
    const r = await upload(member, 'image', PNG, '사진.png', 'image/png')
    expect(r.status).toBe(201)
    expect(r.json.file.name).toBe('사진.png')
    expect(r.json.file.ref).toBe(`fsafile:${slug}/${r.json.file.id}`)
    expect(fs.existsSync(path.join(servers.uploadDir, slug, r.json.file.id))).toBe(true)
  })
})

describe('형식 · 크기 제한', () => {
  it('SVG 는 사진으로 받지 않는다 (스크립트를 담을 수 있음)', async () => {
    expect((await upload(member, 'image', Buffer.from('<svg/>'), 'x.svg', 'image/svg+xml')).status).toBe(400)
  })

  it('사진 5MB 초과는 413', async () => {
    const big = Buffer.alloc(5 * 1024 * 1024 + 10, 1)
    expect((await upload(member, 'image', big, 'big.png', 'image/png')).status).toBe(413)
  })

  it('빈 파일은 400', async () => {
    expect((await upload(member, 'file', Buffer.alloc(0), 'empty.txt', 'text/plain')).status).toBe(400)
  })

  it('경로가 섞인 파일명은 이름만 남긴다', async () => {
    const r = await upload(member, 'file', Buffer.from('x'), '../../etc/passwd', 'text/plain')
    expect(r.status).toBe(201)
    expect(r.json.file.name).toBe('passwd')
  })
})

describe('내려받기', () => {
  it('멤버는 원본 그대로 받는다. 사진은 inline, 일반 파일은 다운로드(attachment)', async () => {
    const img = await upload(member, 'image', PNG, 'p.png', 'image/png')
    const res = await fetch(`${servers.api}/files/${slug}/${img.json.file.id}`, {
      headers: { Authorization: `Bearer ${owner}` },
    })
    expect(res.status).toBe(200)
    expect(Buffer.from(await res.arrayBuffer()).equals(PNG)).toBe(true)
    expect(res.headers.get('content-disposition')).toMatch(/^inline/)
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')

    const txt = await upload(member, 'file', Buffer.from('hello'), 'memo.html', 'text/html')
    const res2 = await fetch(`${servers.api}/files/${slug}/${txt.json.file.id}`, {
      headers: { Authorization: `Bearer ${owner}` },
    })
    // HTML 같은 형식도 브라우저에서 실행되지 않도록 항상 다운로드로만 준다
    expect(res2.headers.get('content-type')).toBe('application/octet-stream')
    expect(res2.headers.get('content-disposition')).toMatch(/^attachment/)
  })

  it('토큰 없으면 401, 멤버 아니면 403, 잘못된 id 는 404', async () => {
    const img = await upload(member, 'image', PNG, 'q.png', 'image/png')
    const url = `${servers.api}/files/${slug}/${img.json.file.id}`
    expect((await fetch(url)).status).toBe(401)
    expect((await fetch(url, { headers: { Authorization: `Bearer ${outsider}` } })).status).toBe(403)
    expect(
      (
        await fetch(`${servers.api}/files/${slug}/..%2F..%2Fboard`, {
          headers: { Authorization: `Bearer ${member}` },
        })
      ).status,
    ).toBe(404)
  })
})
