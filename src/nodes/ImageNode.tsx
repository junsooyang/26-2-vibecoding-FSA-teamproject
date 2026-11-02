import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { ImageNodeData } from '../collab/yjs'

/**
 * 이미지(사진) 커스텀 노드.
 * 업로드한 사진(data URL) 또는 외부 이미지 URL 을 캔버스에 표시한다.
 * 상/하 핸들로 다른 노드와 트리 연결이 가능하다.
 */
export default function ImageNode({ data, selected }: NodeProps) {
  const d = data as ImageNodeData
  const width = Math.max(80, Number(d.width) || 200)

  return (
    <div className={selected ? 'image-node selected' : 'image-node'} style={{ width }}>
      <Handle type="target" position={Position.Top} />

      {d.src ? (
        <img src={d.src} alt={d.label || '이미지'} className="image-node-img" draggable={false} />
      ) : (
        <div className="image-node-empty">이미지 없음</div>
      )}

      {d.label && <div className="image-node-caption">{d.label}</div>}

      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}
