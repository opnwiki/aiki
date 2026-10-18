import { getDatabase } from '../utils/database.js'
import { startArticleOrderExecutor } from '../utils/article-order-executor.js'
import { startWritingTaskAgentExecutor } from '../utils/writing-task-agent-executor.js'
import { startTopicAiRequestExecutor } from '../utils/topic-ai-request-executor.js'
import { startContentTaskExecutor } from '../utils/content-task-executor.js'
import { startNotificationEmailExecutor } from '../utils/notification-email-executor.js'

export default defineNitroPlugin((nitroApp) => {
  const config = useRuntimeConfig()
  if (!config.databaseUrl) return
  const database = getDatabase()
  const stop = startArticleOrderExecutor(database, config)
  const stopTaskAgent = startWritingTaskAgentExecutor(database, config)
  const stopTopicAi = startTopicAiRequestExecutor(database, config)
  const stopContentTasks = startContentTaskExecutor(database, config)
  const stopNotificationEmails = startNotificationEmailExecutor(database, config)
  nitroApp.hooks.hook('close', () => { stop(); stopTaskAgent(); stopTopicAi(); stopContentTasks(); stopNotificationEmails() })
})
