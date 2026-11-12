/**
 * 개인 공간: 제목을 단 노트 여러 개 (서버 저장·검사, 예전 한 개짜리 노트와의 호환)
 * SQLite·Postgres(PGlite) 두 번 돈다 (vitest.workspace.ts).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { makeApi, register, startServers, type TestServers } from '../helpers/server'

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

async function myBoard() {
  n++
  const t = await register(call, `pn_${n}`)
  const slug = (await call('POST', '/rooms', t, { name: `노트${n}` })).json.room.slug as string
  return { t, slug }
}

const note = (id: string, title: string, text: string, updatedAt = 1) => ({ id, title, text, updatedAt })

describe('개인 노트 여러 개', () => {
  it('제목·본문이 있는 노트 여러 개를 순서대로 저장하고 불러온다', async () => {
    const { t, slug } = await myBoard()
    const notes = [note('a', '회의록', '첫 회의'), note('b', '할 일', '- 자료 조사\n- 발표 준비'), note('c', '', '')]
    expect((await call('PUT', `/personal/${slug}`, t, { notes, files: [] })).status).toBe(200)
    const got = (await call('GET', `/personal/${slug}`, t)).json
    expect(got.notes).toEqual(notes)
    expect(got.note).toBe('')
  })

  it('처음 보는 보드는 빈 목록', async () => {
    const { t, slug } = await myBoard()
    expect((await call('GET', `/personal/${slug}`, t)).json).toEqual({ note: '', notes: [], files: [] })
  })

  it('예전 한 개짜리 노트는 "개인 노트" 라는 첫 노트로 보이고, 여러 노트로 저장하면 사라진다', async () => {
    const { t, slug } = await myBoard()
    await call('PUT', `/personal/${slug}`, t, { note: '예전 메모', files: [] })
    const legacy = (await call('GET', `/personal/${slug}`, t)).json.notes
    expect(legacy).toHaveLength(1)
    expect(legacy[0]).toMatchObject({ id: 'note-legacy', title: '개인 노트', text: '예전 메모' })

    // 모두 지운 상태로 저장해도 예전 노트가 되살아나지 않는다
    await call('PUT', `/personal/${slug}`, t, { notes: [], files: [] })
    expect((await call('GET', `/personal/${slug}`, t)).json.notes).toEqual([])
  })

  it('모양이 틀린 항목·같은 id 는 빼고, 제목·개수는 상한까지만', async () => {
    const { t, slug } = await myBoard()
    const many = Array.from({ length: 60 }, (_, i) => note(`n${i}`, 'x'.repeat(150), `본문${i}`))
    const notes = [
      'not-an-object',
      { title: 'id 없음', text: '' },
      { id: 'dup', title: '첫째', text: '1' },
      { id: 'dup', title: '둘째', text: '2' },
      { id: 'weird', title: 123, text: { a: 1 } },
      ...many,
    ]
    expect((await call('PUT', `/personal/${slug}`, t, { notes, files: [] })).status).toBe(200)
    const got = (await call('GET', `/personal/${slug}`, t)).json.notes as { id: string; title: string; text: string }[]
    expect(got).toHaveLength(50)
    expect(got[0]).toMatchObject({ id: 'dup', title: '첫째' })
    expect(got.filter((x) => x.id === 'dup')).toHaveLength(1)
    expect(got[1]).toMatchObject({ id: 'weird', title: '', text: '' })
    expect(got[2].title).toHaveLength(100)
  })

  it('NUL 문자가 섞여도 저장된다 (Postgres 는 TEXT 에 NUL 을 못 넣음)', async () => {
    const { t, slug } = await myBoard()
    const res = await call('PUT', `/personal/${slug}`, t, { notes: [note('z', '제\u0000목', '본\u0000문')], files: [] })
    expect(res.status).toBe(200)
    expect((await call('GET', `/personal/${slug}`, t)).json.notes[0]).toMatchObject({ title: '제목', text: '본문' })
  })

  it('다른 팀원의 노트는 보이지 않는다', async () => {
    const { t, slug } = await myBoard()
    const other = await register(call, `pn_other_${n}`)
    await call('POST', `/rooms/${slug}/members`, t, { username: `pn_other_${n}` })
    await call('POST', `/rooms/${slug}/accept`, other)
    await call('PUT', `/personal/${slug}`, t, { notes: [note('s', '비밀', '나만')], files: [] })
    expect((await call('GET', `/personal/${slug}`, other)).json.notes).toEqual([])
  })
})
