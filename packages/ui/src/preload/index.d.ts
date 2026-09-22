export {}
declare global {
  const electron: {
    ipcRenderer: {
      invoke(channel: string, payload?: any): Promise<any>
      send(channel: string, value?: any): void
      on(channel: string, callback: (...args: any[]) => void): void
      once(channel: string, callback: (...args: any[]) => void): void
      removeListener(channel: string, callback: Function): void
    }
  }
  interface Window {
    electron: typeof electron
  }
}
