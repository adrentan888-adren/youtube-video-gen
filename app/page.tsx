'use client'

import { useState, useCallback, useRef } from 'react'
import type { Script, ImageTask, ImageResult } from '@/lib/types'

type StepStatus = 'idle' | 'running' | 'done' | 'error'

interface Step {
  id: string
  label: string
  sublabel: string
  status: StepStatus
  message?: string
}

const STEP_ICONS: Record<string, string> = {
  script: '✦',
  audio: '◈',
  images: '⬡',
  video: '▶',
}

function StepRow({ step, index }: { step: Step; index: number }) {
  const isActive = step.status === 'running'
  const isDone = step.status === 'done'
  const isError = step.status === 'error'
  const isIdle = step.status === 'idle'

  return (
    <div
      className={`fade-in flex items-start gap-4 p-4 rounded-xl transition-all duration-300 ${
        isActive ? 'glass shimmer border-purple-500/30' : 'glass'
      } ${isDone ? 'border-purple-500/20' : ''} ${isError ? 'border-red-500/30' : ''}`}
      style={{ animationDelay: `${index * 80}ms` }}
    >
      {/* Icon */}
      <div
        className={`mt-0.5 w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 text-sm font-bold transition-all duration-300 ${
          isDone
            ? 'bg-purple-500/20 text-purple-300'
            : isActive
            ? 'bg-purple-500/30 text-purple-200'
            : isError
            ? 'bg-red-500/20 text-red-300'
            : 'bg-white/5 text-white/30'
        }`}
      >
        {isActive ? (
          <div className="ring-spinner" />
        ) : isDone ? (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        ) : isError ? (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <span className="font-mono text-xs">{String(index + 1).padStart(2, '0')}</span>
        )}
      </div>

      {/* Text */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={`text-sm font-semibold ${
              isDone ? 'text-purple-200' : isActive ? 'text-white' : isError ? 'text-red-300' : 'text-white/40'
            }`}
          >
            {step.label}
          </span>
          <span className="text-white/20 text-xs">{STEP_ICONS[step.id]}</span>
        </div>
        <p className={`text-xs mt-0.5 ${isIdle ? 'text-white/20' : 'text-white/50'}`}>
          {step.message ?? step.sublabel}
        </p>
      </div>
    </div>
  )
}

const INITIAL_STEPS: Step[] = [
  { id: 'script', label: 'Script', sublabel: 'GPT-5.2 generates 20-segment script', status: 'idle' },
  { id: 'audio', label: 'Narration', sublabel: 'ElevenLabs TTS creates voiceover', status: 'idle' },
  { id: 'images', label: 'Visuals', sublabel: 'GPT-4o generates 20 HD images', status: 'idle' },
  { id: 'video', label: 'Video', sublabel: 'Shotstack assembles with stylish captions', status: 'idle' },
]

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export default function Home() {
  const [topic, setTopic] = useState('')
  const [steps, setSteps] = useState<Step[]>(INITIAL_STEPS)
  const [running, setRunning] = useState(false)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [videoTitle, setVideoTitle] = useState('')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const abortRef = useRef(false)

  const setStep = useCallback((id: string, patch: Partial<Step>) => {
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  }, [])

  const reset = () => {
    abortRef.current = false
    setSteps(INITIAL_STEPS)
    setVideoUrl(null)
    setVideoTitle('')
    setErrorMsg(null)
  }

  const generate = async () => {
    if (!topic.trim() || running) return
    reset()
    setRunning(true)

    try {
      // ── STEP 1: Script ─────────────────────────────────────────────
      setStep('script', { status: 'running', message: 'Calling GPT-5.2…' })

      const scriptRes = await fetch('/api/generate-script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic }),
      })
      if (!scriptRes.ok) throw new Error(`Script: ${(await scriptRes.json()).error}`)
      const script: Script = await scriptRes.json()
      setVideoTitle(script.title)
      setStep('script', { status: 'done', message: `"${script.title}" — ${script.segments.length} segments` })

      // ── STEP 2: Audio ──────────────────────────────────────────────
      setStep('audio', { status: 'running', message: 'Submitting TTS job…' })

      const audioSubRes = await fetch('/api/submit-audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ narration: script.fullNarration }),
      })
      if (!audioSubRes.ok) throw new Error(`Audio submit: ${(await audioSubRes.json()).error}`)
      const { taskId: audioTaskId } = await audioSubRes.json()

      let audioUrl = ''
      for (let i = 0; i < 24; i++) {
        await sleep(8000)
        setStep('audio', { message: `Generating voiceover… (${(i + 1) * 8}s)` })
        const checkRes = await fetch(`/api/check-audio?taskId=${audioTaskId}`)
        if (!checkRes.ok) throw new Error('Audio check failed')
        const { status, audioUrl: url } = await checkRes.json()
        if (status === 'done' && url) { audioUrl = url; break }
        if (status === 'failed') throw new Error('TTS generation failed')
      }
      if (!audioUrl) throw new Error('Audio timed out after 3 min')
      setStep('audio', { status: 'done', message: 'Voiceover ready' })

      // ── STEP 3: Images ─────────────────────────────────────────────
      setStep('images', { status: 'running', message: 'Submitting 20 image jobs…' })

      const imgSubRes = await fetch('/api/submit-images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ segments: script.segments }),
      })
      if (!imgSubRes.ok) throw new Error(`Image submit: ${(await imgSubRes.json()).error}`)
      const { tasks }: { tasks: ImageTask[] } = await imgSubRes.json()

      setStep('images', { message: 'Waiting 90s for image generation…' })
      await sleep(90000)

      let imageResults: ImageResult[] = []
      let pendingTasks = [...tasks]

      for (let attempt = 0; attempt < 12; attempt++) {
        const checkRes = await fetch('/api/check-images', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tasks: pendingTasks }),
        })
        if (!checkRes.ok) throw new Error('Image check failed')
        const { completed, pending }: { completed: ImageResult[]; pending: ImageTask[] } = await checkRes.json()
        imageResults = [...imageResults, ...completed]
        pendingTasks = pending
        setStep('images', { message: `${imageResults.length} / 20 images ready…` })
        if (pending.length === 0) break
        await sleep(15000)
      }
      if (imageResults.length < 20) throw new Error(`Only ${imageResults.length}/20 images completed`)
      setStep('images', { status: 'done', message: '20 HD visuals generated' })

      // ── STEP 4: Render ─────────────────────────────────────────────
      setStep('video', { status: 'running', message: 'Submitting Shotstack render…' })

      const renderRes = await fetch('/api/render-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          segments: script.segments,
          imageResults,
          audioUrl,
          title: script.title,
        }),
      })
      if (!renderRes.ok) throw new Error(`Render submit: ${(await renderRes.json()).error}`)
      const { renderId } = await renderRes.json()

      setStep('video', { message: 'Rendering 10-min HD video with captions…' })
      await sleep(60000)

      let finalVideoUrl = ''
      for (let i = 0; i < 20; i++) {
        const checkRes = await fetch(`/api/check-render?renderId=${renderId}`)
        if (!checkRes.ok) throw new Error('Render check failed')
        const { status, videoUrl: url, error } = await checkRes.json()
        if (status === 'done' && url) { finalVideoUrl = url; break }
        if (status === 'failed') throw new Error(`Render failed: ${error}`)
        setStep('video', { message: `Rendering… (~${60 + (i + 1) * 15}s elapsed)` })
        await sleep(15000)
      }
      if (!finalVideoUrl) throw new Error('Render timed out')

      setStep('video', { status: 'done', message: 'Video ready!' })
      setVideoUrl(finalVideoUrl)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setErrorMsg(msg)
      setSteps((prev) => prev.map((s) => (s.status === 'running' ? { ...s, status: 'error', message: msg } : s)))
    } finally {
      setRunning(false)
    }
  }

  const allDone = videoUrl !== null

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4 py-16 relative overflow-hidden">
      {/* Background glow orbs */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 -left-40 w-96 h-96 bg-purple-600/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-purple-900/5 rounded-full blur-3xl" />
      </div>

      <div className="w-full max-w-2xl relative z-10 space-y-8">
        {/* Header */}
        <div className="text-center space-y-3">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full glass text-xs text-purple-300 font-medium mb-2">
            <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
            AI YouTube Video Generator
          </div>
          <h1 className="text-4xl sm:text-5xl font-black tracking-tight" style={{ fontFamily: 'Syne, sans-serif' }}>
            <span className="gradient-text">Turn Any Topic</span>
            <br />
            <span className="text-white">Into a Video</span>
          </h1>
          <p className="text-white/40 text-sm max-w-md mx-auto leading-relaxed">
            Script · Voiceover · 20 AI visuals · Stylish captions — assembled into a 10-minute HD video
          </p>
        </div>

        {/* Input */}
        <div className="glass rounded-2xl p-1.5">
          <div className="flex gap-2">
            <input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !running && generate()}
              placeholder="Enter your topic… e.g. why you feel tired everyday"
              disabled={running}
              className="flex-1 bg-transparent px-4 py-3.5 text-sm text-white placeholder-white/25 outline-none disabled:opacity-50"
            />
            <button
              onClick={running ? undefined : generate}
              disabled={!topic.trim() || running}
              className={`px-6 py-3 rounded-xl text-sm font-semibold transition-all duration-200 flex-shrink-0 ${
                !topic.trim() || running
                  ? 'bg-white/5 text-white/20 cursor-not-allowed'
                  : 'bg-gradient-to-r from-purple-500 to-blue-500 text-white hover:from-purple-400 hover:to-blue-400 hover:shadow-lg hover:shadow-purple-500/20 active:scale-95'
              }`}
            >
              {running ? (
                <span className="flex items-center gap-2">
                  <div className="ring-spinner" />
                  Generating
                </span>
              ) : (
                'Generate ↗'
              )}
            </button>
          </div>
        </div>

        {/* Steps */}
        {(running || allDone || errorMsg) && (
          <div className="space-y-2 fade-in">
            {steps.map((step, i) => (
              <StepRow key={step.id} step={step} index={i} />
            ))}
          </div>
        )}

        {/* Video result */}
        {allDone && videoUrl && (
          <div className="glass rounded-2xl p-6 space-y-4 fade-in border-purple-500/20">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white font-semibold text-sm leading-tight">{videoTitle}</p>
                <p className="text-white/40 text-xs mt-1">10 min · HD 1280×720 · Stylish captions</p>
              </div>
            </div>

            <div className="space-y-2">
              <a
                href={videoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-gradient-to-r from-purple-500 to-blue-500 text-white text-sm font-semibold hover:from-purple-400 hover:to-blue-400 transition-all hover:shadow-lg hover:shadow-purple-500/20"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Download Video
              </a>
              <button
                onClick={() => { reset(); setTopic('') }}
                className="w-full py-3 rounded-xl glass text-white/50 text-sm hover:text-white/80 transition-colors"
              >
                Generate Another
              </button>
            </div>

            <p className="text-white/20 text-xs text-center break-all">{videoUrl}</p>
          </div>
        )}

        {/* Footer */}
        <p className="text-center text-white/15 text-xs">
          Powered by kie.ai · ElevenLabs · GPT-4o · Shotstack
        </p>
      </div>
    </main>
  )
}
