import { useEffect, useState } from 'react'
import { api, type AiModelId, type AiModelOption, type AiTaskDraft } from '../api/client'

/** 마지막으로 고른 모델을 이 브라우저에 기억 */
const MODEL_STORAGE_KEY = 'ai-model'

export interface EditableSubtask extends AiTaskDraft {
  id: string
  checked: boolean
}

interface Props {
  roomSlug: string
  /** 선택된 부모 노드의 제목/내용 (있으면 기본 입력값으로 채움) */
  initialTopic?: string
  /** 선택된 부모 노드의 기존 체크항목 등 참고 맥락 */
  initialContext?: string
  /** 부모 노드가 지정되어 있는지 (안내 문구 표시용) */
  parentLabel?: string
  onApply: (tasks: AiTaskDraft[]) => void
  onClose: () => void
}

const COUNT_OPTIONS = [3, 4, 5, 6, 7]

const PROVIDER_LABELS: Record<string, string> = {
  gemini: 'Google Gemini',
  openai: 'OpenAI GPT',
  rule: '기본 단계 추천',
}

function toEditableList(tasks: AiTaskDraft[]): EditableSubtask[] {
  const now = Date.now()
  return tasks.map((t, idx) => ({
    id: `draft-${now}-${idx}`,
    label: t.label,
    checklist: [...(t.checklist ?? [])],
    checked: true,
  }))
}

interface SubtaskRowProps {
  item: EditableSubtask
  index: number
  onToggle: (id: string) => void
  onChangeLabel: (id: string, label: string) => void
  onChangeChecklist: (id: string, checklist: string[]) => void
  onRemove: (id: string) => void
}

function SubtaskPreviewRow({
  item,
  index,
  onToggle,
  onChangeLabel,
  onChangeChecklist,
  onRemove,
}: SubtaskRowProps) {
  const [newCheck, setNewCheck] = useState('')

  const handleAddCheck = () => {
    const trimmed = newCheck.trim()
    if (!trimmed) return
    onChangeChecklist(item.id, [...item.checklist, trimmed])
    setNewCheck('')
  }

  const handleRemoveCheck = (ci: number) => {
    onChangeChecklist(
      item.id,
      item.checklist.filter((_, idx) => idx !== ci),
    )
  }

  return (
    <li className={item.checked ? 'ai-draft-item' : 'ai-draft-item unchecked'}>
      <div className="ai-draft-head">
        <input
          type="checkbox"
          checked={item.checked}
          onChange={() => onToggle(item.id)}
          aria-label={`${index + 1}번 세부 작업 포함`}
        />
        <span className="ai-draft-num">#{index + 1}</span>
        <input
          type="text"
          className="ai-draft-title"
          value={item.label}
          placeholder="세부 작업 이름"
          onChange={(e) => onChangeLabel(item.id, e.target.value)}
        />
        <button
          type="button"
          className="checklist-del"
          onClick={() => onRemove(item.id)}
          title="이 작업 제외"
        >
          ✕
        </button>
      </div>

      <ul className="ai-draft-checks">
        {item.checklist.map((c, ci) => (
          <li key={ci} className="ai-draft-check">
            <span>• {c}</span>
            <button
              type="button"
              className="checklist-del"
              onClick={() => handleRemoveCheck(ci)}
              title="체크항목 삭제"
            >
              ✕
            </button>
          </li>
        ))}
      </ul>

      <div className="ai-draft-check-add">
        <input
          type="text"
          value={newCheck}
          placeholder="세부 체크항목 추가 (Enter)"
          onChange={(e) => setNewCheck(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              handleAddCheck()
            }
          }}
        />
        <button type="button" className="ghost" onClick={handleAddCheck}>
          + 항목
        </button>
      </div>
    </li>
  )
}

/**
 * AI 작업 분해 미리보기 모달.
 * 1) 큰 작업/아이디어 제목과 개수(3~7개)를 입력해 AI 에 분해 요청
 * 2) 제안된 세부 작업 목록에서 제목·체크항목을 고치거나 빼고
 * 3) '추가' 버튼을 눌러야 실제 보드에 WBS 노드들로 반영됨
 */
