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

/** WBS 작업 상태 */
export type WbsStatus = 'todo' | 'doing' | 'done'

/** 노드 댓글(의견) — 모든 노드에 공통 적용 */
export interface Comment {
  /** 고유 id */
  id: string
  /** 작성자 표시 이름 */
  author: string
  /** 작성자 username (삭제 권한 판정용) */
  authorUsername: string
  /** 댓글 내용 */
  text: string
  /** 작성 시각(ms) */
  at: number
}

/** 첨부(링크 또는 업로드 파일) */
export interface Attachment {
  /** 고유 id */
  id: string
  /** link = 외부 URL, file = 업로드 파일(data URL 로 저장) */
  type: 'link' | 'file'
  /** 표시 이름(링크 제목 또는 파일명) */
  name: string
  /** link: URL, file: data URL(base64) */
  url: string
  /** 파일 바이트 크기(file 일 때) */
  size?: number
  /** MIME 타입(file 일 때) */
  mime?: string
}

/** 일반(브레인스토밍) 노드 데이터 */
export interface PlainNodeData {
  label: string
  /** 노드 댓글 목록 */
  comments?: Comment[]
  // React Flow 의 Node<T> 제약(Record<string, unknown>) 충족용 인덱스 시그니처
  [key: string]: unknown
}

/** 스티커 메모 색상 */
export type StickyColor = 'yellow' | 'pink' | 'blue' | 'green'

/** WBS 세부 체크항목(서브태스크) */
export interface ChecklistItem {
  /** 고유 id */
  id: string
  /** 항목 내용 */
  text: string
  /** 완료 여부 */
  done: boolean
}

/** WBS(작업 분해) 노드 데이터 */
export interface WbsNodeData {
  label: string
  /** 담당자 */
  assignee: string
  /** 상태: 할 일 / 진행 중 / 완료 */
  status: WbsStatus
  /** 진행률 0~100 */
  progress: number
  /** 마감일 (YYYY-MM-DD 문자열, 없으면 빈 문자열) */
  due?: string
  /** 세부 체크항목(서브태스크) 목록 */
  checklist?: ChecklistItem[]
  /** 저장용 첨부(링크/파일) 목록 */
  attachments?: Attachment[]
  /** 투표한 사용자 username 목록 (1인 1표) */
  votes?: string[]
  /** 노드 댓글 목록 */
  comments?: Comment[]
  /** 사용자가 조절한 너비/높이(px). 없으면 자동 크기 */
  w?: number
  h?: number
  /** 긴 내용 접힘 여부 */
  collapsed?: boolean
  /** 노드 타입 식별용 (data 로도 구분할 수 있게 둠) */
  kind: 'wbs'
  // React Flow 의 Node<T> 제약 충족용 인덱스 시그니처
  [key: string]: unknown
}

/** 스티커(포스트잇) 메모 노드 데이터 */
export interface StickyNodeData {
  /** 메모 제목 (선택) */
  title?: string
  /** 메모 텍스트 */
  text: string
  /** 메모 색상 */
  color: StickyColor
  /** 투표한 사용자 username 목록 (1인 1표) */
  votes?: string[]
  /** 노드 댓글 목록 */
  comments?: Comment[]
  /** 사용자가 조절한 너비/높이(px). 없으면 자동 크기 */
  w?: number
  h?: number
  /** 긴 내용 접힘 여부 */
  collapsed?: boolean
  /** 노드 타입 식별용 */
  kind: 'sticky'
  // React Flow 의 Node<T> 제약 충족용 인덱스 시그니처
  [key: string]: unknown
}

/** 이미지(사진) 노드 데이터 */
export interface ImageNodeData {
  /** 이미지 설명/캡션 */
  label: string
  /** 이미지 소스: data URL(업로드) 또는 외부 URL */
  src: string
  /** 표시 너비(px). 높이는 비율 유지 */
  width: number
  /** 노드 댓글 목록 */
  comments?: Comment[]
  /** 노드 타입 식별용 */
  kind: 'image'
  // React Flow 의 Node<T> 제약 충족용 인덱스 시그니처
  [key: string]: unknown
}

