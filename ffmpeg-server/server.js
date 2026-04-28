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

function toAssTime(sec) {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  const cs = Math.round((s - Math.floor(s)) * 100)
  return `${h}:${String(Math.floor(m)).padStart(2, '0')}:${String(Math.floor(s)).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
}

// Karaoke Pop: full 6-word chunk always visible; active word pops orange+larger
function wordsToKaraokeAss(allWords, isVertical) {
  const W = isVertical ? 720 : 1280
  const H = isVertical ? 1280 : 720
  const fs    = isVertical ? 38 : 28   // base font — fits nicely per resolution
  const fsPop = isVertical ? 48 : 36   // active word grows ~25%
  const marginV = isVertical ? 120 : 70
  const CHUNK = 6

  // ASS color: &HAABBGGRR (alpha 00 = opaque)
  const ORANGE = '&H000066FF&'  // #FF6600 warm orange

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Liberation Sans,${fs},&H00FFFFFF,&H000000FF,&H00000000,&HAA000000,-1,0,0,0,100,100,0.5,0,3,10,0,2,40,40,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`

  const lines = []

  for (let i = 0; i < allWords.length; i += CHUNK) {
    const chunk = allWords.slice(i, i + CHUNK)
    if (!chunk.length) continue

    for (let j = 0; j < chunk.length; j++) {
      const tStart = chunk[j].start
      const MAX_WORD_HIGHLIGHT = 0.8  // cap Whisper silence-spanning timestamps for any word
      const rawEnd = j + 1 < chunk.length
        ? chunk[j + 1].start
        : Math.min(chunk[j].end, tStart + MAX_WORD_HIGHLIGHT) + 0.05
      const tEnd = Math.min(rawEnd, tStart + MAX_WORD_HIGHLIGHT + 0.05)

      // Full chunk text: active word gets orange+larger, others use default (white bold)
      let text = ''
      for (let k = 0; k < chunk.length; k++) {
        if (k === j) {
          text += `{\\c${ORANGE}\\fs${fsPop}}${chunk[k].word}{\\r}`
        } else {
          text += chunk[k].word
        }
        if (k < chunk.length - 1) text += ' '
      }

      lines.push(
        `Dialogue: 0,${toAssTime(tStart)},${toAssTime(Math.max(tEnd, tStart + 0.05))},Default,,0,0,0,,${text}`
      )
    }
  }

  return header + '\n' + lines.join('\n') + '\n'
}

// ── Subtitle style catalog (mirrors lib/subtitle-styles.ts) ──────────────────

const STYLES = {
  'tiktok-box': (fs, mv) =>
    `FontName=Liberation Sans,FontSize=${fs},Bold=1,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BackColour=&H99000000,BorderStyle=3,Outline=12,Alignment=2,MarginV=${mv}`,
  'youtube-classic': (fs, mv) =>
    `FontName=Liberation Sans,FontSize=${fs},Bold=0,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=1,Alignment=2,MarginV=${mv}`,
  'netflix': (fs, mv) =>
    `FontName=Liberation Sans,FontSize=${fs},Bold=0,PrimaryColour=&H00FFFFFF,BackColour=&HFF000000,BorderStyle=3,Outline=8,Alignment=2,MarginV=${mv}`,
  'bold-yellow': (fs, mv) =>
    `FontName=Liberation Sans,FontSize=${fs},Bold=1,PrimaryColour=&H0000FFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=3,Shadow=0,Alignment=2,MarginV=${mv}`,
  'minimal': (fs, mv) =>
    `FontName=Liberation Sans,FontSize=${fs},Bold=0,PrimaryColour=&H00FFFFFF,OutlineColour=&H80000000,BorderStyle=1,Outline=1,Shadow=0,Alignment=2,MarginV=${mv}`,
  'top-box': (fs, _mv) =>
    `FontName=Liberation Sans,FontSize=${fs},Bold=1,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BackColour=&H99000000,BorderStyle=3,Outline=12,Alignment=8,MarginV=60`,
}

function resolveStyle(styleId, fontSize, marginV) {
  const fn = STYLES[styleId] ?? STYLES['tiktok-box']
  return fn(fontSize, marginV)
}

// ── Video processing ──────────────────────────────────────────────────────────

