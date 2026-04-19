const express = require('express')
const { spawn } = require('child_process')
const fs = require('fs').promises
const fsSync = require('fs')
const path = require('path')
const https = require('https')
const http = require('http')
const crypto = require('crypto')

const app = express()
app.use(express.json({ limit: '4mb' }))

const jobs = new Map()
const WORK_DIR = process.env.WORK_DIR || '/tmp/ffmpeg-jobs'
fsSync.mkdirSync(WORK_DIR, { recursive: true })

// ── Helpers ───────────────────────────────────────────────────────────────────

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fsSync.createWriteStream(dest)
    const client = url.startsWith('https') ? https : http
    const req = client.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close()
        return downloadFile(res.headers.location, dest).then(resolve).catch(reject)
      }
      res.pipe(file)
      file.on('finish', () => { file.close(); resolve() })
    })
    req.on('error', (err) => { fsSync.unlink(dest, () => {}); reject(err) })
  })
}

function toAssTime(sec) {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  const cs = Math.round((s - Math.floor(s)) * 100)
  return `${h}:${String(Math.floor(m)).padStart(2, '0')}:${String(Math.floor(s)).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
}

function generateAss(segments, clipDuration, isVertical) {
  const W = isVertical ? 720 : 1280
  const H = isVertical ? 1280 : 720
  const fontSize = isVertical ? 42 : 36
  const marginV = isVertical ? 110 : 80
  const WORDS_PER_SEC = 2.2
  const CHUNK = 6

  // ASS header — TikTok-style: bold white text, semi-transparent dark box
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Liberation Sans,${fontSize},&H00FFFFFF,&H000000FF,&H00000000,&H99000000,-1,0,0,0,100,100,1,0,3,12,0,2,40,40,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`

  const sorted = [...segments].sort((a, b) => a.segmentIndex - b.segmentIndex)
  const lines = []

  // Time captions as a continuous stream matching the single TTS audio track.
  // Do NOT restart timing per segment — that causes drift vs the voice.
  let globalWordOffset = 0

  for (const seg of sorted) {
    const words = seg.narration.trim().split(/\s+/)
    let offset = 0

    while (offset < words.length) {
      const chunk = words.slice(offset, offset + CHUNK)
      const start = (globalWordOffset + offset) / WORDS_PER_SEC
      const dur = Math.max(0.2, chunk.length / WORDS_PER_SEC)

      lines.push(
        `Dialogue: 0,${toAssTime(start)},${toAssTime(start + dur)},Default,,0,0,0,,${chunk.join(' ')}`
      )
      offset += CHUNK
    }

    globalWordOffset += words.length
  }

  return header + '\n' + lines.join('\n') + '\n'
}

// ── Video processing ──────────────────────────────────────────────────────────

