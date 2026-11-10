// ---------------------------------------------------------------------------
// 표(CSV) 만들기 — 엑셀/구글 시트에서 바로 열 수 있는 형식
// 브라우저 전용 라이브러리를 쓰지 않아 자동 테스트에서도 그대로 불러 쓸 수 있다.
// ---------------------------------------------------------------------------

/**
 * CSV 한 칸을 안전하게 만든다.
 *  - =, +, -, @, 탭, CR 로 시작하면 엑셀이 수식으로 실행할 수 있으므로(CSV 수식 주입)
 *    앞에 작은따옴표를 붙여 글자로만 보이게 한다.
 *  - 쉼표/따옴표/줄바꿈이 있으면 큰따옴표로 감싸고, 안의 따옴표는 두 번 쓴다.
 */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`
  return s
}

/** 2차원 배열을 CSV 문자열로 (엑셀 호환을 위해 CRLF 줄바꿈) */
export function toCsv(rows: unknown[][]): string {
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n')
}
