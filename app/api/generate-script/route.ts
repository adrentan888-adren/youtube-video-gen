import { NextRequest, NextResponse } from 'next/server'
import type { Script, Segment } from '@/lib/types'

// Extracts the first complete JSON array or object from a string using bracket counting
function extractJSON(content: string): unknown | null {
  for (let si = 0; si < content.length; si++) {
    const open = content[si]
    if (open !== '[' && open !== '{') continue
    const close = open === '[' ? ']' : '}'
    let depth = 0, inStr = false, esc = false
    for (let ei = si; ei < content.length; ei++) {
      const ch = content[ei]
      if (esc) { esc = false; continue }
      if (ch === '\\' && inStr) { esc = true; continue }
      if (ch === '"') { inStr = !inStr; continue }
      if (!inStr) {
        if (ch === open) depth++
        else if (ch === close) { depth--; if (depth === 0) { try { return JSON.parse(content.slice(si, ei + 1)) } catch { break } } }
      }
    }
  }
  return null
}

const KIE_KEY = process.env.KIE_AI_API_KEY!
const BATCH_SIZE = 60

async function generateBatch(
  topic: string,
  wordsPerSegment: number,
  batchStart: number,
  batchCount: number,
  totalSegments: number
): Promise<Segment[]> {
  const isFirstBatch = batchStart === 0
  const hookInstruction = isFirstBatch
    ? 'Segment 1 MUST be a very catchy 3-second hook that immediately grabs attention.'
    : `These are segments ${batchStart + 1}–${batchStart + batchCount} of ${totalSegments}. Continue the story naturally from where segment ${batchStart} left off.`

  const prompt = `You are a very experienced social media script creator, create script for this topic: "${topic}", you need to create a very catchy 3 seconds hook for the script, and also make the whole script very interesting so that the audience will continue listening, and also get good takeaway at the same time until the end.

${hookInstruction}

STRICT RULES:
- Exactly ${batchCount} segments numbered from ${batchStart + 1} to ${batchStart + batchCount}
- narration: ${wordsPerSegment} words MAXIMUM per segment (no exceptions)
- image_prompt: 10-12 words MAXIMUM (short scene description only)
- section_title: 3-5 words MAXIMUM (catchy chapter heading)

Respond with ONLY this JSON array, no extra text:
[{"segment_number":${batchStart + 1},"section_title":"S","narration":"N","image_prompt":"P"}]`

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
    throw new Error(`kie.ai error (batch ${batchStart}): ${txt.slice(0, 200)}`)
  }

  const raw = await res.json()
  const content: string = raw.data?.choices?.[0]?.message?.content ?? raw.choices?.[0]?.message?.content ?? ''

  const parsed = extractJSON(content)
  if (!parsed) throw new Error(`Could not parse batch JSON (batch starting at ${batchStart + 1})`)
  const parsedSegments: Array<{ segment_number: number; section_title: string; narration: string; image_prompt: string }> =
    Array.isArray(parsed) ? parsed : (parsed as { segments?: [] }).segments ?? []
  if (!parsedSegments.length) throw new Error(`Empty segments in batch starting at ${batchStart + 1}`)

  return parsedSegments.map((s, i: number) => ({
    segmentIndex: batchStart + i,
    segmentNumber: s.segment_number,
    sectionTitle: s.section_title,
    narration: s.narration,
    imagePrompt: s.image_prompt,
  }))
}

export async function POST(req: NextRequest) {
  try {
    const { topic, segmentCount = 20, wordsPerSegment = 65 } = await req.json()
    if (!topic?.trim()) return NextResponse.json({ error: 'topic required' }, { status: 400 })

    // Build title from first batch, generate all batches sequentially
    let allSegments: Segment[] = []
    let title = topic
    let description = ''

    if (segmentCount <= BATCH_SIZE) {
      // Single batch — use full JSON with title/description
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
        headers: { Authorization: `Bearer ${KIE_KEY}`, 'Content-Type': 'application/json' },
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
      const parsed = extractJSON(content) as { title?: string; description?: string; segments?: [] } | null
      if (!parsed) return NextResponse.json({ error: 'Could not parse script JSON' }, { status: 500 })
      title = parsed.title
      description = parsed.description
      allSegments = parsed.segments.map((s: { segment_number: number; section_title: string; narration: string; image_prompt: string }, i: number) => ({
        segmentIndex: i,
        segmentNumber: s.segment_number,
        sectionTitle: s.section_title,
        narration: s.narration,
        imagePrompt: s.image_prompt,
      }))
    } else {
      // Multi-batch: generate in chunks of BATCH_SIZE sequentially
      for (let start = 0; start < segmentCount; start += BATCH_SIZE) {
        const count = Math.min(BATCH_SIZE, segmentCount - start)
        const batch = await generateBatch(topic, wordsPerSegment, start, count, segmentCount)
        allSegments = [...allSegments, ...batch]
      }
      // Use topic as title for multi-batch
      title = topic.replace(/\b\w/g, (c: string) => c.toUpperCase())
      description = `A ${Math.round((segmentCount * wordsPerSegment) / 130)}-minute video about ${topic}`
    }

    const fullNarration = allSegments.map((s) => s.narration).join(' ')

    const script: Script = { title, description, fullNarration, segments: allSegments }
    return NextResponse.json(script)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
