import { type NodeProps } from '@xyflow/react'
import type { ImageNodeData } from '../collab/yjs'
import NodeHandles from './NodeHandles'

/**
 * 이미지(사진) 커스텀 노드.
 * 업로드한 사진(data URL) 또는 외부 이미지 URL 을 캔버스에 표시한다.
 * 상/하/좌/우 핸들로 어느 방향으로든 다른 노드와 연결할 수 있다.
 */
export default function ImageNode({ data, selected }: NodeProps) {
  const d = data as ImageNodeData
  const width = Math.max(80, Number(d.width) || 200)

  return (
    <div className={selected ? 'image-node selected' : 'image-node'} style={{ width }}>
      <NodeHandles />

      {d.src ? (
        <img src={d.src} alt={d.label || '이미지'} className="image-node-img" draggable={false} />
      ) : (
        <div className="image-node-empty">이미지 없음</div>
      )}

      {d.label && <div className="image-node-caption">{d.label}</div>}
    </div>
  )
}
