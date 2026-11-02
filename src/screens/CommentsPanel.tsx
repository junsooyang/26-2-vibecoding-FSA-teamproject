import { useState } from 'react'
import type { Comment } from '../collab/yjs'

interface Props {
  /** 대상 노드 제목(헤더 표시용) */
  nodeTitle: string
  /** 현재 노드의 댓글 목록 (Yjs 에서 실시간 반영) */
  comments: Comment[]
  /** 현재 사용자 username (본인 댓글만 삭제 허용) */
  currentUsername: string
  onAdd: (text: string) => void
  onDelete: (commentId: string) => void
  onClose: () => void
}

function formatTime(ms: number) {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 특정 노드에 댓글/의견을 남기는 패널 (우측 사이드) */
export default function CommentsPanel({
  nodeTitle,
  comments,
  currentUsername,
  onAdd,
  onDelete,
  onClose,
}: Props) {
  const [text, setText] = useState('')

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const t = text.trim()
    if (!t) return
    onAdd(t)
    setText('')
  }

  const sorted = [...comments].sort((a, b) => a.at - b.at)

  return (
    <aside className="side-panel comments-panel" onClick={(e) => e.stopPropagation()}>
      <div className="side-head">
        <div>
          <h3>💬 댓글</h3>
          <p className="side-sub">{nodeTitle}</p>
        </div>
        <button type="button" className="ghost" onClick={onClose}>
          닫기
        </button>
      </div>

      <div className="comment-list">
        {sorted.length === 0 ? (
          <p className="tip">아직 댓글이 없어요. 첫 의견을 남겨보세요.</p>
        ) : (
          sorted.map((c) => (
            <div key={c.id} className="comment-item">
              <div className="comment-meta">
                <span className="comment-author">{c.author}</span>
                <span className="comment-time">{formatTime(c.at)}</span>
              </div>
              <div className="comment-text">{c.text}</div>
              {c.authorUsername === currentUsername && (
                <button type="button" className="comment-del" onClick={() => onDelete(c.id)}>
                  삭제
                </button>
              )}
            </div>
          ))
        )}
      </div>

      <form className="comment-form" onSubmit={submit}>
        <textarea
          value={text}
          placeholder="의견을 입력하세요 (Enter 전송 / Shift+Enter 줄바꿈)"
          rows={2}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit(e)
            }
          }}
        />
        <button type="submit" disabled={!text.trim()}>
          남기기
        </button>
      </form>
    </aside>
  )
}
