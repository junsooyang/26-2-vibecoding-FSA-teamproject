import { useMemo, useState } from 'react'
import type { CalendarEvent } from '../collab/yjs'
import { dueBadge } from '../collab/wbsUtils'

/** 캘린더에 자동 표시되는 WBS 작업 마감 (WBS 노드에서 파생 — 별도 저장 없음) */
export interface WbsDeadline {
  /** WBS 노드 id */
  id: string
  /** 작업명 */
  label: string
  /** 담당자 */
  assignee: string
  /** 마감일 (YYYY-MM-DD) */
  due: string
  /** 완료 여부 */
  done: boolean
}

interface Props {
  /** 방 이름(헤더 표시용) */
  roomName: string
  /** 캘린더 일정 목록 (Yjs 에서 실시간 반영, 날짜순) */
  events: CalendarEvent[]
  /** 마감일이 지정된 WBS 작업들 (자동으로 캘린더에 기록됨) */
  deadlines: WbsDeadline[]
  /** WBS 마감 항목의 체크 → 해당 작업 완료/해제 */
  onToggleDeadline: (nodeId: string) => void
  /** 담당자 입력 자동완성에 쓸 보드 멤버 이름 */
  memberNames?: string[]
  onAdd: (date: string, text: string, extra: { time?: string; assignee?: string }) => void
  onToggle: (id: string) => void
  onEdit: (id: string, patch: { text: string; time?: string; assignee?: string }) => void
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
  deadlines,
  onToggleDeadline,
  memberNames = [],
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
  const [time, setTime] = useState('')
  const [assignee, setAssignee] = useState('')
  // 수정 중인 일정
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')
  const [editingTime, setEditingTime] = useState('')
  const [editingAssignee, setEditingAssignee] = useState('')
  // 담당자 자동완성 목록 id (같은 화면에 여러 패널이 있어도 겹치지 않게)
  const datalistId = 'cal-assignee-options'

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
    // WBS 마감도 같은 날짜 배지에 합산
    for (const d of deadlines) {
      const cur = map[d.due] ?? { total: 0, done: 0 }
      cur.total += 1
      if (d.done) cur.done += 1
      map[d.due] = cur
    }
    return map
  }, [events, deadlines])

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
  // 선택한 날짜가 마감인 WBS 작업
  const dayDeadlines = useMemo(
    () => deadlines.filter((d) => d.due === selected),
    [deadlines, selected],
  )

  const goPrevMonth = () => setCursor(new Date(year, month - 1, 1))
  const goNextMonth = () => setCursor(new Date(year, month + 1, 1))
  const goPrevYear = () => setCursor(new Date(year - 1, month, 1))
  const goNextYear = () => setCursor(new Date(year + 1, month, 1))
  const goToday = () => {
    setCursor(new Date(today.getFullYear(), today.getMonth(), 1))
    setSelected(todayIso)
  }

  const submitAdd = (e: React.FormEvent) => {
    e.preventDefault()
    const t = text.trim()
    if (!t) return
    onAdd(selected, t, { time, assignee })
    setText('')
    setTime('')
    setAssignee('')
  }

  const startEdit = (ev: CalendarEvent) => {
    setEditingId(ev.id)
    setEditingText(ev.text)
    setEditingTime(ev.time ?? '')
    setEditingAssignee(ev.assignee ?? '')
  }

  const saveEdit = () => {
    if (!editingId) return
    const t = editingText.trim()
    if (t) onEdit(editingId, { text: t, time: editingTime, assignee: editingAssignee })
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
        <button type="button" className="ghost cal-nav-btn" onClick={goPrevYear} title="이전 해">
          «
        </button>
        <button type="button" className="ghost cal-nav-btn" onClick={goPrevMonth} title="이전 달">
          ‹
        </button>
        <strong className="cal-title">
          {year}년 {month + 1}월
        </strong>
        <button type="button" className="ghost cal-nav-btn" onClick={goNextMonth} title="다음 달">
          ›
        </button>
        <button type="button" className="ghost cal-nav-btn" onClick={goNextYear} title="다음 해">
          »
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
        {/* WBS 작업 마감 — 마감일 지정 시 자동 기록. 체크하면 WBS 작업이 완료 처리됨 */}
        {dayDeadlines.map((d) => (
          <div key={`wbs-${d.id}`} className={d.done ? 'cal-event wbs done' : 'cal-event wbs'}>
            <label className="cal-event-main">
              <input
                type="checkbox"
                checked={d.done}
                onChange={() => onToggleDeadline(d.id)}
              />
              <span className="cal-event-text">
                <span className="cal-wbs-tag">WBS 마감</span>
                {d.label}
                {d.assignee && <span className="cal-wbs-assignee"> · {d.assignee}</span>}
              </span>
            </label>
            <span className="cal-wbs-due">{dueBadge(d.due, d.done)}</span>
          </div>
        ))}

        {dayEvents.length === 0 && dayDeadlines.length === 0 ? (
          <p className="tip">이 날짜에 일정이 없어요. 아래에서 추가해보세요.</p>
        ) : (
          dayEvents.map((ev) => {
            const isEditing = editingId === ev.id
            return (
              <div key={ev.id} className={ev.done ? 'cal-event done' : 'cal-event'}>
                {isEditing ? (
                  <div
                    className="cal-event-edit"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        saveEdit()
                      }
                      if (e.key === 'Escape') setEditingId(null)
                    }}
                  >
                    <input
                      value={editingText}
                      autoFocus
                      aria-label="일정 내용"
                      onChange={(e) => setEditingText(e.target.value)}
                    />
                    <div className="cal-extra-row">
                      <input
                        type="time"
                        value={editingTime}
                        aria-label="시간 (선택)"
                        onChange={(e) => setEditingTime(e.target.value)}
                      />
                      <input
                        value={editingAssignee}
                        list={datalistId}
                        placeholder="담당자 (선택)"
                        aria-label="담당자 (선택)"
                        onChange={(e) => setEditingAssignee(e.target.value)}
                      />
                      <button type="button" onClick={saveEdit} disabled={!editingText.trim()}>
                        저장
                      </button>
                      <button type="button" className="ghost" onClick={() => setEditingId(null)}>
                        취소
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <label className="cal-event-main">
                      <input
                        type="checkbox"
                        checked={ev.done}
                        onChange={() => onToggle(ev.id)}
                      />
                      <span className="cal-event-text">
                        {ev.time && <span className="cal-time">{ev.time}</span>}
                        {ev.text}
                        {ev.assignee && <span className="cal-assignee">👤 {ev.assignee}</span>}
                      </span>
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
          aria-label="일정 내용"
          onChange={(e) => setText(e.target.value)}
        />
        <div className="cal-extra-row">
          <input
            type="time"
            value={time}
            aria-label="시간 (선택)"
            title="시간 (선택, 비우면 하루 종일)"
            onChange={(e) => setTime(e.target.value)}
          />
          <input
            value={assignee}
            list={datalistId}
            placeholder="담당자 (선택)"
            aria-label="담당자 (선택)"
            onChange={(e) => setAssignee(e.target.value)}
          />
          <button type="submit" disabled={!text.trim()}>
            추가
          </button>
        </div>
      </form>

      {/* 담당자 자동완성: 보드 멤버 이름 */}
      <datalist id={datalistId}>
        {memberNames.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
    </aside>
  )
}
