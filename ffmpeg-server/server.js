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

function getAudioDuration(audioPath) {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_streams', audioPath])
    let out = ''
    ff.stdout.on('data', (d) => { out += d.toString() })
    ff.on('close', (code) => {
      if (code !== 0) return reject(new Error('ffprobe failed'))
      try {
        const data = JSON.parse(out)
        const dur = parseFloat(data.streams[0].duration)
        resolve(isNaN(dur) ? 0 : dur)
      } catch (e) { reject(e) }
    })
  })
}

// Run faster-whisper on an audio file, return [{word, start, end}]
function transcribeAudio(audioPath) {
  return new Promise((resolve, reject) => {
    const py = spawn('python3', [path.join(__dirname, 'transcribe.py'), audioPath])
    let out = '', err = ''
    py.stdout.on('data', (d) => { out += d.toString() })
    py.stderr.on('data', (d) => { err += d.toString() })
    py.on('close', (code) => {
      if (code !== 0) return reject(new Error(`Whisper failed: ${err.slice(-400)}`))
      try { resolve(JSON.parse(out)) }
      catch (e) { reject(new Error(`Whisper output parse failed: ${out.slice(0, 200)}`)) }
    })
  })
}

function toSrtTime(sec) {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  const ms = Math.round((sec - Math.floor(sec)) * 1000)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`
}

// Group words into 6-word chunks and produce SRT content
function wordsToSrt(allWords) {
  const CHUNK = 6
  const lines = []
  let idx = 1
  for (let i = 0; i < allWords.length; i += CHUNK) {
    const chunk = allWords.slice(i, i + CHUNK)
    if (!chunk.length) continue
    const start = chunk[0].start
    const end = chunk[chunk.length - 1].end
    lines.push(String(idx))
    lines.push(`${toSrtTime(start)} --> ${toSrtTime(Math.max(end, start + 0.2))}`)
    lines.push(chunk.map((w) => w.word).join(' ').trim())
    lines.push('')
    idx++
  }
  return lines.join('\n')
}

// ── Video processing ──────────────────────────────────────────────────────────

async function processVideo(jobId, { imageUrls, audioUrls, wordCounts, segments, clipDuration, orientation }) {
  const jobDir = path.join(WORK_DIR, jobId)
  await fs.mkdir(jobDir, { recursive: true })

  const isVertical = orientation === 'vertical'
  const W = isVertical ? 720 : 1280
  const H = isVertical ? 1280 : 720
  const fontSize = isVertical ? 42 : 36
  const marginV = isVertical ? 110 : 80

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

  // 3. Transcribe each audio chunk with Whisper → exact word timestamps → SRT
  jobs.set(jobId, { status: 'processing', progress: 'Transcribing audio for captions…' })
  const audioDurations = await Promise.all(audioPaths.map(getAudioDuration))

  const allWords = []
  let timeOffset = 0
  for (let i = 0; i < audioPaths.length; i++) {
    const words = await transcribeAudio(audioPaths[i])
    for (const w of words) {
      if (w.word) allWords.push({ word: w.word, start: w.start + timeOffset, end: w.end + timeOffset })
    }
    timeOffset += audioDurations[i]
  }

  const srtContent = wordsToSrt(allWords)
  const srtPath = path.join(jobDir, 'captions.srt')
  await fs.writeFile(srtPath, srtContent, 'utf8')

  // 4. Write image concat list
  const concatLines = imagePaths.flatMap((p) => [`file '${p}'`, `duration ${clipDuration}`])
  concatLines.push(`file '${imagePaths[imagePaths.length - 1]}'`)
  const concatPath = path.join(jobDir, 'images.txt')
  await fs.writeFile(concatPath, concatLines.join('\n'), 'utf8')

  // 5. Run FFmpeg with SRT subtitles (force_style gives TikTok-style appearance)
  jobs.set(jobId, { status: 'processing', progress: 'Rendering video with FFmpeg…' })
  const outputPath = path.join(jobDir, 'output.mp4')

  const escapedSrt = srtPath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'")
  const videoFilter = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=25`
  const subStyle = `FontName=Liberation Sans,FontSize=${fontSize},Bold=1,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BackColour=&H99000000,BorderStyle=3,Outline=12,Alignment=2,MarginV=${marginV}`
  const subFilter = `subtitles='${escapedSrt}':force_style='${subStyle}'`

  const args = ['-y', '-f', 'concat', '-safe', '0', '-i', concatPath]
  audioPaths.forEach((ap) => args.push('-i', ap))

  let filterComplex, mapArgs
  if (audioPaths.length === 1) {
    filterComplex = `[0:v]${videoFilter}[vs];[vs]${subFilter}[vout]`
    mapArgs = ['-map', '[vout]', '-map', '1:a']
  } else {
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

  jobs.set(jobId, { status: 'done', outputPath, srtPath })
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

app.get('/srt/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId)
  if (!job || !job.srtPath) return res.status(404).json({ error: 'SRT not found' })
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="captions.srt"`)
  fsSync.createReadStream(job.srtPath).pipe(res)
})

app.get('/health', (_, res) => res.json({ ok: true }))

const PORT = process.env.PORT || 3001
app.listen(PORT, () => console.log(`FFmpeg server on port ${PORT}`))
