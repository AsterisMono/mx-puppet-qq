import { createWriteStream, existsSync, mkdirSync } from "fs";
import fetch from "node-fetch";
import { resolve as resolvePath } from "path";
export function isPrivateChat(remoteRoomId: string): boolean {
  return remoteRoomId.startsWith("p");
}
export function getOicqIdFromRoomId(remoteRoomId: string): number {
  return parseInt(remoteRoomId.slice(1));
}

export async function downloadTempFile(
  url: string,
  filename: string
): Promise<string> {
  const dir = resolvePath(process.cwd(), `tmp/files/`);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return new Promise((resolve, reject) => {
    const path = resolvePath(process.cwd(), `tmp/files/${filename}`);
    const filePath = createWriteStream(path);
    fetch(url).then((res) => {
      res.body?.pipe(filePath);
      filePath.on("finish", () => {
        filePath.close();
        resolve(path);
      });
      filePath.on("error", (e) => {
        reject(e);
      });
    });
  });
}
