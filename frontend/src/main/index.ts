import { app, shell, BrowserWindow, dialog, ipcMain, protocol, net } from 'electron'
import { basename, join } from 'path'
import { readFile } from 'fs/promises'
import { pathToFileURL } from 'url'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'

// Register custom scheme as privileged (must be before app.ready)
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'local-media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true
    }
  }
])

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 900,
    minHeight: 700,
    show: false,
    backgroundColor: '#0a0a0f',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0a0a0f',
      symbolColor: '#ff0066',
      height: 36
    },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      webSecurity: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Register custom protocol for serving local media files directly from disk
// This avoids HTTP overhead and lets Chromium stream natively
function registerMediaProtocol(): void {
  protocol.handle('local-media', async (request) => {
    // URL format: local-media://media/C:/path/to/file.mp4
    const url = new URL(request.url)
    const filePath = decodeURIComponent(url.pathname)
      .replace(/^\/media\//, '')
      .replace(/^\//, '')

    const response = await net.fetch(pathToFileURL(filePath).href)

    // Clone with CORS headers so Web Audio API can access the media
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: {
        ...Object.fromEntries(response.headers.entries()),
        'Access-Control-Allow-Origin': '*',
      }
    })
  })
}

// IPC: Open folder picker
ipcMain.handle('dialog:openFolder', async () => {
  if (!mainWindow) return []
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'multiSelections']
  })
  return result.canceled ? [] : result.filePaths
})

// IPC: Open file picker
ipcMain.handle('dialog:openFile', async (_event, filters) => {
  if (!mainWindow) return []
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: filters || [
      { name: 'Media Files', extensions: ['mp4', 'webm', 'mkv', 'avi', 'mov', 'jpg', 'png', 'gif'] }
    ]
  })
  return result.canceled ? [] : result.filePaths
})

// IPC: Read a local file and return bytes + basename for uploads
ipcMain.handle('fs:readFile', async (_event, filePath: string) => {
  const buf = await readFile(filePath)
  return { name: basename(filePath), bytes: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) }
})

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.censor.app')

  // Register the local-media:// protocol for direct file serving
  registerMediaProtocol()

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
