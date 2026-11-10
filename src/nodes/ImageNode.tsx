import { useEffect, useState } from 'react'
import { type NodeProps } from '@xyflow/react'
import type { ImageNodeData } from '../collab/yjs'
import { fetchFileBlobUrl, isFileRef } from '../api/client'
import NodeHandles from './NodeHandles'

/**
 * 보드에 저장된 이미지 값을 <img> 에서 쓸 수 있는 주소로 바꾸는 훅.
 *  - 서버 파일 참조(fsafile:...) : 인증 헤더로 가져와 blob URL 로 변환 (로딩/실패 상태 제공)
 *  - 예전 data URL / 외부 URL    : 그대로 사용
 */
function useImageSrc(src: string | undefined) {
  const [resolved, setResolved] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setFailed(false)
    if (!src) {
      setResolved(null)
      return
    }
    if (!isFileRef(src)) {
      setResolved(src)
      return
    }
    let alive = true
    setResolved(null)
    fetchFileBlobUrl(src)
      .then((url) => {
        if (alive) setResolved(url)
      })
      .catch(() => {
        if (alive) setFailed(true)
      })
    return () => {
      alive = false
    }
  }, [src])

  return { resolved, failed, loading: !!src && !resolved && !failed }
}

/**
 * 이미지(사진) 커스텀 노드.
 * 업로드한 사진(서버 파일 참조), 예전 방식의 data URL, 외부 이미지 URL 을 캔버스에 표시한다.
 * 상/하/좌/우 핸들로 어느 방향으로든 다른 노드와 연결할 수 있다.
 */
export default function ImageNode({ data, selected }: NodeProps) {
  const d = data as ImageNodeData
  const width = Math.max(80, Number(d.width) || 200)
  const { resolved, failed, loading } = useImageSrc(d.src)

  return (
    <div className={selected ? 'image-node selected' : 'image-node'} style={{ width }}>
      <NodeHandles />

      {resolved ? (
        <img src={resolved} alt={d.label || '이미지'} className="image-node-img" draggable={false} />
      ) : (
        <div className="image-node-empty">
          {loading ? '불러오는 중...' : failed ? '이미지를 불러오지 못했어요' : '이미지 없음'}
        </div>
      )}

      {d.label && <div className="image-node-caption">{d.label}</div>}
    </div>
  )
}
