import Fastify from 'fastify'
import application from './app.js'

const app = Fastify({ logger: true, bodyLimit: 32768 })
await app.register(application)
await app.listen({ port: Number(process.env.PORT || 3101), host: process.env.HOST || '127.0.0.1' })
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await app.close(); process.exit(0) })
