import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  type Connection,
  type EdgeChange,
  type NodeChange,
} from '@xyflow/react'
import {
  connectRoom,
  isWbsData,
  type Attachment,
  type BoardEdge,
  type BoardNode,
  type ChecklistItem,
  type CollabHandle,
  type Comment,
  type ImageNodeData,
  type Poll,
  type PollOption,
  type StickyColor,
  type StickyNodeData,
  type WbsNodeData,
} from './yjs'
import { layoutNodes, type LayoutDirection } from './layout'

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
export function useCollabBoard(roomName: string, user: AwarenessUser) {
  const handleRef = useRef<CollabHandle | null>(null)
  const [nodes, setNodes] = useState<BoardNode[]>([])
  const [edges, setEdges] = useState<BoardEdge[]>([])
  const [peers, setPeers] = useState<AwarenessUser[]>([])
  const [cursors, setCursors] = useState<RemoteCursor[]>([])
  const [poll, setPoll] = useState<Poll | null>(null)
  const [connected, setConnected] = useState(false)

  // 방 연결 + Yjs 관찰자 등록
  useEffect(() => {
    const handle = connectRoom(roomName, user)
    handleRef.current = handle

    const syncNodes = () => setNodes(Array.from(handle.nodes.values()))
    const syncEdges = () => setEdges(Array.from(handle.edges.values()))
    const syncPoll = () => setPoll((handle.poll.get('current') as Poll | null) ?? null)

    handle.nodes.observe(syncNodes)
    handle.edges.observe(syncEdges)
    handle.poll.observe(syncPoll)
    // 초기 상태 반영
    syncNodes()
    syncEdges()
    syncPoll()

    handle.provider.on('status', (e: { status: string }) => {
      setConnected(e.status === 'connected')
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
      handle.awareness.off('change', syncAwareness)
      handle.destroy()
      handleRef.current = null
    }
    // user 는 최초 연결 시에만 사용. roomName 변경 시에만 재연결.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomName])

  // --- 로컬 조작 -> Yjs 반영 ---

  const onNodesChange = useCallback((changes: NodeChange<BoardNode>[]) => {
    const handle = handleRef.current
    if (!handle) return
    const next = applyNodeChanges(changes, Array.from(handle.nodes.values()))
    handle.doc.transact(() => {
      // 삭제 처리
      const nextIds = new Set(next.map((n) => n.id))
      for (const id of handle.nodes.keys()) {
        if (!nextIds.has(id)) handle.nodes.delete(id)
      }
      // 추가/갱신 (위치 이동 포함)
      for (const n of next) handle.nodes.set(n.id, n)
    })
  }, [])

  const onEdgesChange = useCallback((changes: EdgeChange<BoardEdge>[]) => {
    const handle = handleRef.current
    if (!handle) return
    const next = applyEdgeChanges(changes, Array.from(handle.edges.values()))
    handle.doc.transact(() => {
      const nextIds = new Set(next.map((e) => e.id))
      for (const id of handle.edges.keys()) {
        if (!nextIds.has(id)) handle.edges.delete(id)
      }
      for (const e of next) handle.edges.set(e.id, e)
    })
  }, [])

  const onConnect = useCallback((connection: Connection) => {
    const handle = handleRef.current
    if (!handle) return
    const next = addEdge(connection, Array.from(handle.edges.values()))
    handle.doc.transact(() => {
      for (const e of next) handle.edges.set(e.id, e)
    })
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
      data: { ...existing.data, ...patch },
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
    const current = Array.from(handle.nodes.values())
    const currentEdges = Array.from(handle.edges.values())
    const laid = layoutNodes(current, currentEdges, direction)
    handle.doc.transact(() => {
      for (const n of laid) handle.nodes.set(n.id, n)
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
    handle.nodes.set(id, { ...existing, data: { ...existing.data, ...patch } })
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

  // --- 투표 세션 ---

  /** 새 투표 생성 (질문 + 선택지들). 기존 투표는 덮어쓴다. */
  const createPoll = useCallback((question: string, optionTexts: string[], owner: string) => {
    const handle = handleRef.current
    if (!handle) return
    const options: PollOption[] = optionTexts
      .map((t) => t.trim())
      .filter(Boolean)
      .map((t, i) => ({ id: `opt-${Date.now()}-${i}`, text: t, voters: [] }))
    if (options.length < 2) return // 선택지 최소 2개
    const newPoll: Poll = {
      id: `poll-${Date.now()}`,
      question: question.trim() || '(제목 없는 투표)',
      options,
      owner,
      closed: false,
      createdAt: Date.now(),
    }
    handle.poll.set('current', newPoll)
  }, [])

  /** 투표하기: 한 선택지에만 1표(이미 그 선택지면 취소, 다른 선택지면 이동). 종료된 투표는 무시. */
  const votePoll = useCallback((optionId: string, username: string) => {
    const handle = handleRef.current
    if (!handle || !username) return
    const current = handle.poll.get('current') as Poll | null
    if (!current || current.closed) return
    const options = current.options.map((opt) => {
      // 모든 선택지에서 내 표를 먼저 제거
      const voters = opt.voters.filter((u) => u !== username)
      // 누른 선택지에는, 기존에 안 눌렀던 경우에만 추가(= 다시 누르면 취소 효과)
      const wasVoted = opt.voters.includes(username)
      if (opt.id === optionId && !wasVoted) voters.push(username)
      return { ...opt, voters }
    })
    handle.poll.set('current', { ...current, options })
  }, [])

  /** 투표 종료 (만든 사람만 — 권한은 호출부에서 확인) */
  const closePoll = useCallback(() => {
    const handle = handleRef.current
    if (!handle) return
    const current = handle.poll.get('current') as Poll | null
    if (!current) return
    handle.poll.set('current', { ...current, closed: true })
  }, [])

  /** 투표 삭제(치우기) */
  const clearPoll = useCallback(() => {
    const handle = handleRef.current
    if (!handle) return
    handle.poll.set('current', null)
  }, [])

  return useMemo(
    () => ({
      nodes,
      edges,
      peers,
      cursors,
      connected,
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
      poll,
      createPoll,
      votePoll,
      closePoll,
      clearPoll,
    }),
    [
      nodes,
      edges,
      peers,
      cursors,
      connected,
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
      poll,
      createPoll,
      votePoll,
      closePoll,
      clearPoll,
    ],
  )
}
