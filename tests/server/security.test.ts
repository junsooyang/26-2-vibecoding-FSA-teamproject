/**
 * 보안 점검에서 찾은 문제의 회귀 테스트.
 *  - 잘못된 형식의 입력으로 서버가 죽거나 멈추지 않는다
 *  - 로그인 실패 횟수 제한, 내부 오류 문구 숨김, JWT 알고리즘 고정
 *  - 개인 공간은 그 보드 멤버만 저장, 위험한 주소는 버림, 강퇴 시 정리
 *  - 실시간 서버 메시지 크기 제한
 */
import { createRequire } from 'node:module'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { connectWs, makeApi, register, startServers, type TestServers } from '../helpers/server'
import { openDb, scalar } from '../helpers/sqlite'

const nodeRequire = createRequire(import.meta.url)
const MAX_PAYLOAD = 256 * 1024

let servers: TestServers
let call: ReturnType<typeof makeApi>

beforeAll(async () => {
  servers = await startServers({ maxPayload: MAX_PAYLOAD })
  call = makeApi(servers.api)
})

afterAll(async () => {
  await servers.close()
})

const health = async () => (await call('GET', '/health')).status

describe('잘못된 형식의 입력', () => {
  it('아이디·비밀번호를 배열/객체로 보내도 400 이고 서버는 계속 동작한다', async () => {
    const bad = [
      ['/auth/register', { username: ['abcd'], name: 'x', password: 'secret12' }],
      ['/auth/register', { username: 'okname1', name: { a: 1 }, password: 'secret12' }],
      ['/auth/register', { username: 'okname2', name: 'x', password: ['secret12'] }],
      ['/auth/login', { username: ['abcd'], password: 'x' }],
      ['/auth/login', { username: 'abcd', password: { a: 1 } }],
    ] as const
    for (const [path, body] of bad) {
      expect((await call('POST', path, null, body)).status).toBe(400)
    }
    expect(await health()).toBe(200)
  })

  it('이름은 30자, 비밀번호는 72바이트까지만 받는다', async () => {
    expect(
      (await call('POST', '/auth/register', null, { username: 'longname', name: 'x'.repeat(31), password: 'secret12' }))
        .status,
    ).toBe(400)
    expect(
      (await call('POST', '/auth/register', null, { username: 'longpw', name: 'x', password: 'a'.repeat(73) })).status,
    ).toBe(400)
    // 이름 앞뒤 공백은 잘라서 저장
    const ok = await call('POST', '/auth/register', null, { username: 'trimname', name: '  철수  ', password: 'secret12' })
    expect(ok.status).toBe(201)
    expect(ok.json.user.name).toBe('철수')
  })

  it('초대 아이디·방 이름을 객체로 보내도 400', async () => {
    const t = await register(call, 'sec_owner')
    expect((await call('POST', '/rooms', t, { name: { a: 1 } })).status).toBe(400)
    expect((await call('POST', '/rooms', t, { name: 'x'.repeat(51) })).status).toBe(400)
    const slug = (await call('POST', '/rooms', t, { name: '보안' })).json.room.slug
    expect(slug).toMatch(/^보안-[a-z0-9]{8}$/)
    expect((await call('POST', `/rooms/${slug}/members`, t, { username: { a: 1 } })).status).toBe(400)
    expect(await health()).toBe(200)
  })

  it('깨진 JSON 은 400 이고 내부 파서 문구를 돌려주지 않는다', async () => {
    const res = await fetch(`${servers.api}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{bad',
    })
    expect(res.status).toBe(400)
    const text = await res.text()
    expect(text).not.toMatch(/JSON|position/)
  })

  it('일반 API 는 1MB 가 넘는 JSON 을 거절한다 (413)', async () => {
    const res = await call('POST', '/auth/login', null, { username: 'x', password: 'a'.repeat(1_100_000) })
    expect(res.status).toBe(413)
  })
})

describe('로그인 보호', () => {
  it('같은 아이디로 10번 틀리면 잠시 막히고(429), 다른 아이디는 영향 없다', async () => {
    await register(call, 'sec_brute')
    await register(call, 'sec_other')
    for (let i = 0; i < 10; i++) {
      expect((await call('POST', '/auth/login', null, { username: 'sec_brute', password: `wrong${i}` })).status).toBe(401)
    }
    // 막힌 뒤에는 맞는 비밀번호도 거절
    expect((await call('POST', '/auth/login', null, { username: 'sec_brute', password: 'secret1234' })).status).toBe(429)
    expect((await call('POST', '/auth/login', null, { username: 'sec_other', password: 'secret1234' })).status).toBe(200)
  }, 30000)

  it('없는 아이디와 틀린 비밀번호는 같은 응답이다', async () => {
    await register(call, 'sec_exist')
    const a = await call('POST', '/auth/login', null, { username: 'sec_nobody', password: 'whatever' })
    const b = await call('POST', '/auth/login', null, { username: 'sec_exist', password: 'whatever' })
    expect(a.status).toBe(401)
    expect(a.json).toEqual(b.json)
  })

  it('같은 비밀키라도 다른 알고리즘(HS512)으로 서명한 토큰은 거절한다', async () => {
    const jwt = nodeRequire('jsonwebtoken')
    const forged = jwt.sign({ sub: 1, username: 'x', name: 'x' }, 'test-secret', { algorithm: 'HS512' })
    expect((await call('GET', '/auth/me', forged)).status).toBe(401)
  })
})

describe('개인 공간', () => {
  it('멤버가 아닌 보드·없는 보드에는 저장할 수 없다', async () => {
    const o = await register(call, 'sec_po')
    const x = await register(call, 'sec_px')
    const slug = (await call('POST', '/rooms', o, { name: 'p' })).json.room.slug
    expect((await call('PUT', `/personal/${slug}`, x, { note: 'hi', files: [] })).status).toBe(403)
    expect((await call('PUT', '/personal/no-such-room-zz', x, { note: 'hi', files: [] })).status).toBe(404)
  })

  it('javascript: 같은 위험한 주소의 파일 항목은 저장하지 않는다', async () => {
    const o = await register(call, 'sec_pf')
    const slug = (await call('POST', '/rooms', o, { name: 'pf' })).json.room.slug
    const files = [
      { id: 'a', name: 'ok.txt', size: 2, url: 'data:text/plain;base64,aGk=' },
      { id: 'b', name: 'evil', size: 1, url: 'javascript:alert(1)' },
      'not-an-object',
    ]
    expect((await call('PUT', `/personal/${slug}`, o, { note: '', files })).status).toBe(200)
    const saved = (await call('GET', `/personal/${slug}`, o)).json.files
    expect(saved).toEqual([{ id: 'a', name: 'ok.txt', size: 2, url: 'data:text/plain;base64,aGk=' }])
  })

  it('강퇴되면 그 보드의 개인 공간도 지워진다', async () => {
    const o = await register(call, 'sec_ko')
    const m = await register(call, 'sec_km')
    const slug = (await call('POST', '/rooms', o, { name: 'k' })).json.room.slug
    await call('POST', `/rooms/${slug}/members`, o, { username: 'sec_km' })
    await call('POST', `/rooms/${slug}/accept`, m)
    expect((await call('PUT', `/personal/${slug}`, m, { note: '내 메모', files: [] })).status).toBe(200)
    const mid = (await call('GET', `/rooms/${slug}`, o)).json.members.find(
      (u: { username: string }) => u.username === 'sec_km',
    ).id
    expect((await call('DELETE', `/rooms/${slug}/members/${mid}`, o)).status).toBe(200)
    const db = openDb(servers.dbPath)
    try {
      expect(scalar(db, 'SELECT COUNT(*) AS c FROM personal_spaces WHERE user_id = ? AND room_slug = ?', mid, slug)).toBe(0)
    } finally {
      db.close()
    }
  })
})

describe('실시간 서버', () => {
  it('최대 크기를 넘는 메시지를 보내면 연결을 끊는다 (1009)', async () => {
    const t = await register(call, 'sec_ws')
    const slug = (await call('POST', '/rooms', t, { name: 'w' })).json.room.slug
    const c = await connectWs(servers.ws, slug, t)
    expect(c.ws).toBeTruthy()
    c.ws!.send(Buffer.alloc(MAX_PAYLOAD + 1024, 1))
    const code = await Promise.race([c.closed, new Promise((r) => setTimeout(() => r('open'), 3000))])
    expect(code).toBe(1009)
    // 서버는 죽지 않고 새 연결을 계속 받는다
    const again = await connectWs(servers.ws, slug, t)
    expect(again.ws).toBeTruthy()
    again.ws!.close()
  })

  it('다른 알고리즘으로 서명한 토큰으로는 접속할 수 없다', async () => {
    const t = await register(call, 'sec_ws2')
    const slug = (await call('POST', '/rooms', t, { name: 'w2' })).json.room.slug
    const me = (await call('GET', '/auth/me', t)).json.user
    const jwt = nodeRequire('jsonwebtoken')
    const forged = jwt.sign({ sub: me.id }, 'test-secret', { algorithm: 'HS512' })
    expect((await connectWs(servers.ws, slug, forged)).status).toBe(401)
  })
})
