/**
 * React Flow 변경(NodeChange/EdgeChange) 을 공유 문서(Yjs)와 내 화면 상태로 나눠 반영하는 로직.
 * useCollabBoard 훅과 자동 테스트가 같은 코드를 쓰도록 순수 함수로 분리했다.
 *
 * 선택(클릭)과 React Flow 의 크기 측정은 사람마다 다른 "화면 상태"다. 공유 문서에 쓰면
 *  - 내가 고른 노드가 다른 팀원 화면에서도 선택된 것처럼 보이고
 *  - "노드 이동 → 클릭" 처럼 같은 노드에 더 새로운 값이 덮이면 Yjs 가 이동을 되돌리지 못한다.
 * 그래서 이 값들은 브라우저 메모리에만 두고, 화면에 줄 때 공유 노드와 합친다.
 */
import {
  applyEdgeChanges,
  applyNodeChanges,
  type EdgeChange,
  type NodeChange,
} from '@xyflow/react'
import type * as Y from 'yjs'
import type { BoardEdge, BoardNode } from './yjs'

/** 내 화면에만 두는 노드 상태 (공유 문서에 쓰지 않음) */
export interface NodeUi {
  selected?: boolean
  measured?: { width?: number; height?: number }
  width?: number
  height?: number
  resizing?: boolean
}

/** 공유 문서에 쓰기 전에 화면 전용 필드를 뺀다. (예전 데이터에 남아 있던 값도 정리) */
export function stripUi<T extends object>(item: T): T {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { selected, measured, resizing, ...rest } = item as Record<string, unknown>
  return rest as T
}

/** 공유 노드 + 내 화면 상태를 합쳐 React Flow 에 줄 노드를 만든다. */
export function mergeNodeUi(node: BoardNode, ui: NodeUi | undefined): BoardNode {
  const merged: BoardNode = { ...node, selected: ui?.selected ?? false }
  if (ui?.measured) merged.measured = ui.measured
  if (ui?.width !== undefined) merged.width = ui.width
  if (ui?.height !== undefined) merged.height = ui.height
  if (ui?.resizing !== undefined) merged.resizing = ui.resizing
  return merged
}

/**
 * 노드 변경을 반영한다.
 *  1) 선택 / 크기 측정 → nodeUi(내 화면 상태)만 갱신
 *  2) 이동 / 삭제 / 추가 / 교체 → 공유 문서에 기록 (실행 취소 대상)
 *     applyNodeChanges 는 바뀌지 않은 노드는 같은 객체를 돌려주므로, 실제로 바뀐 노드만 써서
 *     다른 팀원이 동시에 고친 노드를 덮어쓰지 않는다.
 *
 * 반환: uiChanged(화면 상태가 바뀌어 다시 그려야 하는지), written(공유 문서에 쓴 노드 수)
 */
export function applyNodeChangesToBoard(
  doc: Y.Doc,
  nodes: Y.Map<BoardNode>,
  nodeUi: Map<string, NodeUi>,
  changes: NodeChange<BoardNode>[],
): { uiChanged: boolean; written: number } {
  const dataChanges: NodeChange<BoardNode>[] = []
  let uiChanged = false
  for (const c of changes) {
    if (c.type === 'select') {
      nodeUi.set(c.id, { ...(nodeUi.get(c.id) ?? {}), selected: c.selected })
      uiChanged = true
    } else if (c.type === 'dimensions') {
      const ui: NodeUi = { ...(nodeUi.get(c.id) ?? {}) }
      if (c.dimensions) {
        ui.measured = { width: c.dimensions.width, height: c.dimensions.height }
        if (c.setAttributes === true || c.setAttributes === 'width') ui.width = c.dimensions.width
        if (c.setAttributes === true || c.setAttributes === 'height') ui.height = c.dimensions.height
      }
      if (typeof c.resizing === 'boolean') ui.resizing = c.resizing
      nodeUi.set(c.id, ui)
      uiChanged = true
    } else {
      dataChanges.push(c)
    }
  }
  if (dataChanges.length === 0) return { uiChanged, written: 0 }

  const prev = Array.from(nodes.values())
  const next = applyNodeChanges(dataChanges, prev)
  const prevById = new Map(prev.map((n) => [n.id, n]))
  const nextIds = new Set(next.map((n) => n.id))
  let written = 0
  doc.transact(() => {
    for (const n of prev) {
      if (!nextIds.has(n.id)) {
        nodes.delete(n.id)
        nodeUi.delete(n.id)
        written++
      }
    }
    for (const n of next) {
      if (prevById.get(n.id) !== n) {
        nodes.set(n.id, stripUi(n))
        written++
      }
    }
  })
  return { uiChanged, written }
}

/** 연결선 변경을 반영한다. 선택은 edgeSelected(내 화면 상태)로만. */
export function applyEdgeChangesToBoard(
  doc: Y.Doc,
  edges: Y.Map<BoardEdge>,
  edgeSelected: Map<string, boolean>,
  changes: EdgeChange<BoardEdge>[],
): { uiChanged: boolean; written: number } {
  const dataChanges: EdgeChange<BoardEdge>[] = []
  let uiChanged = false
  for (const c of changes) {
    if (c.type === 'select') {
      edgeSelected.set(c.id, c.selected)
      uiChanged = true
    } else {
      dataChanges.push(c)
    }
  }
  if (dataChanges.length === 0) return { uiChanged, written: 0 }

  const prev = Array.from(edges.values())
  const next = applyEdgeChanges(dataChanges, prev)
  const prevById = new Map(prev.map((e) => [e.id, e]))
  const nextIds = new Set(next.map((e) => e.id))
  let written = 0
  doc.transact(() => {
    for (const e of prev) {
      if (!nextIds.has(e.id)) {
        edges.delete(e.id)
        edgeSelected.delete(e.id)
        written++
      }
    }
    for (const e of next) {
      if (prevById.get(e.id) !== e) {
        edges.set(e.id, stripUi(e))
        written++
      }
    }
  })
  return { uiChanged, written }
}
