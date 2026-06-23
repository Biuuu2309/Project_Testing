import { useCallback, useEffect, useLayoutEffect, useState } from 'react'
import './TourGuide.css'

const PAD = 8

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function findTarget(step) {
  if (!step?.target) return null
  return document.querySelector(step.target) || (step.fallback ? document.querySelector(step.fallback) : null)
}

export default function TourGuide({
  open,
  step,
  steps,
  onNext,
  onPrev,
  onSkip,
  onFinish,
}) {
  const current = steps[step]
  const [rect, setRect] = useState(null)
  const [tooltipStyle, setTooltipStyle] = useState({})

  const measure = useCallback(() => {
    if (!open || !current) {
      setRect(null)
      return
    }

    const el = findTarget(current)
    const tooltipWidth = Math.min(320, window.innerWidth - 24)

    if (!el) {
      setRect(null)
      setTooltipStyle({
        top: '50%',
        left: '50%',
        width: tooltipWidth,
        transform: 'translate(-50%, -50%)',
      })
      return
    }

    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    const r = el.getBoundingClientRect()
    setRect({
      viewTop: r.top - PAD,
      viewLeft: r.left - PAD,
      width: r.width + PAD * 2,
      height: r.height + PAD * 2,
    })

    const gap = 14
    let tipTop = r.bottom + gap
    let tipLeft = clamp(r.left + r.width / 2 - tooltipWidth / 2, 12, window.innerWidth - tooltipWidth - 12)

    if (tipTop + 200 > window.innerHeight - 12) {
      tipTop = Math.max(12, r.top - gap - 180)
    }

    setTooltipStyle({ top: tipTop, left: tipLeft, width: tooltipWidth, transform: 'none' })
  }, [open, current])

  useLayoutEffect(() => {
    measure()
  }, [measure, step])

  useEffect(() => {
    if (!open) return undefined
    const onUpdate = () => measure()
    window.addEventListener('resize', onUpdate)
    window.addEventListener('scroll', onUpdate, true)
    const t = window.setTimeout(measure, 120)
    return () => {
      window.removeEventListener('resize', onUpdate)
      window.removeEventListener('scroll', onUpdate, true)
      window.clearTimeout(t)
    }
  }, [open, measure, step])

  if (!open || !current) return null

  const isFirst = step === 0
  const isLast = step === steps.length - 1

  return (
    <div className="tour-root" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      {rect ? (
        <div
          className="tour-spotlight"
          style={{
            top: rect.viewTop,
            left: rect.viewLeft,
            width: rect.width,
            height: rect.height,
          }}
        />
      ) : (
        <div className="tour-backdrop" />
      )}

      <div className={`tour-tooltip${rect ? '' : ' tour-tooltip-centered'}`} style={tooltipStyle}>
        <div className="tour-tooltip-header">
          <span className="tour-step-count">
            Bước {step + 1}/{steps.length}
          </span>
          <button type="button" className="tour-skip" onClick={onSkip}>
            Bỏ qua
          </button>
        </div>
        <h3 id="tour-title" className="tour-title">
          {current.title}
        </h3>
        <p className="tour-content">{current.content}</p>
        <div className="tour-actions">
          {!isFirst && (
            <button type="button" className="btn btn-secondary tour-btn" onClick={onPrev}>
              Quay lại
            </button>
          )}
          {isLast ? (
            <button type="button" className="btn btn-primary tour-btn" onClick={onFinish}>
              Hoàn tất
            </button>
          ) : (
            <button type="button" className="btn btn-primary tour-btn" onClick={onNext}>
              Tiếp theo
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
