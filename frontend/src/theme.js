import { useEffect, useState } from 'preact/hooks'

export function useTheme () {
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('solana-vote-theme') === 'dark' ? 'dark' : 'light' } catch { return 'light' }
  })
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try { localStorage.setItem('solana-vote-theme', theme) } catch {}
  }, [theme])
  return { theme, toggleTheme: () => setTheme(value => value === 'light' ? 'dark' : 'light') }
}
