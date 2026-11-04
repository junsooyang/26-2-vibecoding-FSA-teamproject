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
 * - 클릭하면 Board 로 투표 토글 이벤트를 올려보낸다. (1인 1표, Yjs 저장)
 * - 마우스를 올리면 누가 투표했는지(username 목록) 작은 팝오버로 보여준다.
 */
export default function VoteButton({ nodeId, votes, voted }: Props) {
  const voters = votes ?? []
  const count = voters.length
  const onVote = (e: React.MouseEvent) => {
    e.stopPropagation()
    window.dispatchEvent(new CustomEvent(NODE_VOTE_EVENT, { detail: { id: nodeId } }))
  }
  return (
    <span className="vote-wrap">
      <button
        type="button"
        className={voted ? 'vote-btn voted' : 'vote-btn'}
        onClick={onVote}
      >
        👍 {count}
      </button>
      {count > 0 && (
        <span className="vote-voters" role="tooltip">
          <span className="vote-voters-title">좋아요 {count}명</span>
          {voters.map((u) => (
            <span key={u} className="vote-voter">
              @{u}
            </span>
          ))}
        </span>
      )}
    </span>
  )
}
