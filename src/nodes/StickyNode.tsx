import { NodeResizer, type NodeProps } from '@xyflow/react'
import type { StickyColor, StickyNodeData } from '../collab/yjs'
import { useCurrentUsername } from './CurrentUserContext'
import { NODE_COLLAPSE_EVENT, NODE_RESIZE_EVENT, PROMOTE_WBS_EVENT, STICKY_COLOR_EVENT } from './nodeEvents'
import NodeHandles from './NodeHandles'
import VoteButton from './VoteButton'
import CommentButton from './CommentButton'

/** 스티커 색상 팔레트 (배경 / 테두리) */
export const STICKY_COLORS: Record<StickyColor, { bg: string; border: string }> = {
  yellow: { bg: '#fff9c4', border: '#f6e05e' },
  pink: { bg: '#fde2e4', border: '#f8a5b1' },
  blue: { bg: '#d6ecff', border: '#8ec5f0' },
  green: { bg: '#d9f7df', border: '#8fd99f' },
}

const COLOR_ORDER: StickyColor[] = ['yellow', 'pink', 'blue', 'green']

/** 이 길이를 넘으면 접기/펼치기 버튼을 보여주고, 기본적으로 접어서 … 로 표시한다. */
const LONG_TEXT = 40

/**
 * 스티커(포스트잇) 메모 커스텀 노드.
 * - 더블클릭으로 텍스트 편집(Board 에서 처리)
 * - 모서리를 끌어 크기 조절(공유 저장)
 * - 내용이 길면 접기/펼치기
 */
export default function StickyNode({ id, data, selected }: NodeProps) {
  const d = data as StickyNodeData & { seq?: number; w?: number; h?: number; collapsed?: boolean }
  const me = useCurrentUsername()
  const palette = STICKY_COLORS[d.color] ?? STICKY_COLORS.yellow
  const voted = !!me && (d.votes?.includes(me) ?? false)
  const text = d.text || ''
  const isLong = text.length > LONG_TEXT
  // 명시적 설정이 있으면 그 값, 없으면 긴 글은 기본 접힘(…)
  const collapsed = d.collapsed ?? isLong

  const pickColor = (e: React.MouseEvent, color: StickyColor) => {
    e.stopPropagation()
    window.dispatchEvent(new CustomEvent(STICKY_COLOR_EVENT, { detail: { id, color } }))
  }

  const promote = (e: React.MouseEvent) => {
    e.stopPropagation()
    window.dispatchEvent(new CustomEvent(PROMOTE_WBS_EVENT, { detail: { id } }))
  }

  const toggleCollapse = (e: React.MouseEvent) => {
    e.stopPropagation()
    window.dispatchEvent(new CustomEvent(NODE_COLLAPSE_EVENT, { detail: { id } }))
  }

  // 사용자가 지정한 크기가 있으면 적용 (없으면 CSS 기본)
  const sizeStyle: React.CSSProperties = {
    background: palette.bg,
    borderColor: palette.border,
    ...(d.w ? { width: d.w } : {}),
    ...(d.h && !collapsed ? { height: d.h } : {}),
  }

  return (
    <div className={selected ? 'sticky-node selected' : 'sticky-node'} style={sizeStyle}>
      <NodeResizer
        isVisible={selected}
        minWidth={140}
        minHeight={90}
        onResizeEnd={(_e, params) => {
          window.dispatchEvent(
            new CustomEvent(NODE_RESIZE_EVENT, {
              detail: { id, w: Math.round(params.width), h: Math.round(params.height) },
            }),
          )
        }}
      />
      <NodeHandles />

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
        {d.seq != null && <span className="node-seq" title="생성 순서">#{d.seq}</span>}
      </div>

      <div className={collapsed ? 'sticky-text clamped' : 'sticky-text'}>
        {text || '(빈 메모 — 더블클릭해서 입력)'}
      </div>

      {isLong && (
        <button type="button" className="collapse-toggle" onClick={toggleCollapse}>
          {collapsed ? '⌄ 펼치기' : '⌃ 접기'}
        </button>
      )}

      <div className="sticky-foot">
        <button type="button" className="promote-btn" onClick={promote} title="이 메모를 WBS 작업으로 전환">
          → 작업
        </button>
        <VoteButton nodeId={id} votes={d.votes} voted={voted} />
        <CommentButton nodeId={id} count={d.comments?.length ?? 0} />
      </div>
    </div>
  )
}
