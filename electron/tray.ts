import { BrowserWindow, nativeImage, screen, Tray } from 'electron';
import path from 'node:path';

export class QuickTray {
  private icon?: Tray;
  window?: BrowserWindow;
  constructor(private create: () => BrowserWindow) {}

  configure(enabled: boolean) {
    if (!enabled) {
      this.destroy();
      return;
    }
    if (this.icon) return;
    const mac = process.platform === 'darwin';
    const image = nativeImage
      .createFromPath(path.join(__dirname, '../../assets', mac ? 'trayTemplate.png' : 'icon.png'))
      .resize({ width: mac ? 22 : 24, height: mac ? 22 : 24 });
    if (mac) image.setTemplateImage(true);
    this.icon = new Tray(image);
    this.icon.setToolTip('Cutter · Quick Capture');
    this.window = this.create();
    this.window.on('show', () => this.window?.webContents.send('tray-refresh'));
    this.window.on('blur', () => this.hide());
    this.icon.on('click', () => this.toggle());
    this.icon.on('right-click', () => this.toggle());
  }

  private toggle() {
    const popup = this.window;
    if (!popup || !this.icon) return;
    if (popup.isVisible()) {
      this.hide();
      return;
    }
    const anchor = this.icon.getBounds();
    const area = screen.getDisplayNearestPoint({ x: anchor.x, y: anchor.y }).workArea;
    const [width, height] = popup.getSize();
    const x = Math.max(
      area.x,
      Math.min(area.x + area.width - width, anchor.x + anchor.width / 2 - width / 2),
    );
    const above = anchor.y - height - 8;
    const y = Math.max(
      area.y,
      Math.min(
        area.y + area.height - height,
        above >= area.y ? above : anchor.y + anchor.height + 8,
      ),
    );
    popup.setPosition(Math.round(x), Math.round(y));
    popup.show();
    popup.focus();
  }
  hide() {
    this.window?.hide();
  }
  destroy() {
    this.window?.destroy();
    this.window = undefined;
    this.icon?.destroy();
    this.icon = undefined;
  }
}
