import { useMemo, useState } from 'react'
import type { CalendarEvent } from '../collab/yjs'

interface Props {
  /** 방 이름(헤더 표시용) */
  roomName: string
  /** 캘린더 일정 목록 (Yjs 에서 실시간 반영, 날짜순) */
  events: CalendarEvent[]
  onAdd: (date: string, text: string) => void
  onToggle: (id: string) => void
  onEdit: (id: string, text: string) => void
  onDelete: (id: string) => void
  onClose: () => void
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

/** Date → 'YYYY-MM-DD' (로컬 기준) */
function toISODate(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 'YYYY-MM-DD' 보기 좋게 */
function formatDateLabel(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  const wd = WEEKDAYS[new Date(y, m - 1, d).getDay()]
  return `${y}년 ${m}월 ${d}일 (${wd})`
}

/** 방 전체가 공유하는 캘린더: 월별 그리드 + 날짜별 일정 추가/체크/삭제 (우측 사이드) */
export default function CalendarPanel({
  roomName,
  events,
  onAdd,
  onToggle,
  onEdit,
  onDelete,
  onClose,
}: Props) {
  const today = useMemo(() => new Date(), [])
  const todayIso = toISODate(today)
  // 현재 보고 있는 달 (해당 월 1일)
  const [cursor, setCursor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1))
  // 선택된 날짜 (기본: 오늘)
  const [selected, setSelected] = useState(todayIso)
  // 새 일정 입력값
  const [text, setText] = useState('')
  // 수정 중인 일정
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')

  const year = cursor.getFullYear()
  const month = cursor.getMonth() // 0-based

  // 날짜별 일정 개수 집계 (그리드 배지용)
  const countByDate = useMemo(() => {
    const map: Record<string, { total: number; done: number }> = {}
    for (const e of events) {
      const cur = map[e.date] ?? { total: 0, done: 0 }
      cur.total += 1
      if (e.done) cur.done += 1
      map[e.date] = cur
    }
    return map
  }, [events])

  // 달력 그리드 셀 구성 (앞쪽 빈칸 + 날짜들)
  const cells = useMemo(() => {
    const firstDay = new Date(year, month, 1).getDay() // 0=일
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const arr: (string | null)[] = []
    for (let i = 0; i < firstDay; i++) arr.push(null)
    for (let d = 1; d <= daysInMonth; d++) {
      const pad = (n: number) => String(n).padStart(2, '0')
      arr.push(`${year}-${pad(month + 1)}-${pad(d)}`)
    }
    return arr
  }, [year, month])

  // 선택한 날짜의 일정만
  const dayEvents = useMemo(
    () => events.filter((e) => e.date === selected),
    [events, selected],
  )

  const goPrev = () => setCursor(new Date(year, month - 1, 1))
  const goNext = () => setCursor(new Date(year, month + 1, 1))
  const goToday = () => {
    setCursor(new Date(today.getFullYear(), today.getMonth(), 1))
    setSelected(todayIso)
  }

  const submitAdd = (e: React.FormEvent) => {
    e.preventDefault()
    const t = text.trim()
    if (!t) return
    onAdd(selected, t)
    setText('')
  }

  const startEdit = (ev: CalendarEvent) => {
    setEditingId(ev.id)
    setEditingText(ev.text)
  }

  const saveEdit = () => {
    if (!editingId) return
    const t = editingText.trim()
    if (t) onEdit(editingId, t)
    setEditingId(null)
    setEditingText('')
  }

  return (
    <aside className="side-panel calendar-panel" onClick={(e) => e.stopPropagation()}>
      <div className="side-head">
        <div>
          <h3>🗓️ 캘린더</h3>
          <p className="side-sub">{roomName} · 팀 일정</p>
        </div>
        <button type="button" className="ghost" onClick={onClose}>
          닫기
        </button>
      </div>

      <div className="cal-nav">
        <button type="button" className="ghost" onClick={goPrev} title="이전 달">
          ‹
        </button>
        <strong className="cal-title">
          {year}년 {month + 1}월
        </strong>
        <button type="button" className="ghost" onClick={goNext} title="다음 달">
          ›
        </button>
        <button type="button" className="cal-today-btn" onClick={goToday}>
          오늘
        </button>
      </div>

      <div className="cal-grid">
        {WEEKDAYS.map((w, i) => (
          <div key={w} className={i === 0 ? 'cal-wd sun' : i === 6 ? 'cal-wd sat' : 'cal-wd'}>
            {w}
          </div>
        ))}
        {cells.map((iso, idx) => {
          if (!iso) return <div key={`e-${idx}`} className="cal-cell empty" />
          const day = Number(iso.split('-')[2])
          const cnt = countByDate[iso]
          const isToday = iso === todayIso
          const isSelected = iso === selected
          const cls = [
            'cal-cell',
            isSelected ? 'selected' : '',
            isToday ? 'today' : '',
          ]
            .filter(Boolean)
            .join(' ')
          return (
            <button key={iso} type="button" className={cls} onClick={() => setSelected(iso)}>
              <span className="cal-day">{day}</span>
              {cnt && (
                <span className="cal-dot" title={`일정 ${cnt.total}개`}>
                  {cnt.done === cnt.total ? '✓' : cnt.total}
                </span>
              )}
            </button>
          )
        })}
      </div>

      <div className="cal-day-head">{formatDateLabel(selected)}</div>

      <div className="cal-event-list">
        {dayEvents.length === 0 ? (
          <p className="tip">이 날짜에 일정이 없어요. 아래에서 추가해보세요.</p>
        ) : (
          dayEvents.map((ev) => {
            const isEditing = editingId === ev.id
            return (
              <div key={ev.id} className={ev.done ? 'cal-event done' : 'cal-event'}>
                {isEditing ? (
                  <div className="cal-event-edit">
                    <input
                      value={editingText}
                      autoFocus
                      onChange={(e) => setEditingText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          saveEdit()
                        }
                        if (e.key === 'Escape') setEditingId(null)
                      }}
                    />
                    <button type="button" onClick={saveEdit} disabled={!editingText.trim()}>
                      저장
                    </button>
                    <button type="button" className="ghost" onClick={() => setEditingId(null)}>
                      취소
                    </button>
                  </div>
                ) : (
                  <>
                    <label className="cal-event-main">
                      <input
                        type="checkbox"
                        checked={ev.done}
                        onChange={() => onToggle(ev.id)}
                      />
                      <span className="cal-event-text">{ev.text}</span>
                    </label>
                    <span className="cal-event-actions">
                      <button type="button" className="cal-link" onClick={() => startEdit(ev)}>
                        수정
                      </button>
                      <button
                        type="button"
                        className="cal-link danger-text"
                        onClick={() => onDelete(ev.id)}
                      >
                        삭제
                      </button>
                    </span>
                  </>
                )}
              </div>
            )
          })
        )}
      </div>

      <form className="cal-add-form" onSubmit={submitAdd}>
        <input
          value={text}
          placeholder={`${formatDateLabel(selected)} 일정 추가`}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" disabled={!text.trim()}>
          추가
        </button>
      </form>
    </aside>
  )
}
