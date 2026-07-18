import { AppError } from './errors'

export function paramId(value: string | string[] | undefined): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AppError(400, 'id inválido')
  }
  return value
}
