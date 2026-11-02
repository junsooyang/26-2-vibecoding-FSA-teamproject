import { useCallback, useEffect, useRef, useState } from 'react'

interface Props {
  /** 방 slug (방별로 개인 공간 분리) */
  room: string
  /** 현재 사용자 username (사용자별 개인 공간 분리) */
  username: string
  onClose: () => void
}

/** 개인 보관 파일 (data URL 로 localStorage 에 저장) */
interface PersonalFile {
  id: string
  name: string
  url: string
  size: number
}

interface PersonalData {
  note: string
  files: PersonalFile[]
}

/** 개인 파일 최대 크기(2MB). localStorage 용량 보호. */
const MAX_FILE_SIZE = 2 * 1024 * 1024

function storageKey(room: string, username: string) {
  return `fsa_personal:${username}:${room}`
}

function loadData(room: string, username: string): PersonalData {
  try {
    const raw = localStorage.getItem(storageKey(room, username))
    if (raw) return JSON.parse(raw) as PersonalData
  } catch {
    // 손상된 데이터는 무시
  }
  return { note: '', files: [] }
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * 팀원별 개인 공간 패널.
 * - 개인 노트장(자유 메모)
 * - 개인 파일 보관함
 * 이 데이터는 공유되지 않고, 브라우저 localStorage 에 사용자+방별로 저장된다.
 */
export default function PersonalSpacePanel({ room, username, onClose }: Props) {
  const [data, setData] = useState<PersonalData>(() => loadData(room, username))
  const [fileError, setFileError] = useState('')
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 변경 시 localStorage 에 저장
  useEffect(() => {
    try {
      localStorage.setItem(storageKey(room, username), JSON.stringify(data))
      setSavedAt(Date.now())
    } catch {
      setFileError('저장 공간이 가득 찼습니다. 파일을 줄여주세요.')
    }
  }, [data, room, username])

  const onPickFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
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
      setData((prev) => ({
        ...prev,
        files: [
          ...prev.files,
          {
            id: `pf-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            name: file.name,
            url: String(reader.result),
            size: file.size,
          },
        ],
      }))
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
    reader.onerror = () => setFileError('파일을 읽지 못했습니다.')
    reader.readAsDataURL(file)
  }, [])

  const removeFile = (id: string) =>
    setData((prev) => ({ ...prev, files: prev.files.filter((f) => f.id !== id) }))

  return (
    <aside className="side-panel personal-panel" onClick={(e) => e.stopPropagation()}>
      <div className="side-head">
        <div>
          <h3>🗂️ 내 개인 공간</h3>
          <p className="side-sub">@{username} · 나만 볼 수 있어요</p>
        </div>
        <button type="button" className="ghost" onClick={onClose}>
          닫기
        </button>
      </div>

      <div className="personal-body">
        <div className="field-label">📝 개인 노트장</div>
        <textarea
          className="personal-note"
          value={data.note}
          placeholder="나만 보는 메모를 자유롭게 적어보세요."
          onChange={(e) => setData((prev) => ({ ...prev, note: e.target.value }))}
        />

        <div className="field-label">📎 개인 파일 보관함</div>
        <div className="personal-file-add">
          <input ref={fileInputRef} type="file" onChange={onPickFile} />
          <span className="attach-hint">최대 {formatSize(MAX_FILE_SIZE)}</span>
        </div>
        {fileError && <p className="error">{fileError}</p>}

        {data.files.length > 0 && (
          <ul className="attach-list">
            {data.files.map((f) => (
              <li key={f.id} className="attach-item">
                <a
                  href={f.url}
                  download={f.name}
                  className="attach-link"
                  title={`${f.name} (${formatSize(f.size)})`}
                >
                  <span className="attach-icon">📄</span>
                  <span className="attach-name">{f.name}</span>
                  <span className="attach-size">{formatSize(f.size)}</span>
                </a>
                <button type="button" className="danger" onClick={() => removeFile(f.id)}>
                  삭제
                </button>
              </li>
            ))}
          </ul>
        )}

        {savedAt && <p className="tip">자동 저장됨 · 이 브라우저에만 보관됩니다.</p>}
      </div>
    </aside>
  )
}
