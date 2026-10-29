import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { WbsStatus } from '../collab/yjs'

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
export default function WbsNode({ data, selected }: NodeProps) {
  const d = data as {
    label: string
    assignee: string
    status: WbsStatus
    progress: number
  }
  const status = WBS_STATUS[d.status] ?? WBS_STATUS.todo
  const progress = Math.max(0, Math.min(100, Number(d.progress) || 0))

  return (
    <div className={selected ? 'wbs-node selected' : 'wbs-node'} style={{ borderColor: status.color }}>
      <Handle type="target" position={Position.Top} />

      <div className="wbs-head">
        <span className="wbs-status" style={{ color: status.color, background: status.bg }}>
          {status.label}
        </span>
      </div>

      <div className="wbs-title">{d.label || '(제목 없음)'}</div>

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

      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}
