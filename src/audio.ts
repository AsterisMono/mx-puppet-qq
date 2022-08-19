import { exec } from "child_process";
import { basename, resolve as resolvePath } from "path";

const audioPath = "tmp/audio";
const toolsPath = "tools";

export async function silkToOgg(silkPath: string): Promise<string> {
  const filename = basename(silkPath);
  const pcmPath = `${audioPath}/pcm/${filename}.pcm`;
  const oggPath = `${audioPath}/ogg/${filename}.ogg`;
  const ffmpegCmd = `ffmpeg -y -f s16le -ar 24000 -ac 1 -i ${pcmPath} ${oggPath}`;
  return new Promise((resolve, reject) => {
    exec(
      `${toolsPath}/bin/silk_decoder ${silkPath} ${pcmPath} && ${ffmpegCmd}`
    ).on("exit", (code) => {
      if (code === 0) resolve(resolvePath(oggPath));
      else reject("Error converting silk to Ogg");
    });
  });
}

export async function oggToSilk(oggPath: string): Promise<string> {
  const filename = basename(oggPath).replace(".ogg", "");
  const pcmPath = `${audioPath}/pcm/${filename}.pcm`;
  const silkPath = `${audioPath}/silk/${filename}`;
  const ffmpegCmd = `ffmpeg -y -i "${oggPath}" -f s16le -ar 24000 -ac 1 "${pcmPath}"`;
  return new Promise((resolve, reject) => {
    exec(
      `${ffmpegCmd} && ${toolsPath}/bin/silk_encoder ${pcmPath} ${silkPath} -tencent`
    ).on("exit", (code) => {
      if (code === 0) resolve(resolvePath(silkPath));
      else reject("Error converting ogg to silk");
    });
  });
}
