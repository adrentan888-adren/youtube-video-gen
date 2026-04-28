import { NextRequest, NextResponse } from 'next/server'

const KIE_KEY = process.env.KIE_AI_API_KEY!

// Ask the LLM to write a vivid image generation prompt for the cover
async function buildCoverPrompt(topic: string, orientation: string): Promise<string> {
  const aspectHint = orientation === 'vertical' ? 'vertical 9:16 TikTok thumbnail' : 'wide 16:9 YouTube thumbnail'
  const res = await fetch('https://api.kie.ai/gpt-5-2/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KIE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-5-2',
      messages: [{
        role: 'user',
        content: `Write a vivid, cinematic image generation prompt (max 60 words) for a ${aspectHint} cover image about: "${topic}". Include style: dramatic lighting, high detail, cinematic, epic. Return ONLY the prompt text, nothing else.`,
      }],
      max_tokens: 120,
      temperature: 0.8,
    }),
  })
  if (!res.ok) throw new Error(`LLM prompt failed: ${(await res.text()).slice(0, 100)}`)
  const raw = await res.json()
  return (raw.data?.choices?.[0]?.message?.content ?? raw.choices?.[0]?.message?.content ?? topic).trim()
}

export async function POST(req: NextRequest) {
  try {
    const { topic, orientation = 'horizontal' }: { topic: string; orientation?: string } = await req.json()
    if (!topic?.trim()) return NextResponse.json({ error: 'topic required' }, { status: 400 })

    // Build a detailed prompt via LLM
    const imagePrompt = await buildCoverPrompt(topic, orientation)

    // Generate via Pollinations.ai (free, no key needed, returns JPEG directly)
    const w = orientation === 'vertical' ? 1024 : 1792
    const h = orientation === 'vertical' ? 1792 : 1024
    const coverUrl =
      `https://image.pollinations.ai/prompt/${encodeURIComponent(imagePrompt)}` +
      `?width=${w}&height=${h}&model=flux&nologo=true&seed=${Math.floor(Math.random() * 99999)}`

    // Verify the image is accessible
    const check = await fetch(coverUrl, { method: 'HEAD' })
    if (!check.ok) throw new Error(`Image generation failed: HTTP ${check.status}`)

    return NextResponse.json({ coverUrl, imagePrompt })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
