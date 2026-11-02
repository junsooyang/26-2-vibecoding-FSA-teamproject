import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { Attachment, WbsStatus } from '../collab/yjs'

/** 상태별 라벨/색상 */
export const WBS_STATUS: Record<WbsStatus, { label: string; color: string; bg: string }> = {
  todo: { label: '할 일', color: '#6b7280', bg: '#f3f4f6' },
  doing: { label: '진행 중', color: '#2563eb', bg: '#dbeafe' },
  done: { label: '완료', color: '#059669', bg: '#d1fae5' },
}

/**
 * WBS(작업 분해) 커스텀 노드.
 * 작업명 + 담당자 + 상태 배지 + 진행률 바를 표시한다.
 * 상/하 핸들로 트리(부모-자식) 연결이 가능하다.
 */
/** 노드 내부 상호작용(완료 토글 등)을 Board 로 전달하는 커스텀 이벤트 이름 */
export const WBS_TOGGLE_DONE_EVENT = 'wbs-toggle-done'

export default function WbsNode({ id, data, selected }: NodeProps) {
  const d = data as {
    label: string
    assignee: string
    status: WbsStatus
    progress: number
    attachments?: Attachment[]
  }
  const status = WBS_STATUS[d.status] ?? WBS_STATUS.todo
  const progress = Math.max(0, Math.min(100, Number(d.progress) || 0))
  const done = d.status === 'done'
  const attachmentCount = d.attachments?.length ?? 0

  // 체크박스 토글 -> Board 에 알림(이벤트). 노드 더블클릭 편집과 섞이지 않게 버블링 중단.
  const onToggle = (e: React.MouseEvent | React.ChangeEvent) => {
    e.stopPropagation()
    window.dispatchEvent(new CustomEvent(WBS_TOGGLE_DONE_EVENT, { detail: { id } }))
  }

  return (
    <div className={selected ? 'wbs-node selected' : 'wbs-node'} style={{ borderColor: status.color }}>
      <Handle type="target" position={Position.Top} />

      <div className="wbs-head">
        <label className="wbs-check" onClick={onToggle} title={done ? '완료 해제' : '완료로 표시'}>
          <input type="checkbox" checked={done} onChange={onToggle} onClick={(e) => e.stopPropagation()} />
        </label>
        <span className="wbs-status" style={{ color: status.color, background: status.bg }}>
          {status.label}
        </span>
      </div>

      <div className={done ? 'wbs-title done' : 'wbs-title'}>{d.label || '(제목 없음)'}</div>

      <div className="wbs-meta">
        <span className="wbs-assignee">{d.assignee ? `👤 ${d.assignee}` : '담당자 미지정'}</span>
        <span className="wbs-percent">{progress}%</span>
      </div>

      <div className="wbs-progress">
        <div
          className="wbs-progress-fill"
          style={{ width: `${progress}%`, background: status.color }}
        />
      </div>

      {attachmentCount > 0 && (
        <div className="wbs-attach-count" title={`첨부 ${attachmentCount}개`}>
          📎 {attachmentCount}
        </div>
      )}

      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}
