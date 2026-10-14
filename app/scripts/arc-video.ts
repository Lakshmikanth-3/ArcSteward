// Demo-video director used only when ARC_RECORD_DIR is set: for each narrated scene it scrolls to an
// element, records its on-screen box (the editor zooms onto it), and holds for the narration length.
// Scene start/end times are written to marks.json so the video editor can cut exactly these windows.
import { readFileSync, writeFileSync } from 'node:fs';
import type { Locator, Page } from '@playwright/test';

export function director(page: Page, dir: string | undefined) {
  const holds: Record<string, number> = dir && process.env.ARC_HOLDS ? JSON.parse(readFileSync(process.env.ARC_HOLDS, 'utf8')) : {};
  const t0 = Date.now();
  const marks: Record<string, { t: [number, number]; box?: [number, number, number, number] }> = {};
  const now = () => (Date.now() - t0) / 1000;
  return {
    enabled: !!dir,
    async scene(name: string, target?: Locator) {
      if (!dir) return;
      let box: [number, number, number, number] | undefined;
      if (target) {
        await target.evaluate(el => el.scrollIntoView({ block: 'center' }));
        await page.waitForTimeout(500);
        const b = await target.boundingBox();
        if (b) box = [b.x, b.y, b.width, b.height];
      }
      const start = now();
      await page.waitForTimeout(((holds[name] ?? 4) + 1.2) * 1000);
      marks[name] = { t: [start, now()], box };
    },
    save() { if (dir) writeFileSync(`${dir}/marks.json`, JSON.stringify(marks)); },
  };
}
