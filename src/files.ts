import { extractRawText } from 'mammoth';
import { PDFParse } from 'pdf-parse';
import type { Material } from './types';
import { isRecord } from './validate';

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_TEXT_CHARS = 200_000;
const MAX_IMAGE_DATA_CHARS = 14_000_000; // ~10MB binary as base64

const IMAGE_EXT_MIME: Record<string, 'image/png' | 'image/jpeg' | 'image/gif'> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
};

const TEXT_EXT_MIME: Record<string, string> = {
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
};

export function detectImageMime(buf: Uint8Array): 'image/png' | 'image/jpeg' | 'image/gif' | null {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 6 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'image/gif';
  return null;
}

export interface ExtractedMaterial {
  name: string;
  mime: string;
  text: string;
  data?: string;
}

/** Extract text or base64 image data from an uploaded file; all errors sanitized. */
export async function extractMaterial(filename: string, buf: Uint8Array): Promise<ExtractedMaterial> {
  if (buf.byteLength > MAX_FILE_BYTES) throw new Error('File too large (max 10 MB)');
  const base = filename.split(/[\\/]/).pop() ?? 'file';
  const name = base.slice(0, 200);
  const dot = base.lastIndexOf('.');
  const ext = dot >= 0 ? base.slice(dot + 1).toLowerCase() : '';

  const textMime = TEXT_EXT_MIME[ext];
  if (textMime) {
    const text = new TextDecoder('utf-8').decode(buf).slice(0, MAX_TEXT_CHARS);
    return { name, mime: textMime, text };
  }

  if (ext === 'pdf') {
    const parser = new PDFParse({ data: Buffer.from(buf) });
    try {
      const result = await parser.getText();
      return { name, mime: 'application/pdf', text: result.text.slice(0, MAX_TEXT_CHARS) };
    } catch {
      throw new Error('Could not extract text from PDF');
    } finally {
      await parser.destroy().catch(() => undefined);
    }
  }

  if (ext === 'docx') {
    try {
      const result = await extractRawText({ buffer: Buffer.from(buf) });
      return {
        name,
        mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        text: result.value.slice(0, MAX_TEXT_CHARS),
      };
    } catch {
      throw new Error('Could not extract text from DOCX');
    }
  }

  if (ext === 'doc') throw new Error('.doc files are not supported; save as .docx or PDF and upload again');

  const expected = IMAGE_EXT_MIME[ext];
  if (expected) {
    const detected = detectImageMime(buf);
    if (detected === null || detected !== expected) throw new Error('File contents do not match a valid image');
    return { name, mime: detected, text: '', data: Buffer.from(buf).toString('base64') };
  }

  throw new Error('Unsupported file type. Supported: txt, md, csv, pdf, docx, png, jpg, gif');
}

const MATERIAL_MIMES: Record<string, true> = {
  'text/plain': true,
  'text/markdown': true,
  'text/csv': true,
  'application/pdf': true,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': true,
  'image/png': true,
  'image/jpeg': true,
  'image/gif': true,
};

/** Runtime-validate a client-supplied Material (e.g. chat attachment). Returns a clean copy. */
export function validateMaterialInput(x: unknown): Material {
  if (!isRecord(x)) throw new Error('attachment must be an object');
  const { id, name, text, mime, data } = x;
  if (typeof id !== 'string' || id.length > 64) throw new Error('attachment id invalid');
  if (typeof name !== 'string' || name.length === 0 || name.length > 200) throw new Error('attachment name invalid');
  if (typeof text !== 'string' || text.length > MAX_TEXT_CHARS) throw new Error('attachment text invalid or too large');
  if (typeof mime !== 'string' || !MATERIAL_MIMES[mime]) throw new Error('attachment type not supported');
  if (data !== undefined && (typeof data !== 'string' || data.length > MAX_IMAGE_DATA_CHARS))
    throw new Error('attachment data invalid or too large');
  const m: Material = { id, name, text, mime };
  if (typeof data === 'string') m.data = data;
  return m;
}

export function isImageMaterial(m: { mime: string; data?: string }): boolean {
  return (m.mime === 'image/png' || m.mime === 'image/jpeg' || m.mime === 'image/gif') && typeof m.data === 'string';
}
