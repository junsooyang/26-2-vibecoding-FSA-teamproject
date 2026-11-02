import { useState } from 'react'
import type { Poll } from '../collab/yjs'

interface Props {
  /** 현재 방의 모든 투표 (최신순) */
  polls: Poll[]
  /** 현재 사용자 username */
  username: string
  onCreate: (question: string, options: string[], deadline: number) => void
  onVote: (pollId: string, optionId: string) => void
  onClear: (pollId: string) => void
  onCloseVote: (pollId: string) => void
  onDismiss: () => void
}

/** 마감 상태 라벨 */
function deadlineLabel(poll: Poll): string {
  if (poll.deadline <= 0) return ''
  const diff = poll.deadline - Date.now()
  const d = new Date(poll.deadline)
  const when = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(
    d.getMinutes(),
  ).padStart(2, '0')}`
  if (poll.closed || diff <= 0) return `마감됨 (${when})`
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${when} 마감 · ${mins}분 남음`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${when} 마감 · ${hrs}시간 남음`
  return `${when} 마감 · ${Math.floor(hrs / 24)}일 남음`
}

/** datetime-local 문자열 → ms (빈 값이면 0) */
function toMs(local: string): number {
  if (!local) return 0
  const t = new Date(local).getTime()
  return Number.isNaN(t) ? 0 : t
}

/**
 * 투표 패널. 여러 주제의 투표를 동시에 만들고 참여할 수 있다.
 * - 상단: 새 투표 만들기(질문 + 선택지 + 선택적 마감일시)
 * - 하단: 진행 중/종료된 투표 목록, 각 선택지 투표 + 실시간 결과
 */
export default function PollPanel({
  polls,
  username,
  onCreate,
  onVote,
  onClear,
  onCloseVote,
  onDismiss,
}: Props) {
  const [showCreate, setShowCreate] = useState(polls.length === 0)
  const [question, setQuestion] = useState('')
  const [options, setOptions] = useState<string[]>(['', ''])
  const [deadline, setDeadline] = useState('')

  const setOption = (i: number, v: string) =>
    setOptions((prev) => prev.map((o, idx) => (idx === i ? v : o)))
  const addOptionField = () => setOptions((prev) => [...prev, ''])
  const removeOptionField = (i: number) =>
    setOptions((prev) => (prev.length > 2 ? prev.filter((_, idx) => idx !== i) : prev))

  const create = () => {
    const filled = options.map((o) => o.trim()).filter(Boolean)
    if (!question.trim() || filled.length < 2) return
    onCreate(question, filled, toMs(deadline))
    setQuestion('')
    setOptions(['', ''])
    setDeadline('')
    setShowCreate(false)
  }

  const canCreate = question.trim() !== '' && options.filter((o) => o.trim()).length >= 2

  return (
    <aside className="side-panel poll-panel" onClick={(e) => e.stopPropagation()}>
      <div className="side-head">
        <div>
          <h3>🗳️ 투표</h3>
          <p className="side-sub">진행 중/종료 {polls.length}개</p>
        </div>
        <button type="button" className="ghost" onClick={onDismiss}>
          닫기
        </button>
      </div>

      <div className="poll-body">
        {/* 새 투표 만들기 토글 */}
        <button
          type="button"
          className="poll-new-toggle"
          onClick={() => setShowCreate((v) => !v)}
        >
          {showCreate ? '− 새 투표 접기' : '+ 새 투표 만들기'}
        </button>

        {showCreate && (
          <div className="poll-create">
            <label className="field-label">질문(주제)</label>
            <input
              className="poll-question-input"
              value={question}
              placeholder="예: 다음 주제로 무엇을 할까요?"
              onChange={(e) => setQuestion(e.target.value)}
            />

            <label className="field-label">선택지 (2개 이상)</label>
            {options.map((opt, i) => (
              <div key={i} className="poll-option-row">
                <input
                  value={opt}
                  placeholder={`선택지 ${i + 1}`}
                  onChange={(e) => setOption(i, e.target.value)}
                />
                {options.length > 2 && (
                  <button type="button" className="poll-opt-del" onClick={() => removeOptionField(i)}>
                    ✕
                  </button>
                )}
              </div>
            ))}
            <button type="button" className="ghost" onClick={addOptionField}>
              + 선택지 추가
            </button>

            <label className="field-label">마감 일시 (선택 — 지나면 자동 종료)</label>
            <input
              className="poll-question-input"
              type="datetime-local"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
            />

            <button type="button" className="poll-create-btn" onClick={create} disabled={!canCreate}>
              투표 시작
            </button>
          </div>
        )}

        {/* 투표 목록 */}
        {polls.length === 0 ? (
          <p className="tip">아직 투표가 없어요. 위에서 새 투표를 만들어보세요.</p>
        ) : (
          <div className="poll-list">
            {polls.map((poll) => {
              const totalVotes = poll.options.reduce((s, o) => s + o.voters.length, 0)
              const isOwner = poll.owner === username
              const expired = poll.closed || (poll.deadline > 0 && Date.now() >= poll.deadline)
              const dl = deadlineLabel(poll)
              return (
                <div key={poll.id} className="poll-card">
                  <h4 className="poll-question">{poll.question}</h4>
                  <p className="poll-total">
                    총 {totalVotes}표{expired ? ' · 종료됨' : ''}
                  </p>
                  {dl && <p className={expired ? 'poll-deadline expired' : 'poll-deadline'}>⏰ {dl}</p>}

                  <ul className="poll-options">
                    {poll.options.map((opt) => {
                      const count = opt.voters.length
                      const pct = totalVotes ? Math.round((count / totalVotes) * 100) : 0
                      const mine = opt.voters.includes(username)
                      return (
                        <li key={opt.id}>
                          <button
                            type="button"
                            className={mine ? 'poll-option voted' : 'poll-option'}
                            onClick={() => onVote(poll.id, opt.id)}
                            disabled={expired}
                          >
                            <span className="poll-option-bar" style={{ width: `${pct}%` }} />
                            <span className="poll-option-label">
                              {mine ? '☑' : '☐'} {opt.text}
                            </span>
                            <span className="poll-option-count">
                              {count}표 · {pct}%
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>

                  {isOwner && (
                    <div className="poll-owner-actions">
                      {!expired && (
                        <button type="button" className="ghost" onClick={() => onCloseVote(poll.id)}>
                          투표 종료
                        </button>
                      )}
                      <button type="button" className="danger" onClick={() => onClear(poll.id)}>
                        삭제
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </aside>
  )
}
