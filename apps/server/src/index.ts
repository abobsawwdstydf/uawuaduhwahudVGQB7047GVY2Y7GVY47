import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import mime from 'mime-types';
import { config, TELEGRAM_BOTS, TELEGRAM_AUTH_BOT } from './config';
import { prisma } from './db';
import authRoutes from './routes/auth';

// Initialize database connection
prisma.$connect().then(() => {
  console.log('  ✓ БД подключена');
}).catch(err => {
  console.error('Failed to connect DB:', err);
  process.exit(1);
});
import userRoutes from './routes/users';
import chatRoutes from './routes/chats';
import messageRoutes from './routes/messages';
import storyRoutes from './routes/stories';
import friendRoutes from './routes/friends';
import callLogRoutes from './routes/callLogs';
import messageViewRoutes from './routes/messageViews';
import adminRoutes from './routes/admin';
import { setupSocket } from './socket';
import { authenticateToken, AuthRequest } from './middleware/auth';
import { decryptFileToBuffer, isEncryptionEnabled } from './encrypt';
import { UPLOADS_ROOT } from './shared';

// Disable all console logs for performance
if (process.env.NODE_ENV === 'production') {
  console.log = () => {};
  console.warn = () => {};
  // Keep console.error for debugging
}

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: config.corsOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
  },
});

// Trust first proxy (Nginx) so req.ip returns real client IP from X-Forwarded-For
app.set('trust proxy', 1);

app.use(cors({ origin: config.corsOrigins }));
app.use(express.json({ limit: '10mb' }));

// Файлы больше не хранятся локально - всё в Telegram!
// Serve uploads удален - файлы скачиваются из Telegram по запросу

// Rate limiting for auth endpoints (prevent brute-force)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // max 100 attempts per window for development
  message: { error: 'Слишком много попыток, попробуйте позже' },
  standardHeaders: true,
  legacyHeaders: false,
});

// General API rate limiter (1000 req/min per IP for development)
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 1000,
  message: { error: 'Слишком много запросов, попробуйте позже' },
  standardHeaders: true,
  legacyHeaders: false,
});

// API маршруты
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/users', apiLimiter, authenticateToken, userRoutes);
app.use('/api/chats', apiLimiter, authenticateToken, chatRoutes);
app.use('/api/stories', apiLimiter, authenticateToken, storyRoutes);
app.use('/api/friends', apiLimiter, authenticateToken, friendRoutes);
app.use('/api/call-logs', apiLimiter, authenticateToken, callLogRoutes);
app.use('/api/messages', apiLimiter, authenticateToken, messageViewRoutes);
app.use('/api/messages', apiLimiter, authenticateToken, messageRoutes);
app.use('/api/threads', apiLimiter, authenticateToken, require('./routes/threads').default);
app.use('/api/ai', apiLimiter, authenticateToken, require('./routes/ai').default);
app.use('/api/ai', apiLimiter, authenticateToken, require('./routes/ai-chats').default);
app.use('/api/admin', adminRoutes);

// Проверка здоровья
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', name: 'Nexo Server' });
});

// Админ панель
app.get('/admin', (_req, res) => {
  res.sendFile(path.join(__dirname, 'admin-panel.html'));
});

// Serve static files from web dist (../web/dist relative to src/)
const webDistPath = path.resolve(__dirname, '..', 'web', 'dist');
console.log('Serving web from:', webDistPath);
app.use(express.static(webDistPath));

// Serve public files (badges, etc.)
const publicPath = path.resolve(__dirname, '..', 'web', 'public');
app.use(express.static(publicPath));

// Serve uploads (avatars, etc.)
app.use('/uploads', express.static(UPLOADS_ROOT, {
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Access-Control-Allow-Origin', '*');
  },
}));

// SPA fallback - serve index.html for all other routes
app.get('*', (_req, res) => {
  const indexPath = path.join(webDistPath, 'index.html');
  console.log('Serving index.html from:', indexPath);
  res.sendFile(indexPath);
});

// ICE серверы для WebRTC звонков
app.get('/api/ice-servers', authenticateToken, (_req: AuthRequest, res) => {
  const iceServers: Array<{ urls: string | string[]; username?: string; credential?: string }> = [];

  // STUN серверы
  if (config.stunUrls.length > 0) {
    iceServers.push({ urls: config.stunUrls });
  }

  // TURN сервер с временными credentials (coturn --use-auth-secret)
  if (config.turnUrl && config.turnSecret) {
    const ttl = 24 * 3600; // 24 часа
    const timestamp = Math.floor(Date.now() / 1000) + ttl;
    const username = `${timestamp}:nexo`;
    const credential = crypto
      .createHmac('sha1', config.turnSecret)
      .update(username)
      .digest('base64');

    iceServers.push({
      urls: config.turnUrl,
      username,
      credential,
    });
  }

  res.json({ iceServers });
});

// Socket.io
setupSocket(io);

// Endpoint для скачивания файлов из Telegram
import { telegramStorage } from './lib/telegramStorage';

