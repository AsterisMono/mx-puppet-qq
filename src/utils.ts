import { createWriteStream, existsSync, mkdirSync } from "fs";
import { Log } from "mx-puppet-bridge";
import fetch from "node-fetch";
import { Group, Member } from "oicq";
import { resolve as resolvePath } from "path";

const log = new Log("oicqPuppet:util");

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

export function makeid(length: number) {
  var result = "";
  var characters =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  var charactersLength = characters.length;
  for (var i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
}
export function timeout(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function debounce(fun, delay) {
  //fun 需要去抖动的方法，delay 指定的延迟时间
  var timer; // 用闭包维护一个timer 做为定时器标识
  return function () {
    var context = this; // 调用debounce的时候 保存执行上下文
    var args = arguments;
    clearTimeout(timer);
    timer = setTimeout(function () {
      fun.apply(context, args);
    }, delay); // 设定定时器 判断是否已经触发 ，如果触发则重新计时 等待dely毫秒再执行
  };
}

export async function getGroupOwner(g: Group): Promise<Member | undefined> {
  for (let [k, v] of await g.getMemberMap()) {
    if (g.pickMember(k).is_admin) {
      return g.pickMember(k);
    }
  }
  log.error(`发生了了不得的错误！看起来群${g.group_id}没有群主...`);
}
