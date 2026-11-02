import { createContext, useContext } from 'react'

/** 현재 로그인한 사용자의 username (투표 중복 판정용). 기본값은 빈 문자열. */
export const CurrentUserContext = createContext<string>('')

export function useCurrentUsername() {
  return useContext(CurrentUserContext)
}
