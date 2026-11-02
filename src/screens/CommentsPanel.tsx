import { useState } from 'react'
import type { Comment } from '../collab/yjs'

interface Props {
  /** 대상 노드 제목(헤더 표시용) */
  nodeTitle: string
  /** 현재 노드의 댓글 목록 (Yjs 에서 실시간 반영) */
  comments: Comment[]
  /** 현재 사용자 username (본인 댓글만 수정/삭제 허용) */
  currentUsername: string
  onAdd: (text: string) => void
  onEdit: (commentId: string, text: string) => void
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
  onEdit,
  onDelete,
  onClose,
}: Props) {
  const [text, setText] = useState('')
  // 수정 중인 댓글 id 와 입력값
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const t = text.trim()
    if (!t) return
    onAdd(t)
    setText('')
  }

  const startEdit = (c: Comment) => {
    setEditingId(c.id)
    setEditingText(c.text)
  }

  const saveEdit = () => {
    if (!editingId) return
    const t = editingText.trim()
    if (t) onEdit(editingId, t)
    setEditingId(null)
    setEditingText('')
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
          sorted.map((c) => {
            const mine = c.authorUsername === currentUsername
            const isEditing = editingId === c.id
            return (
              <div key={c.id} className="comment-item">
                <div className="comment-meta">
                  <span className="comment-author">{c.author}</span>
                  <span className="comment-time">{formatTime(c.at)}</span>
                </div>

                {isEditing ? (
                  <div className="comment-edit">
                    <textarea
                      value={editingText}
                      rows={2}
                      autoFocus
                      onChange={(e) => setEditingText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          saveEdit()
                        }
                        if (e.key === 'Escape') setEditingId(null)
                      }}
                    />
                    <div className="comment-edit-actions">
                      <button type="button" className="ghost" onClick={() => setEditingId(null)}>
                        취소
                      </button>
                      <button type="button" onClick={saveEdit} disabled={!editingText.trim()}>
                        저장
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="comment-text">{c.text}</div>
                    {mine && (
                      <div className="comment-actions">
                        <button type="button" className="comment-link" onClick={() => startEdit(c)}>
                          수정
                        </button>
                        <button
                          type="button"
                          className="comment-link danger-text"
                          onClick={() => onDelete(c.id)}
                        >
                          삭제
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )
          })
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