async function processVideo(jobId, { imageUrls, audioUrls, words: precomputedWords, clipDuration, orientation, styleId }) {
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

  // 3. Use pre-computed word timestamps if provided; otherwise run Whisper
  const audioDurations = await Promise.all(audioPaths.map(getAudioDuration))
  let allWords = []

  if (precomputedWords && precomputedWords.length > 0) {
    allWords = precomputedWords
  } else {
    jobs.set(jobId, { status: 'processing', progress: 'Transcribing audio for captions…' })
    let timeOffset = 0
    for (let i = 0; i < audioPaths.length; i++) {
      const words = await transcribeAudio(audioPaths[i])
      for (const w of words) {
        if (w.word) allWords.push({ word: w.word, start: w.start + timeOffset, end: w.end + timeOffset })
      }
      timeOffset += audioDurations[i]
    }
  }

  // Karaoke Pop → ASS; all other styles → SRT with force_style
  const useKaraoke = !styleId || styleId === 'karaoke-pop'
  let subFilePath, subFilter

  if (useKaraoke) {
    const assContent = wordsToKaraokeAss(allWords, isVertical)
    subFilePath = path.join(jobDir, 'captions.ass')
    await fs.writeFile(subFilePath, assContent, 'utf8')
  } else {
    const srtLines = []
    let idx = 1
    const CHUNK = 6
    for (let i = 0; i < allWords.length; i += CHUNK) {
      const chunk = allWords.slice(i, i + CHUNK)
      if (!chunk.length) continue
      const s = chunk[0].start, e = chunk[chunk.length - 1].end
      const toSrt = (t) => { const h=Math.floor(t/3600),m=Math.floor((t%3600)/60),sc=Math.floor(t%60),ms=Math.round((t-Math.floor(t))*1000); return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sc).padStart(2,'0')},${String(ms).padStart(3,'0')}` }
      srtLines.push(String(idx), `${toSrt(s)} --> ${toSrt(Math.max(e, s+0.2))}`, chunk.map(w=>w.word).join(' ').trim(), '')
      idx++
    }
    subFilePath = path.join(jobDir, 'captions.srt')
    await fs.writeFile(subFilePath, srtLines.join('\n'), 'utf8')
  }

  jobs.set(jobId, { status: 'processing', progress: 'Rendering Ken Burns clips…', srtPath: subFilePath })

  // 4. Compute per-clip duration
  const totalAudioDuration = audioDurations.reduce((sum, d) => sum + d, 0)
  const effectiveDurSec = totalAudioDuration > 0
    ? totalAudioDuration / imagePaths.length
    : clipDuration
  const effectiveDur = effectiveDurSec.toFixed(4)

  // Ken Burns effect: 6 alternating directions per clip (pan + zoom via scale+crop)
  function kenBurnsVF(idx) {
    const SW = Math.round(W * 1.3)
    const SH = Math.round(H * 1.3)
    const dx = SW - W   // pan range X
    const dy = SH - H   // pan range Y
    const d = effectiveDur
    const base = `scale=${SW}:${SH}:force_original_aspect_ratio=increase`
    const effects = [
      // Pan right
      `${base},crop=${W}:${H}:'${dx}*t/${d}':'${dy}/2',setsar=1,fps=25`,
      // Pan left
      `${base},crop=${W}:${H}:'${dx}*(1-t/${d})':'${dy}/2',setsar=1,fps=25`,
      // Pan down
      `${base},crop=${W}:${H}:'${dx}/2':'${dy}*t/${d}',setsar=1,fps=25`,
      // Pan up
      `${base},crop=${W}:${H}:'${dx}/2':'${dy}*(1-t/${d})',setsar=1,fps=25`,
      // Zoom in: crop shrinks toward center then scale to output
      `${base},crop='${SW}-${dx}*t/${d}':'${SH}-${dy}*t/${d}':'${dx}*t/${d}/2':'${dy}*t/${d}/2',scale=${W}:${H},setsar=1,fps=25`,
      // Zoom out: crop grows from center then scale to output
      `${base},crop='${W}+${dx}*t/${d}':'${H}+${dy}*t/${d}':'${dx}*(1-t/${d})/2':'${dy}*(1-t/${d})/2',scale=${W}:${H},setsar=1,fps=25`,
    ]
    return effects[idx % effects.length]
  }

  // 5. Render each image as a Ken Burns video clip
  const kbClipPaths = []
  for (let i = 0; i < imagePaths.length; i++) {
    jobs.set(jobId, { status: 'processing', progress: `Ken Burns: clip ${i + 1}/${imagePaths.length}…`, srtPath: subFilePath })
    const clipPath = path.join(jobDir, `kb_${String(i).padStart(4, '0')}.mp4`)
    await new Promise((resolve, reject) => {
      const ff = spawn('ffmpeg', [
        '-y', '-loop', '1', '-t', effectiveDur, '-i', imagePaths[i],
        '-vf', kenBurnsVF(i),
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-r', '25', '-an',
        clipPath,
      ])
      let stderr = ''
      ff.stderr.on('data', (d) => { stderr += d.toString() })
      ff.on('close', (code) => code === 0 ? resolve() : reject(new Error(`KB clip ${i} exit ${code}: ${stderr.slice(-400)}`)))
    })
    kbClipPaths.push(clipPath)
  }

  // 6. Pass 1 — concat Ken Burns clips + audio → staging.mp4
  jobs.set(jobId, { status: 'processing', progress: 'Assembling staging video…', srtPath: subFilePath })

  const clipListPath = path.join(jobDir, 'clips.txt')
  await fs.writeFile(clipListPath, kbClipPaths.map((p) => `file '${p}'`).join('\n'), 'utf8')

  const stagingPath = path.join(jobDir, 'staging.mp4')
  const stagingArgs = ['-y', '-f', 'concat', '-safe', '0', '-i', clipListPath]
  audioPaths.forEach((ap) => stagingArgs.push('-i', ap))

  let stagingMap
  if (audioPaths.length === 1) {
    stagingMap = ['-map', '0:v', '-map', '1:a']
  } else {
    const audioInputs = audioPaths.map((_, i) => `[${i + 1}:a]`).join('')
    stagingArgs.push('-filter_complex', `${audioInputs}concat=n=${audioPaths.length}:v=0:a=1[aout]`)
    stagingMap = ['-map', '0:v', '-map', '[aout]']
  }

  stagingArgs.push(...stagingMap, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', stagingPath)

  await new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', stagingArgs)
    let stderr = ''
    ff.stderr.on('data', (d) => { stderr += d.toString() })
    ff.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`FFmpeg staging exit ${code}: ${stderr.slice(-600)}`))
    })
  })

  jobs.set(jobId, { status: 'processing', progress: 'Burning subtitles…', srtPath: subFilePath, stagingPath })

  // 6. Pass 2 — burn ASS subtitles onto staging video
  const outputPath = path.join(jobDir, 'output.mp4')
  const escapedSub = subFilePath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'")

  if (useKaraoke) {
    subFilter = `subtitles='${escapedSub}'`
  } else {
    const subStyle = resolveStyle(styleId, fontSize, marginV)
    subFilter = `subtitles='${escapedSub}':force_style='${subStyle}'`
  }

  const subArgs = [
    '-y', '-i', stagingPath,
    '-vf', subFilter,
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
    '-c:a', 'copy',
    '-movflags', '+faststart',
    outputPath,
  ]

  await new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', subArgs)
    let stderr = ''
    ff.stderr.on('data', (d) => { stderr += d.toString() })
    ff.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`FFmpeg subtitle burn exit ${code}: ${stderr.slice(-600)}`))
    })
  })

  jobs.set(jobId, { status: 'done', outputPath, stagingPath, srtPath: subFilePath })
}

// ── TTS via edge-tts ──────────────────────────────────────────────────────────
// POST /tts  { chunks: string[], voice?: string }
// Returns    { audioUrls: string[] }  — synchronous, edge-tts is fast

app.post('/tts', async (req, res) => {
  const { chunks, voice = 'en-US-JennyNeural' } = req.body
  if (!Array.isArray(chunks) || !chunks.length) return res.status(400).json({ error: 'chunks[] required' })

  try {
    const base = `https://${req.headers.host}`
    const audioUrls = []

    for (let i = 0; i < chunks.length; i++) {
      const ttsId = crypto.randomUUID()
      const outPath = path.join(WORK_DIR, `tts_${ttsId}.mp3`)

      await new Promise((resolve, reject) => {
        const py = spawn('python3', [path.join(__dirname, 'tts.py'), chunks[i], outPath, voice])
        let err = ''
        py.stderr.on('data', (d) => { err += d.toString() })
        py.on('close', (code) => {
          if (code !== 0) return reject(new Error(`edge-tts failed (chunk ${i}): ${err.slice(-300)}`))
          resolve()
        })
      })

      audioUrls.push(`${base}/tts-audio/${ttsId}`)
      // Store path for serving
      jobs.set(`tts_${ttsId}`, { audioPath: outPath })
    }

    res.json({ audioUrls })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/tts-audio/:ttsId', (req, res) => {
  const job = jobs.get(`tts_${req.params.ttsId}`)
  if (!job || !job.audioPath) return res.status(404).json({ error: 'Audio not found' })
  res.setHeader('Content-Type', 'audio/mpeg')
  fsSync.createReadStream(job.audioPath).pipe(res)
})

