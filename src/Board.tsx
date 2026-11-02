import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  ReactFlowProvider,
  useReactFlow,
  type NodeMouseHandler,
  type NodeTypes,
  type OnNodeDrag,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useCollabBoard, type AwarenessUser } from './collab/useCollabBoard'
import { isWbsData, type BoardNode, type WbsNodeData } from './collab/yjs'
import MembersPanel from './screens/MembersPanel'
import WbsEditPanel from './screens/WbsEditPanel'
import WbsNode, { WBS_TOGGLE_DONE_EVENT } from './nodes/WbsNode'
import ImageNode from './nodes/ImageNode'
import LiveCursors from './nodes/LiveCursors'

/** 업로드 이미지 최대 크기(3MB). data URL 로 Yjs 에 저장되므로 과도한 용량 방지. */
const MAX_IMAGE_SIZE = 3 * 1024 * 1024

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
  onLeave: () => void
}

function BoardInner({ room, roomName, user, onLeave }: BoardProps) {
  const [showMembers, setShowMembers] = useState(false)
  // 편집 중인 WBS 노드 id (null = 패널 닫힘)
  const [editingWbsId, setEditingWbsId] = useState<string | null>(null)
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
  } = useCollabBoard(room, user)

  // 드래그 중인 노드 위에 겹친 "드롭 대상" 노드 id (초록 하이라이트용)
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)
  // 이미지 업로드용 숨은 input
  const imageInputRef = useRef<HTMLInputElement>(null)

  // WBS 노드 체크박스 토글 이벤트 수신 -> 완료 상태 전환
  useEffect(() => {
    const handler = (e: Event) => {
      const id = (e as CustomEvent<{ id: string }>).detail?.id
      if (id) toggleWbsDone(id)
    }
    window.addEventListener(WBS_TOGGLE_DONE_EVENT, handler)
    return () => window.removeEventListener(WBS_TOGGLE_DONE_EVENT, handler)
  }, [toggleWbsDone])

  const { screenToFlowPosition } = useReactFlow()

  // 커스텀 노드 타입 등록
  const nodeTypes = useMemo<NodeTypes>(() => ({ wbs: WbsNode, image: ImageNode }), [])

  // 드래그 대상에 하이라이트 클래스를 입힌 노드 배열
  const displayNodes = useMemo(
    () =>
      nodes.map((n) =>
        n.id === dropTargetId ? { ...n, className: `${n.className ?? ''} drop-target`.trim() } : n,
      ),
    [nodes, dropTargetId],
  )

  // 편집 중인 WBS 노드의 현재 데이터
  const editingNode = editingWbsId ? nodes.find((n) => n.id === editingWbsId) : undefined
  const editingData =
    editingNode && isWbsData(editingNode.data) ? (editingNode.data as WbsNodeData) : null

  // 빈 캔버스 더블클릭 -> 새 일반 노드 추가 (빈 pane 에서만)
  const handlePaneDoubleClick = useCallback(
    (event: React.MouseEvent) => {
      const target = event.target as HTMLElement
      if (!target.classList.contains('react-flow__pane')) return
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY })
      const label = window.prompt('노드 내용 입력', '새 아이디어')
      if (label) addNode(label, position)
    },
    [addNode, screenToFlowPosition],
  )

  // 노드 더블클릭 -> WBS 노드는 편집 패널, 일반 노드는 프롬프트
  const handleNodeDoubleClick: NodeMouseHandler<BoardNode> = useCallback(
    (_event, node) => {
      if (isWbsData(node.data)) {
        setEditingWbsId(node.id)
        return
      }
      const label = window.prompt('노드 수정', String(node.data.label))
      if (label != null) renameNode(node.id, label)
    },
    [renameNode],
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

  return (
    <div
      style={{ width: '100vw', height: '100vh' }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <div className="toolbar">
        <strong>{roomName}</strong>
        <span className={connected ? 'dot online' : 'dot offline'} />
        <span>{connected ? '실시간 연결됨' : '연결 시도 중...'}</span>
        <span className="peers">
          접속 {peers.length}명
          {peers.map((p, i) => (
            <span key={i} className="peer-chip" style={{ background: p.color }}>
              {p.name}
            </span>
          ))}
        </span>
        <span className="hint">
          더블클릭: 아이디어 · 노드를 다른 노드 위로 드래그: 합치기 · 점끼리 드래그: 연결
        </span>
        <button onClick={handleAddWbs}>+ WBS 작업</button>
        <button onClick={handleAddImageClick} title="사진을 노드로 추가">
          + 사진
        </button>
        <button onClick={() => applyLayout('LR')} title="좌→우 트리 정렬">
          자동 정렬 ↔
        </button>
        <button onClick={() => applyLayout('TB')} title="위→아래 트리 정렬">
          자동 정렬 ↕
        </button>
        <button onClick={handleAlignGrid} title="선택 노드(없으면 전체)를 격자로 줄맞춤">
          격자 정렬 ▦
        </button>
        <button onClick={() => setShowMembers(true)}>멤버 관리</button>
        <button onClick={onLeave}>나가기</button>
      </div>

      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleImagePicked}
      />

      {showMembers && <MembersPanel slug={room} onClose={() => setShowMembers(false)} />}

      {editingData && editingWbsId && (
        <WbsEditPanel
          initial={editingData}
          onSave={(patch) => updateWbsNode(editingWbsId, patch)}
          onAddAttachment={(a) => addAttachment(editingWbsId, a)}
          onRemoveAttachment={(aid) => removeAttachment(editingWbsId, aid)}
          onClose={() => setEditingWbsId(null)}
        />
      )}

      <ReactFlow
        nodes={displayNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onDoubleClick={handlePaneDoubleClick}
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
    </div>
  )
}

export default function Board(props: BoardProps) {
  return (
    <ReactFlowProvider>
      <BoardInner {...props} />
    </ReactFlowProvider>
  )
}
