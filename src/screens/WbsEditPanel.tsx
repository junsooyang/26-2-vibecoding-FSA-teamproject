import { useState } from 'react'
import type { WbsNodeData, WbsStatus } from '../collab/yjs'
import { WBS_STATUS } from '../nodes/WbsNode'

interface Props {
  initial: WbsNodeData
  onSave: (patch: Partial<WbsNodeData>) => void
  onClose: () => void
}

const STATUS_ORDER: WbsStatus[] = ['todo', 'doing', 'done']

/** WBS 노드 편집 패널: 작업명 / 담당자 / 상태 / 진행률 */
export default function WbsEditPanel({ initial, onSave, onClose }: Props) {
  const [label, setLabel] = useState(initial.label)
  const [assignee, setAssignee] = useState(initial.assignee)
  const [status, setStatus] = useState<WbsStatus>(initial.status)
  const [progress, setProgress] = useState(initial.progress)

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
      </div>
    </div>
  )
}
