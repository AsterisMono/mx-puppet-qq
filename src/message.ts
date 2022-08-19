import { IReceiveParams, Log, PuppetBridge } from "mx-puppet-bridge";
import { GroupMessageEvent, parseDmMessageId, PrivateMessageEvent } from "oicq";
import { genDmMessageId } from "oicq/lib/message";
import { silkToOgg } from "./audio";
import { downloadTempFile, makeid } from "./utils";
import { readFileSync } from "fs";

const log = new Log("oicqPuppet:messageParser");

// TODO: QQ消息格式处理
export async function parseOicqMessage(
  messageEvent: PrivateMessageEvent | GroupMessageEvent,
  bridge: PuppetBridge,
  sendParams: IReceiveParams
) {
  // console.log(messageEvent);
  const messageChain = messageEvent.message;
  const source = (messageEvent as PrivateMessageEvent).friend || undefined;
  // 处理回复
  let targetRemoteEventId: string | undefined = undefined;
  if (messageEvent.source) {
    const src = messageEvent.source;
    targetRemoteEventId = genDmMessageId(
      src.user_id,
      src.seq,
      src.rand,
      src.time
    ); // 这个Message里的seq是对不上的，要报给上游
    // console.log(
    //   `${sendParams.room.puppetId}, ${sendParams.room.roomId}, ${targetRemoteEventId}`
    // );
    // console.log(
    //   await bridge.eventStore.getMatrix(
    //     sendParams.room.puppetId,
    //     sendParams.room.roomId,
    //     targetRemoteEventId
    //   )
    // );
  }
  let buffer = "";
  for (let message of messageChain) {
    switch (message.type) {
      case "text":
        buffer = buffer.concat(message.text);
        await bridge.sendMessage(sendParams, {
          body: buffer,
        });
        buffer = "";
        break;
      case "image":
        await bridge.sendImage(sendParams, message.url as string, "image");
        break;
      case "file":
        if (sendParams.room.isDirect) {
          await bridge.sendFile(
            sendParams,
            await source.getFileUrl(message.fid),
            message.name
          );
        } else {
          // 是群文件，默认不下载，使用群文件模块访问就行
          await bridge.sendMessage(sendParams, {
            // TODO: 给群文件增加下载链接
            body: `上传了新的群文件：${message.name}`,
          });
        }
        break;
      case "at":
        buffer = buffer.concat(message.text as string);
        break;
      case "record":
        // 语音消息：下载-转换-发送
        const silkPath = await downloadTempFile(
          message.url as string,
          message.md5 || `unknownSilk${makeid(16)}`,
          "audio/silk"
        ); // TODO: Hardcoded path
        const oggPath = await silkToOgg(silkPath);
        const oggBuffer: Buffer = readFileSync(oggPath);
        await bridge.sendAudio(sendParams, oggBuffer, "语音消息");
        break;
      default:
        await bridge.sendMessage(sendParams, {
          body: messageEvent.raw_message,
        });
        break;
    }
  }
}
