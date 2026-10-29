import { useCallback, useMemo, useState } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  ReactFlowProvider,
  useReactFlow,
  type NodeMouseHandler,
  type NodeTypes,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useCollabBoard, type AwarenessUser } from './collab/useCollabBoard'
import { isWbsData, type BoardNode, type WbsNodeData } from './collab/yjs'
import MembersPanel from './screens/MembersPanel'
import WbsEditPanel from './screens/WbsEditPanel'
import WbsNode from './nodes/WbsNode'

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
    connected,
    onNodesChange,
    onEdgesChange,
    onConnect,
    addNode,
    renameNode,
    addWbsNode,
    updateWbsNode,
  } = useCollabBoard(room, user)

  const { screenToFlowPosition } = useReactFlow()

  // 커스텀 노드 타입 등록
  const nodeTypes = useMemo<NodeTypes>(() => ({ wbs: WbsNode }), [])

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

  return (
    <div style={{ width: '100vw', height: '100vh' }}>
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
          빈 공간 더블클릭: 아이디어 노드 · 노드 더블클릭: 수정 · 점끼리 드래그: 연결
        </span>
        <button onClick={handleAddWbs}>+ WBS 작업</button>
        <button onClick={() => setShowMembers(true)}>멤버 관리</button>
        <button onClick={onLeave}>나가기</button>
      </div>

      {showMembers && <MembersPanel slug={room} onClose={() => setShowMembers(false)} />}

      {editingData && editingWbsId && (
        <WbsEditPanel
          initial={editingData}
          onSave={(patch) => updateWbsNode(editingWbsId, patch)}
          onClose={() => setEditingWbsId(null)}
        />
      )}

      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onDoubleClick={handlePaneDoubleClick}
        onNodeDoubleClick={handleNodeDoubleClick}
        fitView
      >
        <Background />
        <Controls />
        <MiniMap pannable zoomable />
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
