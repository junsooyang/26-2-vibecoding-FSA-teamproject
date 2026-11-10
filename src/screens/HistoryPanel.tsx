import { useMemo, useState } from 'react'
import {
  KIND_LABEL,
  summarizeContributions,
  type ActivityEntry,
  type ActivityKind,
} from '../collab/activity'

interface Props {
  entries: ActivityEntry[]
  /** 지금 보드에 있는 노드 id (기록에서 대상으로 이동할 수 있는지 판단) */
  existingNodeIds: Set<string>
  /** 기록 항목을 누르면 해당 노드로 화면 이동 */
  onFocusNode: (nodeId: string) => void
  onOpenCalendar: () => void
  onClose: () => void
}

function formatTime(ms: number) {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 기여도 요약에 보여 줄 종류 묶음 */
const SUMMARY_GROUPS: { label: string; kinds: ActivityKind[] }[] = [
  { label: '추가', kinds: ['add'] },
  { label: '수정', kinds: ['edit', 'move', 'connect', 'disconnect'] },
  { label: '삭제', kinds: ['delete'] },
  { label: '댓글·투표', kinds: ['comment', 'vote'] },
  { label: '일정', kinds: ['calendar'] },
]

/** 변경 기록 패널: 누가 언제 무엇을 바꿨는지 + 사람별 기여도 요약 */
export default function HistoryPanel({
  entries,
  existingNodeIds,
  onFocusNode,
  onOpenCalendar,
  onClose,
}: Props) {
  const [who, setWho] = useState('')

  const summary = useMemo(() => summarizeContributions(entries), [entries])
  const list = useMemo(
    () =>
      entries
        .filter((e) => !who || e.username === who)
        .slice()
        .sort((a, b) => b.at - a.at),
    [entries, who],
  )
  const maxTotal = Math.max(1, ...summary.map((s) => s.total))

  return (
    <aside className="side-panel history-panel" onClick={(e) => e.stopPropagation()}>
      <div className="side-head">
        <div>
          <h3>🕘 변경 기록</h3>
          <p className="side-sub">누가 무엇을 바꿨는지 · 최근 {entries.length}건</p>
        </div>
        <button type="button" className="ghost" onClick={onClose}>
          닫기
        </button>
      </div>

      <div className="history-body">
        {entries.length === 0 ? (
          <p className="tip">
            아직 기록이 없어요. 이 기능을 켠 뒤부터 노드·연결선·일정의 변경이 기록돼요.
          </p>
        ) : (
          <>
            <section className="history-summary" aria-label="팀원별 기여도">
              <div className="field-label">팀원별 기여도</div>
              <ul>
                {summary.map((s) => (
                  <li key={s.username}>
                    <button
                      type="button"
                      className={who === s.username ? 'history-person active' : 'history-person'}
                      onClick={() => setWho((w) => (w === s.username ? '' : s.username))}
                      aria-pressed={who === s.username}
                      title="이 팀원의 기록만 보기"
                    >
                      <span className="history-person-name">{s.name}</span>
                      <span className="history-person-bar" aria-hidden="true">
                        <span style={{ width: `${(s.total / maxTotal) * 100}%` }} />
                      </span>
                      <span className="history-person-total">{s.total}건</span>
                    </button>
                    <div className="history-person-kinds">
                      {SUMMARY_GROUPS.map((g) => {
                        const n = g.kinds.reduce((sum, k) => sum + (s.byKind[k] ?? 0), 0)
                        return n > 0 ? (
                          <span key={g.label}>
                            {g.label} {n}
                          </span>
                        ) : null
                      })}
                    </div>
                  </li>
                ))}
              </ul>
              <p className="history-note">
                건수는 기록 줄 수예요. 2분 안에 같은 대상에 반복한 변경(드래그 등)은 1건으로 묶여요.
              </p>
            </section>

            <div className="history-filter">
              <label>
                <span className="sr-only">팀원 선택</span>
                <select value={who} onChange={(e) => setWho(e.target.value)}>
                  <option value="">모든 팀원</option>
                  {summary.map((s) => (
                    <option key={s.username} value={s.username}>
                      {s.name} (@{s.username})
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <ol className="history-list">
              {list.map((e) => {
                const canFocus = e.targetType !== 'calendar' && existingNodeIds.has(e.targetId)
                const clickable = canFocus || e.targetType === 'calendar'
                const body = (
                  <>
                    <span className="history-meta">
                      <span className="history-name">{e.name}</span>
                      <span className={`history-kind kind-${e.kind}`}>{KIND_LABEL[e.kind]}</span>
                      <span className="history-time">{formatTime(e.at)}</span>
                    </span>
                    <span className="history-target">{e.targetLabel}</span>
                    <span className="history-detail">
                      {e.detail}
                      {e.count > 1 && <span className="history-count"> ×{e.count}</span>}
                    </span>
                  </>
                )
                return (
                  <li key={e.id}>
                    {clickable ? (
                      <button
                        type="button"
                        className="history-item"
                        onClick={() => (canFocus ? onFocusNode(e.targetId) : onOpenCalendar())}
                        title={canFocus ? '보드에서 이 노드 보기' : '캘린더 열기'}
                      >
                        {body}
                      </button>
                    ) : (
                      <div className="history-item static">{body}</div>
                    )}
                  </li>
                )
              })}
            </ol>
          </>
        )}
      </div>
    </aside>
  )
}
