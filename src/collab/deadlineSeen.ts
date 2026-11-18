/**
 * 마감 알림에서 "이미 확인한, 마감 지난 작업" 기록.
 * 한 번 확인(알림 닫기·작업 열기·캘린더 열기)한 지난 마감은 다음에 들어와도 다시 알리지 않는다.
 * - 이 브라우저에만 저장 (보드 + 사용자별)
 * - 작업 id 와 마감일을 함께 기억 → 마감일을 바꾸면 그 작업은 다시 알린다
 * - 오늘·내일 마감은 기록하지 않는다 (계속 알림)
 */

interface DeadlineLike {
  id: string
  due: string
  done: boolean
}

export function deadlineSeenStorageKey(room: string, username: string) {
  return `deadline-seen:${room}:${username}`
}

/** 작업 하나를 구분하는 값 (마감일이 바뀌면 다른 값) */
export function deadlineSeenId(d: { id: string; due: string }) {
  return `${d.id}@${d.due}`
}

/** 저장된 문자열을 읽는다 (깨진 값은 빈 목록) */
export function parseDeadlineSeen(raw: string | null): Set<string> {
  if (!raw) return new Set()
  try {
    const v = JSON.parse(raw)
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}

/** 알림에 띄울 작업: 완료 안 됨 + (오늘·내일 마감, 또는 아직 확인 안 한 지난 마감), 마감일 순 */
export function pickDeadlineAlerts<T extends DeadlineLike>(
  items: T[],
  seen: Set<string>,
  today: string,
  tomorrow: string,
): T[] {
  return items
    .filter((d) => !d.done && d.due && d.due <= tomorrow)
    .filter((d) => d.due >= today || !seen.has(deadlineSeenId(d)))
    .sort((a, b) => a.due.localeCompare(b.due))
}

/**
 * 알림을 확인했을 때 저장할 목록.
 * 이번에 보여 준 지난 마감을 더하고, 지금 지난 마감 목록에 없는 기록(완료·삭제·마감일 변경)은 지운다.
 */
export function nextDeadlineSeen<T extends DeadlineLike>(
  seen: Set<string>,
  shown: T[],
  allItems: T[],
  today: string,
): string[] {
  const overdueNow = new Set(
    allItems.filter((d) => !d.done && d.due && d.due < today).map(deadlineSeenId),
  )
  const next = new Set([...seen].filter((k) => overdueNow.has(k)))
  for (const d of shown) if (d.due < today) next.add(deadlineSeenId(d))
  return [...next]
}
