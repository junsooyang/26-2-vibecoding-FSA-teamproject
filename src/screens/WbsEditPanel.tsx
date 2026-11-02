import { useRef, useState } from 'react'
import type { Attachment, WbsNodeData, WbsStatus } from '../collab/yjs'
import { WBS_STATUS } from '../nodes/WbsNode'

interface Props {
  initial: WbsNodeData
  onSave: (patch: Partial<WbsNodeData>) => void
  onAddAttachment: (attachment: Attachment) => void
  onRemoveAttachment: (attachmentId: string) => void
  onClose: () => void
}

const STATUS_ORDER: WbsStatus[] = ['todo', 'doing', 'done']

/** 업로드 파일 최대 크기(2MB). Yjs 문서에 data URL 로 직접 저장되므로 과도한 용량을 막는다. */
const MAX_FILE_SIZE = 2 * 1024 * 1024

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
  initial,
  onSave,
  onAddAttachment,
  onRemoveAttachment,
  onClose,
}: Props) {
  const [label, setLabel] = useState(initial.label)
  const [assignee, setAssignee] = useState(initial.assignee)
  const [status, setStatus] = useState<WbsStatus>(initial.status)
  const [progress, setProgress] = useState(initial.progress)
  const [linkUrl, setLinkUrl] = useState('')
  const [linkName, setLinkName] = useState('')
  const [fileError, setFileError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 첨부는 Yjs(노드 data)에서 실시간으로 내려오므로 initial 에서 바로 읽는다.
  const attachments = initial.attachments ?? []

  const save = (e: React.FormEvent) => {
    e.preventDefault()
    onSave({ label: label.trim() || '새 작업', assignee: assignee.trim(), status, progress })
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
    const reader = new FileReader()
    reader.onload = () => {
      onAddAttachment({
        id: newId(),
        type: 'file',
        name: file.name,
        url: String(reader.result), // data URL(base64)
        size: file.size,
        mime: file.type,
      })
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
    reader.onerror = () => setFileError('파일을 읽지 못했습니다.')
    reader.readAsDataURL(file)
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

          <button type="submit">저장</button>
        </form>

        {/* ---------- 첨부(링크/파일) ---------- */}
        <div className="attach-section">
          <div className="field-label">📎 자료 첨부 (링크·파일)</div>

          {attachments.length > 0 && (
            <ul className="attach-list">
              {attachments.map((a) => (
                <li key={a.id} className="attach-item">
                  <a
                    href={a.url}
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
            <input ref={fileInputRef} type="file" onChange={onPickFile} />
            <span className="attach-hint">최대 {formatSize(MAX_FILE_SIZE)}</span>
          </div>
          {fileError && <p className="error">{fileError}</p>}
        </div>
      </div>
    </div>
  )
}
