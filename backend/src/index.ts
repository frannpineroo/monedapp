import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import authRouter from './routes/auth'
import onboardingRouter from './routes/onboarding'
import walletsRouter from './routes/wallets'
import clientsRouter from './routes/clients'
import movementsRouter from './routes/movements'
import reportsRouter from './routes/reports'
import exchangeRatesRouter from './routes/exchangeRates'

const app = express()
const port = Number(process.env.PORT) || 8000

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
app.use('/exchange-rates', exchangeRatesRouter)

app.listen(port, () => {
  console.log(`MonedApp API en http://localhost:${port}`)
})
