// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../src/renderer/src/App'

describe('desktop workspace', () => {
  it('navigates to goals from the empty plan', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: 'Add your goals' }))
    expect(screen.getByRole('heading', { name: 'Goals', level: 1 })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Goals' })).toHaveAttribute('aria-current', 'page')
  })
  it('lets the user choose an appearance preference', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }))
    await userEvent.selectOptions(screen.getByLabelText('Theme'), 'dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(localStorage.getItem('daily-theme')).toBe('dark')
  })
})
