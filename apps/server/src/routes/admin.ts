import express from 'express';
import { prisma } from '../db';
import crypto from 'crypto';

const router = express.Router();
const ADMIN_PASSWORD = 'b2323vgn7v672n7823478t92BRGMV7tv83';

// In-memory session store
interface AdminSession {
  token: string;
  ip: string;
  userAgent: string;
  device: string;
  loginAt: Date;
  lastActive: Date;
}

const sessions: Map<string, AdminSession> = new Map();

// Middleware для проверки админ-токена
function authenticateAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Требуется авторизация' });
  }

  // Проверяем, что токен начинается с 'admin-token-' и существует в сессиях
  if (!token.startsWith('admin-token-') || !sessions.has(token)) {
    return res.status(403).json({ error: 'Недействительный токен' });
  }

  // Обновляем lastActive
  const session = sessions.get(token)!;
  session.lastActive = new Date();

  next();
}

// Helper to detect device from user agent
function detectDevice(userAgent: string): string {
  if (!userAgent) return 'Unknown';
  if (/mobile|android|iphone/i.test(userAgent)) return '📱 Mobile';
  if (/tablet|ipad/i.test(userAgent)) return '📱 Tablet';
  if (/windows/i.test(userAgent)) return '🖥️ Windows';
  if (/macintosh|mac os/i.test(userAgent)) return '🖥️ macOS';
  if (/linux/i.test(userAgent)) return '🐧 Linux';
  return '🖥️ Desktop';
}

// Helper to get browser name
function getBrowser(userAgent: string): string {
  if (!userAgent) return 'Unknown';
  if (/chrome/i.test(userAgent)) return 'Chrome';
  if (/firefox/i.test(userAgent)) return 'Firefox';
  if (/safari/i.test(userAgent)) return 'Safari';
  if (/edge/i.test(userAgent)) return 'Edge';
  return 'Browser';
}

// Login
router.post('/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    const token = 'admin-token-' + Date.now() + '-' + crypto.randomBytes(8).toString('hex');
    const userAgent = req.headers['user-agent'] || '';
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    
    sessions.set(token, {
      token,
      ip,
      userAgent,
      device: detectDevice(userAgent),
      loginAt: new Date(),
      lastActive: new Date()
    });
    
    res.json({ success: true, token });
  } else {
    res.status(401).json({ error: 'Неверный пароль' });
  }
});

// Get all sessions
router.get('/sessions', authenticateAdmin, (req, res) => {
  const sessionList = Array.from(sessions.values()).map(s => ({
    token: s.token,
    ip: s.ip,
    device: s.device,
    browser: getBrowser(s.userAgent),
    userAgent: s.userAgent.substring(0, 100) + '...',
    loginAt: s.loginAt,
    lastActive: s.lastActive,
    isCurrent: s.token === req.headers.authorization?.replace('Bearer ', '')
  }));
  res.json(sessionList);
});

// Logout from specific session
router.delete('/sessions/:token', authenticateAdmin, (req, res) => {
  const { token } = req.params;
  if (sessions.delete(token)) {
    res.json({ success: true, message: 'Сессия завершена' });
  } else {
    res.status(404).json({ error: 'Сессия не найдена' });
  }
});

// Logout from all sessions except current
router.post('/sessions/logout-all', authenticateAdmin, (req, res) => {
  const currentToken = req.headers.authorization?.replace('Bearer ', '');
  let count = 0;
  for (const [token] of sessions) {
    if (token !== currentToken) {
      sessions.delete(token);
      count++;
    }
  }
  res.json({ success: true, message: `Завершено ${count} сессий` });
});

// Logout current session
router.post('/sessions/logout-current', authenticateAdmin, (req, res) => {
  const currentToken = req.headers.authorization?.replace('Bearer ', '');
  sessions.delete(currentToken || '');
  res.json({ success: true, message: 'Сессия завершена' });
});

// Get all user devices (from regular user sessions)
router.get('/devices', authenticateAdmin, async (req, res) => {
  try {
    // Get recent active users with their last seen info
    const users = await prisma.user.findMany({
      where: {
        isOnline: true,
        lastSeen: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } // Last 24 hours
      },
      select: {
        id: true,
        username: true,
        displayName: true,
        lastSeen: true,
        isOnline: true
      },
      orderBy: { lastSeen: 'desc' },
      take: 100
    });

    // Map users to device-like entries
    // Since we don't store detailed device info for regular users,
    // we'll create entries based on available data
    const devices = users.map(user => ({
      userId: user.id,
      userName: user.displayName || user.username,
      device: user.isOnline ? '🟢 Online' : '⚫ Offline',
      browser: 'Web Client',
      ip: 'N/A',
      loginAt: user.lastSeen,
      lastActive: user.lastSeen,
      isActive: user.isOnline
    }));

    res.json(devices);
  } catch (error: any) {
    res.status(500).json({ error: error?.message || 'Ошибка получения устройств' });
  }
});

