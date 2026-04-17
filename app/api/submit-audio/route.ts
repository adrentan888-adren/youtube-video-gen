import { NextRequest, NextResponse } from 'next/server'

const KIE_KEY = process.env.KIE_AI_API_KEY!

export async function POST(req: NextRequest) {
  const { narration, voice = 'Rachel' } = await req.json()

  const res = await fetch('https://api.kie.ai/api/v1/jobs/createTask', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KIE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'elevenlabs/text-to-speech-turbo-2-5',
      input: { text: narration, voice, speed: 1.0 },
    }),
  })

  if (!res.ok) {
    const txt = await res.text()
    return NextResponse.json({ error: `TTS submit failed: ${txt.slice(0, 200)}` }, { status: 500 })
  }

  const data = await res.json()
  const taskId = data.data?.taskId

  if (!taskId) return NextResponse.json({ error: 'No taskId from TTS' }, { status: 500 })

  return NextResponse.json({ taskId })
}