async function processVideo(jobId, { imageUrls, audioUrls, wordCounts, segments, clipDuration, orientation }) {
  const jobDir = path.join(WORK_DIR, jobId)
  await fs.mkdir(jobDir, { recursive: true })

  const isVertical = orientation === 'vertical'
  const W = isVertical ? 720 : 1280
  const H = isVertical ? 1280 : 720
  const WORDS_PER_SEC = 2.2

  // 1. Download images (batches of 10)
  jobs.set(jobId, { status: 'processing', progress: `Downloading ${imageUrls.length} images…` })
  const imagePaths = new Array(imageUrls.length)
  for (let i = 0; i < imageUrls.length; i += 10) {
    await Promise.all(
      imageUrls.slice(i, i + 10).map(async (url, bi) => {
        const idx = i + bi
        const dest = path.join(jobDir, `img_${String(idx).padStart(4, '0')}.jpg`)
        await downloadFile(url, dest)
        imagePaths[idx] = dest
      })
    )
  }

  // 2. Download audio files
  jobs.set(jobId, { status: 'processing', progress: 'Downloading audio…' })
  const audioPaths = []
  for (let i = 0; i < audioUrls.length; i++) {
    const dest = path.join(jobDir, `audio_${i}.mp3`)
    await downloadFile(audioUrls[i], dest)
    audioPaths.push(dest)
  }

  // 3. Generate ASS subtitles
  jobs.set(jobId, { status: 'processing', progress: 'Generating captions…' })
  const assContent = generateAss(segments, clipDuration, isVertical)
  const assPath = path.join(jobDir, 'captions.ass')
  await fs.writeFile(assPath, assContent, 'utf8')

  // 4. Write image concat list
  const concatLines = imagePaths.flatMap((p) => [`file '${p}'`, `duration ${clipDuration}`])
  concatLines.push(`file '${imagePaths[imagePaths.length - 1]}'`) // ffmpeg concat needs final entry
  const concatPath = path.join(jobDir, 'images.txt')
  await fs.writeFile(concatPath, concatLines.join('\n'), 'utf8')

  // 5. Run FFmpeg
  jobs.set(jobId, { status: 'processing', progress: 'Rendering video with FFmpeg…' })
  const outputPath = path.join(jobDir, 'output.mp4')

  // Escape ASS path for ffmpeg subtitles filter (Linux path, escape colons & quotes)
  const escapedAss = assPath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'")

  const videoFilter = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=25`
  const subFilter = `subtitles='${escapedAss}'`

  const args = ['-y', '-f', 'concat', '-safe', '0', '-i', concatPath]
  audioPaths.forEach((ap) => args.push('-i', ap))

  let filterComplex, mapArgs
  if (audioPaths.length === 1) {
    filterComplex = `[0:v]${videoFilter}[vs];[vs]${subFilter}[vout]`
    mapArgs = ['-map', '[vout]', '-map', '1:a']
  } else {
    // Chain multiple audio chunks with offsets
    const audioInputs = audioPaths.map((_, i) => `[${i + 1}:a]`).join('')
    const audioConcat = `${audioInputs}concat=n=${audioPaths.length}:v=0:a=1[aout]`
    filterComplex = `[0:v]${videoFilter}[vs];[vs]${subFilter}[vout];${audioConcat}`
    mapArgs = ['-map', '[vout]', '-map', '[aout]']
  }

  args.push('-filter_complex', filterComplex, ...mapArgs)
  args.push(
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
    '-c:a', 'aac', '-b:a', '128k',
    '-movflags', '+faststart',
    outputPath
  )

  await new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', args)
    let stderr = ''
    ff.stderr.on('data', (d) => { stderr += d.toString() })
    ff.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`FFmpeg exit ${code}: ${stderr.slice(-600)}`))
    })
  })

  jobs.set(jobId, { status: 'done', outputPath })
}

// ── Routes ────────────────────────────────────────────────────────────────────

app.post('/render', (req, res) => {
  const jobId = crypto.randomUUID()
  jobs.set(jobId, { status: 'queued' })
  processVideo(jobId, req.body).catch((err) => {
    console.error(`[${jobId}] failed:`, err.message)
    jobs.set(jobId, { status: 'failed', error: err.message })
  })
  res.json({ jobId })
})

app.get('/status/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId)
  if (!job) return res.status(404).json({ error: 'Job not found' })
  if (job.status === 'done') {
    const base = `${req.protocol}://${req.headers.host}`
    return res.json({ status: 'done', videoUrl: `${base}/video/${req.params.jobId}` })
  }
  res.json({ status: job.status, progress: job.progress, error: job.error })
})

app.get('/video/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId)
  if (!job || job.status !== 'done' || !job.outputPath) {
    return res.status(404).json({ error: 'Video not ready' })
  }
  res.setHeader('Content-Type', 'video/mp4')
  res.setHeader('Content-Disposition', 'attachment; filename="video.mp4"')
  fsSync.createReadStream(job.outputPath).pipe(res)
})

app.get('/health', (_, res) => res.json({ ok: true }))

const PORT = process.env.PORT || 3001
app.listen(PORT, () => console.log(`FFmpeg server on port ${PORT}`))
