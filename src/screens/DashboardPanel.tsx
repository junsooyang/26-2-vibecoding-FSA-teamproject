import type { WbsNodeData } from '../collab/yjs'
import { WBS_STATUS } from '../nodes/WbsNode'
import { dueState } from '../collab/wbsUtils'

interface Props {
  /** 보드의 모든 WBS 작업 데이터 */
  tasks: WbsNodeData[]
  onClose: () => void
}

interface MemberStat {
  name: string
  total: number
  todo: number
  doing: number
  done: number
  overdue: number
  progressSum: number
}

const UNASSIGNED = '(담당자 미지정)'

/**
 * 프로젝트 대시보드.
 * - 전체 진행률(작업 진행률 평균) + 상태별 작업 수
 * - 팀원(담당자)별 업무 현황: 담당 개수, 완료/진행/할일, 지연, 평균 진행률
 * WBS 작업 노드만 집계 대상이다.
 */
export default function DashboardPanel({ tasks, onClose }: Props) {
  const total = tasks.length
  const doneCount = tasks.filter((t) => t.status === 'done').length
  const doingCount = tasks.filter((t) => t.status === 'doing').length
  const todoCount = tasks.filter((t) => t.status === 'todo').length
  const overdueCount = tasks.filter((t) => dueState(t.due, t.status === 'done') === 'overdue').length

  // 전체 진행률 = 작업 진행률 평균 (작업 없으면 0)
  const overallProgress = total
    ? Math.round(tasks.reduce((sum, t) => sum + (Number(t.progress) || 0), 0) / total)
    : 0

  // 담당자별 집계
  const byMember = new Map<string, MemberStat>()
  for (const t of tasks) {
    const key = t.assignee?.trim() || UNASSIGNED
    const stat =
      byMember.get(key) ??
      { name: key, total: 0, todo: 0, doing: 0, done: 0, overdue: 0, progressSum: 0 }
    stat.total += 1
    stat.progressSum += Number(t.progress) || 0
    if (t.status === 'done') stat.done += 1
    else if (t.status === 'doing') stat.doing += 1
    else stat.todo += 1
    if (dueState(t.due, t.status === 'done') === 'overdue') stat.overdue += 1
    byMember.set(key, stat)
  }
  const members = Array.from(byMember.values()).sort((a, b) => b.total - a.total)

  return (
    <aside className="side-panel dashboard-panel" onClick={(e) => e.stopPropagation()}>
      <div className="side-head">
        <div>
          <h3>📊 프로젝트 대시보드</h3>
          <p className="side-sub">WBS 작업 {total}개 기준</p>
        </div>
        <button type="button" className="ghost" onClick={onClose}>
          닫기
        </button>
      </div>

      <div className="dash-body">
        {total === 0 ? (
          <p className="tip">아직 WBS 작업이 없어요. 아이디어를 "→ 작업으로" 승격하거나 "+ WBS 작업"을 추가해보세요.</p>
        ) : (
          <>
            {/* 전체 진행률 */}
            <div className="dash-overall">
              <div className="dash-overall-head">
                <span>전체 진행률</span>
                <strong>{overallProgress}%</strong>
              </div>
              <div className="dash-bar big">
                <div className="dash-bar-fill" style={{ width: `${overallProgress}%` }} />
              </div>
              <div className="dash-chips">
                <span className="dash-chip" style={{ background: WBS_STATUS.done.bg, color: WBS_STATUS.done.color }}>
                  완료 {doneCount}
                </span>
                <span className="dash-chip" style={{ background: WBS_STATUS.doing.bg, color: WBS_STATUS.doing.color }}>
                  진행 {doingCount}
                </span>
                <span className="dash-chip" style={{ background: WBS_STATUS.todo.bg, color: WBS_STATUS.todo.color }}>
                  할 일 {todoCount}
                </span>
                {overdueCount > 0 && (
                  <span className="dash-chip overdue">지연 {overdueCount}</span>
                )}
              </div>
            </div>

            {/* 팀원별 현황 */}
            <div className="field-label">팀원별 업무 현황</div>
            <ul className="dash-members">
              {members.map((m) => {
                const avg = Math.round(m.progressSum / m.total)
                return (
                  <li key={m.name} className="dash-member">
                    <div className="dash-member-head">
                      <span className="dash-member-name">
                        {m.name === UNASSIGNED ? m.name : `👤 ${m.name}`}
                      </span>
                      <span className="dash-member-count">{m.total}건 · 평균 {avg}%</span>
                    </div>
                    <div className="dash-bar">
                      <div className="dash-bar-fill" style={{ width: `${avg}%` }} />
                    </div>
                    <div className="dash-member-sub">
                      <span>완료 {m.done}</span>
                      <span>진행 {m.doing}</span>
                      <span>할일 {m.todo}</span>
                      {m.overdue > 0 && <span className="overdue-text">지연 {m.overdue}</span>}
                    </div>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </div>
    </aside>
  )
}
