import ConfirmPhraseModal from './ConfirmPhraseModal'

/** 실수 삭제를 막기 위해 팀장이 직접 입력해야 하는 확인 문구 */
export const DELETE_CONFIRM_PHRASE = '삭제하겠습니다.'

interface Props {
  /** 삭제할 보드 이름 (안내용) */
  roomName: string
  /** 삭제 진행 중 여부 (버튼 비활성화) */
  deleting: boolean
  /** 서버 오류 메시지 (있으면 표시) */
  error: string | null
  onConfirm: () => void
  onClose: () => void
}

/** 보드 삭제 확인 모달: 확인 문구를 입력해야만 삭제 버튼이 켜진다. */
export default function DeleteBoardModal({ roomName, deleting, error, onConfirm, onClose }: Props) {
  return (
    <ConfirmPhraseModal
      title="🗑️ 보드 삭제"
      message={
        <p>
          <strong>'{roomName}'</strong> 보드를 삭제하면 보드 내용, 멤버, 업로드한 파일, 모든 팀원의
          개인 공간이 함께 사라지고 <strong>되돌릴 수 없어요.</strong>
        </p>
      }
      phrase={DELETE_CONFIRM_PHRASE}
      confirmLabel="보드 삭제"
      busy={deleting}
      busyLabel="삭제 중..."
      error={error}
      onConfirm={onConfirm}
      onClose={onClose}
    />
  )
}
