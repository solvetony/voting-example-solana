import Fastify from 'fastify'
import application from '../app.js'

export async function buildApp (options) {
  const app = Fastify({ bodyLimit: 32768 })
  await app.register(application, options)
  await app.ready()
  return app
}