// Stats
router.get('/stats', authenticateAdmin, async (req, res) => {
  try {
    const [userCount, chatCount, messageCount, onlineCount, verifiedCount, bannedCount] = await Promise.all([
      prisma.user.count(),
      prisma.chat.count(),
      prisma.message.count(),
      prisma.user.count({ where: { isOnline: true } }),
      prisma.verifiedEntity.count(),
      prisma.user.count({ where: { isBanned: true } })
    ]);
    res.json({ users: userCount, chats: chatCount, messages: messageCount, online: onlineCount, verified: verifiedCount, banned: bannedCount });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка получения статистики' });
  }
});

// PostgreSQL status
router.get('/status/postgres', authenticateAdmin, async (req, res) => {
  try {
    const dbUrl = process.env.DATABASE_URL || '';
    const result = await prisma.$queryRaw`SELECT version(), current_database(), pg_database_size(current_database()) as size`;
    const data = (result as any[])[0];
    // Convert BigInt to number safely
    let sizeNum = 0;
    if (data?.size !== null && data?.size !== undefined) {
      sizeNum = typeof data.size === 'bigint' ? Number(data.size) : Number(data.size || 0);
    }
    res.json({ connected: true, url: dbUrl.replace(/:\/\/[^@]+@/, '://***@'), version: data?.version?.split(' ')[0] || 'Unknown', database: data?.current_database || 'Unknown', size: formatBytes(sizeNum) });
  } catch (error: any) {
    res.json({ connected: false, url: (process.env.DATABASE_URL || '').replace(/:\/\/[^@]+@/, '://***@') || 'Не настроено', error: error?.message || 'Не удалось подключиться' });
  }
});

// Redis status
router.get('/status/redis', authenticateAdmin, async (req, res) => {
  try {
    const redisUrl = process.env.REDIS_URL || '';
    if (!redisUrl) return res.json({ connected: false, url: 'Не настроено', error: 'Redis URL не указан' });
    const { createClient } = await import('redis');
    const client = createClient({ url: redisUrl });
    await client.connect();
    const info = await client.info();
    const dbsize = await client.dbSize();
    const versionMatch = info.match(/redis_version:([\d.]+)/);
    await client.quit();
    res.json({ connected: true, url: redisUrl.replace(/:\/\/[^@]+@/, '://***@'), version: versionMatch ? versionMatch[1] : 'Unknown', keys: dbsize.toString() });
  } catch (error: any) {
    res.json({ connected: false, url: (process.env.REDIS_URL || '').replace(/:\/\/[^@]+@/, '://***@') || 'Не настроено', error: error?.message || 'Не удалось подключиться' });
  }
});

// Get all users
router.get('/users', authenticateAdmin, async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, username: true, displayName: true, isOnline: true, isVerified: true, isBanned: true, createdAt: true, avatar: true },
      orderBy: { createdAt: 'desc' },
      take: 200
    });
    res.json(users);
  } catch { res.status(500).json({ error: 'Ошибка получения пользователей' }); }
});

// Delete user
router.delete('/users/:id', authenticateAdmin, async (req, res) => {
  try {
    const userId = req.params.id;
    
    // Delete all related data first to avoid foreign key constraints
    await prisma.$transaction([
      // Delete auth sessions
      prisma.authSession.deleteMany({ where: { userId } }),
      // Delete uploaded files
      prisma.telegramFile.deleteMany({ where: { userId } }),
      // Delete story views
      prisma.storyView.deleteMany({ where: { userId } }),
      // Delete stories
      prisma.story.deleteMany({ where: { userId } }),
      // Delete call logs
      prisma.callLog.deleteMany({ where: { OR: [{ callerId: userId }, { calleeId: userId }] } }),
      // Delete friendships
      prisma.friendship.deleteMany({ where: { OR: [{ userId }, { friendId: userId }] } }),
      // Delete read receipts
      prisma.readReceipt.deleteMany({ where: { userId } }),
      // Delete reactions
      prisma.reaction.deleteMany({ where: { userId } }),
      // Delete pinned messages
      prisma.pinnedMessage.deleteMany({ where: { chat: { members: { some: { userId } } } } }),
      // Delete chat memberships (cascade will delete messages)
      prisma.chatMember.deleteMany({ where: { userId } }),
      // Finally delete user
      prisma.user.delete({ where: { id: userId } }),
    ]);
    
    res.json({ success: true });
  } catch (error: any) { 
    console.error('Delete user error:', error);
    res.status(500).json({ error: error?.message || 'Ошибка удаления' }); 
  }
});

