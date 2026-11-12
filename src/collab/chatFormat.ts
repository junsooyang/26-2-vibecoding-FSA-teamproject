import type { ChatMessage, ChatReplyRef } from './yjs'

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

/** 같은 날인지 비교하는 키 (내 컴퓨터 시간대 기준) */
export function chatDayKey(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

/** 날짜 구분선 글자: "2026년 11월 13일 금요일" */
export function formatChatDate(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${WEEKDAYS[d.getDay()]}요일`
}

/** 화면에 그릴 채팅 항목: 날짜 구분선 또는 메시지 */
export type ChatListItem =
  | { kind: 'date'; key: string; label: string }
  | { kind: 'message'; message: ChatMessage }

/**
 * 새 메시지가 바로 앞 메시지와 날짜가 다르면(하루가 지났으면) 그 메시지 앞에 날짜 구분선을 끼워 넣는다.
 * 예: 11월 12일 23:59 다음에 11월 13일 메시지가 오면 → "2026년 11월 13일 금요일" 구분선 후 메시지.
 * 맨 처음 메시지 앞에는 비교할 이전 대화가 없으므로 넣지 않는다.
 */
export function withDateDividers(messages: ChatMessage[]): ChatListItem[] {
  const items: ChatListItem[] = []
  let prevDay: string | null = null
  for (const m of messages) {
    const day = chatDayKey(m.at)
    if (prevDay !== null && day !== prevDay) {
      items.push({ kind: 'date', key: `date-${m.id}`, label: formatChatDate(m.at) })
    }
    prevDay = day
    items.push({ kind: 'message', message: m })
  }
  return items
}

/** 검색 결과 등에서 쓰는 짧은 날짜+시각: "11월 13일 23:59" (올해가 아니면 연도 포함) */
export function formatChatDateTime(ms: number, now = Date.now()): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  const year = d.getFullYear() !== new Date(now).getFullYear() ? `${d.getFullYear()}년 ` : ''
  return `${year}${d.getMonth() + 1}월 ${d.getDate()}일 ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 검색어가 보낸 사람 이름이나 내용에 들어 있는 메시지만 (대소문자·앞뒤 공백 무시) */
export function searchChat(messages: ChatMessage[], query: string): ChatMessage[] {
  const q = query.trim().toLowerCase()
  if (!q) return messages
  return messages.filter(
    (m) => m.text.toLowerCase().includes(q) || m.author.toLowerCase().includes(q),
  )
}

/** 글을 검색어 기준으로 나눈다 (검색어 부분은 hit=true → 화면에서 강조) */
export function splitByQuery(text: string, query: string): { text: string; hit: boolean }[] {
  const q = query.trim()
  if (!q) return [{ text, hit: false }]
  const lower = text.toLowerCase()
  const needle = q.toLowerCase()
  const parts: { text: string; hit: boolean }[] = []
  let i = 0
  while (i < text.length) {
    const at = lower.indexOf(needle, i)
    if (at === -1) {
      parts.push({ text: text.slice(i), hit: false })
      break
    }
    if (at > i) parts.push({ text: text.slice(i, at), hit: false })
    parts.push({ text: text.slice(at, at + needle.length), hit: true })
    i = at + needle.length
  }
  return parts
}

/** 답장 인용에 담을 원문 길이 */
export const REPLY_SNIPPET_MAX = 80

/** 답장할 메시지에서 인용용 요약을 만든다 (줄바꿈은 한 칸 공백, 길면 …) */
export function makeReplyRef(m: ChatMessage): ChatReplyRef {
  const flat = m.text.replace(/\s+/g, ' ').trim()
  const text = flat.length > REPLY_SNIPPET_MAX ? `${flat.slice(0, REPLY_SNIPPET_MAX)}…` : flat
  return { id: m.id, author: m.author, text }
}
