import '@mantine/core/styles.css'
import '@xyflow/react/dist/style.css'
import './style.css'
import { createRoot } from 'react-dom/client'
import { MantineProvider } from '@mantine/core'
import { HashRouter } from 'react-router'
import { GoogleOAuthProvider } from '@react-oauth/google'
import { GOOGLE } from './api'
import App from './App'

createRoot(document.getElementById('root')).render(
  <GoogleOAuthProvider clientId={GOOGLE || 'unset'}>
    <MantineProvider defaultColorScheme="dark">
      <HashRouter>
        <App />
      </HashRouter>
    </MantineProvider>
  </GoogleOAuthProvider>,
)
