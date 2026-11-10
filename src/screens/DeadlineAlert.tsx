import { useEffect } from 'react'
import type { WbsDeadline } from './CalendarPanel'
import { dueBadge, localIsoDate } from '../collab/wbsUtils'

interface Props {
  /** 아직 완료되지 않은 마감 임박 작업들 (지남 / 오늘 / 내일) */
  items: WbsDeadline[]
  /** 작업을 누르면 해당 WBS 편집 패널 열기 */
  onOpenTask: (nodeId: string) => void
  /** 캘린더 열기 */
  onOpenCalendar: () => void
  onClose: () => void
}

/** 보드에 들어왔을 때 한 번 보여주는 마감 임박 작업 요약 카드 */
export default function DeadlineAlert({ items, onOpenTask, onOpenCalendar, onClose }: Props) {
  const today = localIsoDate(0)
  const tomorrow = localIsoDate(1)

  const groups = [
    { key: 'overdue', title: '⚠️ 마감이 지난 작업', list: items.filter((d) => d.due < today) },
    { key: 'today', title: '🔥 오늘 마감', list: items.filter((d) => d.due === today) },
    { key: 'tomorrow', title: '⏰ 내일 마감', list: items.filter((d) => d.due === tomorrow) },
  ].filter((g) => g.list.length > 0)

  // Esc 로 닫기
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <section
      className="deadline-alert"
      role="dialog"
      aria-labelledby="deadline-alert-title"
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <div className="deadline-alert-head">
        <h3 id="deadline-alert-title">📅 마감이 다가온 작업 {items.length}개</h3>
        <button type="button" className="ghost" onClick={onClose} aria-label="마감 알림 닫기">
          닫기
        </button>
      </div>

      {groups.map((g) => (
        <div key={g.key} className={`deadline-group ${g.key}`}>
          <div className="deadline-group-title">{g.title}</div>
          <ul>
            {g.list.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  className="deadline-item"
                  onClick={() => onOpenTask(d.id)}
                  title="작업 편집 열기"
                >
                  <span className="deadline-item-label">{d.label}</span>
                  {d.assignee && <span className="deadline-item-assignee">{d.assignee}</span>}
                  <span className="deadline-item-badge">{dueBadge(d.due, d.done)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}

      <div className="deadline-alert-foot">
        <button type="button" className="ghost" onClick={onOpenCalendar}>
          🗓️ 캘린더에서 보기
        </button>
      </div>
    </section>
  )
}
