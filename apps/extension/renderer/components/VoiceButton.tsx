import { useEffect, useRef, useState } from 'react'
import { LoaderCircle, Mic, Square } from 'lucide-react'
import type { VoiceInput } from '../../shared/types'
import type { Translator } from '../lib/i18n'

interface VoiceButtonProps {
  t: Translator
  disabled?: boolean
  className?: string
  onVoice: (voice: VoiceInput) => Promise<void>
  onError: (message: string) => void
}

function preferredMimeType(): string | undefined {
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find((type) => MediaRecorder.isTypeSupported(type))
}

export function VoiceButton({ t, disabled = false, className = '', onVoice, onError }: VoiceButtonProps): React.JSX.Element {
  const [recording, setRecording] = useState(false)
  const [processing, setProcessing] = useState(false)
  const recorder = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const maxDuration = useRef<number | undefined>(undefined)

  const release = (): void => {
    if (maxDuration.current) window.clearTimeout(maxDuration.current)
    maxDuration.current = undefined
    stream.current?.getTracks().forEach((track) => track.stop())
    stream.current = null
    recorder.current = null
    setRecording(false)
  }

  useEffect(() => () => release(), [])

  const start = async (): Promise<void> => {
    try {
      onError('')
      const nextStream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.current = nextStream
      const mimeType = preferredMimeType()
      const nextRecorder = new MediaRecorder(nextStream, mimeType ? { mimeType } : undefined)
      const chunks: BlobPart[] = []
      nextRecorder.ondataavailable = (event) => { if (event.data.size > 0) chunks.push(event.data) }
      nextRecorder.onstop = () => {
        const blob = new Blob(chunks, { type: nextRecorder.mimeType || 'audio/webm' })
        release()
        if (blob.size < 400) return
        setProcessing(true)
        const reader = new FileReader()
        reader.onload = () => {
          const dataUrl = String(reader.result)
          const data = dataUrl.slice(dataUrl.indexOf(',') + 1)
          void onVoice({ data, mimeType: blob.type || 'audio/webm' }).catch((error: unknown) => onError(error instanceof Error ? error.message : t('voiceError'))).finally(() => setProcessing(false))
        }
        reader.onerror = () => { setProcessing(false); onError(t('voiceError')) }
        reader.readAsDataURL(blob)
      }
      recorder.current = nextRecorder
      nextRecorder.start()
      setRecording(true)
      maxDuration.current = window.setTimeout(() => { if (nextRecorder.state === 'recording') nextRecorder.stop() }, 60_000)
    } catch (error) {
      release()
      onError(error instanceof Error ? error.message : t('voicePermissionError'))
    }
  }

  const stop = (): void => { if (recorder.current?.state === 'recording') recorder.current.stop() }

  return <button type="button" className={`voice-button ${recording ? 'voice-button--recording' : ''} ${className}`} disabled={disabled || processing} onClick={() => { if (recording) stop(); else void start() }} title={recording ? t('voiceStop') : t('voiceStart')} aria-label={recording ? t('voiceStop') : t('voiceStart')}>
    {processing ? <LoaderCircle size={15} className="spin" /> : recording ? <Square size={13} fill="currentColor" /> : <Mic size={15} />}
  </button>
}
