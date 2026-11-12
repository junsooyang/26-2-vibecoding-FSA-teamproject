import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatMessage } from '../collab/yjs'
import { defaultChatRect } from '../collab/windowRect'
import { useFloatingWindow } from './useFloatingWindow'

interface Props {
  /** 방 이름(헤더 표시용) */
  roomName: string
  /** 채팅 메시지 목록 (Yjs 에서 실시간 반영, 시간순) */
  messages: ChatMessage[]
  /** 현재 로그인 사용자 username (내 메시지 오른쪽 정렬 + 수정/삭제 권한) */
  currentUsername: string
  /** 현재 접속자 수 */
  peerCount: number
  /** 메시지마다 아직 안 읽은 멤버 수 (카카오톡처럼 숫자로 표시, 0 이면 숨김) */
  unreadById?: Record<string, number>
  onSend: (text: string) => void
  onEdit: (id: string, text: string) => void
  onDelete: (id: string) => void
  onClose: () => void
  /** 창 머리가 올라갈 수 있는 가장 위 (툴바 높이). 툴바를 가리지 않게 한다 */
  topLimit?: number
}

function formatTime(ms: number) {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * 방에 들어온 참여자들끼리 자유롭게 대화하는 실시간 채팅 창.
 * 오른쪽 패널(캘린더·대시보드 등)과 함께 볼 수 있도록 화면 위에 따로 떠 있고, 끌어서 옮길 수 있다.
 */
export default function ChatPanel({
  roomName,
  messages,
  currentUsername,
  peerCount,
  unreadById = {},
  onSend,
  onEdit,
  onDelete,
  onClose,
  topLimit = 56,
}: Props) {
  const [text, setText] = useState('')
  // 수정 중인 메시지 id 와 입력값
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')
  const listRef = useRef<HTMLDivElement>(null)

  // 떠 있는 작은 창: 머리를 끌어 옮기고 오른쪽 아래 모서리로 크기 조절 (위치는 이 브라우저에 저장)
  const makeDefault = useCallback(
    () => defaultChatRect({ width: window.innerWidth, height: window.innerHeight }, topLimit + 52),
    [topLimit],
  )
  const floating = useFloatingWindow('chat-window-rect', makeDefault, topLimit)

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
    <section
      ref={(el) => {
        floating.elRef.current = el
      }}
      className={floating.dragging ? 'chat-window dragging' : 'chat-window'}
      style={floating.style}
      role="dialog"
      aria-label="채팅"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !editingId) onClose()
      }}
    >
      <div
        className="side-head chat-window-head"
        onPointerDown={floating.onHeaderPointerDown}
        onDoubleClick={floating.reset}
        title={floating.narrow ? undefined : '끌어서 옮기기 · 더블클릭하면 처음 자리로'}
      >
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
                    <span className="chat-meta-col">
                      {(unreadById[m.id] ?? 0) > 0 && (
                        <span
                          className="chat-unread-count"
                          title={`아직 ${unreadById[m.id]}명이 안 읽었어요`}
                          aria-label={`안 읽은 사람 ${unreadById[m.id]}명`}
                        >
                          {unreadById[m.id]}
                        </span>
                      )}
                      <span className="chat-time">{formatTime(m.at)}</span>
                    </span>
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
    </section>
  )
}
