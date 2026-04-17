import { Router, Response } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { prisma } from '../index';

const router = Router();

/**
 * GET /api/ai/chats - Получить все чаты пользователя
 */
router.get('/chats', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const chats = await prisma.aiChat.findMany({
      where: { userId: req.user?.id },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          take: 1 // Последнее сообщение для превью
        }
      },
      orderBy: { updatedAt: 'desc' }
    });

    res.json(chats);
  } catch (error) {
    console.error('Error fetching AI chats:', error);
    res.status(500).json({ error: 'Ошибка при загрузке чатов' });
  }
});

/**
 * POST /api/ai/chats - Создать новый чат
 */
router.post('/chats', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { title } = req.body;
    
    const chat = await prisma.aiChat.create({
      data: {
        userId: req.user!.id,
        title: title || 'Новый чат'
      }
    });

    res.json(chat);
  } catch (error) {
    console.error('Error creating AI chat:', error);
    res.status(500).json({ error: 'Ошибка при создании чата' });
  }
});

/**
 * PUT /api/ai/chats/:id - Обновить название чата
 */
router.put('/chats/:id', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { title } = req.body;

    // Проверка: чат принадлежит пользователю
    const existingChat = await prisma.aiChat.findFirst({
      where: { id, userId: req.user?.id }
    });

    if (!existingChat) {
      res.status(404).json({ error: 'Чат не найден' });
      return;
    }

    const updatedChat = await prisma.aiChat.update({
      where: { id },
      data: { title }
    });

    res.json(updatedChat);
  } catch (error) {
    console.error('Error updating AI chat:', error);
    res.status(500).json({ error: 'Ошибка при обновлении чата' });
  }
});

/**
 * DELETE /api/ai/chats/:id - Удалить чат
 */
router.delete('/chats/:id', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    // Проверка: чат принадлежит пользователю
    const existingChat = await prisma.aiChat.findFirst({
      where: { id, userId: req.user?.id }
    });

    if (!existingChat) {
      res.status(404).json({ error: 'Чат не найден' });
      return;
    }

    await prisma.aiChat.delete({
      where: { id }
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting AI chat:', error);
    res.status(500).json({ error: 'Ошибка при удалении чата' });
  }
});

/**
 * GET /api/ai/chats/:id/messages - Получить сообщения чата
 */
router.get('/chats/:id/messages', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const chat = await prisma.aiChat.findFirst({
      where: { id, userId: req.user?.id },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' }
        }
      }
    });

    if (!chat) {
      res.status(404).json({ error: 'Чат не найден' });
      return;
    }

    res.json(chat.messages);
  } catch (error) {
    console.error('Error fetching AI messages:', error);
    res.status(500).json({ error: 'Ошибка при загрузке сообщений' });
  }
});

/**
 * POST /api/ai/chats/:id/messages - Добавить сообщение в чат
 */
router.post('/chats/:id/messages', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { role, content } = req.body;

    if (!['user', 'assistant', 'system'].includes(role)) {
      res.status(400).json({ error: 'Неверная роль сообщения' });
      return;
    }

    // Проверка: чат принадлежит пользователю
    const existingChat = await prisma.aiChat.findFirst({
      where: { id, userId: req.user?.id }
    });

    if (!existingChat) {
      res.status(404).json({ error: 'Чат не найден' });
      return;
    }

    const message = await prisma.aiMessage.create({
      data: {
        chatId: id,
        role,
        content
      }
    });

    // Обновляем updatedAt у чата
    await prisma.aiChat.update({
      where: { id },
      data: {} // Триггерим updatedAt
    });

    res.json(message);
  } catch (error) {
    console.error('Error creating AI message:', error);
    res.status(500).json({ error: 'Ошибка при сохранении сообщения' });
  }
});

/**
 * GET /api/ai/chats/:id/export - Экспорт чата в JSON
 */
router.get('/chats/:id/export', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const chat = await prisma.aiChat.findFirst({
      where: { id, userId: req.user?.id },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' }
        }
      }
    });

    if (!chat) {
      res.status(404).json({ error: 'Чат не найден' });
      return;
    }

    const exportData = {
      chatId: chat.id,
      title: chat.title,
      createdAt: chat.createdAt,
      exportedAt: new Date(),
      messages: chat.messages.map(msg => ({
        role: msg.role,
        content: msg.content,
        createdAt: msg.createdAt
      }))
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${chat.title.replace(/[^a-z0-9]/gi, '_')}.json"`);
    res.json(exportData);
  } catch (error) {
    console.error('Error exporting AI chat:', error);
    res.status(500).json({ error: 'Ошибка при экспорте чата' });
  }
});

export default router;
