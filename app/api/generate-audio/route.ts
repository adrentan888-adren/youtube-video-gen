import { NextRequest, NextResponse } from 'next/server'

const FFMPEG_URL = process.env.FFMPEG_SERVER_URL!
const MAX_TTS_CHARS = 4900

export const maxDuration = 180 // 3 min for TTS + transcription

function splitNarration(text: string): string[] {
  if (text.length <= MAX_TTS_CHARS) return [text]
  const chunks: string[] = []
  let remaining = text.trim()
  while (remaining.length > MAX_TTS_CHARS) {
    let cutAt = remaining.lastIndexOf(' ', MAX_TTS_CHARS)
    if (cutAt <= 0) cutAt = MAX_TTS_CHARS
    chunks.push(remaining.slice(0, cutAt).trim())
    remaining = remaining.slice(cutAt).trim()
  }
  if (remaining) chunks.push(remaining)
  return chunks
}

export async function POST(req: NextRequest) {
  try {
    const { narration, voice = 'en-US-JennyNeural' } = await req.json()
    const chunks = splitNarration(narration)

    // Step 1: Generate TTS for all chunks
    const ttsRes = await fetch(`${FFMPEG_URL}/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chunks, voice }),
    })
    if (!ttsRes.ok) {
      const txt = await ttsRes.text()
      return NextResponse.json({ error: `TTS failed: ${txt.slice(0, 200)}` }, { status: 500 })
    }
    const { audioUrls }: { audioUrls: string[] } = await ttsRes.json()

    // Step 2: Transcribe each chunk, offset timestamps by cumulative duration
    type Word = { word: string; start: number; end: number }
    const allWords: Word[] = []
    let totalDuration = 0

    for (const audioUrl of audioUrls) {
      const transcribeRes = await fetch(`${FFMPEG_URL}/transcribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioUrl }),
      })
      if (!transcribeRes.ok) {
        const txt = await transcribeRes.text()
        return NextResponse.json({ error: `Transcribe failed: ${txt.slice(0, 200)}` }, { status: 500 })
      }
      const { words, duration }: { words: Word[]; duration: number } = await transcribeRes.json()
      for (const w of words) {
        if (w.word) allWords.push({ word: w.word, start: w.start + totalDuration, end: w.end + totalDuration })
      }
      totalDuration += duration
    }

    return NextResponse.json({ audioUrls, words: allWords, duration: totalDuration })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
