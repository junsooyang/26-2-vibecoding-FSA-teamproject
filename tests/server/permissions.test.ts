/**
 * 권한 테스트: 방/멤버 관리 API (보드 삭제, 초대, 강퇴, 팀장 위임, 나가기, 개인 공간)
 * 실제 Express 앱을 임시 DB 와 빈 포트로 띄워서 HTTP 로 검사한다.
 */
import fs from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { makeApi, register, startServers, type TestServers } from '../helpers/server'
import { openDb, scalar } from '../helpers/sqlite'

let servers: TestServers
let call: ReturnType<typeof makeApi>
let n = 0

beforeAll(async () => {
  servers = await startServers()
  call = makeApi(servers.api)
})

afterAll(async () => {
  await servers.close()
})

/** 테스트마다 새 팀장/참여자/외부인/초대대기 계정과 보드를 만든다 */
interface Fixture {
  slug: string
  owner: string
  member: string
  outsider: string
  invited: string
  ids: Record<string, number>
}
let fx: Fixture

beforeEach(async () => {
  n++
  const names = { owner: `own${n}`, member: `mem${n}`, outsider: `out${n}`, invited: `inv${n}` }
  const owner = await register(call, names.owner)
  const member = await register(call, names.member)
  const outsider = await register(call, names.outsider)
  const invited = await register(call, names.invited)
  const created = await call('POST', '/rooms', owner, { name: `테스트보드${n}` })
  expect(created.status).toBe(201)
  const slug = created.json.room.slug
  await call('POST', `/rooms/${slug}/members`, owner, { username: names.member })
  await call('POST', `/rooms/${slug}/accept`, member)
  await call('POST', `/rooms/${slug}/members`, owner, { username: names.invited }) // 수락 안 함
  const members = (await call('GET', `/rooms/${slug}`, owner)).json.members as {
    id: number
    username: string
  }[]
  const ids = Object.fromEntries(
    Object.entries(names).map(([k, u]) => [k, members.find((m) => m.username === u)?.id ?? -1]),
  )
  fx = { slug, owner, member, outsider, invited, ids }
})

describe('인증', () => {
  it('토큰 없이 방 API 를 부르면 401', async () => {
    expect((await call('GET', '/rooms', null)).status).toBe(401)
  })

  it('위조된 토큰은 401', async () => {
    expect((await call('GET', '/rooms', 'abc.def.ghi')).status).toBe(401)
  })
})

describe('보드 접근', () => {
  it('팀장과 참여자는 보드를 볼 수 있다', async () => {
    expect((await call('GET', `/rooms/${fx.slug}`, fx.owner)).json.role).toBe('owner')
    expect((await call('GET', `/rooms/${fx.slug}`, fx.member)).json.role).toBe('member')
  })

  it('외부인과 초대 대기자는 403', async () => {
    expect((await call('GET', `/rooms/${fx.slug}`, fx.outsider)).status).toBe(403)
    expect((await call('GET', `/rooms/${fx.slug}`, fx.invited)).status).toBe(403)
  })

  it('없는 보드는 404', async () => {
    expect((await call('GET', '/rooms/no-such-board', fx.owner)).status).toBe(404)
  })
})

