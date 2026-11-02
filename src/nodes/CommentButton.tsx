import { NODE_COMMENT_EVENT } from './nodeEvents'

interface Props {
  nodeId: string
  count: number
}

/**
 * 노드 공용 댓글 버튼(💬).
 * 클릭하면 Board 로 "이 노드의 댓글 패널 열기" 이벤트를 올려보낸다.
 */
export default function CommentButton({ nodeId, count }: Props) {
  const onClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    window.dispatchEvent(new CustomEvent(NODE_COMMENT_EVENT, { detail: { id: nodeId } }))
  }
  return (
    <button type="button" className="comment-btn" onClick={onClick} title="댓글/의견">
      💬 {count}
    </button>
  )
}
