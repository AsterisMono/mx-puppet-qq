import { exec } from "child_process";
import { basename, resolve as resolvePath } from "path";
export async function silkToOgg(silkPath: string): Promise<string> {
  const filename = basename(silkPath);
  const audioPath = "tmp/audio";
  const toolsPath = "tools/";
  const pcmPath = `${audioPath}/pcm/${filename}.pcm`;
  const oggPath = `${audioPath}/ogg/${filename}.ogg`;
  const ffmpegCmd = "ffmpeg -y -f s16le -ar 24000 -ac 1";
  return new Promise((resolve, reject) => {
    exec(
      `${toolsPath}/bin/silk_decoder ${silkPath} ${pcmPath} && ${ffmpegCmd} -i ${pcmPath} ${oggPath}`
    ).on("exit", (code) => {
      if (code === 0) resolve(resolvePath(oggPath));
      else reject("Error converting silk to Ogg");
    });
  });
}
