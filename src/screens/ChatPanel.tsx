import { useEffect, useRef, useState } from 'react'
import type { ChatMessage } from '../collab/yjs'

interface Props {
  /** 방 이름(헤더 표시용) */
  roomName: string
  /** 채팅 메시지 목록 (Yjs 에서 실시간 반영, 시간순) */
  messages: ChatMessage[]
  /** 현재 로그인 사용자 username (내 메시지 오른쪽 정렬 + 수정/삭제 권한) */
  currentUsername: string
  /** 현재 접속자 수 */
  peerCount: number
  onSend: (text: string) => void
  onEdit: (id: string, text: string) => void
  onDelete: (id: string) => void
  onClose: () => void
}

function formatTime(ms: number) {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 방에 들어온 참여자들끼리 자유롭게 대화하는 실시간 채팅 패널 (우측 사이드) */
export default function ChatPanel({
  roomName,
  messages,
  currentUsername,
  peerCount,
  onSend,
  onEdit,
  onDelete,
  onClose,
}: Props) {
  const [text, setText] = useState('')
  // 수정 중인 메시지 id 와 입력값
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')
  const listRef = useRef<HTMLDivElement>(null)

  // 새 메시지가 오면 맨 아래로 스크롤
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const t = text.trim()
    if (!t) return
    onSend(t)
    setText('')
  }

  const startEdit = (m: ChatMessage) => {
    setEditingId(m.id)
    setEditingText(m.text)
  }

  const saveEdit = () => {
    if (!editingId) return
    const t = editingText.trim()
    if (t) onEdit(editingId, t)
    setEditingId(null)
    setEditingText('')
  }

  return (
    <aside className="side-panel chat-panel" onClick={(e) => e.stopPropagation()}>
      <div className="side-head">
        <div>
          <h3>💬 채팅</h3>
          <p className="side-sub">
            {roomName} · 접속 {peerCount}명
          </p>
        </div>
        <button type="button" className="ghost" onClick={onClose}>
          닫기
        </button>
      </div>

      <div className="chat-list" ref={listRef}>
        {messages.length === 0 ? (
          <p className="tip">아직 대화가 없어요. 첫 메시지를 보내보세요.</p>
        ) : (
          messages.map((m) => {
            const mine = m.authorUsername === currentUsername
            const isEditing = editingId === m.id
            return (
              <div key={m.id} className={mine ? 'chat-row mine' : 'chat-row'}>
                {!mine && (
                  <span className="chat-author" style={{ color: m.color }}>
                    {m.author}
                  </span>
                )}

                {isEditing ? (
                  <div className="chat-edit">
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
                    <div className="chat-edit-actions">
                      <button type="button" className="ghost" onClick={() => setEditingId(null)}>
                        취소
                      </button>
                      <button type="button" onClick={saveEdit} disabled={!editingText.trim()}>
                        저장
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="chat-bubble-wrap">
                    <div className={mine ? 'chat-bubble mine' : 'chat-bubble'}>
                      {m.text}
                      {m.editedAt ? <span className="chat-edited"> (수정됨)</span> : null}
                    </div>
                    <span className="chat-time">{formatTime(m.at)}</span>
                    {mine && (
                      <span className="chat-msg-actions">
                        <button type="button" className="chat-link" onClick={() => startEdit(m)}>
                          수정
                        </button>
                        <button
                          type="button"
                          className="chat-link danger-text"
                          onClick={() => onDelete(m.id)}
                        >
                          삭제
                        </button>
                      </span>
                    )}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      <form className="comment-form chat-form" onSubmit={submit}>
        <textarea
          value={text}
          placeholder="메시지를 입력하세요 (Enter 전송 / Shift+Enter 줄바꿈)"
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
          보내기
        </button>
      </form>
    </aside>
  )
}
