import { NextRequest, NextResponse } from 'next/server'
import type { Script } from '@/lib/types'

const KIE_KEY = process.env.KIE_AI_API_KEY!

export async function POST(req: NextRequest) {
  const { topic, segmentCount = 20, wordsPerSegment = 65 } = await req.json()
  if (!topic?.trim()) return NextResponse.json({ error: 'topic required' }, { status: 400 })

  const totalMinutes = Math.round((segmentCount * wordsPerSegment) / 130)

  const prompt = `You are a very experienced social media script creator, create script for this topic: "${topic}", you need to create a very catchy 3 seconds hook for the script, and also make the whole script very interesting so that the audience will continue listening, and also get good takeaway at the same time until the end.

STRICT RULES:
- Exactly ${segmentCount} segments
- narration: ${wordsPerSegment} words MAXIMUM per segment (no exceptions)
- image_prompt: 10-12 words MAXIMUM (short scene description only)
- section_title: 3-5 words MAXIMUM (catchy chapter heading)

Respond with ONLY this JSON structure, no extra text:
{"title":"T","description":"D","segments":[{"segment_number":1,"section_title":"S","narration":"N","image_prompt":"P"}]}`

  const res = await fetch('https://api.kie.ai/gpt-5-2/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KIE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-5-2',
      messages: [
        { role: 'system', content: 'You are a very experienced social media script creator.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.7,
      max_tokens: 8000,
    }),
  })

  if (!res.ok) {
    const txt = await res.text()
    return NextResponse.json({ error: `kie.ai error: ${txt.slice(0, 200)}` }, { status: 500 })
  }

  const raw = await res.json()
  const content: string = raw.data?.choices?.[0]?.message?.content ?? raw.choices?.[0]?.message?.content ?? ''

  const jsonMatch = content.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return NextResponse.json({ error: 'Could not parse script JSON' }, { status: 500 })

  const parsed = JSON.parse(jsonMatch[0])

  const segments = parsed.segments.map((s: { segment_number: number; section_title: string; narration: string; image_prompt: string }, i: number) => ({
    segmentIndex: i,
    segmentNumber: s.segment_number,
    sectionTitle: s.section_title,
    narration: s.narration,
    imagePrompt: s.image_prompt,
  }))

  const fullNarration = segments.map((s: { narration: string }) => s.narration).join(' ')

  const script: Script = {
    title: parsed.title,
    description: parsed.description,
    fullNarration,
    segments,
  }

  return NextResponse.json(script)
}
