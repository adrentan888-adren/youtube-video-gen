'use client'

import { useState, useCallback } from 'react'
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

// Duration options: [label, totalSeconds]
const DURATION_OPTIONS: [string, number][] = [
  ['3 min', 180],
  ['5 min', 300],
  ['10 min', 600],
  ['15 min', 900],
  ['20 min', 1200],
]

// Interval options: [label, seconds]
const INTERVAL_OPTIONS: [string, number][] = [
  ['15s', 15],
  ['20s', 20],
  ['30s', 30],
  ['45s', 45],
  ['60s', 60],
]

// Approx words per second of narration (~130 wpm)
const WORDS_PER_SEC = 2.2

function PillGroup<T>({
  options,
  value,
  onChange,
  disabled,
}: {
  options: [string, T][]
  value: T
  onChange: (v: T) => void
  disabled?: boolean
}) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {options.map(([label, val]) => (
        <button
          key={label}
          type="button"
          disabled={disabled}
          onClick={() => onChange(val)}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 ${
            value === val
              ? 'bg-purple-500/30 text-purple-200 border border-purple-500/50'
              : 'bg-white/5 text-white/40 border border-transparent hover:bg-white/10 hover:text-white/60'
          } disabled:cursor-not-allowed disabled:opacity-40`}
        >
          {label}
        </button>
      ))}
    </div>
  )
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
  { id: 'script', label: 'Script', sublabel: 'GPT-5.2 generates script', status: 'idle' },
  { id: 'audio', label: 'Narration', sublabel: 'ElevenLabs TTS creates voiceover', status: 'idle' },
  { id: 'images', label: 'Visuals', sublabel: 'GPT-4o generates HD images', status: 'idle' },
  { id: 'video', label: 'Video', sublabel: 'Shotstack assembles with captions', status: 'idle' },
]

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export default function Home() {
  const [topic, setTopic] = useState('')
  const [totalSeconds, setTotalSeconds] = useState(600)
  const [imageInterval, setImageInterval] = useState(30)
  const [steps, setSteps] = useState<Step[]>(INITIAL_STEPS)
  const [running, setRunning] = useState(false)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [videoTitle, setVideoTitle] = useState('')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const segmentCount = Math.floor(totalSeconds / imageInterval)
  const wordsPerSegment = Math.round(imageInterval * WORDS_PER_SEC)

  const setStep = useCallback((id: string, patch: Partial<Step>) => {
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  }, [])

  const reset = () => {
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
      setStep('script', { status: 'running', message: `Generating ${segmentCount}-segment script…` })

      const scriptRes = await fetch('/api/generate-script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, segmentCount, wordsPerSegment }),
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
      for (let i = 0; i < 30; i++) {
        await sleep(8000)
        setStep('audio', { message: `Generating voiceover… (${(i + 1) * 8}s)` })
        const checkRes = await fetch(`/api/check-audio?taskId=${audioTaskId}`)
        if (!checkRes.ok) throw new Error('Audio check failed')
        const { status, audioUrl: url } = await checkRes.json()
        if (status === 'done' && url) { audioUrl = url; break }
        if (status === 'failed') throw new Error('TTS generation failed')
      }
      if (!audioUrl) throw new Error('Audio timed out')
      setStep('audio', { status: 'done', message: 'Voiceover ready' })

      // ── STEP 3: Images ─────────────────────────────────────────────
      setStep('images', { status: 'running', message: `Submitting ${script.segments.length} image jobs…` })

      const imgSubRes = await fetch('/api/submit-images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ segments: script.segments }),
      })
      if (!imgSubRes.ok) throw new Error(`Image submit: ${(await imgSubRes.json()).error}`)
      const { tasks }: { tasks: ImageTask[] } = await imgSubRes.json()

      const waitSecs = Math.max(60, segmentCount * 5)
      setStep('images', { message: `Waiting ${waitSecs}s for image generation…` })
      await sleep(waitSecs * 1000)

      let imageResults: ImageResult[] = []
      let pendingTasks = [...tasks]

      for (let attempt = 0; attempt < 15; attempt++) {
        const checkRes = await fetch('/api/check-images', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tasks: pendingTasks }),
        })
        if (!checkRes.ok) throw new Error('Image check failed')
        const { completed, pending }: { completed: ImageResult[]; pending: ImageTask[] } = await checkRes.json()
        imageResults = [...imageResults, ...completed]
        pendingTasks = pending
        setStep('images', { message: `${imageResults.length} / ${script.segments.length} images ready…` })
        if (pending.length === 0) break
        await sleep(15000)
      }
      if (imageResults.length < script.segments.length)
        throw new Error(`Only ${imageResults.length}/${script.segments.length} images completed`)
      setStep('images', { status: 'done', message: `${imageResults.length} HD visuals generated` })

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
          clipDuration: imageInterval,
        }),
      })
      if (!renderRes.ok) throw new Error(`Render submit: ${(await renderRes.json()).error}`)
      const { renderId } = await renderRes.json()

      // Rough estimate: ~20s render per minute of output
      const estRenderWait = Math.max(30, Math.floor(totalSeconds / 60) * 20)
      setStep('video', { message: `Rendering ${DURATION_OPTIONS.find(([,s]) => s === totalSeconds)?.[0] ?? ''} video…` })
      await sleep(estRenderWait * 1000)

      let finalVideoUrl = ''
      for (let i = 0; i < 24; i++) {
        const checkRes = await fetch(`/api/check-render?renderId=${renderId}`)
        if (!checkRes.ok) throw new Error('Render check failed')
        const { status, videoUrl: url, error } = await checkRes.json()
        if (status === 'done' && url) { finalVideoUrl = url; break }
        if (status === 'failed') throw new Error(`Render failed: ${error}`)
        setStep('video', { message: `Still rendering… (+${(i + 1) * 15}s)` })
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
  const durationLabel = DURATION_OPTIONS.find(([, s]) => s === totalSeconds)?.[0] ?? ''
  const intervalLabel = INTERVAL_OPTIONS.find(([, s]) => s === imageInterval)?.[0] ?? ''

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4 py-16 relative overflow-hidden">
      {/* Background glow */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 -left-40 w-96 h-96 bg-purple-600/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-purple-900/5 rounded-full blur-3xl" />
      </div>

      <div className="w-full max-w-2xl relative z-10 space-y-6">
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
            Script · Voiceover · AI visuals · Stylish captions — assembled into an HD video
          </p>
        </div>

        {/* Input card */}
        <div className="glass rounded-2xl p-5 space-y-5">
          {/* Topic input */}
          <div className="glass rounded-xl p-1">
            <div className="flex gap-2">
              <input
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !running && generate()}
                placeholder="Enter your topic… e.g. why you feel tired everyday"
                disabled={running}
                className="flex-1 bg-transparent px-4 py-3 text-sm text-white placeholder-white/25 outline-none disabled:opacity-50"
              />
              <button
                onClick={running ? undefined : generate}
                disabled={!topic.trim() || running}
                className={`px-5 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200 flex-shrink-0 ${
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

          {/* Duration + interval selectors */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <p className="text-xs text-white/30 font-medium uppercase tracking-widest">Video Duration</p>
              <PillGroup
                options={DURATION_OPTIONS}
                value={totalSeconds}
                onChange={setTotalSeconds}
                disabled={running}
              />
            </div>
            <div className="space-y-2">
              <p className="text-xs text-white/30 font-medium uppercase tracking-widest">Time Per Image</p>
              <PillGroup
                options={INTERVAL_OPTIONS}
                value={imageInterval}
                onChange={setImageInterval}
                disabled={running}
              />
            </div>
          </div>

          {/* Summary pill */}
          <div className="flex items-center gap-2 text-xs text-white/30">
            <span className="w-1 h-1 rounded-full bg-purple-400/50" />
            <span>
              {segmentCount} images · {durationLabel} total · {intervalLabel} each · ~{wordsPerSegment} words/segment
            </span>
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
                <p className="text-white/40 text-xs mt-1">{durationLabel} · HD 1280×720 · {segmentCount} scenes · Stylish captions</p>
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
