import { Router } from 'express';
import { prisma } from '../db';
import { Prisma } from '@prisma/client';
import { AuthRequest } from '../middleware/auth';
import { SENDER_SELECT, MESSAGE_INCLUDE, uploadFile } from '../shared';
import { telegramStorage } from '../lib/telegramStorage';

const router = Router();

// Получить сообщения чата
router.get('/chat/:chatId', async (req: AuthRequest, res) => {
  try {
    const chatId = String(req.params.chatId);
    const { cursor, limit = '50' } = req.query;
    const take = Math.min(Math.max(1, parseInt(limit as string) || 50), 200);

    const member = await prisma.chatMember.findUnique({
      where: { chatId_userId: { chatId, userId: req.userId! } },
    });

    if (!member) {
      res.status(403).json({ error: 'Нет доступа к этому чату' });
      return;
    }

    const createdAtFilter: Record<string, Date> = {};
    if (cursor) createdAtFilter.lt = new Date(cursor as string);
    if (member.clearedAt) createdAtFilter.gt = member.clearedAt;

    const messages = await prisma.message.findMany({
      where: {
        chatId,
        isDeleted: false,
        hiddenBy: { none: { userId: req.userId! } },
        OR: [
          { scheduledAt: null },
          { senderId: req.userId! },
        ],
        ...(Object.keys(createdAtFilter).length > 0 ? { createdAt: createdAtFilter } : {}),
      },
      include: MESSAGE_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take,
    });

    // Convert tg:// URLs to downloadable API URLs for all media
    const transformMedia = (media: any[]) => media.map(m => ({
      ...m,
      url: m.url?.startsWith('tg://') ? `/api/files/${m.url.replace('tg://', '')}/download` : m.url,
    }));

    const transformedMessages = messages.map(msg => ({
      ...msg,
      media: transformMedia(msg.media || []),
    }));

    res.json(transformedMessages.reverse());
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Загрузка файлов - ОТПРАВКА В TELEGRAM (не локально!)
// Limit increased to 1200 files to match client UI
router.post('/upload', uploadFile.array('files', 1200), async (req: AuthRequest, res) => {
  try {
    const files = req.files as Express.Multer.File[];
    console.log(`[UPLOAD] Received ${files?.length || 0} files from user ${req.userId}`);

    if (!files || files.length === 0) {
      res.status(400).json({ error: 'Файлы не загружены' });
      return;
    }

    const uploadedFiles = [];
    const failedFiles = [];

    for (const file of files) {
      const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');

      // Fix empty/wrong MIME type based on file extension
      let mimeType = file.mimetype;
      if (!mimeType || mimeType === 'application/octet-stream') {
        const ext = originalName.split('.').pop()?.toLowerCase();
        const mimeMap: Record<string, string> = {
          'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png',
          'gif': 'image/gif', 'webp': 'image/webp', 'svg': 'image/svg+xml',
          'mp4': 'video/mp4', 'webm': 'video/webm', 'mov': 'video/quicktime',
          'mp3': 'audio/mpeg', 'ogg': 'audio/ogg', 'opus': 'audio/opus',
          'wav': 'audio/wav', 'm4a': 'audio/mp4', 'aac': 'audio/aac',
          'pdf': 'application/pdf', 'doc': 'application/msword',
          'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'zip': 'application/zip', 'rar': 'application/x-rar-compressed',
        };
        if (ext && mimeMap[ext]) {
          mimeType = mimeMap[ext];
        }
      }

      let storedFile;
      try {
        // Отправляем файл в Telegram каналы
        storedFile = await telegramStorage.uploadFile(
          file.buffer,
          originalName,
          mimeType,
          req.userId!
        );
        console.log(`[UPLOAD] Telegram OK: ${storedFile.fileId} (${mimeType})`);
      } catch (telegramError: any) {
        console.error(`[UPLOAD] Telegram error for ${originalName}: ${telegramError.message}`);
        failedFiles.push({ name: originalName, error: telegramError.message });
        continue; // Continue with next file instead of failing all
      }

      // Сохраняем метаданные в БД
      try {
        const telegramFile = await prisma.telegramFile.create({
          data: {
            fileId: storedFile.fileId,
            userId: req.userId!,
            originalName: storedFile.originalName,
            mimeType: storedFile.mimeType,
            totalSize: storedFile.totalSize,
            encryptionLevel: storedFile.encryptionLevel,
            chunks: {
              create: storedFile.chunks.map(chunk => ({
                fileId: storedFile.fileId,
                chunkIndex: chunk.chunkIndex,
                channelId: chunk.channelId,
                messageId: chunk.messageId,
                botId: chunk.botId,
                size: chunk.size,
              }))
            }
          },
          include: { chunks: true }
        });
        console.log(`[UPLOAD] БД OK: ${telegramFile.fileId}`);
        uploadedFiles.push({
          fileId: telegramFile.fileId,
          filename: telegramFile.originalName,
          size: telegramFile.totalSize,
          mimetype: telegramFile.mimeType,
          url: `/api/files/${telegramFile.fileId}/download`,
        });
      } catch (dbError: any) {
        console.error(`[UPLOAD] БД error: ${dbError.message}`);
        // Файл в Telegram есть, но не в БД — возвращаем fileId напрямую
        uploadedFiles.push({
          fileId: storedFile.fileId,
          filename: storedFile.originalName,
          size: storedFile.totalSize,
          mimetype: storedFile.mimeType,
          url: `/api/files/${storedFile.fileId}/download`,
        });
      }
    }

    // Return results with partial success info
    const response: any = { files: uploadedFiles };
    if (failedFiles.length > 0) {
      response.failed = failedFiles;
      response.partialSuccess = true;
    }

    res.json(response);
  } catch (error: any) {
    console.error('[UPLOAD] Critical error:', error.message);
    res.status(500).json({ error: 'Ошибка загрузки: ' + (error.message || 'Неизвестная ошибка') });
  }
});

// Редактировать сообщение
router.put('/:id', async (req: AuthRequest, res) => {
  try {
    const { content } = req.body;
    const id = String(req.params.id);

    if (!content || typeof content !== 'string' || content.length > 10000) {
      res.status(400).json({ error: 'Содержимое обязательно и не должно превышать 10000 символов' });
      return;
    }

    const message = await prisma.message.findUnique({ 
      where: { id },
      include: { chat: true }
    });
    
    if (!message) {
      res.status(404).json({ error: 'Сообщение не найдено' });
      return;
    }

    // Проверка прав: автор сообщения ИЛИ владелец чата (не admin!)
    let canEdit = message.senderId === req.userId;
    
    if (!canEdit) {
      // Проверяем роль в чате для каналов и групп
      const member = await prisma.chatMember.findUnique({
        where: { chatId_userId: { chatId: message.chatId, userId: req.userId! } },
      });
      
      // Только owner может редактировать чужие сообщения в каналах/группах
      if (member && ['channel', 'group'].includes(message.chat.type) && member.role === 'owner') {
        canEdit = true;
      }
    }

    if (!canEdit) {
      res.status(403).json({ error: 'Нет прав для редактирования' });
      return;
    }

    const updated = await prisma.message.update({
      where: { id },
      data: { content, isEdited: true },
      include: MESSAGE_INCLUDE,
    });

    res.json(updated);
  } catch (error) {
    console.error('Edit message error:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Удалить сообщение
router.delete('/:id', async (req: AuthRequest, res) => {
  try {
    const id = String(req.params.id);

    const message = await prisma.message.findUnique({
      where: { id },
      include: { media: true, chat: true },
    });
    
    if (!message) {
      res.status(404).json({ error: 'Сообщение не найдено' });
      return;
    }

    // Проверка прав: автор сообщения ИЛИ владелец чата (не admin!)
    let canDelete = message.senderId === req.userId;
    
    if (!canDelete) {
      // Проверяем роль в чате для каналов и групп
      const member = await prisma.chatMember.findUnique({
        where: { chatId_userId: { chatId: message.chatId, userId: req.userId! } },
      });
      
      // Только owner может удалять чужие сообщения в каналах/группах
      if (member && ['channel', 'group'].includes(message.chat.type) && member.role === 'owner') {
        canDelete = true;
      }
    }

    if (!canDelete) {
      res.status(403).json({ error: 'Нет прав для удаления' });
      return;
    }

    // Delete media files from disk
    if (message.media && message.media.length > 0) {
      for (const m of message.media) {
        if (m.url) deleteUploadedFile(m.url);
      }
      await prisma.media.deleteMany({ where: { messageId: id } });
    }

    await prisma.message.update({
      where: { id },
      data: { isDeleted: true, content: null },
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Delete message error:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Получить общие медиа/файлы/ссылки чата
router.get('/chat/:chatId/shared', async (req: AuthRequest, res) => {
  try {
    const chatId = String(req.params.chatId);
    const { type } = req.query; // 'media' | 'files' | 'links'

    // Check membership
    const member = await prisma.chatMember.findUnique({
      where: { chatId_userId: { chatId, userId: req.userId! } },
    });
    if (!member) {
      res.status(403).json({ error: 'Нет доступа' });
      return;
    }

    const baseWhere: Prisma.MessageWhereInput = {
      chatId,
      isDeleted: false,
      hiddenBy: { none: { userId: req.userId! } },
      ...(member.clearedAt ? { createdAt: { gt: member.clearedAt } } : {}),
    };

    if (type === 'media') {
      // Images and videos
      const messages = await prisma.message.findMany({
        where: {
          ...baseWhere,
          media: { some: { type: { in: ['image', 'video'] } } },
        },
        include: {
          media: { where: { type: { in: ['image', 'video'] } } },
          sender: { select: SENDER_SELECT },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      res.json(messages);
    } else if (type === 'files') {
      // Files (documents, archives, audio, etc.)
      const messages = await prisma.message.findMany({
        where: {
          ...baseWhere,
          media: { some: { type: { notIn: ['image', 'video'] } } },
        },
        include: {
          media: { where: { type: { notIn: ['image', 'video'] } } },
          sender: { select: SENDER_SELECT },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      res.json(messages);
    } else if (type === 'links') {
      // Messages containing URLs
      const messages = await prisma.message.findMany({
        where: {
          ...baseWhere,
          content: { contains: 'http' },
        },
        include: {
          sender: { select: SENDER_SELECT },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      // Filter to only messages with actual URLs
      const withLinks = messages
        .filter((m) => m.content && /https?:\/\/[^\s]+/i.test(m.content))
        .map((m) => {
          const links = m.content!.match(/https?:\/\/[^\s]+/gi) || [];
          return { ...m, links };
        });
      res.json(withLinks);
    } else {
      res.status(400).json({ error: 'Invalid type. Use: media, files, or links' });
    }
  } catch (error) {
    console.error('Shared media error:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Переслать сообщение (включая сообщения из AI чата)
router.post('/forward', async (req: AuthRequest, res) => {
  try {
    const { messageId, targetChatId, isAiMessage } = req.body;

    if (!messageId || !targetChatId) {
      res.status(400).json({ error: 'messageId и targetChatId обязательны' });
      return;
    }

    // Проверка доступа к целевому чату
    const targetMember = await prisma.chatMember.findUnique({
      where: { chatId_userId: { chatId: targetChatId, userId: req.userId! } },
    });

    if (!targetMember) {
      res.status(403).json({ error: 'Нет доступа к целевому чату' });
      return;
    }

    let messageData: { content?: string; type?: string; media?: any[] } = {};

    if (isAiMessage) {
      // Получаем сообщение из AI чата
      const aiMessage = await prisma.aiMessage.findUnique({
        where: { id: messageId },
        include: { chat: true },
      });

      if (!aiMessage) {
        res.status(404).json({ error: 'AI сообщение не найдено' });
        return;
      }

      // Проверка: пользователь владеет этим AI чатом
      if (aiMessage.chat.userId !== req.userId) {
        res.status(403).json({ error: 'Нет доступа к этому AI сообщению' });
        return;
      }

      messageData = {
        content: `💬 *Сообщение от Nexo AI*:\n\n${aiMessage.content}`,
        type: 'text',
      };
    } else {
      // Получаем обычное сообщение
      const message = await prisma.message.findUnique({
        where: { id: messageId },
        include: { media: true, sender: true },
      });

      if (!message) {
        res.status(404).json({ error: 'Сообщение не найдено' });
        return;
      }

      // Проверка доступа к исходному чату
      const sourceMember = await prisma.chatMember.findUnique({
        where: { chatId_userId: { chatId: message.chatId, userId: req.userId! } },
      });

      if (!sourceMember && message.senderId !== req.userId) {
        res.status(403).json({ error: 'Нет доступа к исходному сообщению' });
        return;
      }

      messageData = {
        content: message.content,
        type: message.type,
        media: message.media.map(m => ({
          type: m.type,
          url: m.url,
          filename: m.filename,
          thumbnail: m.thumbnail,
          size: m.size,
          duration: m.duration,
          width: m.width,
          height: m.height,
        })),
      };
    }

    // Создаём пересланное сообщение
    const forwardedMessage = await prisma.message.create({
      data: {
        chatId: targetChatId,
        senderId: req.userId!,
        content: messageData.content,
        type: messageData.type || 'text',
        forwardedFromId: isAiMessage ? undefined : messageId,
        media: messageData.media ? { create: messageData.media } : undefined,
      },
      include: MESSAGE_INCLUDE,
    });

    // Отправляем событие через WebSocket
    const io = getIO();
    io.to(targetChatId).emit('message:new', forwardedMessage);

    res.json(forwardedMessage);
  } catch (error) {
    console.error('Forward message error:', error);
    res.status(500).json({ error: 'Ошибка при пересылке сообщения' });
  }
});

export default router;
