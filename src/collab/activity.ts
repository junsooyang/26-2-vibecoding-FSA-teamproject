/**
 * 변경 기록(누가 무엇을 바꿨는지).
 *
 * - 각 브라우저가 "내가 한 변경"(로컬 transaction)만 보고 기록을 남긴다. 다른 팀원의 변경은
 *   그 팀원의 브라우저가 남기므로 같은 변경이 두 번 기록되지 않는다.
 * - 기록은 보드 공유 문서의 activity 배열에 저장되어 모든 팀원이 보고, 서버 재시작 후에도 남는다.
 * - 드래그처럼 짧은 시간에 반복되는 변경은 한 줄로 묶는다. (같은 사람·같은 대상·같은 종류, 2분 이내)
 * - 최근 MAX_ACTIVITY 개까지만 보관한다.
 *
 * 이 파일은 브라우저 전용 코드를 쓰지 않아 자동 테스트에서 그대로 불러 쓸 수 있다.
 */
import type * as Y from 'yjs'
import type { BoardEdge, BoardNode, CalendarEvent } from './yjs'

export type ActivityKind =
  | 'add'
  | 'edit'
  | 'move'
  | 'delete'
  | 'connect'
  | 'disconnect'
  | 'comment'
  | 'vote'
  | 'calendar'

export interface ActivityEntry {
  id: string
  /** 마지막으로 기록된 시각(ms) */
  at: number
  /** 처음 기록된 시각(ms) — 묶인 경우 at 과 다르다 */
  firstAt: number
  /** 한 사람 username */
  username: string
  /** 한 사람 표시 이름 */
  name: string
  kind: ActivityKind
  /** 대상 종류 */
  targetType: 'node' | 'edge' | 'calendar'
  /** 대상 id (노드 id 등) — 기록에서 대상으로 이동할 때 사용 */
  targetId: string
  /** 대상 이름 (삭제된 뒤에도 보이도록 기록 당시 이름을 저장) */
  targetLabel: string
  /** 사람이 읽는 설명 */
  detail: string
  /** 묶인 횟수 */
  count: number
}

/** 기록 초안 (사람·시각은 recordActivity 가 채운다) */
export type ActivityDraft = Pick<
  ActivityEntry,
  'kind' | 'targetType' | 'targetId' | 'targetLabel' | 'detail'
>

export const MAX_ACTIVITY = 500
export const COALESCE_MS = 2 * 60 * 1000
/** 묶을 대상을 찾을 때 뒤에서부터 살펴볼 개수 */
const COALESCE_LOOKBACK = 30

const STATUS_LABEL: Record<string, string> = { todo: '할 일', doing: '진행 중', done: '완료' }

export const KIND_LABEL: Record<ActivityKind, string> = {
  add: '추가',
  edit: '수정',
  move: '이동',
  delete: '삭제',
  connect: '연결',
  disconnect: '연결 해제',
  comment: '댓글',
  vote: '투표',
  calendar: '일정',
}

type AnyData = Record<string, unknown>

/** 노드 종류 이름 */
export function nodeTypeName(node: BoardNode | undefined): string {
  const kind = (node?.data as AnyData | undefined)?.kind
  if (kind === 'wbs') return 'WBS 작업'
  if (kind === 'sticky') return '메모'
  if (kind === 'image') return '사진'
  return '아이디어'
}

/** 기록에 보여 줄 노드 이름 (짧게) */
export function nodeLabel(node: BoardNode | undefined): string {
  if (!node) return '(알 수 없는 노드)'
  const d = (node.data ?? {}) as AnyData
  const raw = String(d.label || d.title || d.text || '').trim()
  const short = raw.length > 30 ? `${raw.slice(0, 30)}…` : raw
  return short || `(제목 없는 ${nodeTypeName(node)})`
}

const len = (v: unknown) => (Array.isArray(v) ? v.length : 0)
const str = (v: unknown) => (v === undefined || v === null ? '' : String(v))
const show = (v: unknown) => str(v) || '없음'

/** 체크항목 완료 개수 */
function doneCount(v: unknown) {
  return Array.isArray(v) ? v.filter((c) => (c as { done?: boolean })?.done).length : 0
}

/** 댓글 목록에서 내용이 바뀐 것이 있는지 (개수는 같을 때) */
function commentsEdited(a: unknown, b: unknown) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false
  const before = new Map(a.map((c) => [(c as { id: string }).id, (c as { text: string }).text]))
  return b.some((c) => {
    const old = before.get((c as { id: string }).id)
    return old !== undefined && old !== (c as { text: string }).text
  })
}

/**
 * 노드 하나가 바뀐 내용을 설명한다. 기록할 만한 변경이 없으면 null.
 * (위치만 바뀌면 move, 댓글/투표만 바뀌면 comment/vote, 그 밖의 내용 변경은 edit)
 */
