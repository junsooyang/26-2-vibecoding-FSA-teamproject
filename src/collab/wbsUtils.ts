/** WBS 마감일 관련 공용 유틸 (노드 카드 / 대시보드 공유) */

export type DueState = 'none' | 'overdue' | 'soon' | 'normal'

/** 로컬 자정 기준 '오늘'의 타임스탬프 */
function todayStart(): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/**
 * 마감일 상태를 판정한다.
 * - none: 마감일 없음
 * - overdue: 마감일이 오늘보다 과거 (지남)
 * - soon: 오늘 ~ 3일 이내 (임박)
 * - normal: 그 외 (여유)
 * 완료(done)된 작업은 항상 normal 로 본다.
 */
export function dueState(due: string | undefined, done: boolean): DueState {
  if (!due) return 'none'
  if (done) return 'normal'
  const target = new Date(`${due}T00:00:00`).getTime()
  if (Number.isNaN(target)) return 'none'
  const today = todayStart()
  const dayMs = 24 * 60 * 60 * 1000
  if (target < today) return 'overdue'
  if (target <= today + 3 * dayMs) return 'soon'
  return 'normal'
}

/** 마감일을 'M/D' 짧은 형식으로 표시 */
export function formatDue(due: string): string {
  const d = new Date(`${due}T00:00:00`)
  if (Number.isNaN(d.getTime())) return due
  return `${d.getMonth() + 1}/${d.getDate()}`
}

/** overdue 까지 남은/지난 일수 라벨 (예: "D-2", "D-DAY", "+3일 지남") */
export function dueBadge(due: string, done: boolean): string {
  if (done) return formatDue(due)
  const target = new Date(`${due}T00:00:00`).getTime()
  if (Number.isNaN(target)) return due
  const today = todayStart()
  const diffDays = Math.round((target - today) / (24 * 60 * 60 * 1000))
  if (diffDays === 0) return 'D-DAY'
  if (diffDays > 0) return `D-${diffDays}`
  return `${-diffDays}일 지남`
}
