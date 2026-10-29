import { useCallback } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  ReactFlowProvider,
  useReactFlow,
  type NodeMouseHandler,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useCollabBoard, type AwarenessUser } from './collab/useCollabBoard'
import type { BoardNode } from './collab/yjs'

interface BoardProps {
  room: string
  user: AwarenessUser
  onLeave: () => void
}

function BoardInner({ room, user, onLeave }: BoardProps) {
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
  } = useCollabBoard(room, user)

  const { screenToFlowPosition } = useReactFlow()

  // 빈 캔버스 더블클릭 -> 새 노드 추가 (노드 위 더블클릭은 수정으로 처리하므로 제외)
  const handlePaneDoubleClick = useCallback(
    (event: React.MouseEvent) => {
      const target = event.target as HTMLElement
      // 노드/엣지 등 요소 위에서의 더블클릭은 무시하고, 빈 캔버스(pane)에서만 추가
      if (!target.classList.contains('react-flow__pane')) return
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY })
      const label = window.prompt('노드 내용 입력', '새 아이디어')
      if (label) addNode(label, position)
    },
    [addNode, screenToFlowPosition],
  )

  // 노드 더블클릭 -> 이름 수정
  const handleNodeDoubleClick: NodeMouseHandler<BoardNode> = useCallback(
    (_event, node) => {
      const label = window.prompt('노드 수정', String(node.data.label))
      if (label != null) renameNode(node.id, label)
    },
    [renameNode],
  )

  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <div className="toolbar">
        <strong>방: {room}</strong>
        <span className={connected ? 'dot online' : 'dot offline'} />
        <span>{connected ? '실시간 연결됨' : '연결 시도 중...'}</span>
        <span className="peers">
          참여자 {peers.length}명
          {peers.map((p, i) => (
            <span key={i} className="peer-chip" style={{ background: p.color }}>
              {p.name}
            </span>
          ))}
        </span>
        <span className="hint">빈 공간 더블클릭: 노드 추가 · 노드 더블클릭: 수정 · 점끼리 드래그: 연결</span>
        <button onClick={onLeave}>방 나가기</button>
      </div>

      <ReactFlow
        nodes={nodes}
        edges={edges}
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
