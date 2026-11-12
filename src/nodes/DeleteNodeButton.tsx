import { NODE_DELETE_REQUEST_EVENT } from './nodeEvents'

interface Props {
  nodeId: string
  /** 추가 클래스 (예: 사진 위에 겹쳐 띄울 때) */
  className?: string
}

/**
 * 노드 공용 삭제 버튼(🗑).
 * 바로 지우지 않고 Board 로 "삭제 확인 창 열기" 이벤트만 올려보낸다.
 * ("삭제" 를 직접 입력해야 지워진다)
 */
export default function DeleteNodeButton({ nodeId, className }: Props) {
  const onClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    window.dispatchEvent(new CustomEvent(NODE_DELETE_REQUEST_EVENT, { detail: { id: nodeId } }))
  }
  return (
    <button
      type="button"
      className={['node-delete-btn', 'nodrag', className].filter(Boolean).join(' ')}
      onClick={onClick}
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      title="삭제"
      aria-label="삭제"
    >
      🗑
    </button>
  )
}
