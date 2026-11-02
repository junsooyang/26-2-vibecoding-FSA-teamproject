import { Handle, Position } from '@xyflow/react'

/**
 * 모든 커스텀 노드가 공유하는 4방향(상/하/좌/우) 연결 핸들.
 *
 * 각 방향마다 source(끌어서 시작) + target(받기) 핸들을 겹쳐 둔다.
 * → 어느 방향(위아래/좌우)으로든 노드를 연결할 수 있다.
 * 핸들 id 는 방향별로 고유해야 하므로 `<pos>-s` / `<pos>-t` 로 구분한다.
 */
export default function NodeHandles() {
  const dirs: { pos: Position; key: string }[] = [
    { pos: Position.Top, key: 'top' },
    { pos: Position.Right, key: 'right' },
    { pos: Position.Bottom, key: 'bottom' },
    { pos: Position.Left, key: 'left' },
  ]
  return (
    <>
      {dirs.map(({ pos, key }) => (
        <span key={key}>
          <Handle type="target" position={pos} id={`${key}-t`} className="node-handle" />
          <Handle type="source" position={pos} id={`${key}-s`} className="node-handle" />
        </span>
      ))}
    </>
  )
}
