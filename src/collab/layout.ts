import dagre from '@dagrejs/dagre'
import type { BoardEdge, BoardNode } from './yjs'

export type LayoutDirection = 'TB' | 'LR'

// 실측 크기(node.measured)가 없을 때 쓰는 기본값.
const DEFAULT_W = 200
const DEFAULT_H = 100

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
    nodesep: 55, // 같은 계층 내 노드 간격
    ranksep: 110, // 계층(레벨) 간 간격
    marginx: 20,
    marginy: 20,
  })

  for (const node of nodes) {
    // 실제 렌더된 크기를 쓰면 높이가 제각각인 노드(스티커/WBS)도 겹치지 않는다.
    const width = node.measured?.width ?? DEFAULT_W
    const height = node.measured?.height ?? DEFAULT_H
    g.setNode(node.id, { width, height })
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
    // Dagre 는 노드 중심 좌표를 주므로, 각 노드 실측 크기로 좌상단 기준 변환
    const width = node.measured?.width ?? DEFAULT_W
    const height = node.measured?.height ?? DEFAULT_H
    return {
      ...node,
      position: { x: pos.x - width / 2, y: pos.y - height / 2 },
    }
  })
}
