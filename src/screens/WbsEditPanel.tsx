import { useRef, useState } from 'react'
import type { Attachment, ChecklistItem, WbsNodeData, WbsStatus } from '../collab/yjs'
import { WBS_STATUS } from '../nodes/WbsNode'
import { downloadFileRef, isFileRef, uploadFile } from '../api/client'

interface Props {
  /** 현재 보드 slug (파일을 이 보드에 업로드하기 위해 필요) */
  roomSlug: string
  initial: WbsNodeData
  onSave: (patch: Partial<WbsNodeData>) => void
  onAddAttachment: (attachment: Attachment) => void
  onRemoveAttachment: (attachmentId: string) => void
  onAddChecklistItem: (text: string) => void
  onToggleChecklistItem: (itemId: string) => void
  onRemoveChecklistItem: (itemId: string) => void
  onClose: () => void
}

const STATUS_ORDER: WbsStatus[] = ['todo', 'doing', 'done']

/** 업로드 파일 최대 크기(10MB). 서버도 같은 한도로 검사한다. */
const MAX_FILE_SIZE = 10 * 1024 * 1024

function newId() {
  return `att-${Date.now()}-${Math.floor(Math.random() * 1000)}`
}

function formatSize(bytes?: number) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** WBS 노드 편집 패널: 작업명 / 담당자 / 상태 / 진행률 / 첨부(링크·파일) */
export default function WbsEditPanel({
  roomSlug,
  initial,
  onSave,
  onAddAttachment,
  onRemoveAttachment,
  onAddChecklistItem,
  onToggleChecklistItem,
  onRemoveChecklistItem,
  onClose,
}: Props) {
  const [label, setLabel] = useState(initial.label)
  const [assignee, setAssignee] = useState(initial.assignee)
  const [status, setStatus] = useState<WbsStatus>(initial.status)
  const [progress, setProgress] = useState(initial.progress)
  const [start, setStart] = useState(initial.start ?? '')
  const [due, setDue] = useState(initial.due ?? '')
  const [linkUrl, setLinkUrl] = useState('')
  const [linkName, setLinkName] = useState('')
  const [fileError, setFileError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [newChecklistText, setNewChecklistText] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 첨부/체크리스트는 Yjs(노드 data)에서 실시간으로 내려오므로 initial 에서 바로 읽는다.
  const attachments = initial.attachments ?? []
  const checklist: ChecklistItem[] = initial.checklist ?? []
  const checklistDone = checklist.filter((c) => c.done).length

  const addChecklist = () => {
    const t = newChecklistText.trim()
    if (!t) return
    onAddChecklistItem(t)
    setNewChecklistText('')
  }

  // 시작일이 마감일보다 늦으면 저장하지 않는다 (간트차트 막대가 거꾸로 그려지는 것 방지)
  const dateError = start && due && start > due ? '시작일이 마감일보다 늦어요.' : ''

  const save = (e: React.FormEvent) => {
    e.preventDefault()
    if (dateError) return
    onSave({
      label: label.trim() || '새 작업',
      assignee: assignee.trim(),
      status,
      progress,
      start,
      due,
    })
    onClose()
  }

  // 상태를 완료로 바꾸면 진행률 100으로 보조
  const changeStatus = (s: WbsStatus) => {
    setStatus(s)
    if (s === 'done') setProgress(100)
    else if (s === 'todo' && progress === 100) setProgress(0)
  }

  const addLink = () => {
    const url = linkUrl.trim()
    if (!url) return
    // 스킴이 없으면 https 로 보정
    const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`
    onAddAttachment({
      id: newId(),
      type: 'link',
      name: linkName.trim() || normalized,
      url: normalized,
    })
    setLinkUrl('')
    setLinkName('')
  }

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFileError('')
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > MAX_FILE_SIZE) {
      setFileError(`파일이 너무 큽니다. 최대 ${formatSize(MAX_FILE_SIZE)}까지 가능합니다.`)
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }
    // 파일은 서버에 올리고, 보드 문서에는 참조 문자열(fsafile:...)만 저장한다.
    setUploading(true)
    uploadFile(roomSlug, file, 'file')
      .then((uploaded) => {
        onAddAttachment({
          id: newId(),
          type: 'file',
          name: uploaded.name,
          url: uploaded.ref,
          size: uploaded.size,
          mime: uploaded.mime,
        })
      })
      .catch((err) => {
        setFileError(err instanceof Error ? err.message : '파일을 올리지 못했습니다.')
      })
      .finally(() => {
        setUploading(false)
        if (fileInputRef.current) fileInputRef.current.value = ''
      })
  }

  /** 서버에 저장된 파일은 인증이 필요해서 링크로 바로 열 수 없다. 내려받기로 처리한다. */
  const openAttachment = (e: React.MouseEvent, a: Attachment) => {
    if (a.type !== 'file' || !isFileRef(a.url)) return
    e.preventDefault()
    setFileError('')
    downloadFileRef(a.url, a.name).catch((err) => {
      setFileError(err instanceof Error ? err.message : '파일을 내려받지 못했습니다.')
    })
  }

  return (
    <div className="panel-overlay" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <h2>WBS 작업 편집</h2>
          <button type="button" className="ghost" onClick={onClose}>
            닫기
          </button>
        </div>

        <form onSubmit={save} className="wbs-form">
          <label>
            작업명
            <input value={label} onChange={(e) => setLabel(e.target.value)} autoFocus />
          </label>

          <label>
            담당자
            <input
              value={assignee}
              placeholder="예: 김팀원"
              onChange={(e) => setAssignee(e.target.value)}
            />
          </label>

          <div className="wbs-date-row">
            <label>
              시작일
              <input
                type="date"
                value={start}
                max={due || undefined}
                onChange={(e) => setStart(e.target.value)}
              />
            </label>
            <label>
              마감일
              <input
                type="date"
                value={due}
                min={start || undefined}
                onChange={(e) => setDue(e.target.value)}
              />
            </label>
          </div>
          {dateError && (
            <p className="error" role="alert">
              {dateError}
            </p>
          )}

          <div className="field-label">상태</div>
          <div className="status-group">
            {STATUS_ORDER.map((s) => (
              <button
                key={s}
                type="button"
                className={status === s ? 'status-btn active' : 'status-btn'}
                style={
                  status === s
                    ? { background: WBS_STATUS[s].bg, color: WBS_STATUS[s].color, borderColor: WBS_STATUS[s].color }
                    : undefined
                }
                onClick={() => changeStatus(s)}
              >
                {WBS_STATUS[s].label}
              </button>
            ))}
          </div>

          <label>
            진행률: {progress}%
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={progress}
              onChange={(e) => setProgress(Number(e.target.value))}
            />
          </label>

          <button type="submit" disabled={!!dateError}>
            저장
          </button>
        </form>

        {/* ---------- 세부 체크항목(서브태스크) ---------- */}
        <div className="attach-section">
          <div className="field-label">
            ✅ 세부 체크항목 {checklist.length > 0 && `(${checklistDone}/${checklist.length})`}
          </div>

          {checklist.length > 0 && (
            <ul className="checklist">
              {checklist.map((item) => (
                <li key={item.id} className={item.done ? 'checklist-item done' : 'checklist-item'}>
                  <label>
                    <input
                      type="checkbox"
                      checked={item.done}
                      onChange={() => onToggleChecklistItem(item.id)}
                    />
                    <span className="checklist-text">{item.text}</span>
                  </label>
                  <button
                    type="button"
                    className="checklist-del"
                    onClick={() => onRemoveChecklistItem(item.id)}
                    title="삭제"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="checklist-add">
            <input
              type="text"
              value={newChecklistText}
              placeholder="세부 항목 추가 (Enter)"
              onChange={(e) => setNewChecklistText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addChecklist()
                }
              }}
            />
            <button type="button" className="ghost" onClick={addChecklist}>
              추가
            </button>
          </div>
        </div>

        {/* ---------- 첨부(링크/파일) ---------- */}
        <div className="attach-section">
          <div className="field-label">📎 자료 첨부 (링크·파일)</div>

          {attachments.length > 0 && (
            <ul className="attach-list">
              {attachments.map((a) => (
                <li key={a.id} className="attach-item">
                  <a
                    href={a.url}
                    onClick={(e) => openAttachment(e, a)}
                    target="_blank"
                    rel="noopener noreferrer"
                    download={a.type === 'file' ? a.name : undefined}
                    className="attach-link"
                    title={a.type === 'link' ? a.url : `${a.name} (${formatSize(a.size)})`}
                  >
                    <span className="attach-icon">{a.type === 'link' ? '🔗' : '📄'}</span>
                    <span className="attach-name">{a.name}</span>
                    {a.type === 'file' && <span className="attach-size">{formatSize(a.size)}</span>}
                  </a>
                  <button
                    type="button"
                    className="danger"
                    onClick={() => onRemoveAttachment(a.id)}
                    title="첨부 삭제"
                  >
                    삭제
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* 링크 추가 */}
          <div className="attach-add">
            <input
              type="text"
              value={linkUrl}
              placeholder="링크 URL (예: https://...)"
              onChange={(e) => setLinkUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addLink()
                }
              }}
            />
            <input
              type="text"
              value={linkName}
              placeholder="표시 이름(선택)"
              onChange={(e) => setLinkName(e.target.value)}
            />
            <button type="button" className="ghost" onClick={addLink}>
              링크 추가
            </button>
          </div>

          {/* 파일 업로드 */}
          <div className="attach-file">
            <input ref={fileInputRef} type="file" onChange={onPickFile} disabled={uploading} />
            <span className="attach-hint">
              {uploading ? '업로드 중...' : `최대 ${formatSize(MAX_FILE_SIZE)}`}
            </span>
          </div>
          {fileError && <p className="error">{fileError}</p>}
        </div>
      </div>
    </div>
  )
}