export type BoardNodeData = PlainNodeData | WbsNodeData | ImageNodeData | StickyNodeData

/** WBS 노드인지 좁혀주는 타입 가드 */
export function isWbsData(data: BoardNodeData): data is WbsNodeData {
  return (data as WbsNodeData).kind === 'wbs'
}

/** 이미지 노드인지 좁혀주는 타입 가드 */
export function isImageData(data: BoardNodeData): data is ImageNodeData {
  return (data as ImageNodeData).kind === 'image'
}

/** 스티커 메모 노드인지 좁혀주는 타입 가드 */
export function isStickyData(data: BoardNodeData): data is StickyNodeData {
  return (data as StickyNodeData).kind === 'sticky'
}

export type BoardNode = Node<BoardNodeData>
export type BoardEdge = Edge

/** 방 전체 공유 연결선(엣지) 표시 스타일 */
export interface EdgeStyle {
  color: string
  width: number
}

/** 방 채팅 메시지 (들어온 참여자들끼리 자유롭게 나누는 대화) */
export interface ChatMessage {
  /** 고유 id */
  id: string
  /** 보낸 사람 표시 이름 */
  author: string
  /** 보낸 사람 username (본인 메시지 식별용) */
  authorUsername: string
  /** 보낸 사람 색상(이름표 색) */
  color: string
  /** 메시지 내용 */
  text: string
  /** 보낸 시각(ms) */
  at: number
  /** 마지막 수정 시각(ms). 수정된 적이 있으면 표시용 */
  editedAt?: number
}

/** 방 공유 캘린더 일정 */
export interface CalendarEvent {
  /** 고유 id */
  id: string
  /** 날짜 (YYYY-MM-DD) */
  date: string
  /** 일정 내용 */
  text: string
  /** 완료 체크 여부 */
  done: boolean
  /** 만든 사람 username */
  createdBy: string
  /** 만든 시각(ms) */
  createdAt: number
}

/** 투표 선택지 */
export interface PollOption {
  id: string
  text: string
  /** 이 선택지에 투표한 사용자 username 목록 */
  voters: string[]
}

/** 방 전체 공유 투표 세션 (여러 개 동시 진행 가능) */
export interface Poll {
  id: string
  /** 투표 질문(주제) */
  question: string
  options: PollOption[]
  /** 만든 사람 username (닫기/삭제 권한) */
  owner: string
  /** 진행 중 / 종료됨 */
  closed: boolean
  /** 자동 종료 마감 시각(ms). 0 이면 마감 없음 */
  deadline: number
  createdAt: number
}

export interface CollabHandle {
  doc: Y.Doc
  provider: WebsocketProvider
  nodes: Y.Map<BoardNode>
  edges: Y.Map<BoardEdge>
  /** 방 공유 투표 세션들 (키 = poll id, 여러 개 동시 진행 가능) */
  poll: Y.Map<Poll>
  /** 방 채팅 메시지 목록 (시간순 추가) */
  chat: Y.Array<ChatMessage>
  /** 방 공유 캘린더 일정들 (키 = event id) */
  calendar: Y.Map<CalendarEvent>
  /** 방 공유 설정 (키 'edgeStyle' 등) */
  meta: Y.Map<unknown>
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
  const poll = doc.getMap<Poll>('poll')
  const chat = doc.getArray<ChatMessage>('chat')
  const calendar = doc.getMap<CalendarEvent>('calendar')
  const meta = doc.getMap<unknown>('meta')

  provider.awareness.setLocalStateField('user', user)

  return {
    doc,
    provider,
    nodes,
    edges,
    poll,
    chat,
    calendar,
    meta,
    awareness: provider.awareness,
    destroy: () => {
      provider.destroy()
      doc.destroy()
    },
  }
}
