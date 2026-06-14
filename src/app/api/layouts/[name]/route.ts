import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const ASSETS_BASE = process.env.GAME_ASSETS_DIR || 'C:\\Users\\user\\developsecond\\game-assets';
const LAYOUTS_DIR = path.join(ASSETS_BASE, 'layouts');

const NAME_RE = /^[a-zA-Z0-9_-]+$/;

function validName(name: string): boolean {
  return NAME_RE.test(name) && name.length > 0 && name.length < 64;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  if (!validName(name)) return NextResponse.json({ error: 'Invalid name' }, { status: 400 });
  const fp = path.join(LAYOUTS_DIR, `${name}.json`);
  if (!fs.existsSync(fp)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const data = fs.readFileSync(fp, 'utf-8');
  return new NextResponse(data, { headers: { 'Content-Type': 'application/json' } });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  if (!validName(name)) return NextResponse.json({ error: 'Invalid name' }, { status: 400 });
  if (!fs.existsSync(LAYOUTS_DIR)) fs.mkdirSync(LAYOUTS_DIR, { recursive: true });
  const body = await req.json();
  // Minimal schema check
  if (!body || !Array.isArray(body.placements)) {
    return NextResponse.json({ error: 'Invalid layout body' }, { status: 400 });
  }
  const fp = path.join(LAYOUTS_DIR, `${name}.json`);
  fs.writeFileSync(fp, JSON.stringify(body, null, 2));
  return NextResponse.json({ ok: true, name, placement_count: body.placements.length });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  if (!validName(name)) return NextResponse.json({ error: 'Invalid name' }, { status: 400 });
  const fp = path.join(LAYOUTS_DIR, `${name}.json`);
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
  return NextResponse.json({ ok: true });
}
