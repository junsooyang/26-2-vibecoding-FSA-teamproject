import { useState } from 'react'
import type { Poll } from '../collab/yjs'

interface Props {
  /** 현재 활성 투표 (없으면 null) */
  poll: Poll | null
  /** 현재 사용자 username */
  username: string
  onCreate: (question: string, options: string[]) => void
  onVote: (optionId: string) => void
  onClear: () => void
  onCloseVote: () => void // 투표 종료(결과 확정)
  onDismiss: () => void // 패널 닫기
}

/**
 * 투표 세션 패널.
 * - 진행 중인 투표가 없으면: 질문 + 선택지 입력해 새 투표 생성
 * - 투표가 있으면: 선택지에 투표(1인 1표) + 실시간 결과 막대. 만든 사람은 종료/삭제 가능.
 */
export default function PollPanel({
  poll,
  username,
  onCreate,
  onVote,
  onClear,
  onCloseVote,
  onDismiss,
}: Props) {
  const [question, setQuestion] = useState('')
  const [options, setOptions] = useState<string[]>(['', ''])

  const setOption = (i: number, v: string) =>
    setOptions((prev) => prev.map((o, idx) => (idx === i ? v : o)))
  const addOptionField = () => setOptions((prev) => [...prev, ''])
  const removeOptionField = (i: number) =>
    setOptions((prev) => (prev.length > 2 ? prev.filter((_, idx) => idx !== i) : prev))

  const create = () => {
    const filled = options.map((o) => o.trim()).filter(Boolean)
    if (!question.trim() || filled.length < 2) return
    onCreate(question, filled)
    setQuestion('')
    setOptions(['', ''])
  }

  const totalVotes = poll ? poll.options.reduce((s, o) => s + o.voters.length, 0) : 0
  const isOwner = poll?.owner === username

  return (
    <aside className="side-panel poll-panel" onClick={(e) => e.stopPropagation()}>
      <div className="side-head">
        <div>
          <h3>🗳️ 투표</h3>
          <p className="side-sub">{poll ? (poll.closed ? '종료됨' : '진행 중') : '새 투표 만들기'}</p>
        </div>
        <button type="button" className="ghost" onClick={onDismiss}>
          닫기
        </button>
      </div>

      <div className="poll-body">
        {!poll ? (
          /* ---- 생성 폼 ---- */
          <div className="poll-create">
            <label className="field-label">질문</label>
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

            <button
              type="button"
              className="poll-create-btn"
              onClick={create}
              disabled={!question.trim() || options.filter((o) => o.trim()).length < 2}
            >
              투표 시작
            </button>
          </div>
        ) : (
          /* ---- 투표/결과 ---- */
          <div className="poll-view">
            <h4 className="poll-question">{poll.question}</h4>
            <p className="poll-total">총 {totalVotes}표</p>

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
                      onClick={() => onVote(opt.id)}
                      disabled={poll.closed}
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

            {poll.closed && <p className="tip">이 투표는 종료되었습니다.</p>}

            {isOwner && (
              <div className="poll-owner-actions">
                {!poll.closed && (
                  <button type="button" className="ghost" onClick={onCloseVote}>
                    투표 종료
                  </button>
                )}
                <button type="button" className="danger" onClick={onClear}>
                  투표 삭제
                </button>
              </div>
            )}
            {!isOwner && !poll.closed && (
              <p className="tip">선택지를 눌러 투표하세요. 다시 누르면 취소됩니다. (1인 1표)</p>
            )}
          </div>
        )}
      </div>
    </aside>
  )
}
