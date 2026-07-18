import AsyncStorage from '@react-native-async-storage/async-storage'
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { apiRequest } from '../api/client'
import type { AuthResponse, User } from '../api/types'

const ACCESS_KEY = 'monedapp.accessToken'
const REFRESH_KEY = 'monedapp.refreshToken'
const USER_KEY = 'monedapp.user'

type AuthState = {
  user: User | null
  accessToken: string | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  setUser: (user: User) => void
}

const AuthContext = createContext<AuthState | null>(null)

async function persist(auth: AuthResponse) {
  await AsyncStorage.multiSet([
    [ACCESS_KEY, auth.accessToken],
    [REFRESH_KEY, auth.refreshToken],
    [USER_KEY, JSON.stringify(auth.user)],
  ])
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUserState] = useState<User | null>(null)
  const [accessToken, setAccessToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    ;(async () => {
      try {
        const [[, token], [, userJson]] = await AsyncStorage.multiGet([ACCESS_KEY, USER_KEY])
        if (token && userJson) {
          setAccessToken(token)
          setUserState(JSON.parse(userJson) as User)
        }
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const applyAuth = useCallback(async (auth: AuthResponse) => {
    await persist(auth)
    setAccessToken(auth.accessToken)
    setUserState(auth.user)
  }, [])

  const login = useCallback(
    async (email: string, password: string) => {
      const auth = await apiRequest<AuthResponse>('/auth/login', {
        body: { email, password },
      })
      await applyAuth(auth)
    },
    [applyAuth]
  )

  const register = useCallback(
    async (email: string, password: string) => {
      const auth = await apiRequest<AuthResponse>('/auth/register', {
        body: { email, password },
      })
      await applyAuth(auth)
    },
    [applyAuth]
  )

  const logout = useCallback(async () => {
    await AsyncStorage.multiRemove([ACCESS_KEY, REFRESH_KEY, USER_KEY])
    setAccessToken(null)
    setUserState(null)
  }, [])

  const setUser = useCallback((next: User) => {
    setUserState(next)
    void AsyncStorage.setItem(USER_KEY, JSON.stringify(next))
  }, [])

  const value = useMemo(
    () => ({ user, accessToken, loading, login, register, logout, setUser }),
    [user, accessToken, loading, login, register, logout, setUser]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider')
  return ctx
}
