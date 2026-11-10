import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  ReactFlowProvider,
  useReactFlow,
  getNodesBounds,
  getViewportForBounds,
  MarkerType,
  type NodeMouseHandler,
  type NodeTypes,
  type OnNodeDrag,
  type Edge,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useCollabBoard, type AwarenessUser } from './collab/useCollabBoard'
import {
  isImageData,
  isStickyData,
  isWbsData,
  type BoardNode,
  type Comment,
  type StickyColor,
  type WbsNodeData,
} from './collab/yjs'
import { api, uploadFile } from './api/client'
import MembersPanel from './screens/MembersPanel'
import WbsEditPanel from './screens/WbsEditPanel'
import CommentsPanel from './screens/CommentsPanel'
import ChatPanel from './screens/ChatPanel'
import DeleteBoardModal from './screens/DeleteBoardModal'
import DeadlineAlert from './screens/DeadlineAlert'
import GanttPanel, { type GanttTask } from './screens/GanttPanel'
import HistoryPanel from './screens/HistoryPanel'
import { dueBadge, localIsoDate, splitAssignees } from './collab/wbsUtils'
import CalendarPanel, { type WbsDeadline } from './screens/CalendarPanel'
import PersonalSpacePanel from './screens/PersonalSpacePanel'
import DashboardPanel from './screens/DashboardPanel'
import TextInputModal from './screens/TextInputModal'
import PollPanel from './screens/PollPanel'
import {
  captureBoardPng,
  downloadDataUrl,
  exportFilename,
  savePngAsPdf,
  downloadTextFile,
} from './collab/exportBoard'
import { toCsv } from './collab/csv'
import WbsNode, { WBS_STATUS } from './nodes/WbsNode'
import ImageNode from './nodes/ImageNode'
import StickyNode from './nodes/StickyNode'
import LiveCursors from './nodes/LiveCursors'
import { CurrentUserContext } from './nodes/CurrentUserContext'
import {
  CHECKLIST_TOGGLE_EVENT,
  NODE_COLLAPSE_EVENT,
  NODE_COMMENT_EVENT,
  NODE_RESIZE_EVENT,
  NODE_VOTE_EVENT,
  PROMOTE_WBS_EVENT,
  STICKY_COLOR_EVENT,
  WBS_TOGGLE_DONE_EVENT,
} from './nodes/nodeEvents'

/** 노드 데이터에서 패널 헤더에 쓸 짧은 제목을 뽑는다. */
function nodeTitleOf(node: BoardNode): string {
  const d = node.data
  if (isWbsData(d)) return d.label || '(제목 없는 작업)'
  if (isStickyData(d)) return d.text ? d.text.slice(0, 20) : '(빈 메모)'
  if (isImageData(d)) return d.label || '(이미지)'
  return String((d as { label?: string }).label ?? '(노드)')
}

/** 업로드 이미지 최대 크기(5MB). 서버도 같은 한도로 검사한다. */
const MAX_IMAGE_SIZE = 5 * 1024 * 1024

/** 연결선(엣지) 스타일 설정 UI 옵션 — 실제 값은 Yjs(meta)에 공유 저장된다. */
const DEFAULT_EDGE_STYLE = { color: '#6366f1', width: 2.5 }
const EDGE_COLORS = ['#6366f1', '#111827', '#ef4444', '#f59e0b', '#22c55e', '#06b6d4', '#ec4899']
const EDGE_WIDTHS: { label: string; value: number }[] = [
  { label: '가늘게', value: 1.5 },
  { label: '보통', value: 2.5 },
  { label: '굵게', value: 4 },
  { label: '매우 굵게', value: 6 },
]

/** 담당자 필터 특수 값 (실제 이름과 겹치지 않도록 접두어 사용) */
const FILTER_MINE = '__mine__'
const FILTER_UNASSIGNED = '__unassigned__'

/** 두 노드가 화면상에서 겹치는지 판정 (중심점이 대상 노드 박스 안에 있는지) */
function overlaps(a: BoardNode, b: BoardNode): boolean {
  const aw = a.measured?.width ?? 200
  const ah = a.measured?.height ?? 80
  const bw = b.measured?.width ?? 200
  const bh = b.measured?.height ?? 80
  const acx = a.position.x + aw / 2
  const acy = a.position.y + ah / 2
  return (
    acx >= b.position.x &&
    acx <= b.position.x + bw &&
    acy >= b.position.y &&
    acy <= b.position.y + bh
  )
}

interface BoardProps {
  /** 실시간 동기화용 방 식별자(slug) */
  room: string
  /** 화면에 표시할 방 이름 */
  roomName: string
  user: AwarenessUser
  /** 현재 로그인 사용자 username (투표 1인 1표 식별용) */
  username: string
  onLeave: () => void
}

