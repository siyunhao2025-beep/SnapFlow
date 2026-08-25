import React, { useEffect, useMemo, useState } from 'react'
import type { BootstrapData, CapturePayload, CaptureRect, VisualDescriptor } from '../../../shared/types'
import { pointInsideRect, rectFromPoints } from '../../../shared/capture-math'
import { useLanguage } from '../i18n'

type Point = { x: number; y: number }

export function CaptureOverlay() {
  const { text } = useLanguage()
  const [capture, setCapture] = useState<CapturePayload | null>(null)
  const [boot, setBoot] = useState<BootstrapData | null>(null)
  const [start, setStart] = useState<Point | null>(null)
  const [current, setCurrent] = useState<Point | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    window.snapflow.getPendingCapture()
      .then((payload) => {
        if (!payload) setError(text('没有可用的截图数据，请取消后重试。', 'No capture data is available. Cancel and try again.'))
        setCapture(payload)
      })
      .catch((e: any) => setError(e?.message || text('无法读取截图数据', 'Unable to read capture data')))
    window.snapflow.getBootstrap().then(setBoot).catch((e: any) => setError(e?.message || text('无法读取截图设置', 'Unable to read capture settings')))
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') void window.snapflow.cancelCapture()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])

  const rect = useMemo<CaptureRect | null>(() => {
    if (!start || !current) return null
    return rectFromPoints(start, current)
  }, [start, current])

  if (!capture) return <div className="capture-loading">{error ? <><b>{text('截图初始化失败', 'Capture initialization failed')}</b><span>{error}</span><button onClick={() => void window.snapflow.cancelCapture()}>{text('取消', 'Cancel')}</button></> : text('正在准备截图…', 'Preparing capture…')}</div>

  const pointer = (e: React.PointerEvent<HTMLDivElement>) => ({ x: e.clientX, y: e.clientY })

  function playCaptureSound() {
    if (!boot?.settings.screenshot.playSound) return
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
      const ctx = new AudioCtx()
      const oscillator = ctx.createOscillator()
      const gain = ctx.createGain()
      oscillator.frequency.value = 880
      gain.gain.value = 0.025
      oscillator.connect(gain)
      gain.connect(ctx.destination)
      oscillator.start()
      oscillator.stop(ctx.currentTime + 0.045)
    } catch {
      // Sound is optional and must never block capture.
    }
  }

  async function renderSelectedCrop(selection: CaptureRect) {
    if (!boot?.settings.screenshot.showCursor || !capture) return undefined
    const image = new Image()
    image.src = capture.dataUrl
    await image.decode()
    const sx = image.naturalWidth / capture.displayBounds.width
    const sy = image.naturalHeight / capture.displayBounds.height
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(selection.width * sx))
    canvas.height = Math.max(1, Math.round(selection.height * sy))
    const ctx = canvas.getContext('2d')
    if (!ctx) return undefined
    ctx.drawImage(
      image,
      Math.round(selection.x * sx), Math.round(selection.y * sy), canvas.width, canvas.height,
      0, 0, canvas.width, canvas.height
    )
    const cursor = capture.cursorPosition
    if (cursor && pointInsideRect(cursor, selection)) {
      const cx = Math.max(0, Math.min(canvas.width - 1, Math.round((cursor.x - selection.x) * sx)))
      const cy = Math.max(0, Math.min(canvas.height - 1, Math.round((cursor.y - selection.y) * sy)))
      const scale = Math.max(1, Math.min(sx, sy))
      ctx.save()
      ctx.translate(cx, cy)
      ctx.scale(scale, scale)
      ctx.beginPath()
      ctx.moveTo(0, 0); ctx.lineTo(0, 22); ctx.lineTo(6, 16); ctx.lineTo(10, 27); ctx.lineTo(15, 25); ctx.lineTo(11, 14); ctx.lineTo(20, 14); ctx.closePath()
      ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#111111'; ctx.lineWidth = 2
      ctx.fill(); ctx.stroke(); ctx.restore()
    }
    return canvas.toDataURL('image/png')
  }

  async function analyzeSelection(selection: CaptureRect): Promise<VisualDescriptor | undefined> {
    if (!capture) return undefined
    try {
      const blob = await (await fetch(capture.dataUrl)).blob()
      const bitmap = await createImageBitmap(blob)
      return await new Promise<VisualDescriptor | undefined>((resolve) => {
        const worker = new Worker(new URL('../workers/ocr.worker.ts', import.meta.url), { type: 'module' })
        const timer = window.setTimeout(() => { worker.terminate(); resolve(undefined) }, 2500)
        worker.onmessage = (event) => {
          window.clearTimeout(timer)
          worker.terminate()
          resolve(event.data?.ok ? event.data.descriptor as VisualDescriptor : undefined)
        }
        worker.onerror = () => { window.clearTimeout(timer); worker.terminate(); resolve(undefined) }
        worker.postMessage({ mode: 'visual', bitmap, selection, displayWidth: capture.displayBounds.width, displayHeight: capture.displayBounds.height }, [bitmap])
      })
    } catch {
      return undefined
    }
  }

  const finish = async (selection: CaptureRect | null = rect) => {
    if (!selection || selection.width < 8 || selection.height < 8 || busy) return
    setBusy(true)
    setError('')
    try {
      playCaptureSound()
      const [renderedDataUrl, visual] = await Promise.all([renderSelectedCrop(selection), analyzeSelection(selection)])
      await window.snapflow.completeCapture(selection, renderedDataUrl, visual)
    } catch (e: any) {
      setBusy(false)
      setError(e?.message || text('截图失败，请重试', 'Capture failed. Please try again.'))
    }
  }

  return (
    <div
      className="capture-root"
      onContextMenu={(e) => {
        e.preventDefault()
        void window.snapflow.cancelCapture()
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.currentTarget.setPointerCapture(e.pointerId)
        const p = pointer(e)
        setStart(p)
        setCurrent(p)
      }}
      onPointerMove={(e) => start && setCurrent(pointer(e))}
      onPointerUp={(e) => {
        if (e.button !== 0 || !start) return
        const end = pointer(e)
        setCurrent(end)
        void finish(rectFromPoints(start, end))
      }}
    >
      <img className="capture-dim-image" src={capture.dataUrl} draggable={false} alt="Current display" />
      <div className="capture-hint">
        <b>SnapFlow</b>
        <span>{text('拖动框选 · 松开交给 AI · Esc / 右键取消', 'Drag to select · Release to send to AI · Esc / right-click to cancel')}</span>
      </div>
      {error && <div className="capture-error">{error}</div>}
      {rect && rect.width > 2 && rect.height > 2 && (
        <div
          className="capture-selection"
          style={{
            left: rect.x,
            top: rect.y,
            width: rect.width,
            height: rect.height,
            backgroundImage: `url(${capture.dataUrl})`,
            backgroundPosition: `-${rect.x}px -${rect.y}px`,
            backgroundSize: '100vw 100vh'
          }}
        >
          <div className="capture-size">{Math.round(rect.width)} × {Math.round(rect.height)}</div>
        </div>
      )}
    </div>
  )
}