// ── Routes ────────────────────────────────────────────────────────────────────

// POST /transcribe { audioUrl } → { words: [{word,start,end}], duration }
app.post('/transcribe', async (req, res) => {
  const { audioUrl } = req.body
  if (!audioUrl) return res.status(400).json({ error: 'audioUrl required' })
  const tmpPath = path.join(WORK_DIR, `transcribe_${crypto.randomUUID()}.mp3`)
  try {
    await downloadFile(audioUrl, tmpPath)
    const [words, duration] = await Promise.all([
      transcribeAudio(tmpPath),
      getAudioDuration(tmpPath),
    ])
    fs.unlink(tmpPath).catch(() => {})
    res.json({ words, duration })
  } catch (err) {
    fs.unlink(tmpPath).catch(() => {})
    res.status(500).json({ error: err.message })
  }
})

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
    const base = `https://${req.headers.host}`
    return res.json({
      status: 'done',
      videoUrl: `${base}/video/${req.params.jobId}`,
      stagingUrl: `${base}/staging/${req.params.jobId}`,
      srtUrl: `${base}/srt/${req.params.jobId}`,
    })
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

app.get('/staging/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId)
  if (!job || !job.stagingPath) {
    return res.status(404).json({ error: 'Staging video not ready' })
  }
  res.setHeader('Content-Type', 'video/mp4')
  res.setHeader('Content-Disposition', 'attachment; filename="staging.mp4"')
  fsSync.createReadStream(job.stagingPath).pipe(res)
})

