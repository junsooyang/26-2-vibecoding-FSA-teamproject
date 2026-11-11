import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

/**
 * 입력한 문구가 확인 문구와 같은지 비교한다.
 * 띄어쓰기와 끝의 마침표 차이는 허용해서("팀장 위임", "삭제하겠습니다") 사소한 입력 차이로 막히지 않게 한다.
 */
export function phraseMatches(typed: string, phrase: string) {
  const norm = (s: string) => s.replace(/\s+/g, '').replace(/[.。]+$/, '')
  return norm(typed) !== '' && norm(typed) === norm(phrase)
}

interface Props {
  /** 제목 (예: "👑 팀장 위임") */
  title: string
  /** 무엇이 일어나는지 설명 */
  message: ReactNode
  /** 직접 입력해야 하는 확인 문구 */
  phrase: string
  /** 확인 버튼 글자 */
  confirmLabel: string
  /** 진행 중 (버튼 비활성화, 닫기 막음) */
  busy?: boolean
  busyLabel?: string
  /** 서버 오류 메시지 */
  error?: string | null
  onConfirm: () => void
  onClose: () => void
}

/** 되돌리기 어려운 동작 전에, 확인 문구를 직접 입력해야만 확인 버튼이 켜지는 모달 */
export default function ConfirmPhraseModal({
  title,
  message,
  phrase,
  confirmLabel,
  busy = false,
  busyLabel = '처리 중...',
  error,
  onConfirm,
  onClose,
}: Props) {
  const [typed, setTyped] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const uid = useId()
  const matched = phraseMatches(typed, phrase)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (matched && !busy) onConfirm()
  }

  return (
    <div
      className="panel-overlay"
      onClick={(e) => {
        // 다른 모달(멤버 관리 등) 안에서 열려도 바깥 모달까지 닫히지 않게
        e.stopPropagation()
        if (!busy) onClose()
      }}
    >
      <div
        className="panel delete-board-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${uid}-title`}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !busy) {
            e.stopPropagation()
            onClose()
          }
        }}
      >
        <div className="panel-head">
          <h2 id={`${uid}-title`}>{title}</h2>
        </div>

        <div className="delete-warning">{message}</div>

        <form onSubmit={submit}>
          <label className="delete-label" htmlFor={`${uid}-input`}>
            계속하려면 아래에 <code>{phrase}</code> 를 입력하세요.
          </label>
          <input
            id={`${uid}-input`}
            ref={inputRef}
            className="delete-input"
            value={typed}
            placeholder={phrase}
            autoComplete="off"
            disabled={busy}
            onChange={(e) => setTyped(e.target.value)}
          />

          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}

          <div className="delete-actions">
            <button type="button" className="delete-cancel" onClick={onClose} disabled={busy}>
              취소
            </button>
            <button type="submit" className="delete-confirm" disabled={!matched || busy}>
              {busy ? busyLabel : confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
