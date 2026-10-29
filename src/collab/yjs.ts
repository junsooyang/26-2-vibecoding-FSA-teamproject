import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import type { Edge, Node } from '@xyflow/react'

/**
 * Yjs 기반 실시간 협업 레이어.
 *
 * - 하나의 "방(room)" = 하나의 Y.Doc
 * - 노드와 엣지를 각각 Y.Map 에 저장한다. (키 = id, 값 = 노드/엣지 객체)
 * - 여러 참여자가 동시에 같은 보드를 편집해도 CRDT 가 자동으로 병합한다.
 */

export type BoardNode = Node<{ label: string }>
export type BoardEdge = Edge

export interface CollabHandle {
  doc: Y.Doc
  provider: WebsocketProvider
  nodes: Y.Map<BoardNode>
  edges: Y.Map<BoardEdge>
  /** 현재 접속한 사용자 정보(커서/이름 공유용) */
  awareness: WebsocketProvider['awareness']
  destroy: () => void
}

const WS_URL = import.meta.env.VITE_WS_URL ?? 'ws://localhost:1234'

/**
 * 방 이름으로 협업 세션을 연결한다.
 * 같은 roomName 으로 접속한 모든 클라이언트가 실시간 동기화된다.
 */
export function connectRoom(roomName: string, user: { name: string; color: string }): CollabHandle {
  const doc = new Y.Doc()
  const provider = new WebsocketProvider(WS_URL, roomName, doc)

  const nodes = doc.getMap<BoardNode>('nodes')
  const edges = doc.getMap<BoardEdge>('edges')

  provider.awareness.setLocalStateField('user', user)

  return {
    doc,
    provider,
    nodes,
    edges,
    awareness: provider.awareness,
    destroy: () => {
      provider.destroy()
      doc.destroy()
    },
  }
}
