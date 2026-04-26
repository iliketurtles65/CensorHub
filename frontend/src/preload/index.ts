import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  openFolder: (): Promise<string[]> => ipcRenderer.invoke('dialog:openFolder'),
  openFile: (filters?: any): Promise<string[]> => ipcRenderer.invoke('dialog:openFile', filters),
  readFile: (filePath: string): Promise<{ name: string; bytes: ArrayBuffer }> =>
    ipcRenderer.invoke('fs:readFile', filePath),
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore
  window.electron = electronAPI
  // @ts-ignore
  window.api = api
}