app.get('/api/files/:fileId/download', async (req, res) => {
  try {
    const { fileId } = req.params;
    console.log(`[FILES] Запрос скачивания: ${fileId}`);

    // CORS for media
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD');
    res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');

    if (!fileId || !fileId.startsWith('tg_')) {
      console.warn(`[FILES] Неверный fileId: ${fileId}`);
      res.status(400).json({ error: 'Неверный ID файла' });
      return;
    }

    const telegramFile = await prisma.telegramFile.findUnique({
      where: { fileId },
      include: { chunks: { orderBy: { chunkIndex: 'asc' } } }
    });

    if (!telegramFile) {
      console.warn(`[FILES] Файл ${fileId} не найден в БД`);
      res.status(404).json({ error: 'Файл не найден в хранилище' });
      return;
    }

    if (!telegramFile.chunks || telegramFile.chunks.length === 0) {
      console.warn(`[FILES] Файл ${fileId} без чанков`);
      res.status(404).json({ error: 'Файл повреждён (нет чанков)' });
      return;
    }

    console.log(`[FILES] Файл найден: ${telegramFile.originalName} (${telegramFile.mimeType}, ${telegramFile.totalSize}b, ${telegramFile.chunks.length} чанков)`);

    let fileBuffer: Buffer;
    try {
      // Retry up to 2 times with delay
      let lastError: Error | null = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          fileBuffer = await telegramStorage.downloadFile(
            telegramFile.fileId,
            telegramFile.chunks
          );
          lastError = null;
          break;
        } catch (retryError: any) {
          lastError = retryError;
          console.warn(`[FILES] Download attempt ${attempt + 1} failed: ${retryError.message}`);
          if (attempt < 1) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        }
      }
      if (lastError) throw lastError;
    } catch (downloadError: any) {
      console.error(`[FILES] Ошибка загрузки из Telegram:`, downloadError.message);
      res.status(503).json({ error: 'Файл временно недоступен (ошибка загрузки из хранилища)' });
      return;
    }

    console.log(`[FILES] Файл скачан: ${fileBuffer.length}b`);

    await prisma.telegramFile.update({
      where: { fileId },
      data: { lastAccessed: new Date(), accessCount: { increment: 1 } }
    }).catch(() => {}); // ignore update errors

    const isInline = telegramFile.mimeType.startsWith('image/') ||
                     telegramFile.mimeType.startsWith('video/') ||
                     telegramFile.mimeType.startsWith('audio/');

    if (isInline) {
      res.setHeader('Content-Type', telegramFile.mimeType);
      res.setHeader('Content-Length', fileBuffer.length);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

      const range = req.headers.range;
      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileBuffer.length - 1;

        if (start >= fileBuffer.length) {
          res.writeHead(416, { 'Content-Range': `bytes */${fileBuffer.length}` });
          res.end();
          return;
        }

        const chunk = fileBuffer.slice(start, Math.min(end + 1, fileBuffer.length));
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${Math.min(end, fileBuffer.length - 1)}/${fileBuffer.length}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunk.length,
          'Content-Type': telegramFile.mimeType,
        });
        res.end(chunk);
      } else {
        res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(telegramFile.originalName)}"`);
        res.end(fileBuffer);
      }
    } else {
      res.setHeader('Content-Type', telegramFile.mimeType);
      res.setHeader('Content-Length', fileBuffer.length);
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(telegramFile.originalName)}"`);
      res.setHeader('Cache-Control', 'public, max-age=31536000');
      res.end(fileBuffer);
    }

  } catch (error: any) {
    console.error('[FILES] Ошибка скачивания:', error.message, error.stack);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Ошибка скачивания: ' + error.message });
    }
  }
});

// При старте сервера сбросить всех в offline
prisma.user.updateMany({ data: { isOnline: false, lastSeen: new Date() } })
  .then(() => console.log('  ✔ Все пользователи сброшены в offline'))
  .catch((e: unknown) => console.error('Ошибка сброса онлайн-статусов:', e));

// Cleanup expired stories (every 10 minutes)
import { deleteUploadedFile } from './shared';

async function cleanupExpiredStories() {
  try {
    const expired = await prisma.story.findMany({
      where: { expiresAt: { lte: new Date() } },
      select: { id: true, mediaUrl: true },
    });

    if (expired.length === 0) return;

    for (const story of expired) {
      if (story.mediaUrl) deleteUploadedFile(story.mediaUrl);
    }

    const ids = expired.map(s => s.id);
    // Cascade handles StoryView deletion via schema onDelete: Cascade
    await prisma.story.deleteMany({ where: { id: { in: ids } } });
  } catch (e) {
    // Silent cleanup
  }
}

cleanupExpiredStories();
setInterval(cleanupExpiredStories, 10 * 60 * 1000);

// Start server
server.listen(config.port, '0.0.0.0', () => {
  console.log(`\n  ⚡ Nexo Server запущен на порту ${config.port}\n`);
  console.log(`  📡 Локально: http://localhost:${config.port}`);
  console.log(`  🌐 В сети: http://<ваш-IP>:${config.port}\n`);
});

// Graceful shutdown
const shutdown = async () => {
  await prisma.$disconnect();
  server.close(() => {
    process.exit(0);
  });
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
