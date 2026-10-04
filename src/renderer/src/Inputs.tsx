import { useState, type KeyboardEvent } from 'react'

export function explicitSubmit(event: KeyboardEvent<HTMLFormElement>): void {
  if (event.key === 'Enter' && event.target instanceof HTMLInputElement) event.preventDefault()
}

export function sendChatOnEnter(event: KeyboardEvent<HTMLTextAreaElement>, send: () => void): void {
  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
    event.preventDefault()
    send()
  }
}

export function MinutesInput({
  value,
  onChange,
  min = 5,
  max = 120,
  required = false,
  placeholder,
}: {
  value: number | null
  onChange: (value: number | null) => void
  min?: number
  max?: number
  required?: boolean
  placeholder?: string
}): React.JSX.Element {
  const [draft, setDraft] = useState(value === null ? '' : String(value))
  return (
    <input
      type="number"
      min={min}
      max={max}
      step="1"
      required={required}
      value={draft}
      placeholder={placeholder}
      onFocus={(event) => {
        setDraft(value === null ? '' : String(value))
        event.currentTarget.select()
      }}
      onChange={(event) => {
        const text = event.target.value
        setDraft(text)
      }}
      onBlur={() => {
        if (!draft) {
          onChange(null)
          return
        }
        const number = Number(draft)
        if (Number.isInteger(number) && number >= min && number <= max) {
          onChange(number)
          setDraft(String(number))
        }
      }}
    />
  )
}
