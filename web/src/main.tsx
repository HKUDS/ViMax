import {createRoot} from 'react-dom/client';
import App from './App';
import './styles.css';
import {applyTheme, resolveTheme, THEME_STORAGE_KEY} from './theme';

let storedTheme: string | null = null;
try {
  storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
} catch {
  // Local storage can be unavailable in hardened browser contexts.
}
applyTheme(resolveTheme(storedTheme, window.matchMedia('(prefers-color-scheme: dark)').matches));

createRoot(document.getElementById('root')!).render(<App />);
