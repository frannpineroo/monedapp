import express from 'express'
import cors from 'cors'
import authRouter from './routes/auth'
import onboardingRouter from './routes/onboarding'
import walletsRouter from './routes/wallets'
import clientsRouter from './routes/clients'
import movementsRouter from './routes/movements'
import reportsRouter from './routes/reports'
import categoriesRouter from './routes/categories'
import exchangeRatesRouter from './routes/exchangeRates'
import integrationsCallbackRouter from './routes/integrationsCallback'
import integrationsRouter from './routes/integrations'
import webhooksRouter from './routes/webhooks'
import receivablesRouter from './routes/receivables'

export function createApp() {
  const app = express()

  app.use(cors())
  app.use(express.json())

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' })
  })

  app.use('/auth', authRouter)
  app.use(onboardingRouter)
  app.use('/wallets', walletsRouter)
  app.use('/clients', clientsRouter)
  app.use('/movements', movementsRouter)
  app.use('/reports', reportsRouter)
  app.use('/categories', categoriesRouter)
  app.use('/exchange-rates', exchangeRatesRouter)
  app.use('/integrations', integrationsCallbackRouter)
  app.use('/integrations', integrationsRouter)
  app.use('/webhooks', webhooksRouter)
  app.use('/receivables', receivablesRouter)

  return app
}
