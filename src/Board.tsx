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
import MembersPanel from './screens/MembersPanel'
import WbsEditPanel from './screens/WbsEditPanel'
import CommentsPanel from './screens/CommentsPanel'
import PersonalSpacePanel from './screens/PersonalSpacePanel'
import DashboardPanel from './screens/DashboardPanel'
import TextInputModal from './screens/TextInputModal'
import PollPanel from './screens/PollPanel'
import {
  captureBoardPng,
  downloadDataUrl,
  exportFilename,
  savePngAsPdf,
} from './collab/exportBoard'
import WbsNode from './nodes/WbsNode'
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

/** 업로드 이미지 최대 크기(3MB). data URL 로 Yjs 에 저장되므로 과도한 용량 방지. */
const MAX_IMAGE_SIZE = 3 * 1024 * 1024

/** 연결선(엣지) 스타일 설정 UI 옵션 — 실제 값은 Yjs(meta)에 공유 저장된다. */
const DEFAULT_EDGE_STYLE = { color: '#6366f1', width: 2.5 }
const EDGE_COLORS = ['#6366f1', '#111827', '#ef4444', '#f59e0b', '#22c55e', '#06b6d4', '#ec4899']
const EDGE_WIDTHS: { label: string; value: number }[] = [
  { label: '가늘게', value: 1.5 },
  { label: '보통', value: 2.5 },
  { label: '굵게', value: 4 },
  { label: '매우 굵게', value: 6 },
]

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
  // 부가 기능(사진/정렬/개인공간 등) 더보기 펼침 여부
  const [showMore, setShowMore] = useState(false)
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
    edgeStyle,
    setEdgeStyle,
    resizeNode,
    toggleCollapse,
  } = useCollabBoard(room, user)

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

  const { screenToFlowPosition, getNodes } = useReactFlow()
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

  // 드래그 하이라이트 + 생성 순번(seq)을 data 에 주입한 노드 배열
  const displayNodes = useMemo(
    () =>
      nodes.map((n) => {
        const withSeq = { ...n, data: { ...n.data, seq: seqById[n.id] } }
        return n.id === dropTargetId
          ? { ...withSeq, className: `${n.className ?? ''} drop-target`.trim() }
          : withSeq
      }),
    [nodes, dropTargetId, seqById],
  )

  // 내 설정(색상/굵기)을 모든 연결선에 적용 + 화살표 표시 (내 화면에만 반영)
  const displayEdges = useMemo<Edge[]>(
    () =>
      edges.map((e) => ({
        ...e,
        style: { ...e.style, stroke: edgeStyle.color, strokeWidth: edgeStyle.width },
        markerEnd: { type: MarkerType.ArrowClosed, color: edgeStyle.color },
      })),
    [edges, edgeStyle],
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
      if (file) {
        if (file.size > MAX_IMAGE_SIZE) {
          window.alert('이미지가 너무 큽니다. 최대 3MB까지 가능합니다.')
        } else {
          const reader = new FileReader()
          reader.onload = () => {
            const position = screenToFlowPosition({
              x: window.innerWidth / 2,
              y: window.innerHeight / 2,
            })
            addImageNode(String(reader.result), position, file.name)
          }
          reader.readAsDataURL(file)
        }
      }
      if (imageInputRef.current) imageInputRef.current.value = ''
    },
    [addImageNode, screenToFlowPosition],
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
        </span>

        {/* 더보기 — 부가 기능 */}
        <span className="tool-group more-group">
          <button className="ghost-toggle" onClick={() => setShowMore((v) => !v)}>
            {showMore ? '더보기 ▴' : '더보기 ▾'}
          </button>
          {showMore && (
            <span className="more-items">
              <button onClick={() => setShowDashboard(true)} title="팀원별 현황 / 전체 진행률">
                📊 대시보드
              </button>
              <button onClick={() => setShowPoll(true)} title="질문/선택지로 팀 투표 진행">
                🗳️ 투표
                {polls.some((p) => p && !p.closed && (p.deadline === 0 || Date.now() < p.deadline))
                  ? ' •'
                  : ''}
              </button>
              <button onClick={handleExportImage} disabled={exporting} title="보드 전체를 이미지(PNG)로 저장">
                📷 이미지
              </button>
              <button onClick={handleExportPdf} disabled={exporting} title="보드 전체를 PDF로 저장">
                📄 PDF
              </button>
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
            </span>
          )}
        </span>

        <button className="leave-btn" onClick={onLeave}>
          나가기
        </button>
      </div>

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

      {showMembers && <MembersPanel slug={room} onClose={() => setShowMembers(false)} />}

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
