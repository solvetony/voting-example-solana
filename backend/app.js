import AutoLoad from '@fastify/autoload'
import { fileURLToPath } from 'node:url'

export default async function (fastify, options) {
  fastify.register(AutoLoad, {
    dir: fileURLToPath(new URL('./plugins/', import.meta.url)),
    options
  })
  fastify.register(AutoLoad, {
    dir: fileURLToPath(new URL('./routes/', import.meta.url)),
    options
  })
}
