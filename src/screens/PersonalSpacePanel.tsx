import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type PersonalFile, type PersonalSpace } from '../api/client'

interface Props {
  /** 방 slug (방별로 개인 공간 분리) */
  room: string
  /** 현재 사용자 username (헤더 표시용. 실제 식별은 서버에서 JWT 로 처리) */
  username: string
  /** 접힘 여부 (true 면 얇은 탭만 표시) */
  collapsed: boolean
  /** 접기/펼치기 토글 */
  onToggle: () => void
}

/** 개인 파일 최대 크기(2MB). */
const MAX_FILE_SIZE = 2 * 1024 * 1024
/** 저장 디바운스(ms) */
const SAVE_DEBOUNCE = 800

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

/**
 * 팀원별 개인 공간 패널.
 * - 개인 노트장(자유 메모) + 개인 파일 보관함
 * - 데이터는 **서버(SQLite)** 에 사용자+방별로 저장된다. (JWT 로 본인 식별)
 *   → 어느 기기/브라우저에서 로그인해도 동일하게 보인다. 공유는 되지 않음.
 */
export default function PersonalSpacePanel({ room, username, collapsed, onToggle }: Props) {
  const [data, setData] = useState<PersonalSpace>({ note: '', files: [] })
  const [loading, setLoading] = useState(true)
  const [fileError, setFileError] = useState('')
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const fileInputRef = useRef<HTMLInputElement>(null)
  // 최초 로드 완료 전에는 저장하지 않기 위한 플래그
  const loadedRef = useRef(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 서버에서 내 개인 공간 로드
  useEffect(() => {
    let alive = true
    setLoading(true)
    api
      .getPersonal(room)
      .then((res) => {
        if (!alive) return
        setData({ note: res.note ?? '', files: res.files ?? [] })
      })
      .catch(() => {
        if (alive) setFileError('개인 공간을 불러오지 못했습니다.')
      })
      .finally(() => {
        if (!alive) return
        setLoading(false)
        loadedRef.current = true
      })
    return () => {
      alive = false
    }
  }, [room])

  // 변경 시 디바운스하여 서버에 저장
  useEffect(() => {
    if (!loadedRef.current) return
    setSaveState('saving')
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      api
        .savePersonal(room, data)
        .then(() => setSaveState('saved'))
        .catch(() => setSaveState('error'))
    }, SAVE_DEBOUNCE)
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [data, room])

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
      const newFile: PersonalFile = {
        id: `pf-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        name: file.name,
        url: String(reader.result),
        size: file.size,
      }
      setData((prev) => ({ ...prev, files: [...prev.files, newFile] }))
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
    reader.onerror = () => setFileError('파일을 읽지 못했습니다.')
    reader.readAsDataURL(file)
  }, [])

  const removeFile = (id: string) =>
    setData((prev) => ({ ...prev, files: prev.files.filter((f) => f.id !== id) }))

  const saveLabel: Record<SaveState, string> = {
    idle: '',
    saving: '저장 중...',
    saved: '저장됨 · 모든 기기에서 동기화',
    error: '저장 실패 — 네트워크를 확인하세요',
  }

  return (
    <aside className={collapsed ? 'left-dock collapsed' : 'left-dock'}>
      {/* 접기/펼치기 탭 (항상 보임) */}
      <button
        type="button"
        className="left-dock-tab"
        onClick={onToggle}
        title={collapsed ? '내 개인 공간 열기' : '접기'}
      >
        <span className="left-dock-tab-icon">🗂️</span>
        <span className="left-dock-tab-label">{collapsed ? '개인 공간' : '접기 ◀'}</span>
      </button>

      {/* 펼쳐졌을 때만 보이는 본문 */}
      <div className="left-dock-body">
        <div className="side-head">
          <div>
            <h3>🗂️ 내 개인 공간</h3>
            <p className="side-sub">@{username} · 나만 볼 수 있어요</p>
          </div>
        </div>

        {loading ? (
        <div className="personal-body">
          <p className="tip">불러오는 중...</p>
        </div>
      ) : (
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

          {saveState !== 'idle' && (
            <p className={saveState === 'error' ? 'error' : 'tip'}>{saveLabel[saveState]}</p>
          )}
        </div>
        )}
      </div>
    </aside>
  )
}
