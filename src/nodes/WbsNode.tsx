import { type NodeProps } from '@xyflow/react'
import type { Attachment, WbsStatus } from '../collab/yjs'
import { useCurrentUsername } from './CurrentUserContext'
import { CHECKLIST_TOGGLE_EVENT, WBS_TOGGLE_DONE_EVENT } from './nodeEvents'
import { dueBadge, dueState } from '../collab/wbsUtils'
import NodeHandles from './NodeHandles'
import VoteButton from './VoteButton'
import CommentButton from './CommentButton'

// 기존 import 경로 호환을 위해 재노출
export { WBS_TOGGLE_DONE_EVENT }

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
export default function WbsNode({ id, data, selected }: NodeProps) {
  const d = data as {
    label: string
    assignee: string
    status: WbsStatus
    progress: number
    due?: string
    checklist?: { id: string; text: string; done: boolean }[]
    attachments?: Attachment[]
    votes?: string[]
    comments?: { id: string }[]
  }
  const me = useCurrentUsername()
  const status = WBS_STATUS[d.status] ?? WBS_STATUS.todo
  const progress = Math.max(0, Math.min(100, Number(d.progress) || 0))
  const done = d.status === 'done'
  const dstate = dueState(d.due, done)
  const checklist = d.checklist ?? []
  const checklistDone = checklist.filter((c) => c.done).length
  const attachmentCount = d.attachments?.length ?? 0
  const voted = !!me && (d.votes?.includes(me) ?? false)

  // 체크박스 토글 -> Board 에 알림(이벤트). 노드 더블클릭 편집과 섞이지 않게 버블링 중단.
  const onToggle = (e: React.MouseEvent | React.ChangeEvent) => {
    e.stopPropagation()
    window.dispatchEvent(new CustomEvent(WBS_TOGGLE_DONE_EVENT, { detail: { id } }))
  }

  // 세부 체크항목 토글 (노드에서 바로 체크)
  const onToggleItem = (e: React.MouseEvent | React.ChangeEvent, itemId: string) => {
    e.stopPropagation()
    window.dispatchEvent(new CustomEvent(CHECKLIST_TOGGLE_EVENT, { detail: { id, itemId } }))
  }

  return (
    <div className={selected ? 'wbs-node selected' : 'wbs-node'} style={{ borderColor: status.color }}>
      <NodeHandles />

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

      {d.due && (
        <div className={`wbs-due ${dstate}`}>
          📅 {dueBadge(d.due, done)}
        </div>
      )}

      <div className="wbs-progress">
        <div
          className="wbs-progress-fill"
          style={{ width: `${progress}%`, background: status.color }}
        />
      </div>

      {checklist.length > 0 && (
        <div className="wbs-node-checklist">
          <div className="wbs-checklist-count" title={`세부 항목 ${checklistDone}/${checklist.length} 완료`}>
            ✅ 세부 항목 {checklistDone}/{checklist.length}
          </div>
          <ul className="wbs-check-items">
            {checklist.map((item) => (
              <li key={item.id} className={item.done ? 'wbs-check-item done' : 'wbs-check-item'}>
                <label
                  className="nodrag"
                  onClick={(e) => onToggleItem(e, item.id)}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <input
                    type="checkbox"
                    checked={item.done}
                    onChange={(e) => onToggleItem(e, item.id)}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <span>{item.text}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="wbs-foot">
        {attachmentCount > 0 && (
          <span className="wbs-attach-count" title={`첨부 ${attachmentCount}개`}>
            📎 {attachmentCount}
          </span>
        )}
        <VoteButton nodeId={id} votes={d.votes} voted={voted} />
        <CommentButton nodeId={id} count={d.comments?.length ?? 0} />
      </div>

    </div>
  )
}
