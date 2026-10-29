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
  type BoardEdge,
  type BoardNode,
  type CollabHandle,
  type WbsNodeData,
} from './yjs'

export interface AwarenessUser {
  name: string
  color: string
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
  const [connected, setConnected] = useState(false)

  // 방 연결 + Yjs 관찰자 등록
  useEffect(() => {
    const handle = connectRoom(roomName, user)
    handleRef.current = handle

    const syncNodes = () => setNodes(Array.from(handle.nodes.values()))
    const syncEdges = () => setEdges(Array.from(handle.edges.values()))

    handle.nodes.observe(syncNodes)
    handle.edges.observe(syncEdges)
    // 초기 상태 반영
    syncNodes()
    syncEdges()

    handle.provider.on('status', (e: { status: string }) => {
      setConnected(e.status === 'connected')
    })

    const syncPeers = () => {
      const states = Array.from(handle.awareness.getStates().values())
      setPeers(states.map((s) => (s as { user?: AwarenessUser }).user).filter(Boolean) as AwarenessUser[])
    }
    handle.awareness.on('change', syncPeers)
    syncPeers()

    return () => {
      handle.nodes.unobserve(syncNodes)
      handle.edges.unobserve(syncEdges)
      handle.awareness.off('change', syncPeers)
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
      data: { label },
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

  return useMemo(
    () => ({
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
    }),
    [
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
    ],
  )
}
