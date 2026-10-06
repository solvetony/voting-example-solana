import fp from 'fastify-plugin'
import rateLimit from '@fastify/rate-limit'

export default fp(async function (fastify, options) {
  const origin = options.origin || process.env.APP_ORIGIN
  await fastify.register(rateLimit, { max: 60, timeWindow: '1 minute', allowList: request => !request.url.startsWith('/voting-api/') })
  fastify.addHook('onRequest', async (request, reply) => {
    if (request.headers.origin && request.headers.origin !== origin && request.method !== 'GET') {
      return reply.code(403).send({ error: 'Origin not allowed' })
    }
  })
  fastify.setErrorHandler((error, request, reply) => {
    if (!error.statusCode) request.log.error({ errorType: error.name }, 'Voting request failed')
    reply.code(error.statusCode || 502).send({ error: error.statusCode ? error.message : 'Storage or upstream service unavailable' })
  })
}, { name: 'http-policy' })
