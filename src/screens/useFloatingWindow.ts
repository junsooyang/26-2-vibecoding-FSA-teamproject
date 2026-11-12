import { useCallback, useEffect, useRef, useState } from 'react'
import { clampRect, parseSavedRect, type WindowRect } from '../collab/windowRect'

/** 이 너비 이하에서는 떠 있는 창 대신 화면 아래 시트로 보여 준다 (CSS 의 720px 와 같게) */
const NARROW_QUERY = '(max-width: 720px)'

const viewport = () => ({ width: window.innerWidth, height: window.innerHeight })

/**
 * 화면 위에 떠 있는 작은 창: 머리를 끌어 옮기고, 오른쪽 아래 모서리를 끌어 크기를 바꾼다.
 * 위치·크기는 이 브라우저에 저장되어 다음에 열 때 그 자리에 뜬다.
 *
 * @param storageKey 위치·크기를 저장할 localStorage 키
 * @param makeDefault 저장된 값이 없을 때 처음 위치
 * @param minTop 창 머리가 올라갈 수 있는 가장 위 (툴바 아래)
 */
export function useFloatingWindow(
  storageKey: string,
  makeDefault: () => WindowRect,
  minTop: number,
) {
  const [rect, setRect] = useState<WindowRect>(() => {
    const saved = parseSavedRect(localStorage.getItem(storageKey))
    return clampRect(saved ?? makeDefault(), viewport(), minTop)
  })
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW_QUERY).matches)
  const [dragging, setDragging] = useState(false)
  const elRef = useRef<HTMLElement | null>(null)
  const rectRef = useRef(rect)
  rectRef.current = rect

  const save = useCallback(
    (r: WindowRect) => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(r))
      } catch {
        // 저장 공간이 없으면 이번 창에서만 유지
      }
    },
    [storageKey],
  )

  // 화면 크기가 바뀌면 창을 화면 안으로 다시 맞추고, 좁은 화면 여부를 갱신
  useEffect(() => {
    const mq = window.matchMedia(NARROW_QUERY)
    const onResize = () => setRect((r) => clampRect(r, viewport(), minTop))
    const onMq = () => setNarrow(mq.matches)
    window.addEventListener('resize', onResize)
    mq.addEventListener('change', onMq)
    return () => {
      window.removeEventListener('resize', onResize)
      mq.removeEventListener('change', onMq)
    }
  }, [minTop])

  // 툴바가 여러 줄로 늘어나 창 머리가 툴바 밑에 숨지 않게
  useEffect(() => {
    setRect((r) => clampRect(r, viewport(), minTop))
  }, [minTop])

  // 오른쪽 아래 모서리(CSS resize)로 크기를 바꾸면 그 크기를 기억한다
  useEffect(() => {
    const el = elRef.current
    if (!el || narrow) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const ro = new ResizeObserver(() => {
      const width = Math.round(el.offsetWidth)
      const height = Math.round(el.offsetHeight)
      const cur = rectRef.current
      if (Math.abs(width - cur.width) < 2 && Math.abs(height - cur.height) < 2) return
      const next = clampRect({ ...cur, width, height }, viewport(), minTop)
      setRect(next)
      clearTimeout(timer)
      timer = setTimeout(() => save(next), 300)
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
      clearTimeout(timer)
    }
  }, [narrow, minTop, save])

  /** 창 머리에서 누르면 끌기 시작 (버튼·입력칸을 누른 경우는 제외) */
  const onHeaderPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (narrow || e.button !== 0) return
      if ((e.target as HTMLElement).closest('button, input, textarea, select, a')) return
      e.preventDefault()
      const start = { x: e.clientX, y: e.clientY }
      const origin = rectRef.current
      const header = e.currentTarget
      header.setPointerCapture(e.pointerId)
      setDragging(true)
      const onMove = (ev: PointerEvent) => {
        setRect(
          clampRect(
            { ...origin, x: origin.x + ev.clientX - start.x, y: origin.y + ev.clientY - start.y },
            viewport(),
            minTop,
          ),
        )
      }
      const onUp = () => {
        header.removeEventListener('pointermove', onMove)
        header.removeEventListener('pointerup', onUp)
        header.removeEventListener('pointercancel', onUp)
        setDragging(false)
        save(rectRef.current)
      }
      header.addEventListener('pointermove', onMove)
      header.addEventListener('pointerup', onUp)
      header.addEventListener('pointercancel', onUp)
    },
    [narrow, minTop, save],
  )

  /** 처음 위치로 되돌리기 (머리 더블클릭) */
  const reset = useCallback(() => {
    if (narrow) return
    const next = clampRect(makeDefault(), viewport(), minTop)
    setRect(next)
    save(next)
  }, [narrow, makeDefault, minTop, save])

  // 좁은 화면에서는 CSS 가 정한 아래 시트 모양을 쓰고, 위치·크기를 덮어쓰지 않는다
  const style: React.CSSProperties | undefined = narrow
    ? undefined
    : { left: rect.x, top: rect.y, width: rect.width, height: rect.height }

  return { elRef, style, dragging, narrow, onHeaderPointerDown, reset }
}
