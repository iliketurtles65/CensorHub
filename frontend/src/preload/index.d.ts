import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      openFolder: () => Promise<string[]>
      openFile: (filters?: any) => Promise<string[]>
    }
  }
}
