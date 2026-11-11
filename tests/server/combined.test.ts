/**
 * npm start (API + 실시간 서버 한 포트) 모드 테스트.
 * 같은 포트에서 /api 요청과 /ws/<slug> WebSocket 연결이 모두 동작하고,
 * 접근 제어·실시간 동기화·권한 변경 시 연결 종료가 따로 띄울 때와 똑같이 동작하는지 확인한다.
 */
import { createRequire } from 'node:module'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  closeCodeWithin,
  connectWs,
  makeApi,
  register,
  startServers,
  type TestServers,
} from '../helpers/server'

const nodeRequire = createRequire(import.meta.url)

let servers: TestServers
let call: ReturnType<typeof makeApi>

beforeAll(async () => {
  servers = await startServers({ combined: true })
  call = makeApi(servers.api)
})

afterAll(async () => {
  await servers.close()
})

/** 팀장 + 수락한 참여자 + 보드 하나 */
async function setup(tag: string) {
  const owner = await register(call, `c_own_${tag}`)
  const member = await register(call, `c_mem_${tag}`)
  const slug = (await call('POST', '/rooms', owner, { name: `합침${tag}` })).json.room.slug as string
  await call('POST', `/rooms/${slug}/members`, owner, { username: `c_mem_${tag}` })
  await call('POST', `/rooms/${slug}/accept`, member)
  return { owner, member, slug }
}

describe('한 포트 실행 (npm start)', () => {
  it('API 와 실시간 서버가 같은 포트를 쓴다', () => {
    expect(new URL(servers.api).port).toBe(new URL(servers.ws).port)
    expect(new URL(servers.ws).pathname).toBe('/ws')
  })

  it('API 가 동작한다', async () => {
    expect((await call('GET', '/health')).status).toBe(200)
    expect((await call('GET', '/rooms', null)).status).toBe(401)
  })

  it('실시간 접속도 같은 검사를 한다 (401/403/404, 멤버는 연결)', async () => {
    const { owner, slug } = await setup('a')
    const outsider = await register(call, 'c_out_a')
    expect((await connectWs(servers.ws, slug)).status).toBe(401)
    expect((await connectWs(servers.ws, slug, 'forged')).status).toBe(401)
    expect((await connectWs(servers.ws, slug, outsider)).status).toBe(403)
    expect((await connectWs(servers.ws, 'no-such-board', owner)).status).toBe(404)
    const ok = await connectWs(servers.ws, slug, owner)
    expect(ok.ws).toBeTruthy()
    ok.ws!.close()
  })

  it('예전 주소 형식(/<slug>)으로도 접속된다', async () => {
    const { owner, slug } = await setup('b')
    const legacyBase = servers.ws.replace(/\/ws$/, '')
    const ok = await connectWs(legacyBase, slug, owner)
    expect(ok.ws).toBeTruthy()
    ok.ws!.close()
  })

  it('두 사람의 편집이 실시간으로 동기화된다', async () => {
    const { owner, member, slug } = await setup('c')
    const Y = nodeRequire('yjs')
    const { WebsocketProvider } = nodeRequire('y-websocket')
    const WS = nodeRequire('ws')
    const d1 = new Y.Doc()
    const d2 = new Y.Doc()
    const p1 = new WebsocketProvider(servers.ws, slug, d1, { WebSocketPolyfill: WS, params: { token: owner } })
    const p2 = new WebsocketProvider(servers.ws, slug, d2, { WebSocketPolyfill: WS, params: { token: member } })
    try {
      await waitFor(() => p1.synced && p2.synced)
      d1.getMap('nodes').set('n1', '안녕')
      await waitFor(() => d2.getMap('nodes').get('n1') === '안녕')
      expect(d2.getMap('nodes').get('n1')).toBe('안녕')
    } finally {
      p1.destroy()
      p2.destroy()
    }
  })

  it('강퇴되면 연결이 4403 으로 끊긴다', async () => {
    const { owner, member, slug } = await setup('d')
    const mem = await connectWs(servers.ws, slug, member)
    expect(mem.ws).toBeTruthy()
    const memberId = (await call('GET', `/rooms/${slug}`, owner)).json.members.find(
      (m: { username: string }) => m.username === 'c_mem_d',
    ).id
    await call('DELETE', `/rooms/${slug}/members/${memberId}`, owner)
    expect(await closeCodeWithin(mem.closed, 2000)).toBe(4403)
  })
})

async function waitFor(cond: () => boolean, ms = 3000) {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error('시간 초과')
    await new Promise((r) => setTimeout(r, 30))
  }
}
