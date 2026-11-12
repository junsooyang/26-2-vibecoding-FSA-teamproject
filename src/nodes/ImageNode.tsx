import { useEffect, useState } from 'react'
import { NodeResizer, type NodeProps } from '@xyflow/react'
import type { ImageNodeData } from '../collab/yjs'
import { fetchFileBlobUrl, isFileRef } from '../api/client'
import { safeImageSrc } from '../collab/safeUrl'
import { NODE_RESIZE_EVENT } from './nodeEvents'
import NodeHandles from './NodeHandles'
import DeleteNodeButton from './DeleteNodeButton'

/** 사진 노드 최소 너비(px) */
const MIN_WIDTH = 80

/**
 * 보드에 저장된 이미지 값을 <img> 에서 쓸 수 있는 주소로 바꾸는 훅.
 *  - 서버 파일 참조(fsafile:...) : 인증 헤더로 가져와 blob URL 로 변환 (로딩/실패 상태 제공)
 *  - 예전 data URL(래스터 이미지)  : 그대로 사용 (외부 URL 은 safeImageSrc 에서 걸러짐)
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
 * 업로드한 사진(서버 파일 참조)과 예전 방식의 data URL 을 캔버스에 표시한다.
 * 상/하/좌/우 핸들로 어느 방향으로든 다른 노드와 연결할 수 있다.
 */
export default function ImageNode({ id, data, selected, width: liveWidth }: NodeProps) {
  const d = data as ImageNodeData & { w?: number }
  // 모서리를 끌어 조절한 너비(w, 공유 저장) > 처음 넣을 때 너비(width) > 기본 200px
  const savedWidth = Math.max(MIN_WIDTH, Number(d.w) || Number(d.width) || 200)
  // 끄는 중에는 React Flow 가 알려 주는 실시간 너비를 따라간다
  const width = liveWidth && liveWidth > 0 ? liveWidth : savedWidth
  // 공유 문서의 값은 누구나 바꿀 수 있으므로, 허용된 형식의 주소만 쓴다 (외부 주소·스크립트 차단)
  const { resolved, failed, loading } = useImageSrc(safeImageSrc(d.src))

  return (
    <div className={selected ? 'image-node selected' : 'image-node'} style={{ width }}>
      {/* 사진을 선택하면 모서리 손잡이로 크기 조절 (가로세로 비율 유지) */}
      <NodeResizer
        isVisible={selected}
        minWidth={MIN_WIDTH}
        keepAspectRatio
        onResizeEnd={(_e, params) => {
          window.dispatchEvent(
            new CustomEvent(NODE_RESIZE_EVENT, {
              detail: { id, w: Math.round(params.width), h: Math.round(params.height) },
            }),
          )
        }}
      />
      <NodeHandles />

      {resolved ? (
        <img src={resolved} alt={d.label || '이미지'} className="image-node-img" draggable={false} />
      ) : (
        <div className="image-node-empty">
          {loading ? '불러오는 중...' : failed ? '이미지를 불러오지 못했어요' : '이미지 없음'}
        </div>
      )}

      {d.label && <div className="image-node-caption">{d.label}</div>}

      {/* 오른쪽 아래 삭제 버튼 (사진 위에 겹쳐 표시) */}
      <DeleteNodeButton nodeId={id} className="image-delete" />
    </div>
  )
}