app.get('/srt/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId)
  if (!job || !job.srtPath) return res.status(404).json({ error: 'SRT not found' })
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="captions.srt"`)
  fsSync.createReadStream(job.srtPath).pipe(res)
})

// GET /frame/:jobId/:sec — extract a single frame at t=sec seconds from staging video
app.get('/frame/:jobId/:sec', async (req, res) => {
  const job = jobs.get(req.params.jobId)
  if (!job || !job.stagingPath) return res.status(404).json({ error: 'Staging video not found' })
  const sec = parseFloat(req.params.sec)
  if (isNaN(sec) || sec < 0) return res.status(400).json({ error: 'Invalid time' })

  const framePath = path.join(WORK_DIR, `frame_${req.params.jobId}_${sec}.jpg`)
  try {
    await new Promise((resolve, reject) => {
      const ff = spawn('ffmpeg', [
        '-y', '-ss', String(sec), '-i', job.stagingPath,
        '-vframes', '1', '-q:v', '2', framePath,
      ])
      let stderr = ''
      ff.stderr.on('data', (d) => { stderr += d.toString() })
      ff.on('close', (code) => code === 0 ? resolve() : reject(new Error(stderr.slice(-200))))
    })
    res.setHeader('Content-Type', 'image/jpeg')
    fsSync.createReadStream(framePath).pipe(res)
    res.on('finish', () => fs.unlink(framePath).catch(() => {}))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /duration/:jobId — return staging video duration in seconds
app.get('/duration/:jobId', async (req, res) => {
  const job = jobs.get(req.params.jobId)
  if (!job || !job.stagingPath) return res.status(404).json({ error: 'Staging video not found' })
  try {
    const duration = await getAudioDuration(job.stagingPath)
    res.json({ duration })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/health', (_, res) => res.json({ ok: true }))

const PORT = process.env.PORT || 3001
app.listen(PORT, () => console.log(`FFmpeg server on port ${PORT}`))