function BoardInner({ room, roomName, user, username, onLeave }: BoardProps) {
  // 내 역할 (서버에서 확인). 팀장(owner)에게만 보드 삭제 버튼을 보여준다.
  const [isOwner, setIsOwner] = useState(false)
  // 보드 멤버 이름 목록 (캘린더 담당자 자동완성 등에 사용)
  const [memberNames, setMemberNames] = useState<string[]>([])
  // 역할/멤버 다시 불러오기: 입장 시 + 더보기를 열 때 (다른 팀원이 나에게 팀장을 맡겼을 수 있음)
  const [roleCheckTick, setRoleCheckTick] = useState(0)
  useEffect(() => {
    let alive = true
    api
      .getRoom(room)
      .then((res) => {
        if (!alive) return
        setIsOwner(res.role === 'owner')
        setMemberNames(res.members.filter((m) => m.role !== 'invited').map((m) => m.name))
      })
      .catch(() => {
        if (alive) setIsOwner(false)
      })
    return () => {
      alive = false
    }
  }, [room, roleCheckTick])

  // 보드 삭제 확인 모달 상태 (팀장 전용 — 서버도 owner 가 아니면 403 으로 거부한다)
  const [showDeleteBoard, setShowDeleteBoard] = useState(false)
  const [deletingBoard, setDeletingBoard] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // 확인 문구 입력이 끝난 뒤에만 호출됨 (DeleteBoardModal)
  // 내가 직접 삭제 중이면, 서버가 연결을 끊을 때 뜨는 "삭제됨" 알림은 건너뛴다.
  const deletingByMeRef = useRef(false)
  const handleDeleteBoard = useCallback(async () => {
    setDeletingBoard(true)
    setDeleteError(null)
    deletingByMeRef.current = true
    try {
      await api.deleteRoom(room)
      onLeave()
    } catch (err) {
      deletingByMeRef.current = false
      setDeleteError(err instanceof Error ? err.message : '보드 삭제에 실패했어요.')
      setDeletingBoard(false)
    }
  }, [room, onLeave])

  // 서버가 연결을 끊은 경우 (다른 팀원이 보드를 삭제했거나, 내가 멤버에서 제외됨)
  // 내가 스스로 나가는 중이면, 서버가 연결을 끊을 때 뜨는 "제외됨" 알림도 건너뛴다.
  const leavingByMeRef = useRef(false)
  const handleAccessLost = useCallback(
    (reason: 'deleted' | 'forbidden') => {
      if (deletingByMeRef.current || leavingByMeRef.current) return
      window.alert(
        reason === 'deleted'
          ? '팀장이 이 보드를 삭제했어요. 보드 목록으로 돌아갑니다.'
          : '이 보드에서 제외되어 더 이상 접근할 수 없어요. 보드 목록으로 돌아갑니다.',
      )
      onLeave()
    },
    [onLeave],
  )

  const [showMembers, setShowMembers] = useState(false)
  // 편집 중인 WBS 노드 id (null = 패널 닫힘)
  const [editingWbsId, setEditingWbsId] = useState<string | null>(null)
  // 댓글 패널 대상 노드 id (null = 닫힘)
  const [commentNodeId, setCommentNodeId] = useState<string | null>(null)
  // 왼쪽 개인 공간 패널 접힘 여부 (기본 접힘 → 왼쪽 라인만 표시)
  const [personalCollapsed, setPersonalCollapsed] = useState(true)
  // 시작 안내 카드를 사용자가 닫았는지
  const [guideDismissed, setGuideDismissed] = useState(false)
  // 연결선 스타일 설정 팝오버 열림 여부 (값은 공유 edgeStyle 사용)
  const [showEdgeStyle, setShowEdgeStyle] = useState(false)
  // 대시보드 패널 열림 여부
  const [showDashboard, setShowDashboard] = useState(false)
  // 투표 패널 열림 여부
  const [showPoll, setShowPoll] = useState(false)
  // 채팅 패널 열림 여부
  const [showChat, setShowChat] = useState(false)
  // 캘린더 패널 열림 여부
  const [showCalendar, setShowCalendar] = useState(false)
  // 간트차트 열림 여부
  const [showGantt, setShowGantt] = useState(false)
  // 변경 기록 패널 열림 여부
  const [showHistory, setShowHistory] = useState(false)
  // 부가 기능(사진/정렬/개인공간 등) 더보기 펼침 여부
  const [showMore, setShowMore] = useState(false)
  // 공유(이미지/PDF 저장) 메뉴 펼침 여부
  const [showShare, setShowShare] = useState(false)
  // 여러 줄 텍스트 입력 모달 상태 (null = 닫힘)
  const [textModal, setTextModal] = useState<{
    heading: string
    initial: string
    confirmLabel: string
    withTitle?: boolean
    initialTitle?: string
    onSubmit: (text: string, title?: string) => void
  } | null>(null)
  const {
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
    calendar,
    addCalendarEvent,
    toggleCalendarEvent,
    editCalendarEvent,
    deleteCalendarEvent,
    edgeStyle,
    setEdgeStyle,
    resizeNode,
    toggleCollapse,
    activity,
  } = useCollabBoard(room, user, handleAccessLost, username)

  // --- 실행 취소 / 다시 실행 단축키 ---
  // 입력창에서 글자를 고치는 중이면 브라우저 기본 동작(글자 되돌리기)을 그대로 둔다.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
      ) {
        return
      }
      const key = e.key.toLowerCase()
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [undo, redo])

  // --- 채팅 안 읽은 메시지 ---
  // 마지막으로 읽은 메시지(id + 시각)를 사용자·보드별로 이 브라우저에 저장한다.
  const chatReadKey = `chat-read:${username}:${room}`
  const [chatLastRead, setChatLastRead] = useState<{ id: string | null; at: number }>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(chatReadKey) ?? 'null')
      if (saved && typeof saved.at === 'number') {
        return { id: typeof saved.id === 'string' ? saved.id : null, at: saved.at }
      }
    } catch {
      // 저장값이 깨졌으면 처음부터
    }
    return { id: null, at: 0 }
  })

  const unreadChatCount = useMemo(() => {
    const fromOthers = (m: { authorUsername: string }) => m.authorUsername !== username
    // 마지막으로 읽은 메시지가 남아 있으면 그 뒤의 메시지만 센다 (기기 간 시계 차이에 영향받지 않음)
    const idx = chatLastRead.id ? chat.findIndex((m) => m.id === chatLastRead.id) : -1
    if (idx >= 0) return chat.slice(idx + 1).filter(fromOthers).length
    // 읽은 메시지가 삭제됐거나 기록이 없으면 시각으로 비교
    return chat.filter((m) => m.at > chatLastRead.at && fromOthers(m)).length
  }, [chat, chatLastRead, username])

  // 채팅창이 열려 있는 동안 들어온 메시지는 바로 읽음 처리
  useEffect(() => {
    if (!showChat || chat.length === 0) return
    const last = chat[chat.length - 1]
    if (last.id === chatLastRead.id) return
    const next = { id: last.id, at: Math.max(chatLastRead.at, ...chat.map((m) => m.at)) }
    setChatLastRead(next)
    try {
      localStorage.setItem(chatReadKey, JSON.stringify(next))
    } catch {
      // 저장 공간이 없어도 화면 표시는 계속 동작
    }
  }, [showChat, chat, chatLastRead, chatReadKey])

  // 드래그 중인 노드 위에 겹친 "드롭 대상" 노드 id (초록 하이라이트용)
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)
  // 이미지 업로드용 숨은 input
  const imageInputRef = useRef<HTMLInputElement>(null)

  // 노드 내부 상호작용(완료 토글 / 투표 / 스티커 색상) 이벤트 수신
  useEffect(() => {
    const onToggleDone = (e: Event) => {
      const id = (e as CustomEvent<{ id: string }>).detail?.id
      if (id) toggleWbsDone(id)
    }
    const onVote = (e: Event) => {
      const id = (e as CustomEvent<{ id: string }>).detail?.id
      if (id) toggleVote(id, username)
    }
    const onStickyColor = (e: Event) => {
      const { id, color } = (e as CustomEvent<{ id: string; color: StickyColor }>).detail ?? {}
      if (id && color) updateStickyNode(id, { color })
    }
    const onComment = (e: Event) => {
      const id = (e as CustomEvent<{ id: string }>).detail?.id
      if (id) setCommentNodeId(id)
    }
    const onPromote = (e: Event) => {
      const id = (e as CustomEvent<{ id: string }>).detail?.id
      if (id) {
        const promotedId = promoteToWbs(id)
        if (promotedId) setEditingWbsId(promotedId)
      }
    }
    const onChecklistToggle = (e: Event) => {
      const { id, itemId } = (e as CustomEvent<{ id: string; itemId: string }>).detail ?? {}
      if (id && itemId) toggleChecklistItem(id, itemId)
    }
    const onCollapse = (e: Event) => {
      const id = (e as CustomEvent<{ id: string }>).detail?.id
      if (id) toggleCollapse(id)
    }
    const onResize = (e: Event) => {
      const { id, w, h } = (e as CustomEvent<{ id: string; w: number; h: number }>).detail ?? {}
      if (id && w && h) resizeNode(id, w, h)
    }
    window.addEventListener(WBS_TOGGLE_DONE_EVENT, onToggleDone)
    window.addEventListener(NODE_VOTE_EVENT, onVote)
    window.addEventListener(STICKY_COLOR_EVENT, onStickyColor)
    window.addEventListener(NODE_COMMENT_EVENT, onComment)
    window.addEventListener(PROMOTE_WBS_EVENT, onPromote)
    window.addEventListener(CHECKLIST_TOGGLE_EVENT, onChecklistToggle)
    window.addEventListener(NODE_COLLAPSE_EVENT, onCollapse)
    window.addEventListener(NODE_RESIZE_EVENT, onResize)
    return () => {
      window.removeEventListener(WBS_TOGGLE_DONE_EVENT, onToggleDone)
      window.removeEventListener(NODE_VOTE_EVENT, onVote)
      window.removeEventListener(STICKY_COLOR_EVENT, onStickyColor)
      window.removeEventListener(NODE_COMMENT_EVENT, onComment)
      window.removeEventListener(PROMOTE_WBS_EVENT, onPromote)
      window.removeEventListener(CHECKLIST_TOGGLE_EVENT, onChecklistToggle)
      window.removeEventListener(NODE_COLLAPSE_EVENT, onCollapse)
      window.removeEventListener(NODE_RESIZE_EVENT, onResize)
    }
  }, [
    toggleWbsDone,
    toggleVote,
    updateStickyNode,
    promoteToWbs,
    toggleChecklistItem,
    toggleCollapse,
    resizeNode,
    username,
  ])

  const { screenToFlowPosition, getNodes, setCenter } = useReactFlow()

  // 변경 기록에서 항목을 누르면 그 노드가 화면 가운데 오도록 이동
  const existingNodeIds = useMemo(() => new Set(nodes.map((n) => n.id)), [nodes])
  const focusNode = useCallback(
    (id: string) => {
      const n = nodes.find((x) => x.id === id)
      if (!n) return
      const w = n.measured?.width ?? 200
      const h = n.measured?.height ?? 80
      setCenter(n.position.x + w / 2, n.position.y + h / 2, { zoom: 1.2, duration: 400 })
    },
    [nodes, setCenter],
  )
  // 내보내기 진행 중 표시
  const [exporting, setExporting] = useState(false)

  // 커스텀 노드 타입 등록
  const nodeTypes = useMemo<NodeTypes>(
    () => ({ wbs: WbsNode, image: ImageNode, sticky: StickyNode }),
    [],
  )

  // 노드별 생성 순번(seq) 계산: createdAt(없으면 id 의 timestamp) 기준 오름차순
  const seqById = useMemo(() => {
    const orderKey = (n: BoardNode) => {
      const created = (n.data as { createdAt?: number }).createdAt
      if (typeof created === 'number') return created
      // 구버전 노드: id 의 두 번째 토큰(timestamp) 으로 보조
      const parts = n.id.split('-')
      const ts = Number(parts[1])
      return Number.isFinite(ts) ? ts : 0
    }
    const sorted = [...nodes].sort((a, b) => orderKey(a) - orderKey(b) || a.id.localeCompare(b.id))
    const map: Record<string, number> = {}
    sorted.forEach((n, i) => {
      map[n.id] = i + 1
    })
    return map
  }, [nodes])

  // --- 담당자 필터 (내 화면에만 적용) ---
  // '' = 전체, MINE = 내 작업, UNASSIGNED = 담당자 미지정, 그 외 = 해당 담당자 이름
  const [assigneeFilter, setAssigneeFilter] = useState('')
  const assigneeOptions = useMemo(() => {
    const names = new Set<string>()
    for (const n of nodes) {
      if (isWbsData(n.data)) for (const a of splitAssignees(n.data.assignee)) names.add(a)
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b, 'ko'))
  }, [nodes])

  // 필터에 맞는 노드 id 집합 (필터가 꺼져 있으면 null). WBS 작업만 대상이고 아이디어·메모는 흐리게 처리된다.
  const filterMatchIds = useMemo(() => {
    if (!assigneeFilter) return null
    const me = [user.name, username].map((s) => s.trim().toLowerCase())
    const ids = new Set<string>()
    for (const n of nodes) {
      if (!isWbsData(n.data)) continue
      const people = splitAssignees(n.data.assignee).map((s) => s.toLowerCase())
      const ok =
        assigneeFilter === FILTER_MINE
          ? people.some((p) => me.includes(p))
          : assigneeFilter === FILTER_UNASSIGNED
            ? people.length === 0
            : people.includes(assigneeFilter.toLowerCase())
      if (ok) ids.add(n.id)
    }
    return ids
  }, [assigneeFilter, nodes, user.name, username])

  // 드래그 하이라이트 + 생성 순번(seq) + 필터 흐림을 적용한 노드 배열
  const displayNodes = useMemo(
    () =>
      nodes.map((n) => {
        const classes = [n.className ?? '']
        if (n.id === dropTargetId) classes.push('drop-target')
        if (filterMatchIds && !filterMatchIds.has(n.id)) classes.push('filtered-out')
        const className = classes.join(' ').trim()
        return {
          ...n,
          data: { ...n.data, seq: seqById[n.id] },
          ...(className ? { className } : {}),
        }
      }),
    [nodes, dropTargetId, seqById, filterMatchIds],
  )

  // 내 설정(색상/굵기)을 모든 연결선에 적용 + 화살표 표시 (내 화면에만 반영)
  // 필터 중에는 양 끝이 모두 걸린 연결선만 진하게 보인다.
  const displayEdges = useMemo<Edge[]>(
    () =>
      edges.map((e) => ({
        ...e,
        style: { ...e.style, stroke: edgeStyle.color, strokeWidth: edgeStyle.width },
        markerEnd: { type: MarkerType.ArrowClosed, color: edgeStyle.color },
        ...(filterMatchIds && !(filterMatchIds.has(e.source) && filterMatchIds.has(e.target))
          ? { className: 'filtered-out' }
          : {}),
      })),
    [edges, edgeStyle, filterMatchIds],
  )



  // 편집 중인 WBS 노드의 현재 데이터
  const editingNode = editingWbsId ? nodes.find((n) => n.id === editingWbsId) : undefined
  const editingData =
    editingNode && isWbsData(editingNode.data) ? (editingNode.data as WbsNodeData) : null

  // 댓글 패널 대상 노드 (삭제되면 자동으로 닫힘)
  const commentNode = commentNodeId ? nodes.find((n) => n.id === commentNodeId) : undefined
  const commentList = (commentNode?.data as { comments?: Comment[] } | undefined)?.comments ?? []
  useEffect(() => {
    if (commentNodeId && !commentNode) setCommentNodeId(null)
  }, [commentNodeId, commentNode])

  // 빈 캔버스 더블클릭 -> 새 아이디어 노드 추가 (여러 줄 입력 모달)
  const handlePaneDoubleClick = useCallback(
    (event: React.MouseEvent) => {
      const target = event.target as HTMLElement
      // 노드/핸들/UI 요소 위 더블클릭은 무시하고, 그 외 빈 캔버스에서만 동작.
      if (
        target.closest(
          '.react-flow__node, .react-flow__handle, .react-flow__controls, .react-flow__minimap, .react-flow__edge, button, input, textarea, a, .side-panel, .left-dock, .panel, .empty-card',
        )
      ) {
        return
      }
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY })
      setTextModal({
        heading: '새 아이디어',
        initial: '',
        confirmLabel: '추가',
        onSubmit: (text) => {
          const t = text.trim()
          if (t) addNode(t, position)
        },
      })
    },
    [addNode, screenToFlowPosition],
  )

  // 노드 더블클릭 -> WBS 는 편집 패널, 그 외는 여러 줄 입력 모달
  const handleNodeDoubleClick: NodeMouseHandler<BoardNode> = useCallback(
    (_event, node) => {
      if (isWbsData(node.data)) {
        setEditingWbsId(node.id)
        return
      }
      if (isStickyData(node.data)) {
        setTextModal({
          heading: '메모 수정',
          initial: node.data.text,
          confirmLabel: '저장',
          withTitle: true,
          initialTitle: node.data.title ?? '',
          onSubmit: (text, title) => updateStickyNode(node.id, { text, title: title?.trim() || '' }),
        })
        return
      }
      setTextModal({
        heading: '아이디어 수정',
        initial: String(node.data.label ?? ''),
        confirmLabel: '저장',
        onSubmit: (text) => renameNode(node.id, text),
      })
    },
    [renameNode, updateStickyNode],
  )

  // 화면 중앙 근처에 WBS 노드 추가
  const handleAddWbs = useCallback(() => {
    const position = screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    })
    const id = addWbsNode(position)
    if (id) setEditingWbsId(id)
  }, [addWbsNode, screenToFlowPosition])

  // 화면 중앙 근처에 스티커 메모 추가 (여러 줄 입력 모달)
  const handleAddSticky = useCallback(() => {
    setTextModal({
      heading: '새 메모',
      initial: '',
      confirmLabel: '추가',
      withTitle: true,
      onSubmit: (text, title) => {
        const t = text.trim()
        const ti = title?.trim() ?? ''
        if (!t && !ti) return
        const position = screenToFlowPosition({
          x: window.innerWidth / 2,
          y: window.innerHeight / 2,
        })
        const id = addStickyNode(position)
        if (id) updateStickyNode(id, { text: t, title: ti })
      },
    })
  }, [addStickyNode, updateStickyNode, screenToFlowPosition])

  // 마우스 이동 -> 내 커서(flow 좌표) 브로드캐스트
  const handleMouseMove = useCallback(
    (event: React.MouseEvent) => {
      const pos = screenToFlowPosition({ x: event.clientX, y: event.clientY })
      setCursor(pos)
    },
    [screenToFlowPosition, setCursor],
  )

  // 캔버스를 벗어나면 커서 제거
  const handleMouseLeave = useCallback(() => setCursor(null), [setCursor])

  // --- 드래그해서 합치기(연결) ---
  // 드래그 중: 다른 노드 위에 겹치면 그 노드를 드롭 대상으로 표시
  const handleNodeDrag: OnNodeDrag<BoardNode> = useCallback(
    (_event, dragged) => {
      const hit = nodes.find((n) => n.id !== dragged.id && overlaps(dragged, n))
      setDropTargetId(hit ? hit.id : null)
    },
    [nodes],
  )

  // 드래그 종료: 겹친 대상이 있으면 부모-자식으로 연결(합치기)
  const handleNodeDragStop: OnNodeDrag<BoardNode> = useCallback(
    (_event, dragged) => {
      const hit = nodes.find((n) => n.id !== dragged.id && overlaps(dragged, n))
      if (hit) connectNodes(dragged.id, hit.id)
      setDropTargetId(null)
    },
    [nodes, connectNodes],
  )

  // --- 이미지(사진) 추가 ---
  const handleAddImageClick = useCallback(() => imageInputRef.current?.click(), [])

  const handleImagePicked = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (imageInputRef.current) imageInputRef.current.value = ''
      if (!file) return
      if (file.size > MAX_IMAGE_SIZE) {
        window.alert('이미지가 너무 큽니다. 최대 5MB까지 가능합니다.')
        return
      }
      // 사진은 서버에 올리고, 보드 문서에는 짧은 참조 문자열만 저장한다.
      uploadFile(room, file, 'image')
        .then((uploaded) => {
          const position = screenToFlowPosition({
            x: window.innerWidth / 2,
            y: window.innerHeight / 2,
          })
          addImageNode(uploaded.ref, position, file.name)
        })
        .catch((err) => {
          window.alert(err instanceof Error ? err.message : '사진을 올리지 못했어요.')
        })
    },
    [room, addImageNode, screenToFlowPosition],
  )

  // --- 격자(행렬) 정렬 ---
  // 선택된 노드가 있으면 그것만, 없으면 전체를 격자로 정렬
  const handleAlignGrid = useCallback(() => {
    const selected = nodes.filter((n) => n.selected).map((n) => n.id)
    alignGrid(selected.length > 0 ? selected : undefined)
  }, [nodes, alignGrid])

  // --- 아이디어 → WBS 승격 (선택된 비-WBS 노드들) ---
  const promotableSelected = useMemo(
    () => nodes.filter((n) => n.selected && !isWbsData(n.data) && !isImageData(n.data)),
    [nodes],
  )

  const handlePromoteSelected = useCallback(() => {
    const ids = promotableSelected.map((n) => n.id)
    let lastId: string | undefined
    for (const id of ids) lastId = promoteToWbs(id) ?? lastId
    // 한 개만 승격했으면 편집 패널을 바로 연다
    if (ids.length === 1 && lastId) setEditingWbsId(lastId)
  }, [promotableSelected, promoteToWbs])

  // 보드가 완전히 비었는지(빈 보드 안내용)
  const isEmpty = nodes.length === 0

  // --- 화면 캡처 / PDF 저장 ---
  // 전체 노드가 담기는 이미지를 만든다. (뷰포트 밖 노드까지 포함)
  const buildBoardImage = useCallback(async () => {
    const viewport = document.querySelector('.react-flow__viewport') as HTMLElement | null
    if (!viewport) return null
    const allNodes = getNodes()
    if (allNodes.length === 0) {
      window.alert('보드에 노드가 없어요. 내용을 추가한 뒤 저장해보세요.')
      return null
    }
    // 전체 노드 경계 → 이미지 크기 + 꽉 차는 변환 계산
    const bounds = getNodesBounds(allNodes)
    const padding = 0.1
    const imgW = Math.min(4000, Math.max(640, Math.round(bounds.width * (1 + padding * 2))))
    const imgH = Math.min(4000, Math.max(480, Math.round(bounds.height * (1 + padding * 2))))
    const vp = getViewportForBounds(bounds, imgW, imgH, 0.3, 2, padding)
    const dataUrl = await captureBoardPng({
      viewport,
      width: imgW,
      height: imgH,
      transform: { x: vp.x, y: vp.y, zoom: vp.zoom },
    })
    return { dataUrl, width: imgW, height: imgH }
  }, [getNodes])

  const handleExportImage = useCallback(async () => {
    setExporting(true)
    try {
      const img = await buildBoardImage()
      if (img) downloadDataUrl(img.dataUrl, exportFilename(roomName, 'png'))
    } catch (err) {
      console.error(err)
      window.alert('이미지 저장에 실패했어요.')
    } finally {
      setExporting(false)
    }
  }, [buildBoardImage, roomName])

  const handleExportPdf = useCallback(async () => {
    setExporting(true)
    try {
      const img = await buildBoardImage()
      if (img) savePngAsPdf(img.dataUrl, img.width, img.height, exportFilename(roomName, 'pdf'))
    } catch (err) {
      console.error(err)
      window.alert('PDF 저장에 실패했어요.')
    } finally {
      setExporting(false)
    }
  }, [buildBoardImage, roomName])

  // WBS 작업 목록을 표(CSV)로 저장 — 엑셀/구글 시트에서 바로 열린다. 생성 순번 순서.
  const handleExportCsv = useCallback(() => {
    const tasks = nodes
      .filter((n) => isWbsData(n.data))
      .map((n) => ({ seq: seqById[n.id] ?? 0, d: n.data as WbsNodeData }))
      .sort((a, b) => a.seq - b.seq)
    if (tasks.length === 0) {
      window.alert('보드에 WBS 작업이 없어요. 작업을 추가한 뒤 저장해 보세요.')
      return
    }
    const header = [
      '번호',
      '작업명',
      '담당자',
      '상태',
      '진행률(%)',
      '시작일',
      '마감일',
      '마감 현황',
      '세부 체크항목(완료/전체)',
      '세부 체크항목 내용',
      '첨부 수',
      '투표 수',
      '댓글 수',
    ]
    const rows = tasks.map(({ seq, d }) => {
      const checklist = d.checklist ?? []
      const done = d.status === 'done'
      return [
        seq,
        d.label,
        d.assignee,
        WBS_STATUS[d.status]?.label ?? d.status,
        Math.max(0, Math.min(100, Number(d.progress) || 0)),
        d.start ?? '',
        d.due ?? '',
        d.due ? (done ? '완료' : dueBadge(d.due, false)) : '',
        checklist.length > 0 ? `${checklist.filter((c) => c.done).length}/${checklist.length}` : '',
        checklist.map((c) => `${c.done ? '[완료]' : '[ ]'} ${c.text}`).join(' / '),
        d.attachments?.length ?? 0,
        d.votes?.length ?? 0,
        d.comments?.length ?? 0,
      ]
    })
    downloadTextFile(
      toCsv([header, ...rows]),
      exportFilename(`${roomName}_WBS`, 'csv'),
      'text/csv',
      true,
    )
  }, [nodes, seqById, roomName])

  // 캘린더에 자동 기록할 WBS 마감 (마감일이 지정된 작업만). 노드에서 바로 파생하므로
  // 마감일 수정/작업 삭제/완료 토글이 캘린더에 즉시 반영된다.
  const wbsDeadlines = useMemo<WbsDeadline[]>(
    () =>
      nodes
        .filter((n) => isWbsData(n.data) && !!(n.data as WbsNodeData).due)
        .map((n) => {
          const d = n.data as WbsNodeData
          return {
            id: n.id,
            label: d.label || '(제목 없는 작업)',
            assignee: d.assignee,
            due: d.due as string,
            done: d.status === 'done',
          }
        }),
    [nodes],
  )

  // --- 마감 임박 알림 ---
  // 보드에 들어와 서버 내용을 다 받은 직후 한 번만, 완료되지 않은 작업 중
  // 마감이 지났거나 오늘/내일인 것을 모아 보여준다.
  const [deadlineAlert, setDeadlineAlert] = useState<WbsDeadline[] | null>(null)
  const deadlineCheckedRef = useRef(false)
  useEffect(() => {
    if (!synced || deadlineCheckedRef.current) return
    deadlineCheckedRef.current = true
    const tomorrow = localIsoDate(1)
    const urgent = wbsDeadlines
      .filter((d) => !d.done && d.due <= tomorrow)
      .sort((a, b) => a.due.localeCompare(b.due))
    if (urgent.length > 0) setDeadlineAlert(urgent)
  }, [synced, wbsDeadlines])

  // 간트차트 / CSV 내보내기용 WBS 작업 목록 (생성 순번 포함)
  const ganttTasks = useMemo<GanttTask[]>(
    () =>
      nodes
        .filter((n) => isWbsData(n.data))
        .map((n) => {
          const d = n.data as WbsNodeData
          return {
            id: n.id,
            seq: seqById[n.id],
            label: d.label,
            assignee: d.assignee ?? '',
            status: d.status,
            progress: d.progress,
            start: d.start || undefined,
            due: d.due || undefined,
          }
        }),
    [nodes, seqById],
  )

  // 대시보드 집계용 WBS 작업 데이터 목록
  const wbsTasks = useMemo(
    () => nodes.filter((n) => isWbsData(n.data)).map((n) => n.data as WbsNodeData),
    [nodes],
  )

  return (
    <CurrentUserContext.Provider value={username}>
    <div
      style={{ width: '100vw', height: '100vh' }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onDoubleClick={handlePaneDoubleClick}
    >
      <div className="toolbar">
        <strong className="room-title">{roomName}</strong>
        <span className={connected ? 'dot online' : 'dot offline'} />
        <span className="tool-group undo-group">
          <button
            type="button"
            onClick={undo}
            disabled={!canUndo}
            title="실행 취소 (Ctrl+Z)"
            aria-label="실행 취소"
          >
            ↶
          </button>
          <button
            type="button"
            onClick={redo}
            disabled={!canRedo}
            title="다시 실행 (Ctrl+Shift+Z 또는 Ctrl+Y)"
            aria-label="다시 실행"
          >
            ↷
          </button>
        </span>
        <span className="peers">
          접속 {peers.length}
          {peers.map((p, i) => (
            <span key={i} className="peer-chip" style={{ background: p.color }}>
              {p.name}
            </span>
          ))}
        </span>

        {/* ① 아이디어 — 브레인스토밍 */}
        <span className="tool-group" data-step="1">
          <span className="tool-step">① 아이디어</span>
          <button onClick={handleAddSticky} title="브레인스토밍용 메모(포스트잇) 추가">
            + 메모
          </button>
          <span className="tool-tip-inline">빈 곳 더블클릭으로도 추가</span>
        </span>

        {/* ② 정리 — 마인드맵 */}
        <span className="tool-group" data-step="2">
          <span className="tool-step">② 정리</span>
          <button
            onClick={handlePromoteSelected}
            disabled={promotableSelected.length === 0}
            className="primary"
            title="선택한 아이디어/메모를 WBS 작업으로 전환"
          >
            → 작업으로{promotableSelected.length > 1 ? ` (${promotableSelected.length})` : ''}
          </button>
          <button onClick={() => applyLayout('LR')} title="노드가 가로로 펼쳐지게 정렬">
            가로 정렬 →
          </button>
          <button onClick={() => applyLayout('TB')} title="노드가 세로로 쌓이게 정렬">
            세로 정렬 ↓
          </button>
        </span>

        {/* ③ 작업 — WBS */}
        <span className="tool-group" data-step="3">
          <span className="tool-step">③ 작업</span>
          <button onClick={handleAddWbs}>+ WBS 작업</button>
          <label className={assigneeFilter ? 'assignee-filter active' : 'assignee-filter'}>
            <span aria-hidden="true">👤</span>
            <span className="sr-only">담당자별로 보기</span>
            <select
              value={assigneeFilter}
              onChange={(e) => setAssigneeFilter(e.target.value)}
              title="담당자별로 걸러 보기 (내 화면에만 적용)"
            >
              <option value="">전체 보기</option>
              <option value={FILTER_MINE}>내 작업만</option>
              <option value={FILTER_UNASSIGNED}>담당자 미지정</option>
              {assigneeOptions.length > 0 && (
                <optgroup label="담당자">
                  {assigneeOptions.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>
          {filterMatchIds && (
            <span className="filter-status">
              {filterMatchIds.size}개 작업
              <button
                type="button"
                className="filter-clear"
                onClick={() => setAssigneeFilter('')}
                aria-label="담당자 필터 해제"
              >
                ✕
              </button>
            </span>
          )}
        </span>

        {/* 더보기 — 부가 기능 */}
        <span className="tool-group more-group">
          <button
            className="ghost-toggle"
            onClick={() => {
              // 펼칠 때 내 역할을 다시 확인 (팀장을 위임받았으면 삭제 버튼이 보이도록)
              if (!showMore) setRoleCheckTick((t) => t + 1)
              setShowMore((v) => !v)
            }}
          >
            {showMore ? '더보기 ▴' : '더보기 ▾'}
          </button>
          {showMore && (
            <span className="more-items">
              <button onClick={() => setShowDashboard(true)} title="팀원별 현황 / 전체 진행률">
                📊 대시보드
              </button>
              <button onClick={() => setShowGantt(true)} title="WBS 작업을 시작일~마감일 막대로 보기">
                📈 간트차트
              </button>
              <button
                onClick={() => setShowHistory((v) => !v)}
                title="누가 무엇을 바꿨는지 + 팀원별 기여도"
              >
                🕘 변경 기록
              </button>
              <button
                onClick={() => setShowCalendar((v) => !v)}
                title="팀 일정 캘린더 (날짜별 일정 추가/체크)"
              >
                🗓️ 캘린더
                {calendar.length + wbsDeadlines.length > 0
                  ? ` (${calendar.length + wbsDeadlines.length})`
                  : ''}
              </button>
              <button onClick={() => setShowPoll(true)} title="질문/선택지로 팀 투표 진행">
                🗳️ 투표
                {polls.some((p) => p && !p.closed && (p.deadline === 0 || Date.now() < p.deadline))
                  ? ' •'
                  : ''}
              </button>

              {/* 공유 — 누르면 아래로 이미지/PDF 저장 펼침 */}
              <span className="share-group">
                <button
                  onClick={() => setShowShare((v) => !v)}
                  disabled={exporting}
                  title="보드 전체를 이미지/PDF로 저장"
                >
                  📤 공유{showShare ? ' ▴' : ' ▾'}
                </button>
                {showShare && (
                  <span className="share-submenu">
                    <button
                      onClick={() => {
                        setShowShare(false)
                        handleExportImage()
                      }}
                      disabled={exporting}
                      title="보드 전체를 이미지(PNG)로 저장"
                    >
                      📷 이미지로 저장
                    </button>
                    <button
                      onClick={() => {
                        setShowShare(false)
                        handleExportPdf()
                      }}
                      disabled={exporting}
                      title="보드 전체를 PDF로 저장"
                    >
                      📄 PDF로 저장
                    </button>
                    <button
                      onClick={() => {
                        setShowShare(false)
                        handleExportCsv()
                      }}
                      title="WBS 작업 목록을 엑셀에서 열 수 있는 표(CSV)로 저장"
                    >
                      📋 WBS 표(엑셀 CSV)로 저장
                    </button>
                  </span>
                )}
              </span>

              <button onClick={handleAddImageClick} title="사진을 노드로 추가">
                + 사진
              </button>
              <button onClick={handleAlignGrid} title="선택 노드(없으면 전체)를 격자로 줄맞춤">
                격자 정렬 ▦
              </button>
              <button onClick={() => setShowEdgeStyle((v) => !v)} title="연결선 색상/굵기 설정">
                🔗 선 스타일
              </button>
              <button onClick={() => setShowMembers(true)}>멤버 관리</button>
              {isOwner && (
                <button
                  className="danger-action"
                  onClick={() => {
                    setDeleteError(null)
                    setShowDeleteBoard(true)
                  }}
                  title="이 보드를 완전히 삭제 (팀장만 가능)"
                >
                  🗑️ 보드 삭제
                </button>
              )}
            </span>
          )}
        </span>

        <button className="leave-btn" onClick={onLeave}>
          나가기
        </button>
      </div>

      {/* 오른쪽 상단(나가기 아래) 상시 노출 채팅 버튼 */}
      <button
        className={[
          'chat-fab',
          showChat ? 'active' : '',
          // 우측 사이드 패널(채팅/캘린더/대시보드/투표/댓글)이 열려 있으면 가리지 않게 왼쪽으로 비켜남
          showChat || showCalendar || showDashboard || showPoll || showHistory || commentNodeId
            ? 'shifted'
            : '',
        ]
          .filter(Boolean)
          .join(' ')}
        onClick={() => setShowChat((v) => !v)}
        title="방에 들어온 참여자들끼리 실시간 채팅"
        aria-label={
          unreadChatCount > 0 && !showChat ? `채팅, 안 읽은 메시지 ${unreadChatCount}개` : '채팅'
        }
      >
        💬 채팅
        {unreadChatCount > 0 && !showChat && (
          <span className="chat-unread-badge" aria-hidden="true">
            {unreadChatCount > 99 ? '99+' : unreadChatCount}
          </span>
        )}
      </button>

      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleImagePicked}
      />

      {textModal && (
        <TextInputModal
          heading={textModal.heading}
          initial={textModal.initial}
          confirmLabel={textModal.confirmLabel}
          withTitle={textModal.withTitle}
          initialTitle={textModal.initialTitle}
          onSubmit={textModal.onSubmit}
          onClose={() => setTextModal(null)}
        />
      )}

      {showEdgeStyle && (
        <div className="edge-style-pop" onClick={(e) => e.stopPropagation()}>
          <div className="edge-style-head">
            <strong>🔗 연결선 스타일</strong>
            <button type="button" className="ghost" onClick={() => setShowEdgeStyle(false)}>
              닫기
            </button>
          </div>
          <p className="edge-style-note">모든 참여자에게 공유돼요</p>

          <div className="field-label">색상</div>
          <div className="edge-color-row">
            {EDGE_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={edgeStyle.color === c ? 'edge-color active' : 'edge-color'}
                style={{ background: c }}
                onClick={() => setEdgeStyle({ ...edgeStyle, color: c })}
                title={c}
              />
            ))}
            <input
              type="color"
              className="edge-color-custom"
              value={edgeStyle.color}
              onChange={(e) => setEdgeStyle({ ...edgeStyle, color: e.target.value })}
              title="직접 선택"
            />
          </div>

          <div className="field-label">굵기</div>
          <div className="edge-width-row">
            {EDGE_WIDTHS.map((w) => (
              <button
                key={w.value}
                type="button"
                className={edgeStyle.width === w.value ? 'edge-width active' : 'edge-width'}
                onClick={() => setEdgeStyle({ ...edgeStyle, width: w.value })}
              >
                {w.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            className="ghost edge-reset"
            onClick={() => setEdgeStyle(DEFAULT_EDGE_STYLE)}
          >
            기본값으로
          </button>
        </div>
      )}

      {showMembers && (
        <MembersPanel
          slug={room}
          onClose={() => setShowMembers(false)}
          onRoleChanged={(role) => setIsOwner(role === 'owner')}
          onLeft={() => {
            leavingByMeRef.current = true
            onLeave()
          }}
        />
      )}

      {showHistory && (
        <HistoryPanel
          entries={activity}
          existingNodeIds={existingNodeIds}
          onFocusNode={focusNode}
          onOpenCalendar={() => {
            setShowHistory(false)
            setShowCalendar(true)
          }}
          onClose={() => setShowHistory(false)}
        />
      )}

      {showGantt && (
        <GanttPanel
          tasks={ganttTasks}
          onOpenTask={(id) => {
            setShowGantt(false)
            setEditingWbsId(id)
          }}
          onClose={() => setShowGantt(false)}
        />
      )}

      {deadlineAlert && (
        <DeadlineAlert
          items={deadlineAlert}
          onOpenTask={(id) => {
            setDeadlineAlert(null)
            setEditingWbsId(id)
          }}
          onOpenCalendar={() => {
            setDeadlineAlert(null)
            setShowCalendar(true)
          }}
          onClose={() => setDeadlineAlert(null)}
        />
      )}

      {showDeleteBoard && isOwner && (
        <DeleteBoardModal
          roomName={roomName}
          deleting={deletingBoard}
          error={deleteError}
          onConfirm={handleDeleteBoard}
          onClose={() => setShowDeleteBoard(false)}
        />
      )}

      <PersonalSpacePanel
        room={room}
        username={username}
        collapsed={personalCollapsed}
        onToggle={() => setPersonalCollapsed((v) => !v)}
      />

      {showDashboard && (
        <DashboardPanel tasks={wbsTasks} onClose={() => setShowDashboard(false)} />
      )}

      {showPoll && (
        <PollPanel
          polls={polls}
          username={username}
          onCreate={(q, opts, deadline) => createPoll(q, opts, username, deadline)}
          onVote={(pollId, optId) => votePoll(pollId, optId, username)}
          onCloseVote={(pollId) => closePoll(pollId)}
          onClear={(pollId) => clearPoll(pollId)}
          onDismiss={() => setShowPoll(false)}
        />
      )}

      {showChat && (
        <ChatPanel
          roomName={roomName}
          messages={chat}
          currentUsername={username}
          peerCount={peers.length}
          onSend={(text) => sendChatMessage(text, user.name, username, user.color)}
          onEdit={(id, text) => editChatMessage(id, text)}
          onDelete={(id) => deleteChatMessage(id)}
          onClose={() => setShowChat(false)}
        />
      )}

      {showCalendar && (
        <CalendarPanel
          roomName={roomName}
          events={calendar}
          deadlines={wbsDeadlines}
          onToggleDeadline={(nodeId) => toggleWbsDone(nodeId)}
          memberNames={memberNames}
          onAdd={(date, text, extra) => addCalendarEvent(date, text, username, extra)}
          onToggle={(id) => toggleCalendarEvent(id)}
          onEdit={(id, patch) => editCalendarEvent(id, patch)}
          onDelete={(id) => deleteCalendarEvent(id)}
          onClose={() => setShowCalendar(false)}
        />
      )}

      {commentNode && commentNodeId && (
        <CommentsPanel
          nodeTitle={nodeTitleOf(commentNode)}
          comments={commentList}
          currentUsername={username}
          onAdd={(text) =>
            addComment(commentNodeId, { author: user.name, authorUsername: username, text })
          }
          onEdit={(cid, text) => editComment(commentNodeId, cid, text)}
          onDelete={(cid) => deleteComment(commentNodeId, cid)}
          onClose={() => setCommentNodeId(null)}
        />
      )}

      {editingData && editingWbsId && (
        <WbsEditPanel
          roomSlug={room}
          initial={editingData}
          onSave={(patch) => updateWbsNode(editingWbsId, patch)}
          onAddAttachment={(a) => addAttachment(editingWbsId, a)}
          onRemoveAttachment={(aid) => removeAttachment(editingWbsId, aid)}
          onAddChecklistItem={(t) => addChecklistItem(editingWbsId, t)}
          onToggleChecklistItem={(iid) => toggleChecklistItem(editingWbsId, iid)}
          onRemoveChecklistItem={(iid) => removeChecklistItem(editingWbsId, iid)}
          onClose={() => setEditingWbsId(null)}
        />
      )}

      <ReactFlow
        nodes={displayNodes}
        edges={displayEdges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeDoubleClick={handleNodeDoubleClick}
        onNodeDrag={handleNodeDrag}
        onNodeDragStop={handleNodeDragStop}
        snapToGrid
        snapGrid={[20, 20]}
        fitView
      >
        <Background />
        <Controls />
        <MiniMap pannable zoomable />
        <LiveCursors cursors={cursors} />
      </ReactFlow>

      {exporting && (
        <div className="export-overlay">
          <div className="export-toast">저장할 이미지를 만드는 중...</div>
        </div>
      )}

      {isEmpty && !guideDismissed && (
        <div className="empty-guide">
          <div className="empty-card">
            <button
              type="button"
              className="empty-card-close"
              onClick={() => setGuideDismissed(true)}
              title="안내 닫기"
            >
              ✕
            </button>
            <h2>이렇게 진행해요 👋</h2>
            <ol className="flow-steps">
              <li>
                <span className="flow-badge">①</span>
                <div>
                  <strong>아이디어 모으기</strong>
                  <p>빈 곳을 더블클릭하거나 <b>+ 메모</b>로 떠오르는 생각을 자유롭게 적어요.</p>
                </div>
              </li>
              <li>
                <span className="flow-badge">②</span>
                <div>
                  <strong>마인드맵으로 정리</strong>
                  <p>노드의 점끼리 드래그해 연결하고(상하좌우 어디든), <b>가로/세로 정렬</b>로 트리처럼 구조화해요.</p>
                </div>
              </li>
              <li>
                <span className="flow-badge">③</span>
                <div>
                  <strong>작업으로 전환</strong>
                  <p>채택한 아이디어를 골라 <b>→ 작업으로</b> 버튼을 누르면 담당자·진행률이 있는 WBS 작업이 돼요.</p>
                </div>
              </li>
            </ol>
          </div>
        </div>
      )}
    </div>
    </CurrentUserContext.Provider>
  )
}

export default function Board(props: BoardProps) {
  return (
    <ReactFlowProvider>
      <BoardInner {...props} />
    </ReactFlowProvider>
  )
}
