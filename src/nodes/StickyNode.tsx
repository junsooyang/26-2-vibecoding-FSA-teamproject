import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { StickyColor, StickyNodeData } from '../collab/yjs'
import { useCurrentUsername } from './CurrentUserContext'
import { STICKY_COLOR_EVENT } from './nodeEvents'
import VoteButton from './VoteButton'

/** 스티커 색상 팔레트 (배경 / 테두리) */
export const STICKY_COLORS: Record<StickyColor, { bg: string; border: string }> = {
  yellow: { bg: '#fff9c4', border: '#f6e05e' },
  pink: { bg: '#fde2e4', border: '#f8a5b1' },
  blue: { bg: '#d6ecff', border: '#8ec5f0' },
  green: { bg: '#d9f7df', border: '#8fd99f' },
}

const COLOR_ORDER: StickyColor[] = ['yellow', 'pink', 'blue', 'green']

/**
 * 스티커(포스트잇) 메모 커스텀 노드.
 * - 더블클릭으로 텍스트 편집(Board 에서 처리)
 * - 색상 점을 눌러 색 변경
 * - 👍 투표 버튼 포함
 */
export default function StickyNode({ id, data, selected }: NodeProps) {
  const d = data as StickyNodeData
  const me = useCurrentUsername()
  const palette = STICKY_COLORS[d.color] ?? STICKY_COLORS.yellow
  const voted = !!me && (d.votes?.includes(me) ?? false)

  const pickColor = (e: React.MouseEvent, color: StickyColor) => {
    e.stopPropagation()
    window.dispatchEvent(new CustomEvent(STICKY_COLOR_EVENT, { detail: { id, color } }))
  }

  return (
    <div
      className={selected ? 'sticky-node selected' : 'sticky-node'}
      style={{ background: palette.bg, borderColor: palette.border }}
    >
      <Handle type="target" position={Position.Top} />

      <div className="sticky-colors">
        {COLOR_ORDER.map((c) => (
          <span
            key={c}
            className={d.color === c ? 'sticky-dot active' : 'sticky-dot'}
            style={{ background: STICKY_COLORS[c].border }}
            onClick={(e) => pickColor(e, c)}
            title={`${c} 색상`}
          />
        ))}
      </div>

      <div className="sticky-text">{d.text || '(빈 메모 — 더블클릭해서 입력)'}</div>

      <div className="sticky-foot">
        <VoteButton nodeId={id} votes={d.votes} voted={voted} />
      </div>

      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}