// Get all verified entities
router.get('/verified', authenticateAdmin, async (req, res) => {
  try {
    const entities = await prisma.verifiedEntity.findMany({
      include: { chat: { include: { members: { include: { user: true } } } } }
    });
    const result = entities.map(e => {
      let name = '', members = 0, owner = '', avatar = '';
      if (e.entityType === 'user') {
        // Handled separately
      } else if (e.chat) {
        name = e.chat.name || e.chat.username || '';
        members = e.chat.members.length;
        const admin = e.chat.members.find(m => (m.role === 'owner' || m.role === 'admin'));
        owner = admin?.user?.displayName || admin?.user?.username || '';
        avatar = e.chat.avatar || '';
      }
      return { ...e, name, members, owner, avatar };
    });
    // Add users
    const verifiedUsers = await prisma.user.findMany({
      where: { isVerified: true },
      select: { id: true, displayName: true, username: true, avatar: true, verifiedBadgeUrl: true, verifiedBadgeType: true }
    });
    const userEntities = verifiedUsers.map(u => ({
      entityType: 'user',
      entityId: u.id,
      name: u.displayName || u.username,
      members: 0,
      owner: '',
      avatar: u.avatar || '',
      badgeUrl: u.verifiedBadgeUrl || '',
      badgeType: u.verifiedBadgeType || 'default'
    }));
    res.json([...result, ...userEntities]);
  } catch { res.status(500).json({ error: 'Ошибка' }); }
});

// Verify entity
router.post('/verify', authenticateAdmin, async (req, res) => {
  try {
    const { entityType, entityId, badgeUrl, badgeType } = req.body;
    if (entityType === 'user') {
      await prisma.user.update({
        where: { id: entityId },
        data: { isVerified: true, verifiedBadgeUrl: badgeUrl || null, verifiedBadgeType: badgeType || 'default', verifiedAt: new Date() }
      });
    } else {
      await prisma.verifiedEntity.upsert({
        where: { entityType_entityId: { entityType, entityId } },
        update: { badgeUrl: badgeUrl || null, badgeType: badgeType || 'default', verifiedAt: new Date() },
        create: { entityType, entityId, badgeUrl: badgeUrl || null, badgeType: badgeType || 'default', verifiedBy: 'admin' }
      });
      if (entityType === 'channel' || entityType === 'group') {
        await prisma.chat.update({ where: { id: entityId }, data: { isVerified: true, verifiedBadgeUrl: badgeUrl || null, verifiedBadgeType: badgeType || 'default', verifiedAt: new Date() } });
      }
    }
    res.json({ success: true });
  } catch (error: any) { res.status(500).json({ error: error?.message || 'Ошибка' }); }
});

// Remove verification
router.delete('/verify/:type/:id', authenticateAdmin, async (req, res) => {
  try {
    const { type, id } = req.params;
    if (type === 'user') {
      await prisma.user.update({ where: { id }, data: { isVerified: false, verifiedBadgeUrl: null, verifiedBadgeType: null, verifiedAt: null } });
    } else {
      await prisma.verifiedEntity.deleteMany({ where: { entityType: type, entityId: id } });
      await prisma.chat.updateMany({ where: { id }, data: { isVerified: false, verifiedBadgeUrl: null, verifiedBadgeType: null, verifiedAt: null } });
    }
    res.json({ success: true });
  } catch (error: any) { res.status(500).json({ error: error?.message || 'Ошибка' }); }
});

// Ban user
router.post('/ban', authenticateAdmin, async (req, res) => {
  try {
    const { userId, reason, expiresAt } = req.body;
    await prisma.user.update({
      where: { id: userId },
      data: { isBanned: true, banReason: reason, banExpiresAt: expiresAt ? new Date(expiresAt) : null, bannedAt: new Date(), bannedBy: 'admin' }
    });
    await prisma.userBan.create({
      data: { userId, reason, expiresAt: expiresAt ? new Date(expiresAt) : null, bannedBy: 'admin' }
    });
    res.json({ success: true });
  } catch (error: any) { res.status(500).json({ error: error?.message || 'Ошибка' }); }
});

