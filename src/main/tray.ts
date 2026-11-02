import { Menu, Tray, nativeImage } from 'electron'

export interface TrayActions {
  show: () => void
  newMeeting: () => void
  stopRecording: () => void
  quit: () => void
}

export class AppTray {
  private tray: Tray
  private recording = false

  constructor(
    private icons: { idle: string; recording: string },
    private actions: TrayActions
  ) {
    this.tray = new Tray(nativeImage.createFromPath(icons.idle))
    this.tray.setToolTip('NitroScribe')
    this.tray.on('click', () => actions.show())
    this.render()
  }

  setRecording(recording: boolean): void {
    if (recording === this.recording) return
    this.recording = recording
    this.tray.setImage(nativeImage.createFromPath(recording ? this.icons.recording : this.icons.idle))
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
