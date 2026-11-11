/**
 * 실시간 서버 접근 제어 테스트.
 * 접속 시 JWT·멤버십 검사, 그리고 연결된 뒤 강퇴/나가기/보드 삭제 시 연결이 끊기는지 확인한다.
 * (멤버십 재확인 간격은 테스트에서 200ms 로 줄여서 돌린다)
 */
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import WebSocket from 'ws'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  closeCodeWithin,
  connectWs,
  makeApi,
  register,
  startServers,
  type TestServers,
} from '../helpers/server'

let servers: TestServers
let call: ReturnType<typeof makeApi>
let n = 0
let slug: string
let owner: string
let member: string
let outsider: string
let invited: string
let memberId: number

beforeAll(async () => {
  servers = await startServers({ recheckMs: 200 })
  call = makeApi(servers.api)
})

afterAll(async () => {
  await servers.close()
})

beforeEach(async () => {
  n++
  owner = await register(call, `rown${n}`)
  member = await register(call, `rmem${n}`)
  outsider = await register(call, `rout${n}`)
  invited = await register(call, `rinv${n}`)
  slug = (await call('POST', '/rooms', owner, { name: `실시간${n}` })).json.room.slug
  await call('POST', `/rooms/${slug}/members`, owner, { username: `rmem${n}` })
  await call('POST', `/rooms/${slug}/accept`, member)
  await call('POST', `/rooms/${slug}/members`, owner, { username: `rinv${n}` })
  const members = (await call('GET', `/rooms/${slug}`, owner)).json.members as {
    id: number
    username: string
  }[]
  memberId = members.find((m) => m.username === `rmem${n}`)!.id
})

describe('접속할 때 검사', () => {
  it('토큰이 없거나 위조되면 401 로 거절', async () => {
    expect((await connectWs(servers.ws, slug)).status).toBe(401)
    expect((await connectWs(servers.ws, slug, 'abc.def.ghi')).status).toBe(401)
  })

  it('보드 멤버가 아니거나 초대 수락 전이면 403', async () => {
    expect((await connectWs(servers.ws, slug, outsider)).status).toBe(403)
    expect((await connectWs(servers.ws, slug, invited)).status).toBe(403)
  })

  it('없는 보드는 404', async () => {
    expect((await connectWs(servers.ws, 'no-such-board', owner)).status).toBe(404)
  })

  it('팀장과 참여자는 연결된다', async () => {
    const a = await connectWs(servers.ws, slug, owner)
    const b = await connectWs(servers.ws, slug, member)
    expect(a.ws).toBeDefined()
    expect(b.ws).toBeDefined()
    a.ws?.close()
    b.ws?.close()
  })
})

describe('연결된 뒤 권한이 바뀌면 끊는다', () => {
  it('강퇴되면 4403 으로 끊기고, 다른 멤버는 유지된다', async () => {
    const own = await connectWs(servers.ws, slug, owner)
    const mem = await connectWs(servers.ws, slug, member)
    await call('DELETE', `/rooms/${slug}/members/${memberId}`, owner)
    expect(await closeCodeWithin(mem.closed, 2000)).toBe(4403)
    expect(await closeCodeWithin(own.closed, 600)).toBeNull()
    own.ws?.close()
  })

  it('스스로 나가면 4403 으로 끊긴다', async () => {
    const mem = await connectWs(servers.ws, slug, member)
    await call('POST', `/rooms/${slug}/leave`, member)
    expect(await closeCodeWithin(mem.closed, 2000)).toBe(4403)
  })

  it('보드가 삭제되면 모두 4404 로 끊기고 다시 접속하면 404', async () => {
    const own = await connectWs(servers.ws, slug, owner)
    const mem = await connectWs(servers.ws, slug, member)
    expect((await call('DELETE', `/rooms/${slug}`, owner)).status).toBe(200)
    expect(await closeCodeWithin(own.closed, 2000)).toBe(4404)
    expect(await closeCodeWithin(mem.closed, 2000)).toBe(4404)
    expect((await connectWs(servers.ws, slug, owner)).status).toBe(404)
  })
})

describe('영속화', () => {
  it('보드 내용이 저장되고, 삭제된 보드는 다시 저장되지 않는다', async () => {
    const doc = new Y.Doc()
    const provider = new WebsocketProvider(servers.ws, slug, doc, {
      params: { token: owner },
      WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
    })
    provider.on('connection-close', (e: CloseEvent | null) => {
      if (e && (e.code === 4404 || e.code === 4403)) provider.disconnect()
    })
    await new Promise<void>((resolve) => provider.once('sync', () => resolve()))
    doc.getMap('nodes').set('n1', { id: 'n1', position: { x: 0, y: 0 }, data: { label: 'A' } })

    const docCount = () => servers.scalar('SELECT COUNT(*) AS c FROM docs WHERE name = ?', slug)
    // 저장은 약 0.8초 뒤에 일어난다
    await new Promise((r) => setTimeout(r, 1500))
    expect(await docCount()).toBe(1)

    await call('DELETE', `/rooms/${slug}`, owner)
    await new Promise((r) => setTimeout(r, 1500))
    expect(await docCount()).toBe(0)
    provider.destroy()
    doc.destroy()
    // 마지막 접속자가 나갈 때 다시 저장되지 않는지
    await new Promise((r) => setTimeout(r, 800))
    expect(await docCount()).toBe(0)
  })

  it('모두 나간 직후 다시 들어와도 마지막 내용이 그대로 보인다', async () => {
    const connect = async () => {
      const d = new Y.Doc()
      const p = new WebsocketProvider(servers.ws, slug, d, {
        params: { token: owner },
        WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
      })
      await new Promise<void>((resolve) => p.once('sync', () => resolve()))
      return { d, p }
    }
    const first = await connect()
    first.d.getMap('nodes').set('keep', { id: 'keep', data: { label: '남아야 함' } })
    // 저장(0.8초 debounce)을 기다리지 않고 곧바로 나갔다가 다시 들어온다
    await new Promise((r) => setTimeout(r, 100))
    first.p.destroy()
    first.d.destroy()
    await new Promise((r) => setTimeout(r, 50))
    const second = await connect()
    // 서버가 저장된 내용을 불러와 보내 줄 때까지 잠깐 기다린다
    const end = Date.now() + 3000
    while (!second.d.getMap('nodes').get('keep') && Date.now() < end) {
      await new Promise((r) => setTimeout(r, 50))
    }
    expect((second.d.getMap('nodes').get('keep') as { data: { label: string } })?.data.label).toBe('남아야 함')
    second.p.destroy()
    second.d.destroy()
  })
})
