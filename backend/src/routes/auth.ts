import { Router } from 'express'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { prisma } from '../prisma/prisma'
import { asyncHandler } from '../lib/asyncHandler'
import { AppError } from '../lib/errors'
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  refreshExpiresAt,
} from '../lib/jwt'

const router = Router()

function publicUser(user: { id: string; email: string; profileTemplate: string | null; monotributoCategory: string | null; createdAt: Date }) {
  return {
    id: user.id,
    email: user.email,
    profileTemplate: user.profileTemplate,
    monotributoCategory: user.monotributoCategory,
    createdAt: user.createdAt,
  }
}

async function issueTokens(userId: string, email: string) {
  const accessToken = signAccessToken(userId, email)
  const refreshToken = signRefreshToken(userId)
  const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex')

  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash,
      expiresAt: refreshExpiresAt(),
    },
  })

  return { accessToken, refreshToken }
}

router.post(
  '/register',
  asyncHandler(async (req, res) => {
    const { email, password } = req.body as { email?: unknown; password?: unknown }

    if (typeof email !== 'string' || !email.includes('@')) {
      throw new AppError(400, 'Email inválido')
    }
    if (typeof password !== 'string' || password.length < 8) {
      throw new AppError(400, 'La contraseña debe tener al menos 8 caracteres')
    }

    const normalized = email.trim().toLowerCase()
    const existing = await prisma.user.findUnique({ where: { email: normalized } })
    if (existing) {
      throw new AppError(409, 'Ya existe un usuario con ese email')
    }

    const passwordHash = await bcrypt.hash(password, 10)
    const user = await prisma.user.create({
      data: { email: normalized, passwordHash },
    })

    const tokens = await issueTokens(user.id, user.email)
    res.status(201).json({ user: publicUser(user), ...tokens })
  })
)

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, password } = req.body as { email?: unknown; password?: unknown }

    if (typeof email !== 'string' || typeof password !== 'string') {
      throw new AppError(400, 'Email y contraseña son requeridos')
    }

    const user = await prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    })
    if (!user) {
      throw new AppError(401, 'Credenciales inválidas')
    }

    const ok = await bcrypt.compare(password, user.passwordHash)
    if (!ok) {
      throw new AppError(401, 'Credenciales inválidas')
    }

    const tokens = await issueTokens(user.id, user.email)
    res.json({ user: publicUser(user), ...tokens })
  })
)

router.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const { refreshToken } = req.body as { refreshToken?: unknown }
    if (typeof refreshToken !== 'string') {
      throw new AppError(400, 'refreshToken es requerido')
    }

    let payload
    try {
      payload = verifyRefreshToken(refreshToken)
    } catch {
      throw new AppError(401, 'Refresh token inválido')
    }

    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex')
    const stored = await prisma.refreshToken.findFirst({
      where: { userId: payload.sub, tokenHash, expiresAt: { gt: new Date() } },
    })
    if (!stored) {
      throw new AppError(401, 'Refresh token inválido o expirado')
    }

    await prisma.refreshToken.delete({ where: { id: stored.id } })

    const user = await prisma.user.findUniqueOrThrow({ where: { id: payload.sub } })
    const tokens = await issueTokens(user.id, user.email)
    res.json({ user: publicUser(user), ...tokens })
  })
)

export default router
