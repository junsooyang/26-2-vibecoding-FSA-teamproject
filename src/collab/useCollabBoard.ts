import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { addEdge, type Connection, type EdgeChange, type NodeChange } from '@xyflow/react'
import {
  connectRoom,
  isWbsData,
  type Attachment,
  type BoardEdge,
  type BoardNode,
  type CalendarEvent,
  type ChatMessage,
  type ChecklistItem,
  type CollabHandle,
  type Comment,
  type EdgeStyle,
  type ImageNodeData,
  type Poll,
  type PollOption,
  type StickyColor,
  type StickyNodeData,
  type WbsNodeData,
} from './yjs'
import { layoutNodes, type LayoutDirection } from './layout'
import { UndoManager } from 'yjs'
import {
  applyEdgeChangesToBoard,
  applyNodeChangesToBoard,
  mergeNodeUi,
  stripUi,
  type NodeUi,
} from './boardChanges'
import {
  describeCalendar,
  describeEdge,
  describeNodeAdd,
  describeNodeDelete,
  describeNodeUpdate,
  draftsFromMapChanges,
  recordActivity,
  type ActivityDraft,
  type ActivityEntry,
} from './activity'
import type * as Y from 'yjs'

/** 'HH:MM' 형식만 받는다. 형식이 아니면 빈 값 (시간 없는 일정) */
function normalizeTime(time: string | undefined): string {
  const t = time?.trim() ?? ''
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(t) ? t : ''
}

export interface AwarenessUser {
  name: string
  color: string
}

/** 다른 참여자의 실시간 커서 (flow 좌표계) */
export interface RemoteCursor {
  clientId: number
  name: string
  color: string
  x: number
  y: number
}

/**
 * React Flow <-> Yjs 를 연결하는 핵심 훅.
 *
 * 흐름:
 *  1. Yjs(Y.Map) 가 "진짜 상태(source of truth)" 이다.
 *  2. Yjs 가 바뀌면 observe 콜백이 React state 로 밀어 넣는다. (원격 변경 반영)
 *  3. 사용자가 React Flow 를 조작하면(드래그/연결/추가) Yjs 에 써넣는다. (로컬 변경 전파)
 */
