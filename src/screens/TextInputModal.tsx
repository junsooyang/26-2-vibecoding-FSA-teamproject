import { useState } from 'react'

interface Props {
  /** 모달 헤더 제목 (예: "새 메모") */
  heading: string
  /** 초기 본문 텍스트 */
  initial?: string
  placeholder?: string
  confirmLabel?: string
  /** 제목 입력 칸을 함께 표시할지 */
  withTitle?: boolean
  /** 초기 제목 값 */
  initialTitle?: string
  /** 저장 콜백. withTitle 이면 title 도 함께 전달된다. */
  onSubmit: (text: string, title?: string) => void
  onClose: () => void
}

/**
 * 여러 줄 입력 모달.
 * - 메모/아이디어 본문(textarea) 입력
 * - withTitle 이면 상단에 제목(한 줄) 입력 칸도 제공
 * - Ctrl/⌘ + Enter 로 저장, Esc 로 취소
 */
export default function TextInputModal({
  heading,
  initial = '',
  placeholder = '내용을 입력하세요 (여러 줄 가능)',
  confirmLabel = '확인',
  withTitle = false,
  initialTitle = '',
  onSubmit,
  onClose,
}: Props) {
  const [text, setText] = useState(initial)
  const [titleText, setTitleText] = useState(initialTitle)

  const submit = () => {
    onSubmit(text, withTitle ? titleText : undefined)
    onClose()
  }

  return (
    <div className="panel-overlay" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <h2>{heading}</h2>
          <button type="button" className="ghost" onClick={onClose}>
            닫기
          </button>
        </div>

        {withTitle && (
          <input
            className="text-input-title"
            value={titleText}
            placeholder="제목 (선택)"
            autoFocus
            onChange={(e) => setTitleText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                submit()
              }
              if (e.key === 'Escape') onClose()
            }}
          />
        )}

        <textarea
          className="text-input-area"
          value={text}
          placeholder={placeholder}
          autoFocus={!withTitle}
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
