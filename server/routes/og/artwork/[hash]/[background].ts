import { createCanvas } from '@napi-rs/canvas'
import { drawSquiggleExport } from '../../../../../app/utils/squiggle'
import { socialPreviewInputs } from '../../../../../app/utils/socialPreview'

export default defineEventHandler(async (event) => {
  if (!['GET', 'HEAD'].includes(getMethod(event))) {
    throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
  }
  const hash = getRouterParam(event, 'hash')
  const file = getRouterParam(event, 'background') ?? ''
  const background = file.replace(/\.png$/, '')
  const inputs = socialPreviewInputs(hash, background)
  if (hash !== inputs.hash || file !== `${inputs.background}.png`) {
    throw createError({ statusCode: 404, statusMessage: 'Artwork not found' })
  }
  const canvas = createCanvas(945, 630)
  drawSquiggleExport(canvas.getContext('2d') as unknown as CanvasRenderingContext2D, inputs.hash, 945, 630, { background: `#${inputs.background}` })
  const png = await canvas.encode('png')
  setResponseHeaders(event, {
    'content-type': 'image/png',
    'content-length': png.byteLength,
    'cache-control': 'public, max-age=86400',
  })
  return png
})
