import { NODE_VOTE_EVENT } from './nodeEvents'

interface Props {
  /** 노드 id */
  nodeId: string
  /** 투표한 사용자 username 목록 */
  votes?: string[]
  /** 현재 사용자가 이미 투표했는지 */
  voted: boolean
}

/**
 * 노드 공용 투표 버튼(👍).
 * 클릭하면 Board 로 투표 토글 이벤트를 올려보낸다. (1인 1표, Yjs 저장)
 */
export default function VoteButton({ nodeId, votes, voted }: Props) {
  const count = votes?.length ?? 0
  const onVote = (e: React.MouseEvent) => {
    e.stopPropagation()
    window.dispatchEvent(new CustomEvent(NODE_VOTE_EVENT, { detail: { id: nodeId } }))
  }
  return (
    <button
      type="button"
      className={voted ? 'vote-btn voted' : 'vote-btn'}
      onClick={onVote}
      title={voted ? '투표 취소' : '투표하기'}
    >
      👍 {count}
    </button>
  )
}