describe('보드 삭제', () => {
  it('참여자·외부인·초대 대기자는 삭제할 수 없다', async () => {
    expect((await call('DELETE', `/rooms/${fx.slug}`, fx.member)).status).toBe(403)
    expect((await call('DELETE', `/rooms/${fx.slug}`, fx.outsider)).status).toBe(403)
    expect((await call('DELETE', `/rooms/${fx.slug}`, fx.invited)).status).toBe(403)
    expect((await call('GET', `/rooms/${fx.slug}`, fx.owner)).status).toBe(200)
  })

  it('팀장이 삭제하면 보드·개인 공간·보드 문서·업로드 파일이 모두 정리된다', async () => {
    await call('PUT', `/personal/${fx.slug}`, fx.member, { note: '메모', files: [] })
    // 보드 문서(실시간 서버가 저장하는 docs 테이블)를 미리 만들어 둔다
    const raw = openDb(servers.dbPath)
    raw.exec(
      'CREATE TABLE IF NOT EXISTS docs (name TEXT PRIMARY KEY, state BLOB NOT NULL, updated_at INTEGER NOT NULL)',
    )
    raw
      .prepare('INSERT OR REPLACE INTO docs (name, state, updated_at) VALUES (?, ?, ?)')
      .run(fx.slug, new Uint8Array([1, 2, 3]), Date.now())
    // 업로드 파일
    const up = await fetch(`${servers.api}/files/${fx.slug}?kind=file`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${fx.member}`,
        'Content-Type': 'application/octet-stream',
        'X-File-Name': encodeURIComponent('자료.txt'),
        'X-File-Type': 'text/plain',
      },
      body: Buffer.from('hello'),
    })
    expect(up.status).toBe(201)

    const del = await call('DELETE', `/rooms/${fx.slug}`, fx.owner)
    expect(del.status).toBe(200)

    expect((await call('GET', `/rooms/${fx.slug}`, fx.owner)).status).toBe(404)
    const count = (sql: string) => scalar(raw, sql, fx.slug)
    expect(count('SELECT COUNT(*) FROM personal_spaces WHERE room_slug = ?')).toBe(0)
    expect(count('SELECT COUNT(*) FROM docs WHERE name = ?')).toBe(0)
    expect(count('SELECT COUNT(*) FROM files WHERE room_slug = ?')).toBe(0)
    expect(fs.existsSync(`${servers.uploadDir}/${fx.slug}`)).toBe(false)
    raw.close()
  })
})

describe('초대 · 강퇴', () => {
  it('참여자는 초대·강퇴할 수 없다', async () => {
    const other = await register(call, `extra${n}`)
    expect(other).toBeTruthy()
    expect((await call('POST', `/rooms/${fx.slug}/members`, fx.member, { username: `extra${n}` })).status).toBe(403)
    expect((await call('DELETE', `/rooms/${fx.slug}/members/${fx.ids.owner}`, fx.member)).status).toBe(403)
  })

  it('초대받은 사람은 수락 전에는 들어올 수 없고, 수락하면 참여자가 된다', async () => {
    expect((await call('GET', `/rooms/${fx.slug}`, fx.invited)).status).toBe(403)
    expect((await call('POST', `/rooms/${fx.slug}/accept`, fx.invited)).status).toBe(200)
    expect((await call('GET', `/rooms/${fx.slug}`, fx.invited)).json.role).toBe('member')
  })

  it('팀장은 자기 자신을 강퇴할 수 없다', async () => {
    expect((await call('DELETE', `/rooms/${fx.slug}/members/${fx.ids.owner}`, fx.owner)).status).toBe(400)
  })

  it('팀장이 강퇴하면 그 사람은 더 이상 접근할 수 없다', async () => {
    expect((await call('DELETE', `/rooms/${fx.slug}/members/${fx.ids.member}`, fx.owner)).status).toBe(200)
    expect((await call('GET', `/rooms/${fx.slug}`, fx.member)).status).toBe(403)
  })
})

describe('팀장 위임', () => {
  it('참여자는 위임할 수 없다', async () => {
    const r = await call('POST', `/rooms/${fx.slug}/transfer`, fx.member, { userId: fx.ids.member })
    expect(r.status).toBe(403)
  })

  it('초대 대기자·자기 자신·대상 없음에게는 위임할 수 없다', async () => {
    expect((await call('POST', `/rooms/${fx.slug}/transfer`, fx.owner, { userId: fx.ids.invited })).status).toBe(400)
    expect((await call('POST', `/rooms/${fx.slug}/transfer`, fx.owner, { userId: fx.ids.owner })).status).toBe(400)
    expect((await call('POST', `/rooms/${fx.slug}/transfer`, fx.owner, {})).status).toBe(400)
  })

  it('위임하면 역할이 맞바뀌고 팀장은 한 명뿐이다', async () => {
    const r = await call('POST', `/rooms/${fx.slug}/transfer`, fx.owner, { userId: fx.ids.member })
    expect(r.status).toBe(200)
    expect((await call('GET', `/rooms/${fx.slug}`, fx.owner)).json.role).toBe('member')
    expect((await call('GET', `/rooms/${fx.slug}`, fx.member)).json.role).toBe('owner')

    const raw = openDb(servers.dbPath)
    const owners = scalar(
      raw,
      "SELECT COUNT(*) AS c FROM room_members m JOIN rooms r ON r.id = m.room_id WHERE r.slug = ? AND m.role = 'owner'",
      fx.slug,
    )
    const ownerId = scalar(raw, 'SELECT owner_id FROM rooms WHERE slug = ?', fx.slug)
    raw.close()
    expect(owners).toBe(1)
    expect(ownerId).toBe(fx.ids.member)
  })

  it('위임한 뒤 이전 팀장은 삭제·초대를 할 수 없고, 새 팀장은 할 수 있다', async () => {
    await call('POST', `/rooms/${fx.slug}/transfer`, fx.owner, { userId: fx.ids.member })
    expect((await call('DELETE', `/rooms/${fx.slug}`, fx.owner)).status).toBe(403)
    expect((await call('POST', `/rooms/${fx.slug}/members`, fx.owner, { username: `out${n}` })).status).toBe(403)
    expect((await call('POST', `/rooms/${fx.slug}/members`, fx.member, { username: `out${n}` })).status).toBe(201)
    expect((await call('DELETE', `/rooms/${fx.slug}`, fx.member)).status).toBe(200)
  })
})

describe('보드에서 나가기', () => {
  it('팀장은 나갈 수 없다', async () => {
    expect((await call('POST', `/rooms/${fx.slug}/leave`, fx.owner)).status).toBe(400)
  })

  it('참여자가 나가면 접근할 수 없고 목록에서 사라지며 개인 공간도 지워진다', async () => {
    await call('PUT', `/personal/${fx.slug}`, fx.member, { note: '내 메모', files: [] })
    expect((await call('POST', `/rooms/${fx.slug}/leave`, fx.member)).status).toBe(200)
    expect((await call('GET', `/rooms/${fx.slug}`, fx.member)).status).toBe(403)
    const rooms = (await call('GET', '/rooms', fx.member)).json.rooms as { slug: string }[]
    expect(rooms.some((r) => r.slug === fx.slug)).toBe(false)
    expect((await call('GET', `/personal/${fx.slug}`, fx.member)).json.note).toBe('')
  })

  it('멤버가 아닌 사람은 나갈 수 없다', async () => {
    expect((await call('POST', `/rooms/${fx.slug}/leave`, fx.outsider)).status).toBe(403)
  })
})

describe('개인 공간', () => {
  it('내 개인 공간은 나만 본다 (다른 팀원에게는 비어 보임)', async () => {
    await call('PUT', `/personal/${fx.slug}`, fx.owner, { note: '팀장 메모', files: [] })
    expect((await call('GET', `/personal/${fx.slug}`, fx.owner)).json.note).toBe('팀장 메모')
    expect((await call('GET', `/personal/${fx.slug}`, fx.member)).json.note).toBe('')
  })
})
