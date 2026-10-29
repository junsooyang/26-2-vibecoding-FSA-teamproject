import dagre from '@dagrejs/dagre'
import type { BoardEdge, BoardNode } from './yjs'

export type LayoutDirection = 'TB' | 'LR'

// 노드 크기(레이아웃 간격 계산용). 실제 렌더 크기와 대략 맞춘 값.
const NODE_W = 200
const NODE_H = 80

/**
 * Dagre 로 노드/엣지를 트리(계층) 형태로 자동 정렬한다.
 * - 엣지 연결 관계를 따라 부모→자식 계층을 만든다.
 * - direction: 'TB'(위→아래) 또는 'LR'(좌→우, 마인드맵에 적합)
 * 반환: position 이 갱신된 새 노드 배열 (엣지는 그대로)
 */
export function layoutNodes(
  nodes: BoardNode[],
  edges: BoardEdge[],
  direction: LayoutDirection = 'LR',
): BoardNode[] {
  if (nodes.length === 0) return nodes

  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({
    rankdir: direction,
    nodesep: 40, // 같은 계층 내 노드 간격
    ranksep: 90, // 계층(레벨) 간 간격
    marginx: 20,
    marginy: 20,
  })

  for (const node of nodes) {
    g.setNode(node.id, { width: NODE_W, height: NODE_H })
  }
  for (const edge of edges) {
    // 연결된 노드가 모두 존재할 때만 엣지 반영
    if (g.hasNode(edge.source) && g.hasNode(edge.target)) {
      g.setEdge(edge.source, edge.target)
    }
  }

  dagre.layout(g)

  return nodes.map((node) => {
    const pos = g.node(node.id)
    if (!pos) return node
    // Dagre 는 노드 중심 좌표를 주므로 좌상단 기준으로 변환
    return {
      ...node,
      position: { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 },
    }
  })
}
