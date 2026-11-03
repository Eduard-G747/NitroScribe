import { Menu, Tray, nativeImage } from 'electron'

export interface TrayActions {
  show: () => void
  newMeeting: () => void
  stopRecording: () => void
  quit: () => void
}

/** The macOS menu bar expects ~18 pt icons; Windows scales the 32 px tray icon itself. */
function icon(path: string) {
  const img = nativeImage.createFromPath(path)
  return process.platform === 'darwin' ? img.resize({ width: 18, height: 18 }) : img
}

export class AppTray {
  private tray: Tray
  private recording = false

  constructor(
    private icons: { idle: string; recording: string },
    private actions: TrayActions
  ) {
    this.tray = new Tray(icon(icons.idle))
    this.tray.setToolTip('NitroScribe')
    this.tray.on('click', () => actions.show())
    this.render()
  }

  setRecording(recording: boolean): void {
    if (recording === this.recording) return
    this.recording = recording
    this.tray.setImage(icon(recording ? this.icons.recording : this.icons.idle))
    this.tray.setToolTip(recording ? 'NitroScribe: recording' : 'NitroScribe')
    this.render()
  }

  private render() {
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Open NitroScribe', click: this.actions.show },
        { type: 'separator' },
        { label: 'New meeting and record', click: this.actions.newMeeting, enabled: !this.recording },
        { label: 'Stop recording', click: this.actions.stopRecording, enabled: this.recording },
        { type: 'separator' },
        { label: 'Quit', click: this.actions.quit }
      ])
    )
  }

  destroy(): void {
    this.tray.destroy()
  }
}
