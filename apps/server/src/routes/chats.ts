import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { AuthRequest } from '../middleware/auth';
import { USER_SELECT, SENDER_SELECT, uploadGroupAvatar, deleteUploadedFile, encryptUploadedFile } from '../shared';

const router = Router();

// Compact user select for chat member lists (no bio/birthday)
const CHAT_USER_SELECT = {
  id: true,
  username: true,
  displayName: true,
  avatar: true,
  isOnline: true,
  lastSeen: true,
};

// Получить все чаты пользователя
router.get('/', async (req: AuthRequest, res) => {
  try {
    const chats = await prisma.chat.findMany({
      where: {
        members: { some: { userId: req.userId } },
      },
      include: {
        members: {
          include: { user: { select: CHAT_USER_SELECT } },
        },
        messages: {
          where: {
            isDeleted: false,
            OR: [
              { scheduledAt: null },
              { senderId: req.userId! },
            ],
          },
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: {
            sender: { select: { id: true, username: true, displayName: true } },
            readBy: { select: { userId: true } },
          },
        },
        pinnedMessages: {
          orderBy: { pinnedAt: 'desc' },
          take: 1,
          include: {
            message: {
              include: {
                sender: { select: SENDER_SELECT },
                media: true,
              },
            },
          },
        },
      },
    });

    // Batch unread counts in a single query to avoid N+1
    const chatIds = chats.map(c => c.id);
    let unreadCounts: Array<{ chatId: string; count: bigint }> = [];
    if (chatIds.length > 0) {
      unreadCounts = await prisma.$queryRaw<Array<{ chatId: string; count: bigint }>>(
        Prisma.sql`SELECT m."chatId", COUNT(m.id) as count FROM "Message" m
         LEFT JOIN "ReadReceipt" rr ON rr."messageId" = m.id AND rr."userId" = ${req.userId}
         WHERE m."chatId" IN (${Prisma.join(chatIds)})
         AND m."senderId" != ${req.userId} AND m."isDeleted" = false AND rr.id IS NULL
         AND m."scheduledAt" IS NULL
         GROUP BY m."chatId"`
      ).catch(() => [] as Array<{ chatId: string; count: bigint }>);
    }

    const unreadMap = new Map(unreadCounts.map(r => [r.chatId, Number(r.count)]));

    // Filter last message by clearedAt per user
    const chatsFiltered = chats.map((chat) => {
      const member = chat.members.find((m) => m.userId === req.userId);
      const clearedAt = member?.clearedAt;
      if (clearedAt && chat.messages.length > 0) {
        const filtered = chat.messages.filter((msg) => new Date(msg.createdAt) > new Date(clearedAt));
        return { ...chat, messages: filtered };
      }
      return chat;
    });

    const sortedChats = chatsFiltered.sort((a, b) => {
      const aPinned = a.members.find((m) => m.userId === req.userId)?.isPinned || false;
      const bPinned = b.members.find((m) => m.userId === req.userId)?.isPinned || false;
      if (aPinned && !bPinned) return -1;
      if (!aPinned && bPinned) return 1;

      const aDate = a.messages[0]?.createdAt || a.createdAt;
      const bDate = b.messages[0]?.createdAt || b.createdAt;
      return new Date(bDate).getTime() - new Date(aDate).getTime();
    });

    const chatsWithUnread = sortedChats.map((chat) => ({
      ...chat,
      unreadCount: unreadMap.get(chat.id) || 0,
    }));

    res.json(chatsWithUnread);
  } catch (error) {
    console.error('Get chats error:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Создать личный чат
router.post('/personal', async (req: AuthRequest, res) => {
  try {
    const { userId } = req.body;
    if (!userId) {
      res.status(400).json({ error: 'ID пользователя обязателен' });
      return;
    }

    const existingChat = await prisma.chat.findFirst({
      where: {
        type: 'personal',
        AND: [
          { members: { some: { userId: req.userId } } },
          { members: { some: { userId } } },
        ],
      },
      include: {
        members: { include: { user: { select: CHAT_USER_SELECT } } },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: {
            sender: { select: { id: true, username: true, displayName: true } },
            readBy: { select: { userId: true } },
          },
        },
      },
    });

    if (existingChat) {
      res.json({ ...existingChat, unreadCount: 0 });
      return;
    }

    const chat = await prisma.chat.create({
      data: {
        type: 'personal',
        members: {
          create: [{ userId: req.userId! }, { userId }],
        },
      },
      include: {
        members: { include: { user: { select: CHAT_USER_SELECT } } },
        messages: true,
      },
    });

    res.json({ ...chat, unreadCount: 0 });
  } catch (error) {
    console.error('Create chat error:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Создать или получить чат "Избранное" (saved messages)
router.post('/favorites', async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;

    // Check if favorites chat already exists
    const existing = await prisma.chat.findFirst({
      where: {
        type: 'favorites',
        members: { some: { userId } },
      },
      include: {
        members: { include: { user: { select: CHAT_USER_SELECT } } },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: {
            sender: { select: { id: true, username: true, displayName: true } },
            readBy: { select: { userId: true } },
          },
        },
      },
    });

    if (existing) {
      res.json({ ...existing, unreadCount: 0 });
      return;
    }

    const chat = await prisma.chat.create({
      data: {
        type: 'favorites',
        name: null,
        members: {
          create: [{ userId, role: 'admin' }],
        },
      },
      include: {
        members: { include: { user: { select: CHAT_USER_SELECT } } },
        messages: true,
      },
    });

    res.json({ ...chat, unreadCount: 0 });
  } catch (error) {
    console.error('Create favorites chat error:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Создать групповой чат
router.post('/group', async (req: AuthRequest, res) => {
  try {
    const { name, memberIds } = req.body;
    if (!name || !memberIds || !Array.isArray(memberIds)) {
      res.status(400).json({ error: 'Название и участники обязательны' });
      return;
    }

    // Validate group name length
    if (typeof name !== 'string' || name.trim().length === 0 || name.length > 100) {
      res.status(400).json({ error: 'Название группы должно быть от 1 до 100 символов' });
      return;
    }

    // Limit max members
    if (memberIds.length > 256) {
      res.status(400).json({ error: 'Максимум 256 участников в группе' });
      return;
    }

    const allMemberIds = [...new Set([req.userId!, ...memberIds])];

    const chat = await prisma.chat.create({
      data: {
        type: 'group',
        name,
        members: {
          create: allMemberIds.map((uid) => ({
            userId: uid,
            role: uid === req.userId ? 'owner' : 'member',
          })),
        },
      },
      include: {
        members: { include: { user: { select: CHAT_USER_SELECT } } },
        messages: true,
      },
    });

    res.json({ ...chat, unreadCount: 0 });
  } catch (error) {
    console.error('Create group error:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Создать канал
router.post('/channel', async (req: AuthRequest, res) => {
  try {
    const { name, username, description, avatar } = req.body;
    if (!name || typeof name !== 'string') {
      res.status(400).json({ error: 'Название канала обязательно' });
      return;
    }

    // Validate channel name length
    if (name.trim().length === 0 || name.length > 100) {
      res.status(400).json({ error: 'Название канала должно быть от 1 до 100 символов' });
      return;
    }

    // Username is required
    if (!username || typeof username !== 'string') {
      res.status(400).json({ error: 'Юзернейм канала обязателен' });
      return;
    }

    // Validate username
    if (!/^[a-zA-Z0-9_]{3,32}$/.test(username)) {
      res.status(400).json({ error: 'Юзернейм должен быть от 3 до 32 символов, только латиница, цифры и _' });
      return;
    }

    // Check if username is already taken
    const existing = await prisma.chat.findUnique({ where: { username } });
    if (existing) {
      res.status(400).json({ error: 'Этот юзернейм уже занят' });
      return;
    }

    const chat = await prisma.chat.create({
      data: {
        type: 'channel',
        name,
        username,
        description: description || null,
        avatar: avatar || null,
        members: {
          create: {
            userId: req.userId!,
            role: 'owner',
          },
        },
      },
      include: {
        members: { include: { user: { select: CHAT_USER_SELECT } } },
        messages: true,
      },
    });

    res.json({ ...chat, unreadCount: 0 });
  } catch (error) {
    console.error('Create channel error:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Получить чат по ID
router.get('/:id', async (req: AuthRequest, res) => {
  try {
    const chat = await prisma.chat.findFirst({
      where: {
        id: String(req.params.id),
        members: { some: { userId: req.userId } },
      },
      include: {
        members: { include: { user: { select: CHAT_USER_SELECT } } },
      },
    });

    if (!chat) {
      res.status(404).json({ error: 'Чат не найден' });
      return;
    }

    res.json(chat);
  } catch (error) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Получить канал по username (для вступления по ссылке)
router.get('/join/:username', async (req: AuthRequest, res) => {
  try {
    const { username } = req.params;
    
    const channel = await prisma.chat.findFirst({
      where: {
        type: 'channel',
        username: username as string,
      },
      include: {
        members: { include: { user: { select: CHAT_USER_SELECT } } },
      },
    });

    if (!channel) {
      res.status(404).json({ error: 'Канал не найден' });
      return;
    }

    // Check if user is already a member
    const existingMember = channel.members.find((m) => m.userId === req.userId);
    
    if (!existingMember) {
      // Auto-join the channel
      await prisma.chatMember.create({
        data: {
          chatId: channel.id,
          userId: req.userId!,
          role: 'member',
        },
      });
      
      // Reload channel with updated members
      const updatedChannel = await prisma.chat.findUnique({
        where: { id: channel.id },
        include: {
          members: { include: { user: { select: CHAT_USER_SELECT } } },
        },
      });
      
      res.json({ ...updatedChannel!, joined: true });
    } else {
      res.json({ ...channel, joined: false });
    }
  } catch (error) {
    console.error('Join channel error:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Вступить в канал по username (POST запрос для совместимости)
router.post('/join/:username', async (req: AuthRequest, res) => {
  try {
    const { username } = req.params;
    
    const channel = await prisma.chat.findFirst({
      where: {
        type: 'channel',
        username: username as string,
      },
      include: {
        members: { include: { user: { select: CHAT_USER_SELECT } } },
      },
    });

    if (!channel) {
      res.status(404).json({ error: 'Канал не найден' });
      return;
    }

    // Check if user is already a member
    const existingMember = channel.members.find((m) => m.userId === req.userId);
    
    if (!existingMember) {
      // Auto-join the channel
      await prisma.chatMember.create({
        data: {
          chatId: channel.id,
          userId: req.userId!,
          role: 'member',
        },
      });
      
      // Reload channel with updated members
      const updatedChannel = await prisma.chat.findUnique({
        where: { id: channel.id },
        include: {
          members: { include: { user: { select: CHAT_USER_SELECT } } },
        },
      });
      
      res.json({ ...updatedChannel!, joined: true });
    } else {
      res.json({ ...channel, joined: false });
    }
  } catch (error) {
    console.error('Join channel error:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Обновить группу/канал (только админ)
router.put('/:id', async (req: AuthRequest, res) => {
  try {
    const chatId = String(req.params.id);
    const { name, description } = req.body;

    const member = await prisma.chatMember.findUnique({
      where: { chatId_userId: { chatId, userId: req.userId! } },
    });

    if (!member || member.role !== 'owner' && member.role !== 'admin') {
      res.status(403).json({ error: 'Только администратор может редактировать группу' });
      return;
    }

    const chat = await prisma.chat.update({
      where: { id: chatId },
      data: { name, description },
      include: {
        members: { include: { user: { select: USER_SELECT } } },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: {
            sender: { select: { id: true, username: true, displayName: true } },
            readBy: { select: { userId: true } },
          },
        },
      },
    });

    res.json(chat);
  } catch (error) {
    console.error('Update group error:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Загрузить аватар группы (только админ)
router.post('/:id/avatar', uploadGroupAvatar.single('avatar'), encryptUploadedFile, async (req: AuthRequest, res) => {
  try {
    const chatId = String(req.params.id);

    const member = await prisma.chatMember.findUnique({
      where: { chatId_userId: { chatId, userId: req.userId! } },
    });

    if (!member || member.role !== 'owner' && member.role !== 'admin') {
      res.status(403).json({ error: 'Только администратор может менять аватар группы' });
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: 'Файл не загружен' });
      return;
    }

    // Delete old avatar file
    const currentChat = await prisma.chat.findUnique({ where: { id: chatId }, select: { avatar: true } });
    if (currentChat?.avatar) deleteUploadedFile(currentChat.avatar);

    const avatarUrl = `/uploads/avatars/${req.file.filename}`;

    const chat = await prisma.chat.update({
      where: { id: chatId },
      data: { avatar: avatarUrl },
      include: {
        members: { include: { user: { select: USER_SELECT } } },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: {
            sender: { select: { id: true, username: true, displayName: true } },
            readBy: { select: { userId: true } },
          },
        },
      },
    });

    res.json(chat);
  } catch (error) {
    console.error('Upload group avatar error:', error);
    res.status(500).json({ error: 'Ошибка загрузки аватара' });
  }
});

// Удалить аватар группы (только админ)
router.delete('/:id/avatar', async (req: AuthRequest, res) => {
  try {
    const chatId = String(req.params.id);

    const member = await prisma.chatMember.findUnique({
      where: { chatId_userId: { chatId, userId: req.userId! } },
    });

    if (!member || member.role !== 'owner' && member.role !== 'admin') {
      res.status(403).json({ error: 'Только администратор может менять аватар группы' });
      return;
    }

    // Delete file from disk
    const currentChat = await prisma.chat.findUnique({ where: { id: chatId }, select: { avatar: true } });
    if (currentChat?.avatar) deleteUploadedFile(currentChat.avatar);

    const chat = await prisma.chat.update({
      where: { id: chatId },
      data: { avatar: null },
      include: {
        members: { include: { user: { select: USER_SELECT } } },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: {
            sender: { select: { id: true, username: true, displayName: true } },
            readBy: { select: { userId: true } },
          },
        },
      },
    });

    res.json(chat);
  } catch (error) {
    res.status(500).json({ error: 'Ошибка удаления аватара' });
  }
});

// Добавить участников в группу (только админ)
router.post('/:id/members', async (req: AuthRequest, res) => {
  try {
    const chatId = String(req.params.id);
    const { userIds } = req.body;

    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      res.status(400).json({ error: 'Необходимо указать пользователей' });
      return;
    }

    const member = await prisma.chatMember.findUnique({
      where: { chatId_userId: { chatId, userId: req.userId! } },
    });

    if (!member || member.role !== 'owner' && member.role !== 'admin') {
      res.status(403).json({ error: 'Только администратор может добавлять участников' });
      return;
    }

    const chat = await prisma.chat.findUnique({ where: { id: chatId } });
    if (!chat || chat.type !== 'group') {
      res.status(400).json({ error: 'Чат не является группой' });
      return;
    }

    for (const uid of userIds) {
      await prisma.chatMember.upsert({
        where: { chatId_userId: { chatId, userId: uid } },
        create: { chatId, userId: uid, role: 'member' },
        update: {},
      });
    }

    const updatedChat = await prisma.chat.findUnique({
      where: { id: chatId },
      include: {
        members: { include: { user: { select: USER_SELECT } } },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: {
            sender: { select: { id: true, username: true, displayName: true } },
            readBy: { select: { userId: true } },
          },
        },
      },
    });

    res.json(updatedChat);
  } catch (error) {
    console.error('Add members error:', error);
    res.status(500).json({ error: 'Ошибка добавления участников' });
  }
});

// Удалить участника из группы (только админ)
router.delete('/:id/members/:userId', async (req: AuthRequest, res) => {
  try {
    const chatId = String(req.params.id);
    const targetUserId = String(req.params.userId);

    const member = await prisma.chatMember.findUnique({
      where: { chatId_userId: { chatId, userId: req.userId! } },
    });

    if (!member || member.role !== 'owner' && member.role !== 'admin') {
      res.status(403).json({ error: 'Только администратор может удалять участников' });
      return;
    }

    if (targetUserId === req.userId) {
      res.status(400).json({ error: 'Нельзя удалить себя из группы' });
      return;
    }

    await prisma.chatMember.delete({
      where: { chatId_userId: { chatId, userId: targetUserId } },
    });

    const updatedChat = await prisma.chat.findUnique({
      where: { id: chatId },
      include: {
        members: { include: { user: { select: USER_SELECT } } },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: {
            sender: { select: { id: true, username: true, displayName: true } },
            readBy: { select: { userId: true } },
          },
        },
      },
    });

    res.json(updatedChat);
  } catch (error) {
    console.error('Remove member error:', error);
    res.status(500).json({ error: 'Ошибка удаления участника' });
  }
});

// Очистить чат для себя
router.post('/:id/clear', async (req: AuthRequest, res) => {
  try {
    const chatId = String(req.params.id);

    await prisma.chatMember.update({
      where: { chatId_userId: { chatId, userId: req.userId! } },
      data: { clearedAt: new Date() },
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Clear chat error:', error);
    res.status(500).json({ error: 'Ошибка очистки чата' });
  }
});

// Получить аналитику канала (должен идти перед другими /:id роутами)
router.get('/:id/analytics', async (req: AuthRequest, res) => {
  try {
    const channelId = String(req.params.id);
    const userId = req.userId!;
    
    // Check if user is channel owner/admin
    const member = await prisma.chatMember.findUnique({
      where: {
        chatId_userId: {
          chatId: channelId,
          userId,
        },
      },
    });
    
    if (!member || member.role !== 'owner' && member.role !== 'admin') {
      res.status(403).json({ error: 'Только администратор может просматривать аналитику' });
      return;
    }
    
    // Get subscriber count
    const subscribers = await prisma.chatMember.count({
      where: { chatId: channelId },
    });
    
    // Get total posts
    const posts = await prisma.message.count({
      where: {
        chatId: channelId,
        isDeleted: false,
      },
    });
    
    // Get recent posts with stats
    const recentPosts = await prisma.message.findMany({
      where: {
        chatId: channelId,
        isDeleted: false,
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: {
        _count: {
          select: {
            views: true,
            reactions: true,
          },
        },
      },
    });
    
    // Get top posts by views
    const topPosts = await prisma.message.findMany({
      where: {
        chatId: channelId,
        isDeleted: false,
      },
      orderBy: { views: { _count: 'desc' } },
      take: 10,
      include: {
        _count: {
          select: {
            views: true,
            reactions: true,
          },
        },
      },
    });
    
    // Calculate total views
    const totalViewsResult = await prisma.messageView.groupBy({
      by: ['messageId'],
      where: {
        message: {
          chatId: channelId,
        },
      },
      _count: true,
    });
    
    const totalViews = totalViewsResult.reduce((sum, item) => sum + item._count, 0);

    // Get subscriber growth data (last 7 days by default)
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    
    const growthData = await prisma.chatMember.groupBy({
      by: ['joinedAt'],
      where: {
        chatId: channelId,
        joinedAt: { gte: sevenDaysAgo },
      },
      _count: true,
    });

    // Group by day
    const growthByDay: Record<string, number> = {};
    for (let i = 6; i >= 0; i--) {
      const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const dateStr = date.toISOString().split('T')[0];
      growthByDay[dateStr] = 0;
    }
    
    growthData.forEach(item => {
      const dateStr = item.joinedAt.toISOString().split('T')[0];
      if (growthByDay[dateStr] !== undefined) {
        growthByDay[dateStr] += item._count;
      }
    });

    const growthArray = Object.entries(growthByDay).map(([date, count]) => ({ date, count }));

    res.json({
      subscribers,
      totalViews,
      posts,
      growthData: growthArray,
      recentPosts: recentPosts.map(p => ({
        id: p.id,
        content: p.content,
        createdAt: p.createdAt.toISOString(),
        viewCount: p._count.views,
        reactions: p._count.reactions,
      })),
      topPosts: topPosts.map(p => ({
        id: p.id,
        content: p.content,
        createdAt: p.createdAt.toISOString(),
        viewCount: p._count.views,
        reactions: p._count.reactions,
      })),
    });
  } catch (error) {
    console.error('Get channel analytics error:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Удалить чат (для текущего пользователя — выйти из чата)
router.delete('/:id', async (req: AuthRequest, res) => {
  try {
    const chatId = String(req.params.id);
    const userId = req.userId!;

    const chat = await prisma.chat.findUnique({
      where: { id: chatId },
      include: { members: true },
    });

    if (!chat) {
      res.status(404).json({ error: 'Чат не найден' });
      return;
    }

    // Membership check
    const isMember = chat.members.some(m => m.userId === userId);
    if (!isMember) {
      res.status(403).json({ error: 'Нет доступа к этому чату' });
      return;
    }

    if (chat.type === 'channel') {
      // For channels: only admin can delete, and it deletes for everyone
      const isAdmin = chat.members.some(m => m.userId === userId && (m.role === 'owner' || m.role === 'admin'));
      if (!isAdmin) {
        // Regular members can just leave
        await prisma.chatMember.delete({
          where: { chatId_userId: { chatId, userId } },
        });
      } else {
        // Admin deletes - remove entire channel with all messages and members
        await prisma.chat.delete({ where: { id: chatId } });
      }
    } else if (chat.type === 'personal') {
      // For personal chats, just remove the member (soft leave) instead of destroying for both
      await prisma.chatMember.delete({
        where: { chatId_userId: { chatId, userId } },
      });
      // If both members have left, clean up the chat
      const remaining = await prisma.chatMember.count({ where: { chatId } });
      if (remaining === 0) {
        await prisma.chat.delete({ where: { id: chatId } });
      }
    } else if (chat.members.length <= 1) {
      // Last member — delete the group entirely
      await prisma.chat.delete({ where: { id: chatId } });
    } else {
      // For groups, just remove the member
      await prisma.chatMember.delete({
        where: { chatId_userId: { chatId, userId } },
      });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Delete chat error:', error);
    res.status(500).json({ error: 'Ошибка удаления чата' });
  }
});

// Закрепить / открепить чат
router.post('/:id/pin', async (req: AuthRequest, res) => {
  try {
    const chatId = String(req.params.id);
    const userId = req.userId!;

    const member = await prisma.chatMember.findUnique({
      where: { chatId_userId: { chatId, userId } },
    });

    if (!member) {
      res.status(404).json({ error: 'Чат не найден' });
      return;
    }

    await prisma.chatMember.update({
      where: { chatId_userId: { chatId, userId } },
      data: { isPinned: !member.isPinned },
    });

    res.json({ isPinned: !member.isPinned });
  } catch (error) {
    console.error('Pin chat error:', error);
    res.status(500).json({ error: 'Ошибка закрепления чата' });
  }
});

// Загрузить аватар группы (только админ)
router.post('/:id/avatar', uploadGroupAvatar.single('avatar'), encryptUploadedFile, async (req: AuthRequest, res) => {
  try {
    const chatId = String(req.params.id);

    const member = await prisma.chatMember.findUnique({
      where: { chatId_userId: { chatId, userId: req.userId! } },
    });

    if (!member || member.role !== 'owner' && member.role !== 'admin') {
      res.status(403).json({ error: 'Только администратор может менять аватар группы' });
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: 'Файл не загружен' });
      return;
    }

    // Delete old avatar file
    const currentChat = await prisma.chat.findUnique({ where: { id: chatId }, select: { avatar: true } });
    if (currentChat?.avatar) deleteUploadedFile(currentChat.avatar);

    const avatarUrl = `/uploads/avatars/${req.file.filename}`;

    const chat = await prisma.chat.update({
      where: { id: chatId },
      data: { avatar: avatarUrl },
      include: {
        members: { include: { user: { select: USER_SELECT } } },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: {
            sender: { select: { id: true, username: true, displayName: true } },
            readBy: { select: { userId: true } },
          },
        },
      },
    });

    res.json(chat);
  } catch (error) {
    console.error('Upload group avatar error:', error);
    res.status(500).json({ error: 'Ошибка загрузки аватара' });
  }
});

export default router;
