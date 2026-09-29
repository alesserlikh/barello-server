import app from './app'
import { env } from './config/env'

app.listen(env.port, () => {
  console.log(`Barello server is running on http://localhost:${env.port}`)
})