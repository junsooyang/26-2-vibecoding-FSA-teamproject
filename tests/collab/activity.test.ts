/**
 * 변경 기록 테스트 (src/collab/activity.ts 의 실제 코드 사용).
 */
import * as Y from 'yjs'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  COALESCE_MS,
  MAX_ACTIVITY,
  describeCalendar,
  describeEdge,
  describeNodeAdd,
  describeNodeUpdate,
  draftsFromMapChanges,
  recordActivity,
  summarizeContributions,
  type ActivityEntry,
} from '../../src/collab/activity'
import type { BoardNode, CalendarEvent } from '../../src/collab/yjs'

const wbs = (patch: Record<string, unknown> = {}, pos = { x: 0, y: 0 }): BoardNode => ({
  id: 'w1',
  position: pos,
  data: {
    kind: 'wbs',
    label: '보고서',
    assignee: '',
    status: 'todo',
    progress: 0,
    ...patch,
  },
})

describe('변경 설명', () => {
  it('상태·진행률·담당자·마감일 변경을 한 줄로 설명한다', () => {
    const d = describeNodeUpdate(
      wbs(),
      wbs({ status: 'doing', progress: 40, assignee: '철수', due: '2026-11-10' }),
    )
    expect(d?.kind).toBe('edit')
    expect(d?.detail).toContain('상태 할 일 → 진행 중')
    expect(d?.detail).toContain('진행률 0% → 40%')
    expect(d?.detail).toContain('담당자 없음 → 철수')
    expect(d?.detail).toContain('마감일 없음 → 2026-11-10')
    expect(d?.targetLabel).toBe('보고서')
  })

  it('위치만 바뀌면 이동, 아무것도 안 바뀌면 기록하지 않는다', () => {
    expect(describeNodeUpdate(wbs(), wbs({}, { x: 10, y: 0 }))?.kind).toBe('move')
    expect(describeNodeUpdate(wbs(), wbs())).toBeNull()
    expect(describeNodeUpdate(wbs(), wbs({ collapsed: true }))).toBeNull() // 접기는 기록 안 함
  })

  it('댓글·투표는 별도 종류로', () => {
    const c = describeNodeUpdate(wbs(), wbs({ comments: [{ id: 'c1', text: 'hi' }] }))
    expect(c).toMatchObject({ kind: 'comment', detail: '댓글 작성' })
    const v = describeNodeUpdate(wbs(), wbs({ votes: ['u1'] }))
    expect(v).toMatchObject({ kind: 'vote', detail: '투표' })
  })

  it('아이디어 → WBS 승격', () => {
    const idea: BoardNode = { id: 'w1', position: { x: 0, y: 0 }, data: { label: '아이디어' } }
    expect(describeNodeUpdate(idea, wbs())?.detail).toBe('아이디어를 WBS 작업으로 전환')
  })

  it('추가 / 연결 / 일정', () => {
    expect(describeNodeAdd(wbs()).detail).toBe('WBS 작업 추가')
    const nodes: Record<string, BoardNode> = {
      a: { id: 'a', position: { x: 0, y: 0 }, data: { label: '기획' } },
      b: { id: 'b', position: { x: 0, y: 0 }, data: { label: '개발' } },
    }
    const e = describeEdge({ id: 'e', source: 'a', target: 'b' }, true, (id) => nodes[id])
    expect(e).toMatchObject({ kind: 'connect', targetLabel: '기획 → 개발', targetId: 'b' })

    const ev: CalendarEvent = {
      id: 'c',
      date: '2026-11-10',
      text: '발표',
      time: '14:00',
      done: false,
      createdBy: 'u',
      createdAt: 0,
    }
    expect(describeCalendar(undefined, ev)?.detail).toBe('일정 추가')
    expect(describeCalendar(ev, { ...ev, done: true })?.detail).toBe('일정 완료')
    expect(describeCalendar(ev, ev)).toBeNull()
    expect(describeCalendar(ev, undefined)?.targetLabel).toBe('발표 (2026-11-10 14:00)')
  })
})

