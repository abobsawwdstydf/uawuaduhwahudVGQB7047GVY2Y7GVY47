import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { UPLOADS_ROOT } from '../shared';

const UPLOADS_DIR = path.join(UPLOADS_ROOT, 'files');

// Ensure upload directory exists
function ensureDir() {
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
}

interface LocalFile {
  fileId: string;
  originalName: string;
  mimeType: string;
  size: number;
  path: string;
  createdAt: Date;
}

export const localStorage = {
  async uploadFile(buffer: Buffer, originalName: string, mimeType: string): Promise<LocalFile> {
    ensureDir();
    
    const ext = path.extname(originalName);
    const fileId = `local_${Date.now()}_${crypto.randomBytes(8).toString('hex')}${ext}`;
    const filePath = path.join(UPLOADS_DIR, fileId);
    
    fs.writeFileSync(filePath, buffer);
    
    return {
      fileId,
      originalName,
      mimeType,
      size: buffer.length,
      path: filePath,
      createdAt: new Date(),
    };
  },

  async downloadFile(fileId: string): Promise<{ buffer: Buffer; mimeType: string; originalName: string }> {
    const filePath = path.join(UPLOADS_DIR, fileId);
    
    if (!fs.existsSync(filePath)) {
      throw new Error('File not found');
    }
    
    const buffer = fs.readFileSync(filePath);
    const ext = path.extname(fileId).toLowerCase();
    
    const mimeTypes: Record<string, string> = {
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
      '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
      '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
      '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
      '.pdf': 'application/pdf', '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.zip': 'application/zip', '.rar': 'application/x-rar-compressed',
    };
    
    return {
      buffer,
      mimeType: mimeTypes[ext] || 'application/octet-stream',
      originalName: fileId,
    };
  },

  async deleteFile(fileId: string): Promise<void> {
    const filePath = path.join(UPLOADS_DIR, fileId);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  },

  getFilePath(fileId: string): string {
    return `/uploads/files/${fileId}`;
  }
};