export function describeNodeUpdate(oldNode: BoardNode, newNode: BoardNode): ActivityDraft | null {
  const a = (oldNode.data ?? {}) as AnyData
  const b = (newNode.data ?? {}) as AnyData
  const base = {
    targetType: 'node' as const,
    targetId: newNode.id,
    targetLabel: nodeLabel(newNode),
  }

  // 아이디어/메모 → WBS 작업 승격
  if (a.kind !== 'wbs' && b.kind === 'wbs') {
    return { ...base, kind: 'edit', detail: `${nodeTypeName(oldNode)}를 WBS 작업으로 전환` }
  }

  const parts: string[] = []
  if (str(a.label) !== str(b.label) || str(a.text) !== str(b.text) || str(a.title) !== str(b.title)) {
    parts.push('내용 수정')
  }
  if (a.status !== b.status && b.status !== undefined) {
    parts.push(`상태 ${STATUS_LABEL[str(a.status)] ?? show(a.status)} → ${STATUS_LABEL[str(b.status)] ?? show(b.status)}`)
  }
  if (Number(a.progress ?? 0) !== Number(b.progress ?? 0) && b.progress !== undefined) {
    parts.push(`진행률 ${Number(a.progress) || 0}% → ${Number(b.progress) || 0}%`)
  }
  if (str(a.assignee) !== str(b.assignee)) parts.push(`담당자 ${show(a.assignee)} → ${show(b.assignee)}`)
  if (str(a.start) !== str(b.start)) parts.push(`시작일 ${show(a.start)} → ${show(b.start)}`)
  if (str(a.due) !== str(b.due)) parts.push(`마감일 ${show(a.due)} → ${show(b.due)}`)
  if (len(a.checklist) !== len(b.checklist)) {
    parts.push(len(b.checklist) > len(a.checklist) ? '체크항목 추가' : '체크항목 삭제')
  } else if (doneCount(a.checklist) !== doneCount(b.checklist)) {
    parts.push(`체크항목 완료 ${doneCount(b.checklist)}/${len(b.checklist)}`)
  }
  if (len(a.attachments) !== len(b.attachments)) {
    parts.push(len(b.attachments) > len(a.attachments) ? '자료 첨부' : '첨부 삭제')
  }
  if (str(a.color) !== str(b.color)) parts.push('색상 변경')
  if (str(a.src) !== str(b.src)) parts.push('사진 교체')
  if (a.w !== b.w || a.h !== b.h) parts.push('크기 조절')

  if (parts.length > 0) return { ...base, kind: 'edit', detail: parts.join(', ') }

  // 댓글 / 투표 (내용 변경이 없을 때만 별도 종류로)
  if (len(b.comments) > len(a.comments)) return { ...base, kind: 'comment', detail: '댓글 작성' }
  if (len(b.comments) < len(a.comments)) return { ...base, kind: 'comment', detail: '댓글 삭제' }
  if (commentsEdited(a.comments, b.comments)) return { ...base, kind: 'comment', detail: '댓글 수정' }
  if (len(b.votes) > len(a.votes)) return { ...base, kind: 'vote', detail: '투표' }
  if (len(b.votes) < len(a.votes)) return { ...base, kind: 'vote', detail: '투표 취소' }

  const ap = oldNode.position
  const bp = newNode.position
  if (ap && bp && (ap.x !== bp.x || ap.y !== bp.y)) {
    return { ...base, kind: 'move', detail: '위치 이동' }
  }
  // 그 밖(접기/펼치기, 드래그 중 표시 등)은 기록하지 않는다
  return null
}

export function describeNodeAdd(node: BoardNode): ActivityDraft {
  return {
    kind: 'add',
    targetType: 'node',
    targetId: node.id,
    targetLabel: nodeLabel(node),
    detail: `${nodeTypeName(node)} 추가`,
  }
}

export function describeNodeDelete(node: BoardNode): ActivityDraft {
  return {
    kind: 'delete',
    targetType: 'node',
    targetId: node.id,
    targetLabel: nodeLabel(node),
    detail: `${nodeTypeName(node)} 삭제`,
  }
}

/** 연결선 추가/삭제 설명. getNode 로 양 끝 노드 이름을 찾는다. */
export function describeEdge(
  edge: BoardEdge,
  added: boolean,
  getNode: (id: string) => BoardNode | undefined,
): ActivityDraft {
  const label = `${nodeLabel(getNode(edge.source))} → ${nodeLabel(getNode(edge.target))}`
  return {
    kind: added ? 'connect' : 'disconnect',
    targetType: 'edge',
    // 연결선은 지워지면 이동할 곳이 없으므로 도착 노드로 이동한다
    targetId: edge.target,
    targetLabel: label,
    detail: added ? '노드 연결' : '연결 해제',
  }
}

