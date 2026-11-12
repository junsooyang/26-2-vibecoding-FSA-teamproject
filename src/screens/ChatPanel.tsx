import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChatMessage, ChatReplyRef } from '../collab/yjs'
import {
  formatChatDateTime,
  makeReplyRef,
  searchChat,
  splitByQuery,
  withDateDividers,
} from '../collab/chatFormat'
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
  /** 보내기. 답장이면 원래 메시지 요약(replyTo)을 함께 넘긴다 */
  onSend: (text: string, replyTo?: ChatReplyRef) => void
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

/** 검색어 부분을 <mark> 로 강조해 그린다 */
function Highlighted({ text, query }: { text: string; query: string }) {
  return (
    <>
      {splitByQuery(text, query).map((p, i) =>
        p.hit ? (
          <mark key={i} className="chat-hit">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  )
}

/**
 * 방에 들어온 참여자들끼리 자유롭게 대화하는 실시간 채팅 창.
 * 오른쪽 패널(캘린더·대시보드 등)과 함께 볼 수 있도록 화면 위에 따로 떠 있고, 끌어서 옮길 수 있다.
 * - 하루가 지나 새 대화가 오면 가운데에 날짜 구분선 ("2026년 11월 13일 금요일")
 * - 대화 기록 검색 (결과를 누르면 그 메시지로 이동)
 * - 메시지에 답장 (원래 메시지를 인용해 보여 주고, 인용을 누르면 원래 메시지로 이동)
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
  // 답장할 메시지 (null = 일반 메시지)
  const [replyTo, setReplyTo] = useState<ChatReplyRef | null>(null)
  // 검색
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  // 이동한 메시지를 잠깐 강조
  const [flashId, setFlashId] = useState<string | null>(null)
  const [pendingJumpId, setPendingJumpId] = useState<string | null>(null)

  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // 떠 있는 작은 창: 머리를 끌어 옮기고 오른쪽 아래 모서리로 크기 조절 (위치는 이 브라우저에 저장)
  const makeDefault = useCallback(
    () => defaultChatRect({ width: window.innerWidth, height: window.innerHeight }, topLimit + 52),
    [topLimit],
  )
  const floating = useFloatingWindow('chat-window-rect', makeDefault, topLimit)

  const searching = searchOpen && query.trim() !== ''
  const items = useMemo(() => withDateDividers(messages), [messages])
  const results = useMemo(
    () => (searching ? searchChat(messages, query) : []),
    [searching, messages, query],
  )
  const existingIds = useMemo(() => new Set(messages.map((m) => m.id)), [messages])

  // 새 메시지가 오면 맨 아래로 스크롤 (검색 결과를 보는 중에는 그대로)
  useEffect(() => {
    if (searching) return
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length, searching])

  // 검색 창을 열면 입력칸에 커서
  useEffect(() => {
    if (searchOpen) searchRef.current?.focus()
  }, [searchOpen])

  // 메시지로 이동: 검색을 닫고 다시 그려진 뒤 그 메시지를 가운데로 스크롤 + 잠깐 강조
  useEffect(() => {
    if (!pendingJumpId || searching) return
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-msg-id="${CSS.escape(pendingJumpId)}"]`,
    )
    setPendingJumpId(null)
    if (!el) return
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    setFlashId(pendingJumpId)
  }, [pendingJumpId, searching])

  useEffect(() => {
    if (!flashId) return
    const t = window.setTimeout(() => setFlashId(null), 1600)
    return () => window.clearTimeout(t)
  }, [flashId])

  const jumpTo = (id: string) => {
    if (!existingIds.has(id)) return
    setSearchOpen(false)
    setQuery('')
    setPendingJumpId(id)
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const t = text.trim()
    if (!t) return
    onSend(t, replyTo ?? undefined)
    setText('')
    setReplyTo(null)
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

  const startReply = (m: ChatMessage) => {
    setReplyTo(makeReplyRef(m))
    inputRef.current?.focus()
  }

  const closeSearch = () => {
    setSearchOpen(false)
    setQuery('')
  }

  const renderMessage = (m: ChatMessage) => {
    const mine = m.authorUsername === currentUsername
    const isEditing = editingId === m.id
    const rowClass = ['chat-row', mine ? 'mine' : '', flashId === m.id ? 'flash' : '']
      .filter(Boolean)
      .join(' ')
    return (
      <div key={m.id} className={rowClass} data-msg-id={m.id}>
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
                if (e.key === 'Escape') {
                  e.stopPropagation()
                  setEditingId(null)
                }
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
              {m.replyTo && (
                <button
                  type="button"
                  className="chat-reply-quote"
                  onClick={() => m.replyTo && jumpTo(m.replyTo.id)}
                  disabled={!existingIds.has(m.replyTo.id)}
                  title={
                    existingIds.has(m.replyTo.id) ? '원래 메시지로 이동' : '원래 메시지가 지워졌어요'
                  }
                >
                  <span className="chat-reply-author">↩ {m.replyTo.author}</span>
                  <span className="chat-reply-text">{m.replyTo.text}</span>
                </button>
              )}
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
            <span className="chat-msg-actions">
              <button type="button" className="chat-link" onClick={() => startReply(m)}>
                답장
              </button>
              {mine && (
                <>
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
                </>
              )}
            </span>
          </div>
        )}
      </div>
    )
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
        if (e.key !== 'Escape' || editingId) return
        // Esc: 답장 취소 → 검색 닫기 → 창 닫기 순서
        if (replyTo) setReplyTo(null)
        else if (searchOpen) closeSearch()
        else onClose()
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
        <div className="chat-head-actions">
          <button
            type="button"
            className={searchOpen ? 'ghost chat-search-toggle active' : 'ghost chat-search-toggle'}
            onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
            aria-pressed={searchOpen}
            title="대화 기록 검색"
          >
            🔍 검색
          </button>
          <button type="button" className="ghost" onClick={onClose}>
            닫기
          </button>
        </div>
      </div>

      {searchOpen && (
        <div className="chat-search-bar">
          <input
            ref={searchRef}
            type="search"
            value={query}
            placeholder="내용이나 보낸 사람으로 찾기"
            aria-label="대화 기록 검색"
            onChange={(e) => setQuery(e.target.value)}
          />
          <span className="chat-search-count" aria-live="polite">
            {searching ? `${results.length}개` : ''}
          </span>
        </div>
      )}

      <div className="chat-list" ref={listRef}>
        {searching ? (
          results.length === 0 ? (
            <p className="tip">‘{query.trim()}’ 이(가) 들어간 대화가 없어요.</p>
          ) : (
            results.map((m) => (
              <button
                key={m.id}
                type="button"
                className="chat-search-result"
                onClick={() => jumpTo(m.id)}
                title="이 메시지로 이동"
              >
                <span className="chat-search-head">
                  <b style={{ color: m.color }}>
                    <Highlighted text={m.author} query={query} />
                  </b>
                  <span className="chat-time">{formatChatDateTime(m.at)}</span>
                </span>
                <span className="chat-search-text">
                  <Highlighted text={m.text} query={query} />
                </span>
              </button>
            ))
          )
        ) : messages.length === 0 ? (
          <p className="tip">아직 대화가 없어요. 첫 메시지를 보내보세요.</p>
        ) : (
          items.map((item) =>
            item.kind === 'date' ? (
              <div key={item.key} className="chat-date-divider" role="separator">
                <span>{item.label}</span>
              </div>
            ) : (
              renderMessage(item.message)
            ),
          )
        )}
      </div>

      {replyTo && (
        <div className="chat-reply-bar">
          <div className="chat-reply-bar-body">
            <span className="chat-reply-author">↩ {replyTo.author}에게 답장</span>
            <span className="chat-reply-text">{replyTo.text}</span>
          </div>
          <button
            type="button"
            className="chat-link"
            onClick={() => setReplyTo(null)}
            aria-label="답장 취소"
            title="답장 취소 (Esc)"
          >
            ✕
          </button>
        </div>
      )}

      <form className="comment-form chat-form" onSubmit={submit}>
        <textarea
          ref={inputRef}
          value={text}
          placeholder={
            replyTo
              ? `${replyTo.author}에게 답장 (Enter 전송 / Shift+Enter 줄바꿈)`
              : '메시지를 입력하세요 (Enter 전송 / Shift+Enter 줄바꿈)'
          }
          rows={2}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
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
