/**
 * 실행 취소 / 동시 편집 로직 테스트 (src/collab/boardChanges.ts 의 실제 코드 사용).
 * 두 Y.Doc 을 서로 동기화해 "나"와 "다른 팀원"을 흉내 낸다.
 */
import * as Y from 'yjs'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  applyEdgeChangesToBoard,
  applyNodeChangesToBoard,
  edgeStyleOf,
  mergeNodeUi,
  stripUi,
  withEdgeStyle,
  type NodeUi,
} from '../../src/collab/boardChanges'
import type { BoardEdge, BoardNode } from '../../src/collab/yjs'

function node(id: string, x: number, label: string): BoardNode {
  return { id, position: { x, y: 0 }, data: { label } }
}

let a: Y.Doc
let b: Y.Doc
let an: Y.Map<BoardNode>
let bn: Y.Map<BoardNode>
let ae: Y.Map<BoardEdge>
let ui: Map<string, NodeUi>
let um: Y.UndoManager

beforeEach(() => {
  a = new Y.Doc()
  b = new Y.Doc()
  a.on('update', (u: Uint8Array, origin: unknown) => {
    if (origin !== 'remote') Y.applyUpdate(b, u, 'remote')
  })
  b.on('update', (u: Uint8Array, origin: unknown) => {
    if (origin !== 'remote') Y.applyUpdate(a, u, 'remote')
  })
  an = a.getMap('nodes')
  bn = b.getMap('nodes')
  ae = a.getMap('edges')
  ui = new Map()
  um = new Y.UndoManager([an, ae], { captureTimeout: 500 })
  an.set('n1', node('n1', 0, 'A'))
  an.set('n2', node('n2', 100, 'B'))
  um.stopCapturing()
  um.clear()
})

const move = (id: string, x: number) =>
  applyNodeChangesToBoard(a, an, ui, [{ type: 'position', id, position: { x, y: 0 } }])

describe('공유 문서 쓰기', () => {
  it('노드를 옮기면 그 노드만 쓴다 (다른 팀원의 동시 수정을 덮어쓰지 않음)', () => {
    bn.set('n2', { ...bn.get('n2')!, data: { label: 'B-팀원' } })
    const { written } = move('n1', 50)
    expect(written).toBe(1)
    expect((an.get('n2')!.data as { label: string }).label).toBe('B-팀원')
  })

  it('선택과 크기 측정은 공유 문서에 쓰지 않고 내 화면 상태에만 둔다', () => {
    const r = applyNodeChangesToBoard(a, an, ui, [
      { type: 'select', id: 'n1', selected: true },
      { type: 'dimensions', id: 'n1', dimensions: { width: 180, height: 90 } },
    ])
    expect(r).toEqual({ uiChanged: true, written: 0 })
    expect(bn.get('n1')!.selected).toBeUndefined()
    expect(ui.get('n1')).toMatchObject({ selected: true, measured: { width: 180, height: 90 } })
    expect(um.undoStack.length).toBe(0)
  })

  it('삭제하면 공유 문서와 내 화면 상태에서 모두 지운다', () => {
    ui.set('n1', { selected: true })
    applyNodeChangesToBoard(a, an, ui, [{ type: 'remove', id: 'n1' }])
    expect(an.has('n1')).toBe(false)
    expect(bn.has('n1')).toBe(false)
    expect(ui.has('n1')).toBe(false)
  })

  it('예전 데이터에 남아 있던 selected / measured 는 쓸 때 정리된다', () => {
    an.set('old', { ...node('old', 0, 'x'), selected: true, measured: { width: 1, height: 1 } })
    move('old', 5)
    expect('selected' in an.get('old')!).toBe(false)
    expect('measured' in an.get('old')!).toBe(false)
  })

  it('연결선 선택도 내 화면 상태로만, 삭제는 공유 문서에', () => {
    ae.set('e1', { id: 'e1', source: 'n1', target: 'n2' })
    const sel = new Map<string, boolean>()
    expect(applyEdgeChangesToBoard(a, ae, sel, [{ type: 'select', id: 'e1', selected: true }]).written).toBe(0)
    expect(sel.get('e1')).toBe(true)
    applyEdgeChangesToBoard(a, ae, sel, [{ type: 'remove', id: 'e1' }])
    expect(ae.has('e1')).toBe(false)
    expect(sel.has('e1')).toBe(false)
  })
})