describe('기록 남기기', () => {
  let doc: Y.Doc
  let arr: Y.Array<ActivityEntry>
  const me = { username: 'chulsoo', name: '철수' }

  beforeEach(() => {
    doc = new Y.Doc()
    arr = doc.getArray<ActivityEntry>('activity')
  })

  const draft = (targetId = 'n1', kind: ActivityEntry['kind'] = 'move') => ({
    kind,
    targetType: 'node' as const,
    targetId,
    targetLabel: '노드',
    detail: '위치 이동',
  })

  it('같은 사람·대상·종류를 2분 안에 반복하면 한 줄로 묶는다', () => {
    recordActivity(doc, arr, [draft()], me, 1000)
    recordActivity(doc, arr, [draft()], me, 2000)
    recordActivity(doc, arr, [draft()], me, 3000)
    expect(arr.length).toBe(1)
    expect(arr.get(0)).toMatchObject({ count: 3, firstAt: 1000, at: 3000, username: 'chulsoo' })
  })

  it('시간이 지나거나 대상·사람이 다르면 따로 남긴다', () => {
    recordActivity(doc, arr, [draft()], me, 1000)
    recordActivity(doc, arr, [draft()], me, 1000 + COALESCE_MS + 1)
    recordActivity(doc, arr, [draft('n2')], me, 1000 + COALESCE_MS + 2)
    recordActivity(doc, arr, [draft('n2')], { username: 'younghee', name: '영희' }, 1000 + COALESCE_MS + 3)
    expect(arr.length).toBe(4)
  })

  it(`최근 ${MAX_ACTIVITY}개까지만 보관한다`, () => {
    for (let i = 0; i < MAX_ACTIVITY + 20; i++) {
      recordActivity(doc, arr, [draft(`n${i}`, 'add')], me, i)
    }
    expect(arr.length).toBe(MAX_ACTIVITY)
    expect(arr.get(0).targetId).toBe('n20') // 오래된 것부터 지워짐
  })

  it('username 이 없으면 기록하지 않는다', () => {
    recordActivity(doc, arr, [draft()], { username: '', name: '' }, 1)
    expect(arr.length).toBe(0)
  })

  it('Y.Map 변경 이벤트에서 기록 초안을 만든다 (내 변경만 받아서 사용)', () => {
    const nodes = doc.getMap<BoardNode>('nodes')
    const seen: ReturnType<typeof draftsFromMapChanges<BoardNode>>[] = []
    nodes.observe((event, tx) => {
      if (!tx.local) return
      seen.push(
        draftsFromMapChanges<BoardNode>(
          event.changes.keys,
          (k) => nodes.get(k),
          (o, nn) => (!o && nn ? describeNodeAdd(nn) : o && nn ? describeNodeUpdate(o, nn) : null),
        ),
      )
    })
    nodes.set('w1', wbs())
    nodes.set('w1', wbs({ status: 'done', progress: 100 }))
    expect(seen.map((d) => d[0]?.kind)).toEqual(['add', 'edit'])

    // 원격(다른 팀원) 변경은 local=false 라 기록하지 않는다
    const remote = new Y.Doc()
    remote.getMap<BoardNode>('nodes').set('x', wbs())
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote), 'remote')
    expect(seen.length).toBe(2)
  })
})

describe('기여도 요약', () => {
  it('사람별로 줄 수와 종류별 수를 센다', () => {
    const e = (username: string, kind: ActivityEntry['kind'], at: number): ActivityEntry => ({
      id: `${username}-${at}`,
      at,
      firstAt: at,
      username,
      name: username,
      kind,
      targetType: 'node',
      targetId: 'x',
      targetLabel: 'x',
      detail: '',
      count: 5, // 묶인 줄도 1건으로 센다
    })
    const s = summarizeContributions([e('a', 'add', 1), e('a', 'edit', 2), e('b', 'delete', 3)])
    expect(s[0]).toMatchObject({ username: 'a', total: 2, byKind: { add: 1, edit: 1 } })
    expect(s[1]).toMatchObject({ username: 'b', total: 1 })
  })
})
