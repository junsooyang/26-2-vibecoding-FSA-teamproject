import { useCallback, useState } from 'react'
import type { ResizeParams } from '@xyflow/react'
import { NODE_RESIZE_EVENT } from './nodeEvents'

/**
 * 모서리 손잡이(NodeResizer)로 크기를 바꾸는 동안에만 쓰는 "실시간 크기".
 *
 * React Flow 가 노드에 넘겨 주는 width/height 는 "측정된 크기"라서, 그 값을 다시 노드 너비로 쓰면
 * 감싸는 칸이 한 번 커질 때(예: 드래그로 겹쳤을 때) 측정값 → 너비 → 측정값으로 계속 커진 채 남는다.
 * 그래서 끄는 중에는 NodeResizer 가 알려 주는 값만 쓰고, 끝나면 공유 저장된 크기(data.w/h)를 따른다.
 */
export function useLiveResize(id: string) {
  const [live, setLive] = useState<{ width: number; height: number } | null>(null)

  const onResize = useCallback((_e: unknown, p: ResizeParams) => {
    setLive({ width: p.width, height: p.height })
  }, [])

  const onResizeEnd = useCallback(
    (_e: unknown, p: ResizeParams) => {
      setLive(null)
      window.dispatchEvent(
        new CustomEvent(NODE_RESIZE_EVENT, {
          detail: { id, w: Math.round(p.width), h: Math.round(p.height) },
        }),
      )
    },
    [id],
  )

  return { live, onResize, onResizeEnd }
}
