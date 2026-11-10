import { useEffect, useRef, useState } from 'react'

/** 실수 삭제를 막기 위해 팀장이 직접 입력해야 하는 확인 문구 */
export const DELETE_CONFIRM_PHRASE = '삭제하겠습니다.'

/** 끝의 마침표/공백 차이는 허용해서 입력 실수로 막히지 않게 비교한다. */
function normalize(s: string) {
  return s.trim().replace(/[.。]+$/, '')
}

interface Props {
  /** 삭제할 보드 이름 (안내용) */
  roomName: string
  /** 삭제 진행 중 여부 (버튼 비활성화) */
  deleting: boolean
  /** 서버 오류 메시지 (있으면 표시) */
  error: string | null
  onConfirm: () => void
  onClose: () => void
}

/** 보드 삭제 확인 모달: 확인 문구를 정확히 입력해야만 삭제 버튼이 활성화된다. */
export default function DeleteBoardModal({ roomName, deleting, error, onConfirm, onClose }: Props) {
  const [typed, setTyped] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const matched = normalize(typed) === normalize(DELETE_CONFIRM_PHRASE)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (matched && !deleting) onConfirm()
  }

  return (
    <div className="panel-overlay" onClick={deleting ? undefined : onClose}>
      <div
        className="panel delete-board-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-board-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !deleting) onClose()
        }}
      >
        <div className="panel-head">
          <h2 id="delete-board-title">🗑️ 보드 삭제</h2>
        </div>

        <p className="delete-warning">
          <strong>'{roomName}'</strong> 보드를 삭제하면 보드 내용, 멤버, 모든 팀원의 개인 공간이
          함께 사라지고 <strong>되돌릴 수 없어요.</strong>
        </p>

        <form onSubmit={submit}>
          <label className="delete-label" htmlFor="delete-board-input">
            계속하려면 아래에 <code>{DELETE_CONFIRM_PHRASE}</code> 를 입력하세요.
          </label>
          <input
            id="delete-board-input"
            ref={inputRef}
            className="delete-input"
            value={typed}
            placeholder={DELETE_CONFIRM_PHRASE}
            autoComplete="off"
            disabled={deleting}
            onChange={(e) => setTyped(e.target.value)}
          />

          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}

          <div className="delete-actions">
            <button type="button" className="delete-cancel" onClick={onClose} disabled={deleting}>
              취소
            </button>
            <button type="submit" className="delete-confirm" disabled={!matched || deleting}>
              {deleting ? '삭제 중...' : '보드 삭제'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
