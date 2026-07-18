import { Platform } from 'react-native'

/** Android emulator → host machine. iOS simulator → localhost. Physical device: set EXPO_PUBLIC_API_URL. */
export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ??
  (Platform.OS === 'android' ? 'http://10.0.2.2:8000' : 'http://localhost:8000')
