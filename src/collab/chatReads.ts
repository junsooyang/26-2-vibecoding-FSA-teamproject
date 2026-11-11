/**
 * 채팅 읽음 표시 (카카오톡처럼 "아직 안 읽은 사람 수").
 *
 * - 사람마다 "마지막으로 읽은 메시지(id + 시각)" 를 보드 공유 문서에 저장한다. (chatReads 맵)
 * - 메시지 하나의 숫자 = 그 메시지를 아직 안 읽은 보드 멤버 수
 *     · 보낸 사람 본인은 세지 않는다 (보낸 사람은 당연히 읽은 것)
 *     · 메시지가 올라온 뒤에 들어온 멤버는 세지 않는다 (카카오톡에서 나중에 들어온 사람처럼)
 * - 내 "안 읽은 메시지 수" 배지는 다른 사람이 보낸 메시지만 센다.
 *
 * 브라우저 전용 코드를 쓰지 않아 자동 테스트에서 그대로 불러 쓸 수 있다.
 */
import type { ChatMessage } from './yjs'

/** 한 사람의 읽은 위치 */
export interface ChatRead {
  /** 마지막으로 읽은 메시지 id */
  id: string | null
  /** 마지막으로 읽은 메시지 시각(ms) — id 의 메시지가 지워졌을 때 대신 쓴다 */
  at: number
}

/** 읽음 숫자를 셀 보드 멤버 (초대 대기는 제외) */
export interface ChatMember {
  username: string
  /** 보드에 들어온 시각(ms). 이보다 먼저 올라온 메시지는 이 사람 몫으로 세지 않는다 */
  joinedAt: number
}

/**
 * 이 사람이 messages[index] 를 읽었는지.
 * 읽은 메시지가 목록에 남아 있으면 순서로 비교하고(기기마다 시계가 달라도 정확),
 * 지워졌으면 시각으로 비교한다.
 */
function hasRead(
  read: ChatRead | undefined,
  readIndex: number,
  message: ChatMessage,
  index: number,
): boolean {
  if (!read) return false
  if (readIndex >= 0) return readIndex >= index
  return read.at >= message.at
}

/** 메시지마다 아직 안 읽은 멤버 수. (0 이면 다 읽음) */
export function unreadCountsByMessage(
  messages: ChatMessage[],
  reads: Record<string, ChatRead>,
  members: ChatMember[],
): Record<string, number> {
  const indexById = new Map(messages.map((m, i) => [m.id, i]))
  const readIndex = new Map(
    members.map((p) => {
      const r = reads[p.username]
      return [p.username, r?.id ? indexById.get(r.id) ?? -1 : -1]
    }),
  )
  const counts: Record<string, number> = {}
  messages.forEach((m, i) => {
    let n = 0
    for (const p of members) {
      if (p.username === m.authorUsername) continue
      if (m.at < p.joinedAt) continue
      if (!hasRead(reads[p.username], readIndex.get(p.username) ?? -1, m, i)) n++
    }
    counts[m.id] = n
  })
  return counts
}

/** 내가 아직 안 읽은 메시지 수 (내가 보낸 메시지는 세지 않음) */
export function myUnreadCount(
  messages: ChatMessage[],
  myRead: ChatRead | undefined,
  username: string,
): number {
  const idx = myRead?.id ? messages.findIndex((m) => m.id === myRead.id) : -1
  return messages.filter(
    (m, i) => m.authorUsername !== username && !hasRead(myRead, idx, m, i),
  ).length
}

/** 읽은 위치를 앞으로만 옮긴다 (뒤로 되돌아가지 않게). 바뀔 게 없으면 null */
export function advanceRead(
  messages: ChatMessage[],
  current: ChatRead | undefined,
  next: ChatRead,
): ChatRead | null {
  if (!current) return next
  if (current.id === next.id) return null
  const ci = current.id ? messages.findIndex((m) => m.id === current.id) : -1
  const ni = next.id ? messages.findIndex((m) => m.id === next.id) : -1
  if (ci >= 0 && ni >= 0) return ni > ci ? next : null
  return next.at > current.at ? next : null
}