export function useCollabBoard(
  roomName: string,
  user: AwarenessUser,
  /** 서버가 접근을 끊었을 때 호출 (deleted: 보드 삭제됨, forbidden: 멤버에서 제외됨) */
  onAccessLost?: (reason: 'deleted' | 'forbidden') => void,
  /** 변경 기록에 남길 내 username (기여도 집계 기준) */
  username = '',
) {
  const handleRef = useRef<CollabHandle | null>(null)
  // 최신 콜백을 ref 로 들고 있어 재연결 없이도 항상 최신 함수를 호출한다.
  const accessLostRef = useRef(onAccessLost)
  accessLostRef.current = onAccessLost
  // 변경 기록용 "나" (재연결 없이 최신 값 사용)
  const actorRef = useRef({ username, name: user.name })
  actorRef.current = { username, name: user.name }
  const [activity, setActivity] = useState<ActivityEntry[]>([])
  // 공유 문서(Yjs)에 있는 그대로의 노드/연결선
  const [rawNodes, setNodes] = useState<BoardNode[]>([])
  const [rawEdges, setEdges] = useState<BoardEdge[]>([])
  // 내 화면에만 두는 선택/크기 상태 (바뀌면 uiVersion 을 올려 다시 그린다)
  const nodeUiRef = useRef(new Map<string, NodeUi>())
  const edgeSelectedRef = useRef(new Map<string, boolean>())
  const [uiVersion, setUiVersion] = useState(0)
  // React Flow 와 화면에 넘길 노드/연결선 = 공유 데이터 + 내 화면 상태
  const nodes = useMemo(
    () => rawNodes.map((n) => mergeNodeUi(n, nodeUiRef.current.get(n.id))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rawNodes, uiVersion],
  )
  const edges = useMemo(
    () => rawEdges.map((e) => ({ ...e, selected: edgeSelectedRef.current.get(e.id) ?? false })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rawEdges, uiVersion],
  )
  const [peers, setPeers] = useState<AwarenessUser[]>([])
  const [cursors, setCursors] = useState<RemoteCursor[]>([])
  const [polls, setPolls] = useState<Poll[]>([])
  const [chat, setChat] = useState<ChatMessage[]>([])
  const [calendar, setCalendar] = useState<CalendarEvent[]>([])
  const [edgeStyle, setEdgeStyleState] = useState<EdgeStyle>({ color: '#6366f1', width: 2.5 })
  const [connected, setConnected] = useState(false)
  // 서버의 보드 내용을 처음 다 받았는지 (마감 알림 등 "접속 직후" 판단에 사용)
  const [synced, setSynced] = useState(false)
  const undoManagerRef = useRef<UndoManager | null>(null)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)

  // 방 연결 + Yjs 관찰자 등록
  useEffect(() => {
    const handle = connectRoom(roomName, user)
    handleRef.current = handle

    // 실행 취소 관리자: 노드와 연결선만 대상. 기본적으로 origin 이 null 인 "내 변경"만 기록하므로
    // 서버에서 받은 다른 팀원의 변경(origin = provider)은 되돌리지 않는다.
    // 0.5초 안에 이어진 변경(드래그 중 위치 이동, 노드 삭제 + 연결선 삭제 등)은 한 번에 되돌린다.
    const undoManager = new UndoManager([handle.nodes, handle.edges], { captureTimeout: 500 })
    undoManagerRef.current = undoManager
    const syncUndoState = () => {
      setCanUndo(undoManager.undoStack.length > 0)
      setCanRedo(undoManager.redoStack.length > 0)
    }
    undoManager.on('stack-item-added', syncUndoState)
    undoManager.on('stack-item-popped', syncUndoState)
    undoManager.on('stack-cleared', syncUndoState)
    syncUndoState()

    setSynced(handle.provider.synced)
    handle.provider.on('sync', (isSynced: boolean) => setSynced(isSynced))

    const syncNodes = () => setNodes(Array.from(handle.nodes.values()))
    const syncEdges = () => setEdges(Array.from(handle.edges.values()))
    const syncPoll = () =>
      setPolls(
        Array.from(handle.poll.values())
          // 옛 구조/깨진 데이터 방어: 필수 필드가 있는 것만
          .filter((p): p is Poll => !!p && Array.isArray((p as Poll).options) && typeof (p as Poll).id === 'string')
          .map((p) => ({ ...p, deadline: typeof p.deadline === 'number' ? p.deadline : 0 }))
          .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)),
      )
    const syncChat = () =>
      setChat(
        handle.chat
          .toArray()
          .filter((m): m is ChatMessage => !!m && typeof (m as ChatMessage).id === 'string'),
      )
    const syncCalendar = () =>
      setCalendar(
        Array.from(handle.calendar.values())
          .filter(
            (e): e is CalendarEvent =>
              !!e && typeof (e as CalendarEvent).id === 'string' && typeof (e as CalendarEvent).date === 'string',
          )
          // 날짜 → 시각(시간 없는 일정은 그날 맨 앞) → 만든 순서
          .sort(
            (a, b) =>
              a.date.localeCompare(b.date) ||
              (a.time ?? '').localeCompare(b.time ?? '') ||
              a.createdAt - b.createdAt,
          ),
      )
    const syncMeta = () => {
      const es = handle.meta.get('edgeStyle') as Partial<EdgeStyle> | undefined
      if (es && typeof es.color === 'string' && typeof es.width === 'number') {
        setEdgeStyleState({ color: es.color, width: es.width })
      }
    }

    handle.nodes.observe(syncNodes)
    handle.edges.observe(syncEdges)
    handle.poll.observe(syncPoll)
    handle.chat.observe(syncChat)
    handle.calendar.observe(syncCalendar)
    handle.meta.observe(syncMeta)

    // --- 변경 기록 ---
    // 내 브라우저에서 일어난 변경(tx.local)만 기록한다. 다른 팀원의 변경은 그 팀원의 브라우저가 기록한다.
    // 실행 취소/다시 실행으로 바뀐 것도 "내가 한 변경"이라 기록되며, 설명 뒤에 표시를 붙인다.
    const syncActivity = () =>
      setActivity(
        handle.activity
          .toArray()
          .filter((e): e is ActivityEntry => !!e && typeof (e as ActivityEntry).id === 'string'),
      )
    const withUndoMark = (drafts: ActivityDraft[], tx: Y.Transaction) =>
      tx.origin === undoManager
        ? drafts.map((d) => ({ ...d, detail: `${d.detail} (실행 취소/다시 실행)` }))
        : drafts
    const logNodes = (event: Y.YMapEvent<BoardNode>, tx: Y.Transaction) => {
      if (!tx.local) return
      const drafts = draftsFromMapChanges<BoardNode>(
        event.changes.keys,
        (k) => handle.nodes.get(k),
        (oldNode, newNode) => {
          if (!oldNode && newNode) return describeNodeAdd(newNode)
          if (oldNode && !newNode) return describeNodeDelete(oldNode)
          if (oldNode && newNode) return describeNodeUpdate(oldNode, newNode)
          return null
        },
      )
      recordActivity(handle.doc, handle.activity, withUndoMark(drafts, tx), actorRef.current)
    }
    const logEdges = (event: Y.YMapEvent<BoardEdge>, tx: Y.Transaction) => {
      if (!tx.local) return
      const getNode = (id: string) => handle.nodes.get(id)
      const drafts = draftsFromMapChanges<BoardEdge>(
        event.changes.keys,
        (k) => handle.edges.get(k),
        (oldEdge, newEdge) => {
          if (!oldEdge && newEdge) return describeEdge(newEdge, true, getNode)
          if (oldEdge && !newEdge) return describeEdge(oldEdge, false, getNode)
          return null // 연결선 자체 수정은 기록하지 않음
        },
      )
      recordActivity(handle.doc, handle.activity, withUndoMark(drafts, tx), actorRef.current)
    }
    const logCalendar = (event: Y.YMapEvent<CalendarEvent>, tx: Y.Transaction) => {
      if (!tx.local) return
      const drafts = draftsFromMapChanges<CalendarEvent>(
        event.changes.keys,
        (k) => handle.calendar.get(k),
        describeCalendar,
      )
      recordActivity(handle.doc, handle.activity, drafts, actorRef.current)
    }
    handle.activity.observe(syncActivity)
    handle.nodes.observe(logNodes)
    handle.edges.observe(logEdges)
    handle.calendar.observe(logCalendar)
    syncActivity()
    // 초기 상태 반영
    syncNodes()
    syncEdges()
    syncPoll()
    syncChat()
    syncCalendar()
    syncMeta()

    handle.provider.on('status', (e: { status: string }) => {
      setConnected(e.status === 'connected')
    })

    // 서버가 보드 삭제(4404) / 권한 상실(4403)로 연결을 닫으면 재접속을 멈추고 알린다.
    handle.provider.on('connection-close', (event: CloseEvent | null) => {
      if (!event) return
      if (event.code === 4404 || event.code === 4403) {
        handle.provider.disconnect()
        accessLostRef.current?.(event.code === 4404 ? 'deleted' : 'forbidden')
      }
    })

    const myClientId = handle.awareness.clientID
    const syncAwareness = () => {
      const entries = Array.from(handle.awareness.getStates().entries())
      // 접속자 목록(자기 포함)
      setPeers(
        entries
          .map(([, s]) => (s as { user?: AwarenessUser }).user)
          .filter(Boolean) as AwarenessUser[],
      )
      // 원격 커서 목록(자기 자신 제외, 커서 좌표가 있는 참여자만)
      const remote: RemoteCursor[] = []
      for (const [clientId, state] of entries) {
        if (clientId === myClientId) continue
        const s = state as { user?: AwarenessUser; cursor?: { x: number; y: number } }
        if (s.user && s.cursor) {
          remote.push({
            clientId,
            name: s.user.name,
            color: s.user.color,
            x: s.cursor.x,
            y: s.cursor.y,
          })
        }
      }
      setCursors(remote)
    }
    handle.awareness.on('change', syncAwareness)
    syncAwareness()

    return () => {
      handle.nodes.unobserve(syncNodes)
      handle.edges.unobserve(syncEdges)
      handle.poll.unobserve(syncPoll)
      handle.chat.unobserve(syncChat)
      handle.calendar.unobserve(syncCalendar)
      handle.activity.unobserve(syncActivity)
      handle.nodes.unobserve(logNodes)
      handle.edges.unobserve(logEdges)
      handle.calendar.unobserve(logCalendar)
      handle.meta.unobserve(syncMeta)
      handle.awareness.off('change', syncAwareness)
      undoManager.destroy()
      undoManagerRef.current = null
      handle.destroy()
      handleRef.current = null
    }
    // user 는 최초 연결 시에만 사용. roomName 변경 시에만 재연결.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomName])

  // 마감 시각이 지난 투표를 자동 종료 (1초마다 점검).
  // deadline 이 지난 열린 투표가 하나라도 있으면 closed=true 로 기록한다.
  useEffect(() => {
    const hasPending = polls.some((p) => p && !p.closed && p.deadline > 0)
    if (!hasPending) return
    const tick = () => {
      const handle = handleRef.current
      if (!handle) return
      const now = Date.now()
      handle.doc.transact(() => {
        for (const p of handle.poll.values()) {
          if (p && !p.closed && p.deadline > 0 && now >= p.deadline) {
            handle.poll.set(p.id, { ...p, closed: true })
          }
        }
      })
    }
    tick() // 즉시 1회
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [polls])

  // --- 로컬 조작 -> Yjs 반영 ---

  // 선택/크기 측정은 내 화면 상태로, 이동/삭제/추가는 공유 문서로 (자세한 설명은 boardChanges.ts)
  const onNodesChange = useCallback((changes: NodeChange<BoardNode>[]) => {
    const handle = handleRef.current
    if (!handle) return
    const { uiChanged } = applyNodeChangesToBoard(
      handle.doc,
      handle.nodes,
      nodeUiRef.current,
      changes,
    )
    if (uiChanged) setUiVersion((v) => v + 1)
  }, [])

  const onEdgesChange = useCallback((changes: EdgeChange<BoardEdge>[]) => {
    const handle = handleRef.current
    if (!handle) return
    const { uiChanged } = applyEdgeChangesToBoard(
      handle.doc,
      handle.edges,
      edgeSelectedRef.current,
      changes,
    )
    if (uiChanged) setUiVersion((v) => v + 1)
  }, [])

  const onConnect = useCallback((connection: Connection) => {
    const handle = handleRef.current
    if (!handle) return
    const prev = Array.from(handle.edges.values())
    const prevIds = new Set(prev.map((e) => e.id))
    const next = addEdge(connection, prev)
    handle.doc.transact(() => {
      // 새로 생긴 연결선만 쓴다
      for (const e of next) {
        if (!prevIds.has(e.id)) handle.edges.set(e.id, e)
      }
    })
  }, [])

  // --- 실행 취소 / 다시 실행 (내 변경만, 노드·연결선 대상) ---
  const undo = useCallback(() => {
    undoManagerRef.current?.undo()
  }, [])
  const redo = useCallback(() => {
    undoManagerRef.current?.redo()
  }, [])

  /** 새 노드(아이디어) 추가 */
  const addNode = useCallback((label: string, position: { x: number; y: number }) => {
    const handle = handleRef.current
    if (!handle) return
    const id = `node-${Date.now()}-${Math.floor(Math.random() * 1000)}`
    const node: BoardNode = {
      id,
      position,
      data: { label, createdAt: Date.now() },
      type: 'default',
    }
    handle.nodes.set(id, node)
  }, [])

  /** 노드 라벨 수정 (일반 노드) */
  const renameNode = useCallback((id: string, label: string) => {
    const handle = handleRef.current
    if (!handle) return
    const existing = handle.nodes.get(id)
    if (!existing) return
    handle.nodes.set(id, { ...existing, data: { ...existing.data, label } })
  }, [])

  /** 새 WBS(작업) 노드 추가 */
  const addWbsNode = useCallback((position: { x: number; y: number }) => {
    const handle = handleRef.current
    if (!handle) return
    const id = `wbs-${Date.now()}-${Math.floor(Math.random() * 1000)}`
    const node: BoardNode = {
      id,
      position,
      type: 'wbs',
      data: {
        label: '새 작업',
        assignee: '',
        status: 'todo',
        progress: 0,
        kind: 'wbs',
        createdAt: Date.now(),
      },
    }
    handle.nodes.set(id, node)
    return id
  }, [])

  /** WBS 노드 필드 수정 (부분 업데이트) */
  const updateWbsNode = useCallback((id: string, patch: Partial<WbsNodeData>) => {
    const handle = handleRef.current
    if (!handle) return
    const existing = handle.nodes.get(id)
    if (!existing) return
    handle.nodes.set(id, {
      ...existing,
      data: { ...existing.data, ...patch } as BoardNode['data'],
    })
  }, [])

  /** 완료 여부 토글: done <-> todo. 완료 시 진행률 100, 해제 시 0 */
  const toggleWbsDone = useCallback((id: string) => {
    const handle = handleRef.current
    if (!handle) return
    const existing = handle.nodes.get(id)
    if (!existing || !isWbsData(existing.data)) return
    const nowDone = existing.data.status === 'done'
    const next = nowDone
      ? { status: 'todo' as const, progress: 0 }
      : { status: 'done' as const, progress: 100 }
    handle.nodes.set(id, { ...existing, data: { ...existing.data, ...next } })
  }, [])

  /** WBS 노드에 첨부(링크/파일) 추가 */
  const addAttachment = useCallback((id: string, attachment: Attachment) => {
    const handle = handleRef.current
    if (!handle) return
    const existing = handle.nodes.get(id)
    if (!existing || !isWbsData(existing.data)) return
    const list = existing.data.attachments ?? []
    handle.nodes.set(id, {
      ...existing,
      data: { ...existing.data, attachments: [...list, attachment] },
    })
  }, [])

  /** WBS 노드에서 첨부 삭제 */
  const removeAttachment = useCallback((id: string, attachmentId: string) => {
    const handle = handleRef.current
    if (!handle) return
    const existing = handle.nodes.get(id)
    if (!existing || !isWbsData(existing.data)) return
    const list = existing.data.attachments ?? []
    handle.nodes.set(id, {
      ...existing,
      data: { ...existing.data, attachments: list.filter((a) => a.id !== attachmentId) },
    })
  }, [])

  /** 내 커서 위치(flow 좌표)를 awareness 로 브로드캐스트. null 이면 커서 제거(화면 이탈). */
  const setCursor = useCallback((pos: { x: number; y: number } | null) => {
    const handle = handleRef.current
    if (!handle) return
    handle.awareness.setLocalStateField('cursor', pos)
  }, [])

  /** 자동 레이아웃(마인드맵 정렬): dagre 로 위치 재계산 후 Yjs 에 반영 → 모두에게 동기화 */
  const applyLayout = useCallback((direction: LayoutDirection = 'LR') => {
    const handle = handleRef.current
    if (!handle) return
    // 정렬에는 실제 렌더 크기가 필요하다. 크기 측정값은 내 화면 상태에 있으므로 합쳐서 넘긴다.
    const current = Array.from(handle.nodes.values()).map((n) =>
      mergeNodeUi(n, nodeUiRef.current.get(n.id)),
    )
    const currentEdges = Array.from(handle.edges.values())
    const laid = layoutNodes(current, currentEdges, direction)
    handle.doc.transact(() => {
      for (const n of laid) handle.nodes.set(n.id, stripUi(n))
    })
  }, [])

  /** 새 이미지(사진) 노드 추가 */
  const addImageNode = useCallback(
    (src: string, position: { x: number; y: number }, label = '') => {
      const handle = handleRef.current
      if (!handle) return
      const id = `img-${Date.now()}-${Math.floor(Math.random() * 1000)}`
      const node: BoardNode = {
        id,
        position,
        type: 'image',
        data: { label, src, width: 220, kind: 'image', createdAt: Date.now() },
      }
      handle.nodes.set(id, node)
      return id
    },
    [],
  )

  /** 이미지 노드 필드 수정 (캡션/너비 등) */
  const updateImageNode = useCallback((id: string, patch: Partial<ImageNodeData>) => {
    const handle = handleRef.current
    if (!handle) return
    const existing = handle.nodes.get(id)
    if (!existing) return
    handle.nodes.set(id, {
      ...existing,
      data: { ...existing.data, ...patch } as BoardNode['data'],
    })
  }, [])

  /**
   * 노드 병합(합치기): 드래그한 노드(sourceId)를 대상 노드(targetId) 아래로
   * 부모-자식 연결한다. 이미 연결돼 있으면 아무것도 하지 않는다.
   */
  const connectNodes = useCallback((sourceId: string, targetId: string) => {
    const handle = handleRef.current
    if (!handle || sourceId === targetId) return
    // 중복/역방향 엣지 방지
    for (const e of handle.edges.values()) {
      if (
        (e.source === targetId && e.target === sourceId) ||
        (e.source === sourceId && e.target === targetId)
      ) {
        return
      }
    }
    const id = `edge-${targetId}-${sourceId}`
    const edge: BoardEdge = { id, source: targetId, target: sourceId }
    handle.edges.set(id, edge)
  }, [])

  /**
   * 선택한 노드들(없으면 전체)을 격자(행렬)로 정렬한다.
   * 왼쪽 위부터 열(columns) 수만큼 채우며 등간격 배치. → 사진/텍스트 줄맞춤.
   */
  const alignGrid = useCallback((ids?: string[], columns = 4, gapX = 260, gapY = 200) => {
    const handle = handleRef.current
    if (!handle) return
    const all = Array.from(handle.nodes.values())
    const targets =
      ids && ids.length > 0 ? all.filter((n) => ids.includes(n.id)) : all
    if (targets.length === 0) return
    // 기준점: 대상 노드들의 최소 x,y (현재 위치 근처에서 정렬)
    const baseX = Math.min(...targets.map((n) => n.position.x))
    const baseY = Math.min(...targets.map((n) => n.position.y))
    handle.doc.transact(() => {
      targets.forEach((node, i) => {
        const col = i % columns
        const row = Math.floor(i / columns)
        handle.nodes.set(node.id, {
          ...node,
          position: { x: baseX + col * gapX, y: baseY + row * gapY },
        })
      })
    })
  }, [])

  /** 새 스티커(포스트잇) 메모 노드 추가 */
  const addStickyNode = useCallback(
    (position: { x: number; y: number }, color: StickyColor = 'yellow') => {
      const handle = handleRef.current
      if (!handle) return
      const id = `sticky-${Date.now()}-${Math.floor(Math.random() * 1000)}`
      const node: BoardNode = {
        id,
        position,
        type: 'sticky',
        data: { text: '', color, votes: [], kind: 'sticky', createdAt: Date.now() },
      }
      handle.nodes.set(id, node)
      return id
    },
    [],
  )

  /** 스티커 메모 필드 수정 (텍스트/색상) */
  const updateStickyNode = useCallback((id: string, patch: Partial<StickyNodeData>) => {
    const handle = handleRef.current
    if (!handle) return
    const existing = handle.nodes.get(id)
    if (!existing) return
    handle.nodes.set(id, { ...existing, data: { ...existing.data, ...patch } })
  }, [])

  /**
   * 노드 투표 토글(1인 1표). username 이 votes 배열에 있으면 제거, 없으면 추가.
   * WBS/스티커 등 votes 필드를 가진 노드에 공통 적용.
   */
  const toggleVote = useCallback((id: string, username: string) => {
    const handle = handleRef.current
    if (!handle || !username) return
    const existing = handle.nodes.get(id)
    if (!existing) return
    const data = existing.data as { votes?: string[] }
    const votes = data.votes ?? []
    const next = votes.includes(username)
      ? votes.filter((u) => u !== username)
      : [...votes, username]
    handle.nodes.set(id, { ...existing, data: { ...existing.data, votes: next } })
  }, [])

  /** 노드에 댓글(의견) 추가. 모든 노드 공통. */
  const addComment = useCallback(
    (id: string, comment: { author: string; authorUsername: string; text: string }) => {
      const handle = handleRef.current
      if (!handle) return
      const existing = handle.nodes.get(id)
      if (!existing) return
      const data = existing.data as { comments?: Comment[] }
      const list = data.comments ?? []
      const newComment: Comment = {
        id: `cmt-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        author: comment.author,
        authorUsername: comment.authorUsername,
        text: comment.text,
        at: Date.now(),
      }
      handle.nodes.set(id, {
        ...existing,
        data: { ...existing.data, comments: [...list, newComment] },
      })
    },
    [],
  )

  /** 노드 댓글 삭제 */
  const deleteComment = useCallback((id: string, commentId: string) => {
    const handle = handleRef.current
    if (!handle) return
    const existing = handle.nodes.get(id)
    if (!existing) return
    const data = existing.data as { comments?: Comment[] }
    const list = data.comments ?? []
    handle.nodes.set(id, {
      ...existing,
      data: { ...existing.data, comments: list.filter((c) => c.id !== commentId) },
    })
  }, [])

  /** 노드 댓글 수정 (본인 댓글만 — 권한 체크는 호출부에서) */
  const editComment = useCallback((id: string, commentId: string, text: string) => {
    const handle = handleRef.current
    if (!handle) return
    const existing = handle.nodes.get(id)
    if (!existing) return
    const data = existing.data as { comments?: Comment[] }
    const list = data.comments ?? []
    handle.nodes.set(id, {
      ...existing,
      data: {
        ...existing.data,
        comments: list.map((c) => (c.id === commentId ? { ...c, text } : c)),
      },
    })
  }, [])

  /** WBS 세부 체크항목 추가 */
  const addChecklistItem = useCallback((id: string, text: string) => {
    const handle = handleRef.current
    if (!handle) return
    const existing = handle.nodes.get(id)
    if (!existing || !isWbsData(existing.data)) return
    const list = existing.data.checklist ?? []
    const item: ChecklistItem = {
      id: `chk-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      text,
      done: false,
    }
    handle.nodes.set(id, {
      ...existing,
      data: { ...existing.data, checklist: [...list, item] },
    })
  }, [])

  /** WBS 세부 체크항목 완료 토글 */
  const toggleChecklistItem = useCallback((id: string, itemId: string) => {
    const handle = handleRef.current
    if (!handle) return
    const existing = handle.nodes.get(id)
    if (!existing || !isWbsData(existing.data)) return
    const list = existing.data.checklist ?? []
    handle.nodes.set(id, {
      ...existing,
      data: {
        ...existing.data,
        checklist: list.map((c) => (c.id === itemId ? { ...c, done: !c.done } : c)),
      },
    })
  }, [])

  /** WBS 세부 체크항목 삭제 */
  const removeChecklistItem = useCallback((id: string, itemId: string) => {
    const handle = handleRef.current
    if (!handle) return
    const existing = handle.nodes.get(id)
    if (!existing || !isWbsData(existing.data)) return
    const list = existing.data.checklist ?? []
    handle.nodes.set(id, {
      ...existing,
      data: { ...existing.data, checklist: list.filter((c) => c.id !== itemId) },
    })
  }, [])

  /**
   * 아이디어/스티커 노드를 WBS 작업 노드로 "승격"한다.
   * - id, position, 연결(엣지)은 그대로 유지 → 마인드맵에서 고른 아이디어를 바로 할 일로 전환.
   * - 기존 라벨/메모 텍스트를 작업명으로 가져오고, 투표/댓글도 보존한다.
   * - 이미 WBS 라면 아무 것도 하지 않는다.
   * 반환: 승격된 노드 id (WBS 편집 패널을 바로 열기 위함)
   */
  const promoteToWbs = useCallback((id: string) => {
    const handle = handleRef.current
    if (!handle) return
    const existing = handle.nodes.get(id)
    if (!existing) return
    const data = existing.data as {
      kind?: string
      label?: string
      text?: string
      votes?: string[]
      comments?: Comment[]
    }
    if (data.kind === 'wbs') return id // 이미 WBS
    const label = (data.label ?? data.text ?? '').trim() || '새 작업'
    const wbsData: WbsNodeData = {
      label,
      assignee: '',
      status: 'todo',
      progress: 0,
      votes: data.votes ?? [],
      comments: data.comments ?? [],
      kind: 'wbs',
    }
    handle.nodes.set(id, { ...existing, type: 'wbs', data: wbsData })
    return id
  }, [])

  // --- 투표 세션 (여러 개 동시 진행) ---

  /** 새 투표 생성 (질문 + 선택지들 + 선택적 마감 시각). 여러 개를 동시에 만들 수 있다. */
  const createPoll = useCallback(
    (question: string, optionTexts: string[], owner: string, deadline = 0) => {
      const handle = handleRef.current
      if (!handle) return
      const options: PollOption[] = optionTexts
        .map((t) => t.trim())
        .filter(Boolean)
        .map((t, i) => ({ id: `opt-${Date.now()}-${i}`, text: t, voters: [] }))
      if (options.length < 2) return // 선택지 최소 2개
      const id = `poll-${Date.now()}-${Math.floor(Math.random() * 1000)}`
      const newPoll: Poll = {
        id,
        question: question.trim() || '(제목 없는 투표)',
        options,
        owner,
        closed: false,
        deadline: deadline > 0 ? deadline : 0,
        createdAt: Date.now(),
      }
      handle.poll.set(id, newPoll)
    },
    [],
  )

  /** 특정 투표에 투표: 한 선택지에만 1표(다시 누르면 취소). 종료/마감된 투표는 무시. */
  const votePoll = useCallback((pollId: string, optionId: string, username: string) => {
    const handle = handleRef.current
    if (!handle || !username) return
    const target = handle.poll.get(pollId)
    if (!target || target.closed) return
    if (target.deadline > 0 && Date.now() >= target.deadline) return // 마감 지남
    const options = target.options.map((opt) => {
      const voters = opt.voters.filter((u) => u !== username)
      const wasVoted = opt.voters.includes(username)
      if (opt.id === optionId && !wasVoted) voters.push(username)
      return { ...opt, voters }
    })
    handle.poll.set(pollId, { ...target, options })
  }, [])

  /** 특정 투표 종료 (만든 사람만 — 권한은 호출부에서 확인) */
  const closePoll = useCallback((pollId: string) => {
    const handle = handleRef.current
    if (!handle) return
    const target = handle.poll.get(pollId)
    if (!target) return
    handle.poll.set(pollId, { ...target, closed: true })
  }, [])

  /** 특정 투표 삭제 */
  const clearPoll = useCallback((pollId: string) => {
    const handle = handleRef.current
    if (!handle) return
    handle.poll.delete(pollId)
  }, [])

  /** 방 채팅 메시지 전송 (방에 들어온 참여자 모두에게 실시간 공유) */
  const sendChatMessage = useCallback(
    (text: string, author: string, authorUsername: string, color: string) => {
      const handle = handleRef.current
      const trimmed = text.trim()
      if (!handle || !trimmed) return
      const message: ChatMessage = {
        id: `chat-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        author,
        authorUsername,
        color,
        text: trimmed,
        at: Date.now(),
      }
      handle.chat.push([message])
    },
    [],
  )

  /** 채팅 메시지 수정 (본인 메시지만 — 권한 체크는 호출부에서) */
  const editChatMessage = useCallback((id: string, text: string) => {
    const handle = handleRef.current
    const trimmed = text.trim()
    if (!handle || !trimmed) return
    const arr = handle.chat.toArray()
    const idx = arr.findIndex((m) => m && m.id === id)
    if (idx === -1) return
    const edited: ChatMessage = { ...arr[idx], text: trimmed, editedAt: Date.now() }
    handle.doc.transact(() => {
      handle.chat.delete(idx, 1)
      handle.chat.insert(idx, [edited])
    })
  }, [])

  /** 채팅 메시지 삭제 (본인 메시지만 — 권한 체크는 호출부에서) */
  const deleteChatMessage = useCallback((id: string) => {
    const handle = handleRef.current
    if (!handle) return
    const idx = handle.chat.toArray().findIndex((m) => m && m.id === id)
    if (idx === -1) return
    handle.chat.delete(idx, 1)
  }, [])

  /** 캘린더 일정 추가 (특정 날짜에) */
  const addCalendarEvent = useCallback(
    (
      date: string,
      text: string,
      createdBy: string,
      extra: { time?: string; assignee?: string } = {},
    ) => {
      const handle = handleRef.current
      const trimmed = text.trim()
      if (!handle || !date || !trimmed) return
      const id = `cal-${Date.now()}-${Math.floor(Math.random() * 1000)}`
      const event: CalendarEvent = {
        id,
        date,
        text: trimmed,
        done: false,
        createdBy,
        createdAt: Date.now(),
      }
      const time = normalizeTime(extra.time)
      const assignee = extra.assignee?.trim()
      if (time) event.time = time
      if (assignee) event.assignee = assignee
      handle.calendar.set(id, event)
    },
    [],
  )

  /** 캘린더 일정 완료 체크 토글 */
  const toggleCalendarEvent = useCallback((id: string) => {
    const handle = handleRef.current
    if (!handle) return
    const existing = handle.calendar.get(id)
    if (!existing) return
    handle.calendar.set(id, { ...existing, done: !existing.done })
  }, [])

  /** 캘린더 일정 내용 수정 */
  const editCalendarEvent = useCallback(
    (id: string, patch: { text: string; time?: string; assignee?: string }) => {
      const handle = handleRef.current
      const trimmed = patch.text.trim()
      if (!handle || !trimmed) return
      const existing = handle.calendar.get(id)
      if (!existing) return
      // 비운 칸은 필드 자체를 지워 "시간 없음 / 담당자 없음" 으로 되돌린다
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { time: _oldTime, assignee: _oldAssignee, ...rest } = existing
      const next: CalendarEvent = { ...rest, text: trimmed }
      const time = normalizeTime(patch.time)
      const assignee = patch.assignee?.trim()
      if (time) next.time = time
      if (assignee) next.assignee = assignee
      handle.calendar.set(id, next)
    },
    [],
  )

  /** 캘린더 일정 삭제 */
  const deleteCalendarEvent = useCallback((id: string) => {
    const handle = handleRef.current
    if (!handle) return
    handle.calendar.delete(id)
  }, [])

  /** 공유 연결선 스타일 설정 (모든 참여자에게 반영) */
  const setEdgeStyle = useCallback((style: EdgeStyle) => {
    const handle = handleRef.current
    if (!handle) return
    handle.meta.set('edgeStyle', style)
  }, [])

  /** 노드 크기(너비/높이) 저장 — 공유 */
  const resizeNode = useCallback((id: string, w: number, h: number) => {
    const handle = handleRef.current
    if (!handle) return
    const existing = handle.nodes.get(id)
    if (!existing) return
    handle.nodes.set(id, {
      ...existing,
      data: { ...existing.data, w, h } as BoardNode['data'],
    })
  }, [])

  /** 노드 내용 접힘/펼침 토글 — 공유 */
  const toggleCollapse = useCallback((id: string) => {
    const handle = handleRef.current
    if (!handle) return
    const existing = handle.nodes.get(id)
    if (!existing) return
    const cur = (existing.data as { collapsed?: boolean }).collapsed ?? false
    handle.nodes.set(id, {
      ...existing,
      data: { ...existing.data, collapsed: !cur } as BoardNode['data'],
    })
  }, [])

  return useMemo(
    () => ({
      nodes,
      edges,
      peers,
      cursors,
      connected,
      synced,
      undo,
      redo,
      canUndo,
      canRedo,
      onNodesChange,
      onEdgesChange,
      onConnect,
      addNode,
      renameNode,
      addWbsNode,
      updateWbsNode,
      toggleWbsDone,
      addAttachment,
      removeAttachment,
      setCursor,
      applyLayout,
      addImageNode,
      updateImageNode,
      connectNodes,
      alignGrid,
      addStickyNode,
      updateStickyNode,
      toggleVote,
      addComment,
      deleteComment,
      editComment,
      addChecklistItem,
      toggleChecklistItem,
      removeChecklistItem,
      promoteToWbs,
      polls,
      createPoll,
      votePoll,
      closePoll,
      clearPoll,
      chat,
      sendChatMessage,
      editChatMessage,
      deleteChatMessage,
      activity,
      calendar,
      addCalendarEvent,
      toggleCalendarEvent,
      editCalendarEvent,
      deleteCalendarEvent,
      edgeStyle,
      setEdgeStyle,
      resizeNode,
      toggleCollapse,
    }),
    [
      nodes,
      edges,
      peers,
      cursors,
      connected,
      synced,
      undo,
      redo,
      canUndo,
      canRedo,
      onNodesChange,
      onEdgesChange,
      onConnect,
      addNode,
      renameNode,
      addWbsNode,
      updateWbsNode,
      toggleWbsDone,
      addAttachment,
      removeAttachment,
      setCursor,
      applyLayout,
      addImageNode,
      updateImageNode,
      connectNodes,
      alignGrid,
      addStickyNode,
      updateStickyNode,
      toggleVote,
      addComment,
      deleteComment,
      editComment,
      addChecklistItem,
      toggleChecklistItem,
      removeChecklistItem,
      promoteToWbs,
      polls,
      createPoll,
      votePoll,
      closePoll,
      clearPoll,
      chat,
      sendChatMessage,
      editChatMessage,
      deleteChatMessage,
      activity,
      calendar,
      addCalendarEvent,
      toggleCalendarEvent,
      editCalendarEvent,
      deleteCalendarEvent,
      edgeStyle,
      setEdgeStyle,
      resizeNode,
      toggleCollapse,
    ],
  )
}
