import type { FastifyInstance } from 'fastify';
import { ChatScope, ChatSend, type ChatHistory } from '@storytime/shared';
import type { Db } from '../db/client.js';
import { defaultBudgetTokens } from '../bible/budget.js';
import { assertChatable } from '../generation/chat.js';
import { isProjectBusy, startChatRun } from '../generation/runner.js';
import { addMessage, clearChat, deleteMessage, ensureChat, findChat, readMessages } from '../chat/store.js';
import { assertScope } from '../chat/sections.js';
import { conflict } from '../services/entities.js';
import { readProject } from './projects.js';

/**
 * Revision conversations: talk to the model about a chapter, a scene, the draft
 * or the whole book, and have it rewrite the text as you agree on changes. Each
 * rewrite is saved as a new version, so nothing is ever lost.
 */
export async function chatRoutes(app: FastifyInstance) {
  const db: Db = app.db;

  app.get('/projects/:projectId/revision-chat', async (request) => {
    const { projectId } = request.params as { projectId: string };
    const scope = ChatScope.parse(request.query);
    readProject(db, projectId);
    assertScope(db, projectId, scope);
    const chat = findChat(db, projectId, scope);
    const history: ChatHistory = { chat, messages: chat ? readMessages(db, chat.id) : [] };
    return history;
  });

  /** Send a message. The reply streams over the run's event channel and is stored when it finishes. */
  app.post('/projects/:projectId/revision-chat', async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const body = ChatSend.parse(request.body);
    const project = readProject(db, projectId);

    if (isProjectBusy(projectId)) {
      throw conflict('This book already has a generation running. Wait for it to finish, or cancel it first.');
    }
    const scope = { scopeType: body.scopeType, scopeId: body.scopeId };
    assertChatable(db, projectId, scope, project.tokenBudget ?? defaultBudgetTokens(null));

    const chat = ensureChat(db, projectId, scope);
    const message = addMessage({ db, chatId: chat.id, role: 'user', content: body.message });
    try {
      const { runId } = startChatRun(db, projectId, {
        chatId: chat.id,
        userMessageId: message.id,
        scope,
        message: body.message,
        attributeDialogue: body.attributeDialogue !== false,
      });
      return reply.status(202).send({ runId, chatId: chat.id, messageId: message.id, streamUrl: `/api/runs/${runId}/events` });
    } catch (err) {
      // No reply is coming, so do not leave the author's message hanging in the history.
      deleteMessage(db, message.id);
      throw err;
    }
  });

  /** Start the conversation over. The manuscript, and every version the chat wrote, stays as it is. */
  app.delete('/projects/:projectId/revision-chat', async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const scope = ChatScope.parse(request.query);
    readProject(db, projectId);
    assertScope(db, projectId, scope);
    const chat = findChat(db, projectId, scope);
    if (chat) clearChat(db, chat.id);
    return reply.status(204).send();
  });
}
