import { NextRequest, NextResponse } from 'next/server'

const KIE_KEY = process.env.KIE_AI_API_KEY!

type Word = { word: string; start: number; end: number }

export async function POST(req: NextRequest) {
  try {
    const { words, duration, imageInterval }: { words: Word[]; duration: number; imageInterval: number } = await req.json()

    const numImages = Math.ceil(duration / imageInterval)

    // Build transcript text for each time window
    const windows = Array.from({ length: numImages }, (_, i) => {
      const start = i * imageInterval
      const end = Math.min((i + 1) * imageInterval, duration)
      const text = words
        .filter((w) => w.start >= start && w.start < end)
        .map((w) => w.word)
        .join(' ')
        .trim()
      return { index: i, start, end, text }
    })

    const prompt = `You are given ${numImages} transcript segments from a narration video. Each segment is ${imageInterval} seconds long. For each segment, provide a short (3-5 words) stock photo search keyword that best represents what is visually happening or being described.

Segments:
${windows.map((w) => `${w.index + 1}. [${w.start.toFixed(0)}s-${w.end.toFixed(0)}s]: "${w.text || '(no speech)'}"`).join('\n')}

Respond with ONLY a JSON array of ${numImages} keyword strings, one per segment:
["keyword 1", "keyword 2", ...]`

    const res = await fetch('https://api.kie.ai/gpt-5-2/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${KIE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-5-2',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.4,
        max_tokens: 500,
      }),
    })

    if (!res.ok) {
      const txt = await res.text()
      return NextResponse.json({ error: `LLM keyword error: ${txt.slice(0, 200)}` }, { status: 500 })
    }

    const raw = await res.json()
    const content: string = raw.data?.choices?.[0]?.message?.content ?? raw.choices?.[0]?.message?.content ?? ''

    const match = content.match(/\[[\s\S]*\]/)
    if (!match) return NextResponse.json({ error: `Could not parse keywords from: ${content.slice(0, 200)}` }, { status: 500 })

    const keywords: string[] = JSON.parse(match[0])
    return NextResponse.json({ keywords })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
