import { useEffect, useRef, useState } from 'react'

/**
 * 요소 안 내용이 세로로 넘치는지(스크롤이 생기는지) 추적한다.
 * 넘칠 때만 `nowheel` 을 붙여, 넘치지 않는 노드 위에서는 휠로 보드가 그대로 움직이게 한다.
 */
export function useOverflowing<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [overflowing, setOverflowing] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const check = () => setOverflowing(el.scrollHeight > el.clientHeight + 1)
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    // 안쪽 내용 크기가 바뀌어도 다시 확인
    for (const child of Array.from(el.children)) ro.observe(child)
    const mo = new MutationObserver(check)
    mo.observe(el, { childList: true, subtree: true, characterData: true })
    return () => {
      ro.disconnect()
      mo.disconnect()
    }
  }, [])

  return { ref, overflowing }
}