/** 캘린더 일정 변경 설명. 기록할 만한 변경이 없으면 null. */
export function describeCalendar(
  oldEv: CalendarEvent | undefined,
  newEv: CalendarEvent | undefined,
): ActivityDraft | null {
  const ev = newEv ?? oldEv
  if (!ev) return null
  const base = {
    kind: 'calendar' as const,
    targetType: 'calendar' as const,
    targetId: ev.id,
    targetLabel: `${ev.text} (${ev.date}${ev.time ? ` ${ev.time}` : ''})`,
  }
  if (!oldEv) return { ...base, detail: '일정 추가' }
  if (!newEv) return { ...base, detail: '일정 삭제' }
  if (oldEv.done !== newEv.done) return { ...base, detail: newEv.done ? '일정 완료' : '일정 완료 해제' }
  if (
    oldEv.text !== newEv.text ||
    oldEv.time !== newEv.time ||
    oldEv.assignee !== newEv.assignee ||
    oldEv.date !== newEv.date
  ) {
    return { ...base, detail: '일정 수정' }
  }
  return null
}

/**
 * Y.Map 변경 이벤트(키별 add/update/delete)를 기록 초안 목록으로 바꾼다.
 *  - describe(oldValue, newValue): 변경 하나를 설명 (없으면 null)
 */
export function draftsFromMapChanges<T>(
  keys: Map<string, { action: 'add' | 'update' | 'delete'; oldValue: unknown }>,
  getCurrent: (key: string) => T | undefined,
  describe: (oldValue: T | undefined, newValue: T | undefined) => ActivityDraft | null,
): ActivityDraft[] {
  const drafts: ActivityDraft[] = []
  keys.forEach((change, key) => {
    const oldValue = change.action === 'add' ? undefined : (change.oldValue as T)
    const newValue = change.action === 'delete' ? undefined : getCurrent(key)
    const d = describe(oldValue, newValue)
    if (d) drafts.push(d)
  })
  return drafts
}

/**
 * 기록 초안을 activity 배열에 남긴다.
 * 같은 사람이 같은 대상에 같은 종류의 변경을 COALESCE_MS 안에 다시 하면 새 줄을 만들지 않고
 * 기존 줄을 갱신(맨 뒤로 옮기고 횟수 +1)한다. MAX_ACTIVITY 개를 넘으면 오래된 것부터 지운다.
 */
export function recordActivity(
  doc: Y.Doc,
  activity: Y.Array<ActivityEntry>,
  drafts: ActivityDraft[],
  actor: { username: string; name: string },
  now: number = Date.now(),
) {
  if (drafts.length === 0 || !actor.username) return
  doc.transact(() => {
    for (const draft of drafts) {
      const list = activity.toArray()
      let mergeIdx = -1
      for (let i = list.length - 1; i >= Math.max(0, list.length - COALESCE_LOOKBACK); i--) {
        const e = list[i]
        if (
          e &&
          e.username === actor.username &&
          e.targetId === draft.targetId &&
          e.kind === draft.kind &&
          now - e.at <= COALESCE_MS
        ) {
          mergeIdx = i
          break
        }
      }
      if (mergeIdx >= 0) {
        const prev = list[mergeIdx]
        const merged: ActivityEntry = {
          ...prev,
          ...draft,
          at: now,
          count: (prev.count || 1) + 1,
        }
        activity.delete(mergeIdx, 1)
        activity.push([merged])
      } else {
        activity.push([
          {
            ...draft,
            id: `act-${now}-${Math.floor(Math.random() * 100000)}`,
            at: now,
            firstAt: now,
            username: actor.username,
            name: actor.name,
            count: 1,
          },
        ])
      }
    }
    const overflow = activity.length - MAX_ACTIVITY
    if (overflow > 0) activity.delete(0, overflow)
  })
}

/** 사람별 기여도 요약 (기록 개수 기준) */
export interface ContributionSummary {
  username: string
  name: string
  total: number
  byKind: Partial<Record<ActivityKind, number>>
  lastAt: number
}

export function summarizeContributions(entries: ActivityEntry[]): ContributionSummary[] {
  const map = new Map<string, ContributionSummary>()
  for (const e of entries) {
    const s = map.get(e.username) ?? {
      username: e.username,
      name: e.name,
      total: 0,
      byKind: {},
      lastAt: 0,
    }
    // 묶인 줄은 한 번의 작업으로 센다 (드래그 여러 번 = 이동 1회)
    s.total += 1
    s.byKind[e.kind] = (s.byKind[e.kind] ?? 0) + 1
    if (e.at >= s.lastAt) {
      s.lastAt = e.at
      s.name = e.name
    }
    map.set(e.username, s)
  }
  return Array.from(map.values()).sort((a, b) => b.total - a.total)
}
