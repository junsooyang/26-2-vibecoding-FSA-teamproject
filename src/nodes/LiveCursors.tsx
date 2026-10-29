import { useStore } from '@xyflow/react'
import type { RemoteCursor } from '../collab/useCollabBoard'

interface Props {
  cursors: RemoteCursor[]
}

/**
 * 다른 참여자의 실시간 커서를 캔버스 위에 표시한다.
 * awareness 에 저장된 flow 좌표를 현재 뷰포트(줌/팬)에 맞춰 화면 좌표로 변환한다.
 * 덕분에 각자 줌/팬 상태가 달라도 커서가 올바른 위치에 보인다.
 */
export default function LiveCursors({ cursors }: Props) {
  // [translateX, translateY, zoom]
  const transform = useStore((s) => s.transform)
  const [tx, ty, zoom] = transform

  return (
    <div className="cursor-layer">
      {cursors.map((c) => {
        const screenX = c.x * zoom + tx
        const screenY = c.y * zoom + ty
        return (
          <div
            key={c.clientId}
            className="live-cursor"
            style={{ transform: `translate(${screenX}px, ${screenY}px)` }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill={c.color}>
              <path d="M5 3l14 7-6 2-2 6-6-15z" />
            </svg>
            <span className="cursor-label" style={{ background: c.color }}>
              {c.name}
            </span>
          </div>
        )
      })}
    </div>
  )
}
