import 'dotenv/config'
import { createApp } from './app'

const app = createApp()
const port = Number(process.env.PORT) || 8000

app.listen(port, () => {
  console.log(`MonedApp API en http://localhost:${port}`)
})
