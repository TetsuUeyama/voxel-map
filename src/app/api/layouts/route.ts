import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const ASSETS_BASE = process.env.GAME_ASSETS_DIR || 'C:\\Users\\user\\developsecond\\game-assets';
const LAYOUTS_DIR = path.join(ASSETS_BASE, 'layouts');

export async function GET() {
  if (!fs.existsSync(LAYOUTS_DIR)) return NextResponse.json({ names: [] });
  const files = fs.readdirSync(LAYOUTS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''));
  return NextResponse.json({ names: files });
}
