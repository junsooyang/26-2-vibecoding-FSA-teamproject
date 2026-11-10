import { useEffect, useMemo } from 'react'
import type { WbsStatus } from '../collab/yjs'
import { WBS_STATUS } from '../nodes/WbsNode'
import { localIsoDate } from '../collab/wbsUtils'

/** 간트차트 한 줄에 필요한 WBS 작업 정보 */
export interface GanttTask {
  id: string
  seq?: number
  label: string
  assignee: string
  status: WbsStatus
  progress: number
  start?: string
  due?: string
}

interface Props {
  tasks: GanttTask[]
  /** 작업 이름을 누르면 WBS 편집 패널 열기 */
  onOpenTask: (id: string) => void
  onClose: () => void
}

const DAY_MS = 24 * 60 * 60 * 1000

/** 'YYYY-MM-DD' → 날짜 번호 (UTC 기준이라 서머타임 영향 없음). 형식이 틀리면 null */
function dayNum(iso: string | undefined): number | null {
  if (!iso) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return null
  return Math.round(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS)
}

/** 날짜 번호 → Date (UTC) */
function fromDayNum(n: number) {
  return new Date(n * DAY_MS)
}

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토']

/** WBS 작업을 시작일~마감일 기간 막대로 보여 주는 간트차트(타임라인) */
export default function GanttPanel({ tasks, onOpenTask, onClose }: Props) {
  const today = dayNum(localIsoDate(0)) as number

  // 기간 계산: 시작일만 있거나 마감일만 있으면 그 하루짜리 막대로 그린다.
  const { rows, undated } = useMemo(() => {
    const dated: (GanttTask & { s: number; e: number })[] = []
    const none: GanttTask[] = []
    for (const t of tasks) {
      const s = dayNum(t.start)
      const e = dayNum(t.due)
      if (s === null && e === null) {
        none.push(t)
        continue
      }
      const ss = s ?? (e as number)
      const ee = e ?? ss
      dated.push({ ...t, s: Math.min(ss, ee), e: Math.max(ss, ee) })
    }
    dated.sort((a, b) => a.s - b.s || a.e - b.e || (a.seq ?? 0) - (b.seq ?? 0))
    none.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
    return { rows: dated, undated: none }
  }, [tasks])

  // 표시 범위: 모든 작업 + 오늘이 들어가도록, 앞뒤로 하루씩 여유
  const range = useMemo(() => {
    if (rows.length === 0) return null
    const first = Math.min(today, ...rows.map((r) => r.s)) - 1
    const last = Math.max(today, ...rows.map((r) => r.e)) + 1
    const days = last - first + 1
    // 기간이 길수록 하루 칸을 좁게 (너무 길면 가로 스크롤)
    const dayWidth = days <= 31 ? 32 : days <= 92 ? 18 : 10
    return { first, last, days, dayWidth }
  }, [rows, today])

  // Esc 로 닫기
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // 헤더: 월 구간 + 날짜 칸
  const header = useMemo(() => {
    if (!range) return null
    const months: { label: string; span: number }[] = []
    const days: { n: number; date: Date }[] = []
    for (let n = range.first; n <= range.last; n++) {
      const date = fromDayNum(n)
      days.push({ n, date })
      const label = `${date.getUTCFullYear()}년 ${date.getUTCMonth() + 1}월`
      const lastMonth = months[months.length - 1]
      if (lastMonth && lastMonth.label === label) lastMonth.span++
      else months.push({ label, span: 1 })
    }
    return { months, days }
  }, [range])

  const trackWidth = range ? range.days * range.dayWidth : 0

  return (
    <div className="panel-overlay" onClick={onClose}>
      <div
        className="panel gantt-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="gantt-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="panel-head">
          <h2 id="gantt-title">📈 WBS 간트차트</h2>
          <button type="button" className="ghost" onClick={onClose}>
            닫기
          </button>
        </div>

        {tasks.length === 0 ? (
          <p className="tip">아직 WBS 작업이 없어요. 툴바의 + WBS 작업으로 추가해 보세요.</p>
        ) : (
          <>
            <div className="gantt-legend">
              {(Object.keys(WBS_STATUS) as WbsStatus[]).map((s) => (
                <span key={s} className="gantt-legend-item">
                  <span className="gantt-legend-dot" style={{ background: WBS_STATUS[s].color }} />
                  {WBS_STATUS[s].label}
                </span>
              ))}
              <span className="gantt-legend-item">
                <span className="gantt-legend-today" /> 오늘
              </span>
              <span className="gantt-legend-note">막대 안의 진한 부분 = 진행률</span>
            </div>

            {range && header ? (
              <div className="gantt-scroll">
                <div className="gantt-grid" style={{ width: 220 + trackWidth }}>
                  {/* 헤더 */}
                  <div className="gantt-row gantt-header-row">
                  <div className="gantt-corner">작업</div>
                  <div className="gantt-head" style={{ width: trackWidth }}>
                    <div className="gantt-months">
                      {header.months.map((m, i) => (
                        <div
                          key={i}
                          className="gantt-month"
                          style={{ width: m.span * range.dayWidth }}
                        >
                          {m.span * range.dayWidth >= 60 ? m.label : ''}
                        </div>
                      ))}
                    </div>
                    <div className="gantt-days">
                      {header.days.map(({ n, date }) => {
                        const wd = date.getUTCDay()
                        return (
                          <div
                            key={n}
                            className={[
                              'gantt-day',
                              wd === 0 || wd === 6 ? 'weekend' : '',
                              n === today ? 'today' : '',
                            ]
                              .filter(Boolean)
                              .join(' ')}
                            style={{ width: range.dayWidth }}
                            title={`${date.getUTCMonth() + 1}/${date.getUTCDate()} (${WEEKDAY[wd]})`}
                          >
                            {range.dayWidth >= 18 ? date.getUTCDate() : ''}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                  </div>

                  {/* 작업 줄 */}
                  {rows.map((r) => {
                    const st = WBS_STATUS[r.status] ?? WBS_STATUS.todo
                    const progress = Math.max(0, Math.min(100, Number(r.progress) || 0))
                    const overdue = r.status !== 'done' && r.e < today
                    const left = (r.s - range.first) * range.dayWidth
                    const width = (r.e - r.s + 1) * range.dayWidth
                    const period =
                      r.s === r.e
                        ? `${r.due || r.start}`
                        : `${r.start || '?'} ~ ${r.due || '?'}`
                    return (
                      <div key={r.id} className="gantt-row">
                        <button
                          type="button"
                          className="gantt-label"
                          onClick={() => onOpenTask(r.id)}
                          title="작업 편집 열기"
                        >
                          {r.seq !== undefined && <span className="gantt-seq">#{r.seq}</span>}
                          <span className="gantt-label-text">{r.label || '(제목 없는 작업)'}</span>
                          {r.assignee && <span className="gantt-assignee">{r.assignee}</span>}
                        </button>
                        <div className="gantt-track" style={{ width: trackWidth }}>
                          <div
                            className="gantt-today-line"
                            style={{ left: (today - range.first) * range.dayWidth + range.dayWidth / 2 }}
                          />
                          <div
                            className={overdue ? 'gantt-bar overdue' : 'gantt-bar'}
                            style={{ left, width, borderColor: st.color, background: st.bg }}
                            title={`${r.label} · ${period} · ${st.label} ${progress}%${overdue ? ' · 마감 지남' : ''}`}
                          >
                            <div
                              className="gantt-bar-fill"
                              style={{ width: `${progress}%`, background: st.color }}
                            />
                            <span className="gantt-bar-text">{progress}%</span>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : (
              <p className="tip">
                날짜가 지정된 작업이 없어요. WBS 편집 패널에서 시작일·마감일을 넣으면 막대로 보여요.
              </p>
            )}

            {undated.length > 0 && (
              <div className="gantt-undated">
                <div className="field-label">날짜 미정 ({undated.length})</div>
                <ul>
                  {undated.map((t) => (
                    <li key={t.id}>
                      <button type="button" className="gantt-undated-item" onClick={() => onOpenTask(t.id)}>
                        {t.seq !== undefined && <span className="gantt-seq">#{t.seq}</span>}
                        {t.label || '(제목 없는 작업)'}
                        {t.assignee && <span className="gantt-assignee"> · {t.assignee}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
