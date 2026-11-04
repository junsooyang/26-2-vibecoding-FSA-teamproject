/**
 * 커스텀 노드 내부의 상호작용을 Board 로 전달하기 위한 window CustomEvent 이름 모음.
 * (React Flow 커스텀 노드는 props 로 콜백을 받기 번거로워 이벤트로 올려보낸다.)
 */

/** WBS 완료 체크박스 토글: detail = { id } */
export const WBS_TOGGLE_DONE_EVENT = 'wbs-toggle-done'

/** 노드 투표 토글(1인 1표): detail = { id } */
export const NODE_VOTE_EVENT = 'node-vote'

/** 스티커 메모 색상 변경: detail = { id, color } */
export const STICKY_COLOR_EVENT = 'sticky-color'

/** 노드 댓글 패널 열기: detail = { id } */
export const NODE_COMMENT_EVENT = 'node-comment'

/** 아이디어/스티커 노드를 WBS 작업으로 승격: detail = { id } */
export const PROMOTE_WBS_EVENT = 'promote-wbs'

/** WBS 세부 체크항목 완료 토글: detail = { id, itemId } */
export const CHECKLIST_TOGGLE_EVENT = 'checklist-toggle'

/** 노드 내용 접기/펼치기 토글: detail = { id } */
export const NODE_COLLAPSE_EVENT = 'node-collapse'

/** 노드 크기 조절 완료: detail = { id, w, h } */
export const NODE_RESIZE_EVENT = 'node-resize'