export default function AiBreakdownModal({
  roomSlug,
  initialTopic = '',
  initialContext = '',
  parentLabel,
  onApply,
  onClose,
}: Props) {
  const [topic, setTopic] = useState(initialTopic)
  const [context, setContext] = useState(initialContext)
  const [count, setCount] = useState(5)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [providerInfo, setProviderInfo] = useState<{
    provider: string
    model: string
    notice?: string
  } | null>(null)
  const [drafts, setDrafts] = useState<EditableSubtask[]>([])
  // 모델 선택: 서버가 알려 준 목록 (키가 없는 모델은 고를 수 없게 표시)
  const [models, setModels] = useState<AiModelOption[] | null>(null)
  const [model, setModel] = useState<AiModelId | ''>('')

  useEffect(() => {
    let alive = true
    api
      .aiModels()
      .then(({ models: list, defaultModel }) => {
        if (!alive) return
        setModels(list)
        const usable = (id: string | null) => list.find((m) => m.id === id && m.available)?.id
        let saved: string | null = null
        try {
          saved = localStorage.getItem(MODEL_STORAGE_KEY)
        } catch {
          // 저장소를 못 쓰면 서버 기본값
        }
        setModel(usable(saved) ?? usable(defaultModel) ?? list.find((m) => m.available)?.id ?? '')
      })
      .catch(() => {
        // 목록을 못 받으면 선택 칸 없이 서버 기본값으로 생성한다
        if (alive) setModels([])
      })
    return () => {
      alive = false
    }
  }, [])

  const chooseModel = (id: AiModelId) => {
    setModel(id)
    try {
      localStorage.setItem(MODEL_STORAGE_KEY, id)
    } catch {
      // 기억하지 못해도 이번 창에서는 그대로 쓴다
    }
  }

  const handleGenerate = async (e?: React.FormEvent) => {
    e?.preventDefault()
    const clean = topic.trim()
    if (!clean) {
      setError('쪼갤 큰 작업이나 아이디어 내용을 입력하세요.')
      return
    }
    setError('')
    setLoading(true)
    try {
      const res = await api.breakdownTasks(roomSlug, {
        topic: clean,
        context: context.trim() || undefined,
        count,
        ...(model ? { model } : {}),
      })
      setProviderInfo({ provider: res.provider, model: res.model, notice: res.fallback ? res.notice : undefined })
      setDrafts(toEditableList(res.tasks))
    } catch (err) {
      setError(err instanceof Error ? err.message : '세부 작업을 생성하지 못했습니다.')
    } finally {
      setLoading(false)
    }
  }

  const toggleItem = (id: string) => {
    setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, checked: !d.checked } : d)))
  }

  const changeLabel = (id: string, label: string) => {
    setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, label } : d)))
  }

  const changeChecklist = (id: string, checklist: string[]) => {
    setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, checklist } : d)))
  }

  const removeItem = (id: string) => {
    setDrafts((prev) => prev.filter((d) => d.id !== id))
  }

  const addBlankDraft = () => {
    setDrafts((prev) => [
      ...prev,
      {
        id: `draft-${Date.now()}-${prev.length}`,
        label: '새 세부 작업',
        checklist: [],
        checked: true,
      },
    ])
  }

  const selectedDrafts = drafts.filter((d) => d.checked && d.label.trim().length > 0)

  const handleConfirm = () => {
    if (selectedDrafts.length === 0) return
    onApply(
      selectedDrafts.map((d) => ({
        label: d.label.trim(),
        checklist: d.checklist.map((c) => c.trim()).filter(Boolean),
      })),
    )
    onClose()
  }

  return (
    <div className="panel-overlay" onClick={onClose}>
      <div className="panel ai-panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <h2>✨ AI 작업 쪼개기</h2>
          <button type="button" className="ghost" onClick={onClose}>
            닫기
          </button>
        </div>

        {parentLabel && (
          <p className="tip ai-parent-hint">
            기준 노드 <strong>「{parentLabel}」</strong> 아래에 하위 WBS 작업으로 연결됩니다.
          </p>
        )}

        <form onSubmit={handleGenerate} className="wbs-form ai-form">
          <label>
            쪼갤 큰 작업 / 주제
            <input
              value={topic}
              placeholder="예: 쇼핑몰 결제 기능 구현, 중간 발표 자료 준비"
              onChange={(e) => setTopic(e.target.value)}
              autoFocus
            />
          </label>

          {models && models.length > 0 && (
            <div className="ai-model-field">
              <label>
                AI 모델
                <select
                  className="ai-model-select"
                  value={model}
                  onChange={(e) => chooseModel(e.target.value as AiModelId)}
                >
                  {models.map((m) => (
                    <option key={m.id} value={m.id} disabled={!m.available}>
                      {m.available
                        ? `${m.label}${m.id === 'rule' ? '' : ` · ${m.model}`}`
                        : `${m.label} — 사용 불가`}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}

          <div className="ai-options-row">
            <label className="ai-context-label">
              추가 요청 사항 (선택)
              <input
                value={context}
                placeholder="예: 프론트엔드 위주로, 2주 분량으로"
                onChange={(e) => setContext(e.target.value)}
              />
            </label>
            <label className="ai-count-label">
              개수
              <select value={count} onChange={(e) => setCount(Number(e.target.value))}>
                {COUNT_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n}개
                  </option>
                ))}
              </select>
            </label>
          </div>

          <button type="submit" disabled={loading || !topic.trim()}>
            {loading ? 'AI가 작업을 쪼개는 중...' : drafts.length > 0 ? '↻ 다시 생성' : '✨ 세부 작업 생성'}
          </button>
        </form>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        {drafts.length > 0 && (
          <div className="ai-preview-section">
            <div className="ai-preview-head">
              <span className="field-label">
                미리보기 ({selectedDrafts.length}/{drafts.length}개 선택) — 내용을 자유롭게 고친 뒤 추가하세요
              </span>
              {providerInfo && (
                <span className="ai-provider-badge" title={providerInfo.model}>
                  {PROVIDER_LABELS[providerInfo.provider] ?? providerInfo.provider}
                </span>
              )}
            </div>

            {providerInfo?.notice && (
              <p className="tip ai-fallback-notice" role="status">
                {providerInfo.notice}
              </p>
            )}

            <ul className="ai-draft-list">
              {drafts.map((item, idx) => (
                <SubtaskPreviewRow
                  key={item.id}
                  item={item}
                  index={idx}
                  onToggle={toggleItem}
                  onChangeLabel={changeLabel}
                  onChangeChecklist={changeChecklist}
                  onRemove={removeItem}
                />
              ))}
            </ul>

            <div className="ai-preview-actions">
              <button type="button" className="ghost" onClick={addBlankDraft}>
                + 작업 직접 추가
              </button>
              <button
                type="button"
                className="primary"
                disabled={selectedDrafts.length === 0}
                onClick={handleConfirm}
              >
                선택한 {selectedDrafts.length}개 WBS 작업 추가
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
