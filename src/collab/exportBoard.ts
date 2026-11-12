import { toPng } from 'html-to-image'
import { jsPDF } from 'jspdf'

/** 캡처 옵션: 뷰포트 엘리먼트와 출력 크기/변환 */
export interface CaptureOptions {
  /** 캡처 대상 (.react-flow__viewport 엘리먼트) */
  viewport: HTMLElement
  /** 출력 이미지 너비 */
  width: number
  /** 출력 이미지 높이 */
  height: number
  /** 전체 노드가 들어가도록 계산한 변환 (x, y, zoom) */
  transform: { x: number; y: number; zoom: number }
}

/**
 * React Flow 뷰포트를 PNG data URL 로 캡처한다.
 * 전체 노드가 담기도록, 호출부가 계산한 변환을 캡처 순간에만 적용한다.
 */
export async function captureBoardPng(opts: CaptureOptions): Promise<string> {
  const { viewport, width, height, transform } = opts
  return toPng(viewport, {
    backgroundColor: '#ffffff',
    width,
    height,
    pixelRatio: 2, // 선명하게
    style: {
      width: `${width}px`,
      height: `${height}px`,
      transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.zoom})`,
    },
    // 커서 오버레이 등 캡처에서 제외할 요소
    filter: (node) => {
      const cls = (node as HTMLElement).classList
      if (!cls) return true
      return !cls.contains('cursor-layer') && !cls.contains('react-flow__minimap') &&
        !cls.contains('react-flow__controls') && !cls.contains('node-delete-btn')
    },
  })
}

/** data URL 을 파일로 다운로드 */
export function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

/** 파일명에 쓸 수 있도록 방 이름을 정리하고 날짜를 붙인다 */
export function exportFilename(roomName: string, ext: string): string {
  const safe = roomName.replace(/[\\/:*?"<>|]/g, '_').slice(0, 40) || 'board'
  const d = new Date()
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(
    d.getDate(),
  ).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`
  return `${safe}_${stamp}.${ext}`
}

/**
 * PNG data URL 을 PDF 로 만들어 저장한다.
 * 이미지 비율에 맞춰 가로/세로 방향을 고르고, A4 안에 여백을 두고 맞춰 넣는다.
 */
export function savePngAsPdf(pngDataUrl: string, imgW: number, imgH: number, filename: string) {
  const orientation = imgW >= imgH ? 'landscape' : 'portrait'
  const pdf = new jsPDF({ orientation, unit: 'pt', format: 'a4' })
  const pageW = pdf.internal.pageSize.getWidth()
  const pageH = pdf.internal.pageSize.getHeight()
  const margin = 24
  const maxW = pageW - margin * 2
  const maxH = pageH - margin * 2
  // 이미지 비율 유지하며 페이지 안에 맞춤
  const ratio = Math.min(maxW / imgW, maxH / imgH)
  const w = imgW * ratio
  const h = imgH * ratio
  const x = (pageW - w) / 2
  const y = (pageH - h) / 2
  pdf.addImage(pngDataUrl, 'PNG', x, y, w, h)
  pdf.save(filename)
}

// ---------------------------------------------------------------------------
// 텍스트 파일 저장 (CSV 변환 자체는 ./csv.ts)
// ---------------------------------------------------------------------------

/**
 * 텍스트를 파일로 저장한다.
 * CSV 는 맨 앞에 UTF-8 BOM 을 붙여야 엑셀(윈도우)에서 한글이 깨지지 않는다.
 */
export function downloadTextFile(text: string, filename: string, mime: string, withBom = false) {
  const blob = new Blob([withBom ? '\uFEFF' : '', text], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // 다운로드가 시작된 뒤 정리
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
