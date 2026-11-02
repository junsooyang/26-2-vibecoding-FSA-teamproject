import { useState } from 'react'

interface Props {
  title: string
  /** 초기 텍스트 */
  initial?: string
  placeholder?: string
  confirmLabel?: string
  onSubmit: (text: string) => void
  onClose: () => void
}

/**
 * 여러 줄 입력이 가능한 모달.
 * window.prompt(한 줄) 대신 textarea 로 메모/아이디어 내용을 입력받는다.
 * - Ctrl/⌘ + Enter 로 저장, Esc 로 취소
 */
export default function TextInputModal({
  title,
  initial = '',
  placeholder = '내용을 입력하세요 (여러 줄 가능)',
  confirmLabel = '확인',
  onSubmit,
  onClose,
}: Props) {
  const [text, setText] = useState(initial)

  const submit = () => {
    onSubmit(text)
    onClose()
  }

  return (
    <div className="panel-overlay" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <h2>{title}</h2>
          <button type="button" className="ghost" onClick={onClose}>
            닫기
          </button>
        </div>

        <textarea
          className="text-input-area"
          value={text}
          placeholder={placeholder}
          autoFocus
          rows={6}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              submit()
            }
            if (e.key === 'Escape') onClose()
          }}
        />

        <div className="text-input-actions">
          <span className="attach-hint">Ctrl + Enter 로 저장 · 줄바꿈은 Enter</span>
          <button type="button" onClick={submit}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
