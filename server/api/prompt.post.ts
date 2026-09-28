import { createPromptHandler } from '../utils/promptHandler'

const handlePrompt = createPromptHandler()

export default defineEventHandler(event => {
  const config = useRuntimeConfig(event)
  return handlePrompt(event, { apiKey: config.openaiApiKey, model: config.promptModel })
})