describe('실행 취소 / 다시 실행', () => {
  it('이동 → 클릭(선택) → 되돌리기: 이동이 되돌려진다', () => {
    move('n1', 50)
    applyNodeChangesToBoard(a, an, ui, [{ type: 'select', id: 'n1', selected: true }])
    applyNodeChangesToBoard(a, an, ui, [
      { type: 'dimensions', id: 'n1', dimensions: { width: 200, height: 80 } },
    ])
    um.undo()
    expect(an.get('n1')!.position.x).toBe(0)
    expect(bn.get('n1')!.position.x).toBe(0) // 팀원 화면에도 반영
    um.redo()
    expect(an.get('n1')!.position.x).toBe(50)
  })

  it('내 변경만 되돌리고 다른 팀원의 변경은 남긴다', () => {
    move('n1', 50)
    bn.set('n3', node('n3', 0, 'C-팀원'))
    um.undo()
    expect(an.get('n1')!.position.x).toBe(0)
    expect(an.has('n3')).toBe(true)
  })

  it('삭제를 되돌리면 노드가 돌아온다', () => {
    applyNodeChangesToBoard(a, an, ui, [{ type: 'remove', id: 'n2' }])
    expect(an.has('n2')).toBe(false)
    um.undo()
    expect((an.get('n2')!.data as { label: string }).label).toBe('B')
  })

  it('빠르게 이어진 이동(드래그)은 한 번에 되돌린다', () => {
    for (let i = 1; i <= 5; i++) move('n2', 100 + i * 10)
    expect(um.undoStack.length).toBe(1)
    um.undo()
    expect(an.get('n2')!.position.x).toBe(100)
  })
})

describe('화면 상태 합치기', () => {
  it('mergeNodeUi 는 내 선택·측정 크기를 붙이고, 기록이 없으면 선택 해제로 본다', () => {
    const n = node('n1', 0, 'A')
    expect(mergeNodeUi(n, undefined).selected).toBe(false)
    const m = mergeNodeUi(n, { selected: true, measured: { width: 10, height: 20 } })
    expect(m.selected).toBe(true)
    expect(m.measured).toEqual({ width: 10, height: 20 })
  })

  it('stripUi 는 화면 전용 필드만 뺀다', () => {
    const s = stripUi({ id: 'x', selected: true, measured: {}, resizing: true, position: { x: 1, y: 2 } })
    expect(s).toEqual({ id: 'x', position: { x: 1, y: 2 } })
  })
})

describe('크기 조절', () => {
  it('끄는 동안은 내 화면 임시 크기를 쓰고, 끝나면 지워서 공유 크기를 따른다', () => {
    applyNodeChangesToBoard(a, an, ui, [
      {
        type: 'dimensions',
        id: 'n1',
        dimensions: { width: 300, height: 200 },
        resizing: true,
        setAttributes: true,
      },
    ])
    expect(ui.get('n1')).toMatchObject({ width: 300, height: 200, resizing: true })
    applyNodeChangesToBoard(a, an, ui, [
      { type: 'dimensions', id: 'n1', dimensions: { width: 300, height: 200 }, resizing: false },
    ])
    expect(ui.get('n1')?.width).toBeUndefined()
    expect(ui.get('n1')?.height).toBeUndefined()
    expect(an.get('n1')!.width).toBeUndefined() // 공유 문서에는 화면 크기가 들어가지 않음
  })
})

describe('연결선 스타일 (선마다 따로)', () => {
  const fallback = { color: '#6366f1', width: 2.5 }

  it('저장된 스타일이 없으면 보드 기본값, 있으면 그 선의 값', () => {
    const plain: BoardEdge = { id: 'e', source: 'a', target: 'b' }
    expect(edgeStyleOf(plain, fallback)).toEqual(fallback)
    const red = withEdgeStyle(plain, { color: '#ef4444', width: 4 })
    expect(edgeStyleOf(red, fallback)).toEqual({ color: '#ef4444', width: 4 })
  })

  it('한 선을 바꿔도 다른 선은 그대로', () => {
    ae.set('e1', withEdgeStyle({ id: 'e1', source: 'n1', target: 'n2' }, fallback))
    ae.set('e2', withEdgeStyle({ id: 'e2', source: 'n2', target: 'n1' }, fallback))
    ae.set('e1', withEdgeStyle(ae.get('e1')!, { color: '#22c55e', width: 6 }))
    expect(edgeStyleOf(ae.get('e1')!, fallback).color).toBe('#22c55e')
    expect(edgeStyleOf(ae.get('e2')!, fallback)).toEqual(fallback)
  })

  it('다른 data 값은 유지하고, 잘못된 값은 기본값으로', () => {
    const e: BoardEdge = { id: 'e', source: 'a', target: 'b', data: { note: 'x', color: '', width: -1 } }
    expect(edgeStyleOf(e, fallback)).toEqual(fallback)
    expect(withEdgeStyle(e, fallback).data).toMatchObject({ note: 'x', ...fallback })
  })
})
