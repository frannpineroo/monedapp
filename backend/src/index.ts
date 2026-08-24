import 'dotenv/config'
import { createApp } from './app'

const app = createApp()
const port = Number(process.env.PORT) || 8100

app.listen(port, () => {
  console.log(`MonedApp API en http://localhost:${port}`)
})