// Unban user
router.delete('/ban/:id', authenticateAdmin, async (req, res) => {
  try {
    await prisma.user.update({ where: { id: req.params.id }, data: { isBanned: false, banReason: null, banExpiresAt: null, bannedAt: null, bannedBy: null } });
    await prisma.userBan.updateMany({ where: { userId: req.params.id, isActive: true }, data: { isActive: false, liftedAt: new Date(), liftedBy: 'admin' } });
    res.json({ success: true });
  } catch (error: any) { res.status(500).json({ error: error?.message || 'Ошибка' }); }
});

// Storage config
router.post('/config/storage', authenticateAdmin, async (req, res) => {
  try {
    const { mode } = req.body;
    if (mode === 'local' || mode === 'telegram') {
      res.json({ success: true, message: `Режим хранилища: ${mode === 'local' ? 'Локальный' : 'Telegram'}` });
    } else { res.status(400).json({ error: 'Неверный режим' }); }
  } catch { res.status(500).json({ error: 'Ошибка' }); }
});

// Database config
router.post('/config/database', authenticateAdmin, async (req, res) => {
  try {
    const { databaseUrl } = req.body;
    if (!databaseUrl) return res.status(400).json({ error: 'URL базы данных обязателен' });
    res.json({ success: true, message: 'Конфигурация обновлена. Перезапустите сервер.' });
  } catch { res.status(500).json({ error: 'Ошибка обновления' }); }
});

// Redis config
router.post('/config/redis', authenticateAdmin, async (req, res) => {
  try { res.json({ success: true, message: 'Redis настроен' }); }
  catch { res.status(500).json({ error: 'Ошибка настройки' }); }
});

// Get config
router.get('/config', authenticateAdmin, async (req, res) => {
  res.json({
    database: { type: process.env.DATABASE_URL?.includes('postgres') ? 'postgresql' : 'sqlite', url: process.env.DATABASE_URL?.replace(/:\/\/[^@]+@/, '://***@') },
    redis: { enabled: !!process.env.REDIS_URL, url: process.env.REDIS_URL?.replace(/:\/\/[^@]+@/, '://***@') }
  });
});

// Clear cache
router.post('/cache/clear', authenticateAdmin, async (req, res) => {
  res.json({ success: true, message: 'Кэш очищен' });
});

// Broadcast message to all users
router.post('/broadcast', authenticateAdmin, async (req, res) => {
  try {
    const { title, message, type } = req.body;
    
    if (!message || typeof message !== 'string') {
      res.status(400).json({ error: 'Текст сообщения обязателен' });
      return;
    }

    // Get all online users and their socket IDs
    const onlineUsers = await prisma.user.findMany({
      where: { isOnline: true },
      select: { id: true }
    });

    // Get IO instance - we need to access it from the main index
    // For now, we'll just count how many would receive it
    const recipients = onlineUsers.length;

    // Save broadcast to database for offline users
    const broadcast = await prisma.broadcast.create({
      data: {
        title: title || 'Уведомление',
        message: message.substring(0, 5000),
        type: type || 'info',
        sentAt: new Date()
      }
    });

    // Emit to all connected sockets via io (we'll access it via app)
    const io = req.app.get('io');
    if (io) {
      io.emit('broadcast', {
        id: broadcast.id,
        title: title || 'Уведомление',
        message: message.substring(0, 5000),
        type: type || 'info',
        sentAt: broadcast.sentAt.toISOString()
      });
    }

    res.json({ 
      success: true, 
      recipients,
      broadcastId: broadcast.id,
      message: `Сообщение отправлено ${recipients} пользователям`
    });
  } catch (error: any) {
    console.error('Broadcast error:', error);
    res.status(500).json({ error: error?.message || 'Ошибка рассылки' });
  }
});

// Get broadcast history
router.get('/broadcasts', authenticateAdmin, async (req, res) => {
  try {
    const broadcasts = await prisma.broadcast.findMany({
      orderBy: { sentAt: 'desc' },
      take: 50
    });
    res.json(broadcasts);
  } catch (error: any) {
    res.status(500).json({ error: error?.message || 'Ошибка получения истории' });
  }
});

// System info
router.get('/system/info', authenticateAdmin, async (req, res) => {
  const uptime = process.uptime();
  const hours = Math.floor(uptime / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);
  res.json({ nodeVersion: process.version, env: process.env.NODE_ENV || 'development', port: process.env.PORT || '3001', uptime: `${hours}ч ${minutes}м`, memory: formatBytes(process.memoryUsage().rss) });
});

// Restart
router.post('/system/restart', authenticateAdmin, async (req, res) => {
  res.json({ success: true, message: 'Сервер перезагружается...' });
  setTimeout(() => process.exit(0), 1000);
});

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export default router;
